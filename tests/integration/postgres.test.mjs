import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { createService } from '../../src/db/service.mjs';

const url = new URL(process.env.NEXO_TEST_URL || 'postgres://invalid');
if (process.env.NEXO_TEST_LOCAL !== '1' || url.hostname !== '127.0.0.1' || !/^\/nexo_test_[a-f0-9]+$/.test(url.pathname)) {
  throw new Error('Run npm run test:integration: isolated local database required');
}
const admin = new pg.Client({connectionString: url.href});
let pool, api, fixture;
const runtimePassword = randomBytes(32).toString('hex');
before(async () => {
  await admin.connect();
  const version = await admin.query('SHOW server_version');
  console.log(`PostgreSQL real: ${version.rows[0].server_version}`);
  assert.deepEqual(await migrate(admin),['001_core.sql','002_operations.sql','003_queue.sql']);
  // A real non-owner, non-superuser login exercises grants and RLS.
  await admin.query(`CREATE ROLE nexo_test_runtime LOGIN PASSWORD '${runtimePassword}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
    GRANT nexo_app TO nexo_test_runtime`);
  const runtimeUrl = new URL(url); runtimeUrl.username='nexo_test_runtime'; runtimeUrl.password=runtimePassword;
  pool = new pg.Pool({connectionString:runtimeUrl.href,max:40});
  api=createService(pool);
});
after(async () => { if(pool) await pool.end(); await admin.end(); });

beforeEach(async () => {
  await admin.query(`TRUNCATE nexo.audit_events,nexo.bookings,nexo.actions,nexo.fares,nexo.trips,
    nexo.vehicles,nexo.stops,nexo.routes,nexo.memberships,nexo.sessions,nexo.users,nexo.associations`);
  const f = {A:randomUUID(),B:randomUUID(),ra:randomUUID(),rb:randomUUID(),
    adminA:randomUUID(),adminB:randomUUID(),p:randomUUID(),other:randomUUID(),
    drivers:Array.from({length:4},randomUUID),vehicles:Array.from({length:4},randomUUID),
    trips:Array.from({length:4},randomUUID),tokens:{}};
  for(const key of ['adminA','adminB','p','other']) {
    await admin.query('INSERT INTO nexo.users VALUES($1,$2)',[f[key],`fictional-${key}`]);
    f.tokens[key]=randomBytes(32).toString('hex');
    await session(f[key],f.tokens[key]);
  }
  for(let i=0;i<4;i++) {
    await admin.query('INSERT INTO nexo.users VALUES($1,$2)',[f.drivers[i],`fictional-driver-${i}`]);
    f.tokens[`d${i}`]=randomBytes(32).toString('hex');
    await session(f.drivers[i],f.tokens[`d${i}`]);
  }
  for(const a of [f.A,f.B]) await admin.query('INSERT INTO nexo.associations(id,name) VALUES($1,$2)',[a,'Asociación ficticia']);
  await admin.query(`INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true),($3,$4,'ASSOCIATION_ADMIN',true)`,[f.A,f.adminA,f.B,f.adminB]);
  for(const [route,a] of [[f.ra,f.A],[f.rb,f.B]]) {
    await admin.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code) VALUES($1,$2,'Ruta ficticia','OUT',1,4,'Y-FICTICIO','V-FICTICIO')",[route,a]);
    for(let s=0;s<4;s++) await admin.query('INSERT INTO nexo.stops(association_id,route_id,stop_index,name) VALUES($1,$2,$3,$4)',[a,route,s,`Parada ficticia ${s}`]);
    for(let from=0;from<3;from++) for(let to=from+1;to<4;to++) for(const express of [false,true]) {
      await admin.query(`INSERT INTO nexo.fares(association_id,route_id,from_stop,to_stop,express,version,amount_bob,valid_from)
        VALUES($1,$2,$3,$4,$5,1,$6,now()-interval '1 day')`,[a,route,from,to,express,express?60:10]);
    }
  }
  for(let i=0;i<4;i++) {
    const a=i===3?f.B:f.A, route=i===3?f.rb:f.ra;
    await admin.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[a,f.drivers[i]]);
    await admin.query('INSERT INTO nexo.vehicles(id,association_id,label) VALUES($1,$2,$3)',[f.vehicles[i],a,`FICTICIO-${i}`]);
    await admin.query('INSERT INTO nexo.trips(id,association_id,route_id,vehicle_id,driver_id,position_no) VALUES($1,$2,$3,$4,$5,$6)',[f.trips[i],a,route,f.vehicles[i],f.drivers[i],i+1]);
  }
  fixture=f;
});
async function session(user,token) {
  await admin.query("INSERT INTO nexo.sessions VALUES($1,$2,now()+interval '1 hour',NULL)",[
    createHash('sha256').update(token).digest('hex'),user]);
}
const request=(seats=1,more={})=>({routeId:fixture.ra,from:0,to:3,seats,...more});
const key=()=>randomUUID();
async function sql(token,query,values=[]) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
    const result=await client.query(query,values);
    await client.query('COMMIT'); return result;
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally {client.release();}
}
const rejects=(promise,pattern)=>assert.rejects(promise,pattern);
async function hold(seats=1,more={},token=fixture.tokens.p) { return api.reserve(token,key(),request(seats,more)); }
async function acceptAll(group) {
  for(const booking of group.bookingIds) {
    const {rows:[b]}=await admin.query('SELECT t.driver_id FROM nexo.bookings b JOIN nexo.trips t ON b.trip_id=t.id WHERE b.id=$1',[booking]);
    const driver=fixture.drivers.indexOf(b.driver_id);
    await api.respond(fixture.tokens[`d${driver}`],key(),booking,true);
  }
}
async function fixed(seats,trip=0,more={}) { return hold(seats,{parts:[{tripId:fixture.trips[trip],seats}],...more}); }
async function occupancy() {
  return (await admin.query(`SELECT t.id,s,coalesce(sum(b.seats),0)::integer AS used FROM nexo.trips t
    CROSS JOIN generate_series(0,2) s LEFT JOIN nexo.bookings b ON b.trip_id=t.id AND nexo.live(b)
    AND b.from_stop<=s AND b.to_stop>s GROUP BY t.id,s ORDER BY t.id,s`)).rows;
}

test('migrations: second application is a no-op, registry checksums match',async()=>{
  assert.deepEqual(await migrate(admin),[]);
  assert.equal((await admin.query('SELECT * FROM public.nexo_migrations')).rowCount,3);
});
test('migrations: failed DDL rolls back; checksum drift is rejected',async()=>{
  const dir=await mkdtemp(resolve('.local','migration-test-'));
  const directory=pathToFileURL(dir+sep);
  await writeFile(resolve(dir,'999_probe.sql'),'CREATE TABLE nexo.rollback_probe(id int); SELECT missing_function();');
  await rejects(migrate(admin,directory),/missing_function/);
  assert.equal((await admin.query("SELECT to_regclass('nexo.rollback_probe') AS t")).rows[0].t,null);
  assert.equal((await admin.query("SELECT * FROM public.nexo_migrations WHERE name='999_probe.sql'")).rowCount,0);
  await writeFile(resolve(dir,'001_core.sql'),'SELECT 1;');
  await rejects(migrate(admin,directory),/CHECKSUM_MISMATCH/);
});
test('T01: RLS admin A/B and driver only see their operational scope',async()=>{
  const a=await sql(fixture.tokens.adminA,'SELECT * FROM nexo.vehicles');
  const b=await sql(fixture.tokens.adminB,'SELECT * FROM nexo.vehicles');
  assert.equal(a.rowCount,3); assert.equal(b.rowCount,1);
  assert.ok(a.rows.every(v=>v.association_id===fixture.A));
  assert.ok(b.rows.every(v=>v.association_id===fixture.B));
  assert.equal((await sql(fixture.tokens.d0,'SELECT * FROM nexo.trips')).rowCount,1);
  assert.equal((await sql(fixture.tokens.d0,'SELECT * FROM nexo.vehicles')).rowCount,1);
});
test('T02: passenger cannot read/change/cancel someone else; raw DML denied',async()=>{
  const g=await hold();
  assert.equal((await api.bookings(fixture.tokens.other)).length,0);
  await rejects(api.cancel(fixture.tokens.other,key(),g.bookingIds[0]),/FORBIDDEN/);
  await rejects(sql(fixture.tokens.p,'UPDATE nexo.bookings SET seats=6'),/permission denied/);
  await rejects(sql(fixture.tokens.adminA,'DELETE FROM nexo.audit_events'),/permission denied/);
  await rejects(sql(fixture.tokens.adminA,'INSERT INTO nexo.memberships VALUES($1,$2,$3,true)',[fixture.B,fixture.adminA,'ASSOCIATION_ADMIN']),/permission denied/);
  await rejects(sql(fixture.tokens.adminA,'SELECT * FROM nexo.sessions'),/permission denied/);
});
test('authentication: forged actor/association context, invalid, expired and revoked tokens denied',async()=>{
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('nexo.user_id',$1,true),set_config('nexo.association_id',$2,true)",[fixture.adminA,fixture.A]);
    assert.equal((await c.query('SELECT * FROM nexo.vehicles')).rowCount,0);
    await c.query('ROLLBACK');
  } finally {c.release();}
  await rejects(api.reserve('x'.repeat(64),key(),request()),/UNAUTHENTICATED/);
  await rejects(hold(1,{associationId:fixture.B}),/INVALID_REQUEST/);
  await admin.query('UPDATE nexo.sessions SET revoked_at=now() WHERE user_id=$1',[fixture.p]);
  await rejects(hold(),/UNAUTHENTICATED/);
  await admin.query("UPDATE nexo.sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE user_id=$1",[fixture.p]);
  await rejects(hold(),/UNAUTHENTICATED/);
  // The pooled connection has no residual transaction-local identity.
  assert.equal((await pool.query('SELECT * FROM nexo.vehicles')).rowCount,0);
});
test('runtime: privileged connections and internal helpers cannot bypass validation',async()=>{
  await rejects(sql(fixture.tokens.p,"SELECT nexo.action_finish('forged','{}','{}')"),/permission denied/);
  await rejects(sql(fixture.tokens.p,'SELECT nexo.expire_holds($1)',[fixture.ra]),/permission denied/);
  const privileged=new pg.Pool({connectionString:url.href});
  try { await rejects(createService(privileged).reserve(fixture.tokens.p,key(),request()),/UNSAFE_RUNTIME_ROLE/); }
  finally {await privileged.end();}
});
test('T03/T05: 3 walk-ins force group of 5 into next eligible vehicle, together',async()=>{
  await hold(3,{source:'WALK_IN'},fixture.tokens.adminA);
  const group=await hold(5);
  const rows=await admin.query('SELECT * FROM nexo.bookings WHERE group_id=$1',[group.groupId]);
  assert.equal(rows.rowCount,1); assert.equal(rows.rows[0].trip_id,fixture.trips[1]);
  await rejects(hold(1,{source:'WALK_IN'},fixture.tokens.p),/FORBIDDEN_SOURCE/);
  await rejects(api.reserve(fixture.tokens.adminA,key(),request(1,{source:'WALK_IN',routeId:fixture.rb})),/FORBIDDEN_SOURCE/);
});
test('T04: 24 simultaneous connections compete for the final seat; exactly one wins',async()=>{
  await fixed(5);
  const results=await Promise.allSettled(Array.from({length:24},()=>fixed(1)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>/NO_CAPACITY/.test(r.reason.message)));
  assert.ok((await occupancy()).every(r=>r.used<=6));
  assert.deepEqual((await occupancy()).filter(r=>r.id===fixture.trips[0]).map(r=>r.used),[6,6,6]);
});
test('idempotency: concurrent same-key requests yield one group; conflicting payload denied',async()=>{
  const k=key(); const req=request(2);
  const results=await Promise.all(Array.from({length:16},()=>api.reserve(fixture.tokens.p,k,req)));
  assert.ok(results.every(r=>r.groupId===results[0].groupId));
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
  await rejects(api.reserve(fixture.tokens.p,k,request(3)),/IDEMPOTENCY_CONFLICT/);
});
test('T06: failure of second voluntary split leg rolls back both inventory and action',async()=>{
  const first=await fixed(6);
  await fixed(6,1);
  await api.cancel(fixture.tokens.p,key(),first.bookingIds[0]);
  const before=(await admin.query('SELECT * FROM nexo.bookings')).rowCount;
  await rejects(hold(5,{splitConsent:true,containsMinors:false,parts:[
    {tripId:fixture.trips[0],seats:3},{tripId:fixture.trips[1],seats:2}]}),/NO_CAPACITY/);
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,before);
  assert.equal((await admin.query("SELECT * FROM nexo.audit_events WHERE action='OFFER_CREATED'")).rowCount,2);
});
test('split consent, minors and express guards; linked group confirms only after all drivers accept',async()=>{
  const parts=[{tripId:fixture.trips[0],seats:3},{tripId:fixture.trips[1],seats:2}];
  await rejects(hold(5,{parts}),/SPLIT_NOT_ALLOWED/);
  await rejects(hold(5,{parts,splitConsent:true,containsMinors:true}),/SPLIT_NOT_ALLOWED/);
  const g=await hold(5,{parts,splitConsent:true,containsMinors:false});
  assert.equal((await api.respond(fixture.tokens.d0,key(),g.bookingIds[0],true)).status,'HELD');
  assert.equal((await admin.query("SELECT * FROM nexo.bookings WHERE status='CONFIRMED'")).rowCount,0);
  assert.equal((await api.respond(fixture.tokens.d1,key(),g.bookingIds[1],true)).status,'CONFIRMED');
  assert.equal((await admin.query("SELECT * FROM nexo.bookings WHERE status='CONFIRMED'")).rowCount,2);
});
test('T07: express cannot overlap any booking and cannot be divided',async()=>{
  await fixed(1);
  await rejects(fixed(6,0,{express:true}),/NO_CAPACITY/);
  await rejects(hold(6,{express:true,splitConsent:true,containsMinors:false,parts:[
    {tripId:fixture.trips[1],seats:3},{tripId:fixture.trips[2],seats:3}]}),/SPLIT_NOT_ALLOWED/);
  const g=await hold(6,{express:true});
  assert.equal((await admin.query('SELECT trip_id,price_bob FROM nexo.bookings WHERE group_id=$1',[g.groupId])).rows[0].trip_id,fixture.trips[1]);
});
test('T08/T09: full second vehicle departs once, only its driver, queue positions preserved',async()=>{
  const a=await fixed(2,0), b=await fixed(6,1);
  await acceptAll(a); await acceptAll(b);
  await rejects(api.depart(fixture.tokens.adminA,key(),fixture.trips[1]),/FORBIDDEN/);
  await rejects(api.depart(fixture.tokens.d0,key(),fixture.trips[0]),/NOT_FULL/);
  const k=key();
  const results=await Promise.all(Array.from({length:10},()=>api.depart(fixture.tokens.d1,k,fixture.trips[1])));
  assert.ok(results.every(r=>r.status==='IN_TRANSIT'));
  assert.equal((await admin.query("SELECT * FROM nexo.audit_events WHERE action='DEPARTED'")).rowCount,1);
  const {rows}=await admin.query('SELECT id,position_no,status FROM nexo.trips WHERE association_id=$1 ORDER BY position_no',[fixture.A]);
  assert.deepEqual(rows.map(r=>[r.position_no,r.status]),[['1','QUEUED'],['2','IN_TRANSIT'],['3','QUEUED']]);
});
test('T10/T11: past pickup, unauthorized stops, invalid segments and ambiguous fare denied',async()=>{
  await admin.query('UPDATE nexo.trips SET current_stop=1 WHERE id=$1',[fixture.trips[0]]);
  await rejects(fixed(1),/INCOMPATIBLE_TRIP/);
  await rejects(hold(1,{from:2,to:2}),/INVALID_SEGMENT/);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=false WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await rejects(hold(1,{from:1}),/INVALID_SEGMENT/);
  await admin.query(`INSERT INTO nexo.fares SELECT gen_random_uuid(),association_id,route_id,from_stop,to_stop,express,2,99,valid_from,valid_until
    FROM nexo.fares WHERE route_id=$1 AND from_stop=0 AND to_stop=3 AND NOT express`,[fixture.ra]);
  await rejects(hold(),/FARE_UNRESOLVED/);
  await admin.query('DELETE FROM nexo.fares WHERE route_id=$1',[fixture.ra]);
  await rejects(hold(),/FARE_UNRESOLVED/);
});
test('T13/T14: suspension hides public catalog, blocks new reservations; active trip finishes',async()=>{
  const g=await fixed(6); await acceptAll(g);
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await admin.query("UPDATE nexo.associations SET status='SUSPENDED' WHERE id=$1",[fixture.A]);
  assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.associations WHERE id=$1',[fixture.A])).rowCount,0);
  assert.equal((await sql(fixture.tokens.adminA,'SELECT * FROM nexo.associations WHERE id=$1',[fixture.A])).rowCount,1);
  await rejects(hold(),/ASSOCIATION_SUSPENDED/);
  assert.equal((await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3)).status,'COMPLETED');
});
test('T17: composite references and active-driver constraints prevent association mixing',async()=>{
  await rejects(fixed(1,3),/INCOMPATIBLE_TRIP/);
  const unusedVehicle=randomUUID();
  await admin.query("INSERT INTO nexo.vehicles(id,association_id,label) VALUES($1,$2,'FICTICIO-FK')",[unusedVehicle,fixture.B]);
  await rejects(admin.query('UPDATE nexo.trips SET vehicle_id=$1 WHERE id=$2',[unusedVehicle,fixture.trips[0]]),/foreign key/);
  await rejects(admin.query('UPDATE nexo.trips SET route_id=$1 WHERE id=$2',[fixture.rb,fixture.trips[0]]),/foreign key/);
  await rejects(admin.query('UPDATE nexo.trips SET driver_id=$1 WHERE id=$2',[fixture.drivers[3],fixture.trips[0]]),/INACTIVE_DRIVER/);
  const g=await fixed(1);
  await rejects(admin.query('UPDATE nexo.bookings SET trip_id=$1 WHERE id=$2',[fixture.trips[3],g.bookingIds[0]]),/foreign key/);
  await admin.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[fixture.B,fixture.drivers[0]]);
  await rejects(admin.query('UPDATE nexo.trips SET driver_id=$1 WHERE id=$2',[fixture.drivers[0],fixture.trips[3]]),/one_active_driver/);
  await admin.query('UPDATE nexo.memberships SET active=false WHERE user_id=$1',[fixture.drivers[0]]);
  await rejects(fixed(1),/INCOMPATIBLE_TRIP/);
});
test('T18: non-overlapping segments reuse seats; concurrent overlap stays at six',async()=>{
  await fixed(6,0,{from:0,to:1});
  await fixed(4,0,{from:1,to:3});
  const results=await Promise.allSettled(Array.from({length:12},()=>fixed(1,0,{from:1,to:2})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  assert.deepEqual((await occupancy()).filter(r=>r.id===fixture.trips[0]).map(r=>r.used),[6,6,4]);
  await rejects(fixed(1,0,{from:0,to:2}),/NO_CAPACITY/);
});
test('cancel/reject/expiry release whole group; price snapshots survive tariff changes',async()=>{
  const g=await fixed(6);
  await admin.query('UPDATE nexo.fares SET amount_bob=99,version=2 WHERE route_id=$1',[fixture.ra]);
  assert.equal((await api.bookings(fixture.tokens.p))[0].price_bob,'60.00');
  await api.cancel(fixture.tokens.p,key(),g.bookingIds[0]);
  assert.ok((await occupancy()).every(r=>r.used===0));
  const rejected=await fixed(6);
  await api.respond(fixture.tokens.d0,key(),rejected.bookingIds[0],false);
  const expired=await fixed(6);
  await admin.query("UPDATE nexo.bookings SET expires_at=now()-interval '1 second' WHERE group_id=$1",[expired.groupId]);
  assert.equal((await api.respond(fixture.tokens.d0,key(),expired.bookingIds[0],true)).status,'EXPIRED');
  await fixed(6);
});
test('departure supports confirmed later pickups; held-only seats cannot depart',async()=>{
  const g=await fixed(6,0,{from:1,to:3});
  await rejects(api.depart(fixture.tokens.d0,key(),fixture.trips[0]),/UNACCEPTED_OFFERS/);
  await acceptAll(g);
  assert.equal((await api.depart(fixture.tokens.d0,key(),fixture.trips[0])).status,'IN_TRANSIT');
  await rejects(api.cancel(fixture.tokens.p,key(),g.bookingIds[0]),/TRIP_ALREADY_STARTED/);
  await rejects(api.progress(fixture.tokens.d1,key(),fixture.trips[0],3),/FORBIDDEN/);
  await rejects(api.progress(fixture.tokens.d0,key(),fixture.trips[0],4),/INVALID_PROGRESS/);
});
test('queue: after arrival, own driver requests destination tail once; no forced reordering',async()=>{
  const target=randomUUID();
  await admin.query(`INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code)
    VALUES($1,$2,'Regreso ficticio','IN',1,4,'V-FICTICIO','Y-FICTICIO')`,[target,fixture.A]);
  await rejects(api.requestQueue(fixture.tokens.d0,key(),fixture.trips[0],target),/NOT_AVAILABLE/);
  const g=await fixed(6); await acceptAll(g);
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3);
  await rejects(api.requestQueue(fixture.tokens.adminA,key(),fixture.trips[0],target),/FORBIDDEN/);
  await rejects(api.requestQueue(fixture.tokens.d0,key(),fixture.trips[0],fixture.rb),/INVALID_DESTINATION_QUEUE/);
  await rejects(api.requestQueue(fixture.tokens.d0,key(),fixture.trips[0],fixture.ra),/INVALID_DESTINATION_QUEUE/);
  const k=key();
  const a=await api.requestQueue(fixture.tokens.d0,k,fixture.trips[0],target);
  const b=await api.requestQueue(fixture.tokens.d0,k,fixture.trips[0],target);
  assert.deepEqual(a,b); assert.equal(a.position,1);
  await rejects(api.requestQueue(fixture.tokens.d0,key(),fixture.trips[0],target),/ALREADY_ACTIVE/);
  // A past arrival cannot move the vehicle back to a stale location after a later trip.
  await admin.query("UPDATE nexo.trips SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[a.tripId]);
  await rejects(api.requestQueue(fixture.tokens.d0,key(),fixture.trips[0],target),/STALE_PREVIOUS_TRIP/);
});
test('audit rows are immutable, including trusted-owner accidental updates',async()=>{
  await hold();
  await rejects(admin.query("UPDATE nexo.audit_events SET action='FORGED'"),/IMMUTABLE_AUDIT/);
});
test('concurrent confirmation cannot duplicate seats or audit; cancel races remain consistent',async()=>{
  const g=await fixed(6);
  const responses=await Promise.all(Array.from({length:12},()=>api.respond(fixture.tokens.d0,key(),g.bookingIds[0],true)));
  assert.ok(responses.every(r=>r.status==='CONFIRMED'));
  assert.equal((await admin.query("SELECT * FROM nexo.audit_events WHERE action='OFFER_ACCEPTED'")).rowCount,1);
  const result=await Promise.allSettled([
    api.cancel(fixture.tokens.p,key(),g.bookingIds[0]), fixed(6)
  ]);
  assert.equal(result[0].status,'fulfilled');
  assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('concurrent migration runners serialize through advisory lock',async()=>{
  const other=new pg.Client({connectionString:url.href}); await other.connect();
  try {assert.deepEqual(await Promise.all([migrate(admin),migrate(other)]),[[],[]]);}
  finally {await other.end();}
});
test('explicit assignments cannot bypass the first compatible vehicle',async()=>{
  await rejects(fixed(1,1),/QUEUE_ORDER/);
  await rejects(hold(5,{splitConsent:true,containsMinors:false,parts:[
    {tripId:fixture.trips[1],seats:3},{tripId:fixture.trips[2],seats:2}]}),/QUEUE_ORDER/);
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,0);
});
