import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { createService } from '../../src/db/service.mjs';
import { createIdentity } from '../../src/auth/identity.mjs';
import { seedGeography,mapRoute,permit } from '../helpers/geography.mjs';

const url = new URL(process.env.NEXO_TEST_URL || 'postgres://invalid');
if (process.env.NEXO_TEST_LOCAL !== '1' || url.hostname !== '127.0.0.1' || !/^\/nexo_test_[a-f0-9]+$/.test(url.pathname)) {
  throw new Error('Run npm run test:integration: isolated local database required');
}
const admin = new pg.Client({connectionString: url.href});
let pool, api, fixture, identityPool, provisionPool, identity;
const runtimePassword = randomBytes(32).toString('hex');
before(async () => {
  await admin.connect();
  const version = await admin.query('SHOW server_version');
  console.log(`PostgreSQL real: ${version.rows[0].server_version}`);
  assert.deepEqual(await migrate(admin),['001_core.sql','002_operations.sql','003_queue.sql','004_isolation_guard.sql','005_geography_authorizations.sql','006_search_authorization_functions.sql','007_eligibility_rls.sql','008_locality_lookup.sql','009_identity_and_provisioning.sql']);
  // A real non-owner, non-superuser login exercises grants and RLS.
  await admin.query(`CREATE ROLE nexo_test_runtime LOGIN PASSWORD '${runtimePassword}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
    GRANT nexo_app TO nexo_test_runtime`);
  const runtimeUrl = new URL(url); runtimeUrl.username='nexo_test_runtime'; runtimeUrl.password=runtimePassword;
  pool = new pg.Pool({connectionString:runtimeUrl.href,max:40});
  api=createService(pool);
  for (const [name,group] of [['identity','nexo_identity'],['provision','nexo_provisioner']]) {
    await admin.query(`CREATE ROLE nexo_test_${name} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT; GRANT ${group} TO nexo_test_${name}`);
    const loginUrl=new URL(url); loginUrl.username='nexo_test_'+name; loginUrl.password=runtimePassword;
    const trustedPool=new pg.Pool({connectionString:loginUrl.href,max:12});
    if(name==='identity') identityPool=trustedPool; else provisionPool=trustedPool;
  }
  identity=createIdentity(identityPool);
});
after(async () => { for(const p of [pool,identityPool,provisionPool]) if(p) await p.end(); await admin.end(); });

beforeEach(async () => {
  await admin.query(`TRUNCATE nexo.identity_recovery,nexo.identity_accounts,nexo.identity_attempts,nexo.identity_events,
    nexo.audit_events,nexo.bookings,nexo.actions,nexo.fares,nexo.trips,
    nexo.vehicles,nexo.stops,nexo.routes,nexo.memberships,nexo.sessions,nexo.users,nexo.associations,
    nexo.authorization_events,nexo.route_authorizations,nexo.operation_reviewers,
    nexo.localities,nexo.municipalities,nexo.provinces,nexo.departments,nexo.geo_catalogs`);
  const f = {A:randomUUID(),B:randomUUID(),ra:randomUUID(),rb:randomUUID(),
    adminA:randomUUID(),adminB:randomUUID(),p:randomUUID(),other:randomUUID(),reviewer:randomUUID(),
    drivers:Array.from({length:4},randomUUID),vehicles:Array.from({length:4},randomUUID),
    trips:Array.from({length:4},randomUUID),tokens:{}};
  for(const key of ['adminA','adminB','p','other','reviewer']) {
    await admin.query('INSERT INTO nexo.users VALUES($1,$2)',[f[key],`fictional-${key}`]);
    f.tokens[key]=randomBytes(32).toString('hex');
    await session(f[key],f.tokens[key]);
  }
  for(let i=0;i<4;i++) {
    await admin.query('INSERT INTO nexo.users VALUES($1,$2)',[f.drivers[i],`fictional-driver-${i}`]);
    f.tokens[`d${i}`]=randomBytes(32).toString('hex');
    await session(f.drivers[i],f.tokens[`d${i}`]);
  }
  for(const a of [f.A,f.B]) await admin.query("INSERT INTO nexo.associations(id,name,adherence_status,operating_status) VALUES($1,$2,'ADHERED','OPERATING')",[a,'Asociación ficticia']);
  await admin.query('INSERT INTO nexo.operation_reviewers VALUES($1)',[f.reviewer]);
  f.geo=await seedGeography(admin);
  f.authorizations={};
  await admin.query(`INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true),($3,$4,'ASSOCIATION_ADMIN',true)`,[f.A,f.adminA,f.B,f.adminB]);
  for(const [route,a] of [[f.ra,f.A],[f.rb,f.B]]) {
    await admin.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code) VALUES($1,$2,'Ruta ficticia','OUT',1,4,'Y-FICTICIO','V-FICTICIO')",[route,a]);
    await mapRoute(admin,route,a,f.geo);
    f.authorizations[route]=await permit(admin,route,a,f.adminA,f.reviewer);
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
  assert.equal((await admin.query('SELECT * FROM public.nexo_migrations')).rowCount,9);
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
  await mapRoute(admin,target,fixture.A,fixture.geo,fixture.geo.localities[1],fixture.geo.localities[0]);
  await permit(admin,target,fixture.A,fixture.adminA,fixture.reviewer);
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
test('direct RPC cannot bypass fresh inventory snapshots with a different isolation level',async()=>{
  for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
    const client=await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await client.query("SELECT set_config('nexo.session_token',$1,true)",[fixture.tokens.p]);
      await rejects(client.query('SELECT nexo.reserve($1,$2::jsonb)',[key(),request()]),/UNSUPPORTED_ISOLATION/);
    } finally {await client.query('ROLLBACK'); client.release();}
  }
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,0);
});

const search=(seats=1,more={})=>api.search(fixture.tokens.p,{
  originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1],seats,...more
});
async function addService(destination) {
  const route=randomUUID(),driver=randomUUID(),vehicle=randomUUID();
  await admin.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count) VALUES($1,$2,'Servicio ficticio','OUT',1,2)",[route,fixture.A]);
  await mapRoute(admin,route,fixture.A,fixture.geo,fixture.geo.localities[0],destination,2);
  await permit(admin,route,fixture.A,fixture.adminA,fixture.reviewer);
  await admin.query("INSERT INTO nexo.users VALUES($1,'Chofer ficticio adicional')",[driver]);
  await admin.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[fixture.A,driver]);
  await admin.query("INSERT INTO nexo.vehicles(id,association_id,label) VALUES($1,$2,'FICTICIO-NACIONAL')",[vehicle,fixture.A]);
  await admin.query('INSERT INTO nexo.trips(association_id,route_id,vehicle_id,driver_id,position_no) VALUES($1,$2,$3,$4,1)',[fixture.A,route,vehicle,driver]);
  await admin.query("INSERT INTO nexo.fares(association_id,route_id,from_stop,to_stop,version,amount_bob,valid_from) VALUES($1,$2,0,1,1,20,now()-interval '1 day')",[fixture.A,route]);
  return route;
}
async function waitForReservationLock() {
  for(let i=0;i<200;i++) {
    const {rows:[row]}=await admin.query("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%nexo.reserve(%') AS waiting");
    if(row.waiting) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Reservation did not reach expected database lock');
}
test('G01: geographic hierarchy classifies all three coverage types, without a client selector',async()=>{
  const g=fixture.geo;
  for(const [i,expected] of [[1,'INTERMUNICIPAL'],[2,'INTERPROVINCIAL'],[3,'INTERDEPARTAMENTAL'],[4,null]]) {
    const {rows:[r]}=await admin.query('SELECT nexo.classify_journey($1,$2) AS coverage',[g.localities[0],g.localities[i]]);
    assert.equal(r.coverage,expected);
  }
  await addService(g.localities[2]); await addService(g.localities[3]);
  for(const [i,expected] of [[1,'INTERMUNICIPAL'],[2,'INTERPROVINCIAL'],[3,'INTERDEPARTAMENTAL']]) {
    const result=await search(1,{destinationLocalityId:g.localities[i]});
    assert.equal(result.coverage,expected); assert.ok(result.results.length>0);
    assert.ok(result.results.every(r=>r.coverage===expected));
  }
});
test('G02: origin/destination search returns only actual services, prices and boarding points',async()=>{
  const result=await search(2);
  assert.equal(result.status,'FOUND'); assert.equal(result.results.length,2);
  for(const r of result.results) {
    assert.equal(r.priceBOB,20); assert.equal(r.currency,'BOB');
    assert.equal(r.availableSeats,6); assert.equal(r.from,0); assert.equal(r.to,3);
    assert.ok(r.boardingName); assert.equal('driverId' in r,false); assert.equal('tripId' in r,false);
  }
  const intermediate=await search(1,{destinationLocalityId:fixture.geo.localities[4]});
  assert.equal(intermediate.status,'FOUND'); assert.equal(intermediate.coverage,null);
  assert.ok(intermediate.results.every(r=>r.coverage==='INTERMUNICIPAL'));
  const reverse=await search(1,{originLocalityId:fixture.geo.localities[1],destinationLocalityId:fixture.geo.localities[0]});
  assert.deepEqual(reverse,{status:'NO_DIRECT_SERVICE',coverage:'INTERMUNICIPAL',results:[]});
  await rejects(sql('x'.repeat(64),'SELECT nexo.search_services($1,$2,1,false)',fixture.geo.localities.slice(0,2)),/UNAUTHENTICATED/);
});
test('G03: no valid authorization means no offer and direct reservations are denied',async()=>{
  await admin.query("UPDATE nexo.route_authorizations SET status='REVOKED'");
  assert.deepEqual((await search()).results,[]);
  assert.equal((await search()).status,'NO_DIRECT_SERVICE');
  await rejects(hold(),/ROUTE_NOT_ELIGIBLE/);
  for(const [status,start,end] of [
    ['PENDING','2000-01-01','2100-01-01'],
    ['VERIFIED','2000-01-01','2001-01-01'],
    ['VERIFIED','2100-01-01','2101-01-01']
  ]) {
    const {rows:[a]}=await admin.query(
      "INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,status,valid_from,valid_until,requested_by,reviewed_by,review_reason) VALUES($1,$2,'Emisor ficticio',$3,$4,$5,$6,$7,$8,'Prueba') RETURNING id",
      [fixture.A,fixture.ra,key(),status,start,end,fixture.adminA,fixture.reviewer]);
    assert.deepEqual((await search()).results,[]);
    await rejects(hold(),/ROUTE_NOT_ELIGIBLE/);
    await admin.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE id=$1",[a.id]);
  }
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,0);
});
test('G04: adherence, operational suspension and commercial access are independent gates',async()=>{
  for(const [field,value] of [['adherence_status','WITHDRAWN'],['operating_status','SUSPENDED'],['status','SUSPENDED']]) {
    await admin.query('UPDATE nexo.associations SET '+field+'=$1 WHERE id=$2',[value,fixture.A]);
    const result=await search(); assert.equal(result.results.length,1); assert.equal(result.results[0].associationId,fixture.B);
    await rejects(hold(),/ROUTE_NOT_ELIGIBLE|ASSOCIATION_SUSPENDED/);
    const active=field==='adherence_status'?'ADHERED':field==='operating_status'?'OPERATING':'ACTIVE';
    await admin.query('UPDATE nexo.associations SET '+field+'=$1 WHERE id=$2',[active,fixture.A]);
  }
});
test('G05: authorization submission is tenant-scoped; only a trusted reviewer can verify',async()=>{
  await admin.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
  const args=[key(),fixture.ra,'Emisor ficticio','Referencia ficticia','2000-01-01T00:00:00Z','2100-01-01T00:00:00Z'];
  const a=await api.submitAuthorization(fixture.tokens.adminA,...args);
  assert.deepEqual(await api.submitAuthorization(fixture.tokens.adminA,...args),a);
  assert.equal(a.status,'PENDING');
  await rejects(api.submitAuthorization(fixture.tokens.adminB,key(),...args.slice(1)),/FORBIDDEN/);
  await rejects(api.reviewAuthorization(fixture.tokens.adminA,key(),a.authorizationId,'VERIFIED','Autoverificación'),/FORBIDDEN/);
  assert.equal((await search()).results.length,1);
  const reviewKey=key();
  assert.equal((await api.reviewAuthorization(fixture.tokens.reviewer,reviewKey,a.authorizationId,'VERIFIED','Documentación ficticia revisada')).status,'VERIFIED');
  await api.reviewAuthorization(fixture.tokens.reviewer,reviewKey,a.authorizationId,'VERIFIED','Documentación ficticia revisada');
  assert.equal((await search()).results.length,2);
  assert.equal((await admin.query('SELECT * FROM nexo.authorization_events WHERE authorization_id=$1',[a.authorizationId])).rowCount,2);
  await rejects(sql(fixture.tokens.adminA,'UPDATE nexo.route_authorizations SET status=$1',['VERIFIED']),/permission denied/);
  await rejects(sql(fixture.tokens.adminA,'INSERT INTO nexo.operation_reviewers VALUES($1)',[fixture.adminA]),/permission denied/);
  await rejects(admin.query("UPDATE nexo.authorization_events SET reason='alterado'"),/IMMUTABLE_AUDIT/);
});
test('G06: RLS hides unauthorized catalog and permit metadata while preserving own booking history',async()=>{
  const g=await hold();
  await admin.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
  const a=await sql(fixture.tokens.adminA,'SELECT * FROM nexo.route_authorizations');
  const b=await sql(fixture.tokens.adminB,'SELECT * FROM nexo.route_authorizations');
  assert.ok(a.rows.every(r=>r.association_id===fixture.A));
  assert.ok(b.rows.every(r=>r.association_id===fixture.B));
  assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.route_authorizations')).rowCount,0);
  assert.equal((await sql(fixture.tokens.other,'SELECT * FROM nexo.routes WHERE id=$1',[fixture.ra])).rowCount,0);
  assert.equal((await sql(fixture.tokens.other,'SELECT * FROM nexo.stops WHERE route_id=$1',[fixture.ra])).rowCount,0);
  assert.equal((await sql(fixture.tokens.other,'SELECT * FROM nexo.fares WHERE route_id=$1',[fixture.ra])).rowCount,0);
  assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.routes WHERE id=$1',[fixture.ra])).rowCount,1);
  assert.equal((await api.bookings(fixture.tokens.p))[0].id,g.bookingIds[0]);
  await rejects(sql(fixture.tokens.p,"SELECT nexo.reserve_inventory('bypass','{}')"),/permission denied/);
  await rejects(api.respond(fixture.tokens.d0,key(),g.bookingIds[0],true),/ROUTE_NOT_ELIGIBLE/);
  await api.cancel(fixture.tokens.p,key(),g.bookingIds[0]);
});
test('G07: search honors capacity, stop permissions, fare uniqueness and live driver eligibility',async()=>{
  await fixed(6,0); await fixed(6,1); await fixed(6,2);
  assert.deepEqual((await search()).results.map(r=>r.associationId),[fixture.B]);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=false WHERE route_id=$1 AND stop_index=0',[fixture.rb]);
  assert.deepEqual((await search()).results,[]);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=true WHERE route_id=$1 AND stop_index=0',[fixture.rb]);
  await admin.query('UPDATE nexo.memberships SET active=false WHERE user_id=$1',[fixture.drivers[3]]);
  assert.deepEqual((await search()).results,[]);
  await admin.query('UPDATE nexo.memberships SET active=true WHERE user_id=$1',[fixture.drivers[3]]);
  await admin.query("INSERT INTO nexo.fares(association_id,route_id,from_stop,to_stop,version,amount_bob,valid_from) VALUES($1,$2,0,3,2,99,now()-interval '1 day')",[fixture.B,fixture.rb]);
  assert.deepEqual((await search()).results,[]);
});
test('G08: geographic versions, route endpoints and stop_count cannot be mixed or rewritten',async()=>{
  await rejects(admin.query('UPDATE nexo.routes SET stop_count=2 WHERE id=$1',[fixture.ra]),/ROUTE_VERSION_IN_USE/);
  await rejects(admin.query('UPDATE nexo.localities SET municipality_id=$1 WHERE id=$2',[fixture.geo.municipalities[3],fixture.geo.localities[0]]),/GEOGRAPHY_VERSION_IN_USE/);
  const route=randomUUID();
  await admin.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,catalog_id,origin_locality_id,destination_locality_id) VALUES($1,$2,'Prueba','OUT',1,2,$3,$4,$5)",[route,fixture.A,fixture.geo.catalog,...fixture.geo.localities.slice(0,2)]);
  const insert='INSERT INTO nexo.stops(association_id,route_id,stop_index,name,catalog_id,locality_id) VALUES($1,$2,$3,$4,$5,$6)';
  await rejects(admin.query(insert,[fixture.A,route,2,'Fuera de rango',fixture.geo.catalog,fixture.geo.localities[1]]),/INVALID_STOP_INDEX/);
  await rejects(admin.query(insert,[fixture.A,route,0,'Extremo incorrecto',fixture.geo.catalog,fixture.geo.localities[1]]),/STOP_ENDPOINT_MISMATCH/);
  const otherCatalog=randomUUID();
  await admin.query("INSERT INTO nexo.geo_catalogs VALUES($1,'Otro catálogo ficticio','v1','fixture','SYNTHETIC','ACTIVE')",[otherCatalog]);
  await rejects(admin.query("INSERT INTO nexo.provinces VALUES($1,$2,$3,'X','Provincia ficticia')",[randomUUID(),otherCatalog,fixture.geo.departments[0]]),/foreign key/);
  await rejects(admin.query(insert,[fixture.B,route,0,'Asociación incorrecta',fixture.geo.catalog,fixture.geo.localities[0]]),/foreign key/);
});
test('G09: reservations recheck all association switches after waiting for concurrent updates',async()=>{
  for(const field of ['status','operating_status','adherence_status']) {
    const blocker=new pg.Client({connectionString:url.href}); await blocker.connect();
    let result;
    try {
      await blocker.query('BEGIN');
      await blocker.query('UPDATE nexo.associations SET '+field+'=$1 WHERE id=$2',[field==='adherence_status'?'WITHDRAWN':'SUSPENDED',fixture.A]);
      result=hold().then(value=>({value}),error=>({error}));
      await waitForReservationLock();
      await blocker.query('COMMIT');
      assert.match((await result).error.message,/ASSOCIATION_SUSPENDED|ROUTE_NOT_ELIGIBLE/);
    } finally {await blocker.query('ROLLBACK'); await blocker.end(); if(result) await result;}
    await admin.query('UPDATE nexo.associations SET '+field+'=$1 WHERE id=$2',[field==='status'?'ACTIVE':field==='adherence_status'?'ADHERED':'OPERATING',fixture.A]);
  }
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,0);
});
test('G10: concurrent permit revocation wins before a waiting reservation reads inventory',async()=>{
  const blocker=new pg.Client({connectionString:url.href}); await blocker.connect();
  let result;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
    result=hold().then(value=>({value}),error=>({error}));
    await waitForReservationLock(); await blocker.query('COMMIT');
    assert.match((await result).error.message,/ROUTE_NOT_ELIGIBLE/);
  } finally {await blocker.query('ROLLBACK'); await blocker.end(); if(result) await result;}
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,0);
});
test('G11: authorization revocation preserves active trips, cancellation and terminal completion',async()=>{
  const g=await fixed(6); await acceptAll(g); await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await api.reviewAuthorization(fixture.tokens.reviewer,key(),fixture.authorizations[fixture.ra],'REVOKED','Revocación ficticia');
  await rejects(hold(),/ROUTE_NOT_ELIGIBLE/);
  assert.equal((await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3)).status,'COMPLETED');
});
test('G12: applied migrations 001-007 remain byte-identical',async()=>{
  const expected={
    '001_core.sql':'9552c0fad137a0f7d0669dd2cdef7d137a0dd7382d79468f71fb413865f5d059',
    '002_operations.sql':'787a76dc49b5359cefd23917ddca7009fd334ab44688f7e6602d36b7b93343c4',
    '003_queue.sql':'4fe53741452e3008a82690838d3f86e8308d3ddda322896ba723e94a7f4dd620',
    '004_isolation_guard.sql':'2ecd12ef4230f29a94a6bc915f8be31f2f3d5e2e1b395cc3c15555442951d401',
    '005_geography_authorizations.sql':'42e93efbfc8a70cbff8cadc0620216830b6b7e05e354335db4ddd752773e8fd5',
    '006_search_authorization_functions.sql':'e156c33c62f08e6c9bb2a9c0605fc6a841ca888fca0476f5424b99fa62d4d4de',
    '007_eligibility_rls.sql':'3fef73dc7ec20fce98505206bdc61426ba2cba321aaf83ea2fecd0b789105b03'
  };
  for(const [name,digest] of Object.entries(expected)) {
    const bytes=await readFile(new URL('../../database/migrations/'+name,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);
  }
});
test('G13: additive upgrade of a populated 001-004 database preserves bookings and running operations',async()=>{
  const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');
  await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
  const upgradedUrl=new URL(url); upgradedUrl.pathname='/'+name;
  const db=new pg.Client({connectionString:upgradedUrl.href}); await db.connect();
  try {
    const dir=await mkdtemp(resolve('.local','old-migrations-'));
    for(const file of ['001_core.sql','002_operations.sql','003_queue.sql','004_isolation_guard.sql'])
      await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
    assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,4);
    const a=randomUUID(),u=randomUUID(),d=randomUUID(),r=randomUUID(),v=randomUUID(),t=randomUUID(),fare=randomUUID(),b=randomUUID();
    const token=randomBytes(32).toString('hex');
    await db.query("INSERT INTO nexo.users VALUES($1,'Pasajero antiguo ficticio'),($2,'Chofer antiguo ficticio')",[u,d]);
    await db.query("INSERT INTO nexo.sessions VALUES($1,$2,now()+interval '1 hour',NULL)",[createHash('sha256').update(token).digest('hex'),d]);
    await db.query("INSERT INTO nexo.associations(id,name) VALUES($1,'Asociación antigua ficticia')",[a]);
    await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[a,d]);
    await db.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count) VALUES($1,$2,'Ruta anterior','OUT',1,2)",[r,a]);
    await db.query("INSERT INTO nexo.stops(association_id,route_id,stop_index,name) VALUES($1,$2,0,'Origen antiguo'),($1,$2,1,'Destino antiguo')",[a,r]);
    await db.query("INSERT INTO nexo.vehicles(id,association_id,label) VALUES($1,$2,'ANTIGUO-FICTICIO')",[v,a]);
    await db.query('INSERT INTO nexo.trips(id,association_id,route_id,vehicle_id,driver_id,position_no) VALUES($1,$2,$3,$4,$5,1)',[t,a,r,v,d]);
    await db.query("INSERT INTO nexo.fares(id,association_id,route_id,from_stop,to_stop,version,amount_bob,valid_from) VALUES($1,$2,$3,0,1,1,10,now())",[fare,a,r]);
    await db.query("INSERT INTO nexo.bookings(id,association_id,trip_id,route_id,passenger_id,created_by,group_id,source,seats,from_stop,to_stop,fare_id,price_bob,fare_version,status,expires_at,driver_accepted) VALUES($1,$2,$3,$4,$5,$5,$1,'APP',2,0,1,$6,20,1,'CONFIRMED',now()+interval '1 hour',true)",[b,a,t,r,u,fare]);
    const before=(await db.query('SELECT * FROM nexo.bookings')).rows;
    assert.deepEqual(await migrate(db),['005_geography_authorizations.sql','006_search_authorization_functions.sql','007_eligibility_rls.sql','008_locality_lookup.sql','009_identity_and_provisioning.sql']);
    assert.deepEqual((await db.query('SELECT * FROM nexo.bookings')).rows,before);
    assert.deepEqual(await migrate(db),[]);
    assert.equal((await db.query('SELECT * FROM nexo.route_authorizations')).rowCount,0);
    assert.equal((await db.query('SELECT catalog_id FROM nexo.routes')).rows[0].catalog_id,null);
    await db.query("SELECT set_config('nexo.session_token',$1,false)",[token]);
    await rejects(db.query('SELECT nexo.reserve($1,$2::jsonb)',[key(),{routeId:r,from:0,to:1,seats:1}]),/ROUTE_NOT_ELIGIBLE/);
    const geography=await seedGeography(db);
    await db.query('BEGIN');
    try {
      await db.query('UPDATE nexo.routes SET catalog_id=$2,origin_locality_id=$3,destination_locality_id=$4 WHERE id=$1',[r,geography.catalog,...geography.localities.slice(0,2)]);
      for(let index=0;index<2;index++) await db.query('UPDATE nexo.stops SET catalog_id=$3,locality_id=$4 WHERE route_id=$1 AND stop_index=$2',[r,index,geography.catalog,geography.localities[index]]);
      await db.query("UPDATE nexo.associations SET adherence_status='ADHERED',operating_status='OPERATING' WHERE id=$1",[a]);
      await permit(db,r,a,u,d);
      await db.query('COMMIT');
    } catch(error) {await db.query('ROLLBACK'); throw error;}
    const held=(await db.query('SELECT nexo.reserve($1,$2::jsonb) AS r',[key(),{routeId:r,from:0,to:1,seats:4}])).rows[0].r;
    await db.query('SELECT nexo.respond_offer($1,$2,true)',[key(),held.bookingIds[0]]);
    assert.equal((await db.query('SELECT seats,price_bob FROM nexo.bookings WHERE id=$1',[b])).rows[0].seats,2);
    assert.equal((await db.query('SELECT nexo.depart($1,$2) AS r',[key(),t])).rows[0].r.status,'IN_TRANSIT');
    assert.equal((await db.query('SELECT nexo.progress($1,$2,1) AS r',[key(),t])).rows[0].r.status,'COMPLETED');
  } finally {await db.end();}
});

const password='Clave ficticia ñ 42';
const hashToken=t=>createHash('sha256').update(t).digest('hex');
async function managedAccount(login='pasajero.ficticio') {
  assert.deepEqual(await identity.register({login,password}),{status:'REGISTRATION_RECEIVED'});
  return (await admin.query('SELECT * FROM nexo.identity_accounts WHERE login_key=$1',[login])).rows[0];
}
async function namedLocalities() {
  // Fictional fixtures marked VERIFIED only to exercise that branch of the contract.
  await admin.query("UPDATE nexo.geo_catalogs SET data_kind='VERIFIED',name='Fixture verificada, no oficial' WHERE id=$1",[fixture.geo.catalog]);
  const ids=[];
  for(const [i,name] of ['San José ficticio','San José ficticio','Sán Julián ficticio','Ñuflo ficticio'].entries()) {
    const id=randomUUID(); ids.push(id);
    await admin.query('INSERT INTO nexo.localities VALUES($1,$2,$3,$4,$5)',[id,fixture.geo.catalog,fixture.geo.municipalities[i],key(),name]);
  }
  return ids;
}
test('L01: bounded suggestions disambiguate homonyms, normalize accents and preserve selected IDs/version',async()=>{
  const ids=await namedLocalities();
  const results=await api.suggestLocalities(fixture.tokens.p,{query:'  SAN  JOSE\u0301  '});
  assert.equal(results.length,2);
  assert.deepEqual(new Set(results.map(r=>r.localityId)),new Set(ids.slice(0,2)));
  assert.equal(new Set(results.map(r=>r.municipality)).size,2);
  for(const r of results) {
    assert.equal(r.catalogId,fixture.geo.catalog); assert.equal(r.catalogVersion,'test');
    assert.ok(r.province && r.department); assert.equal('associationId' in r,false);
  }
  assert.deepEqual(await api.suggestLocalities(fixture.tokens.p,{query:'san jose'}),results);
  assert.deepEqual(await api.suggestLocalities(fixture.tokens.p,{query:'san jose',limit:1}),results.slice(0,1));
  assert.equal((await api.suggestLocalities(fixture.tokens.p,{query:'sán ju'}))[0].localityId,ids[2]);
  assert.equal((await api.suggestLocalities(fixture.tokens.p,{query:'ÑU'}))[0].localityId,ids[3]);
  assert.equal((await api.suggestLocalities(fixture.tokens.p,{query:'ñu'}))[0].localityId,ids[3]);
  assert.deepEqual(await api.suggestLocalities(fixture.tokens.p,{query:'Sin coincidencia'}),[]);
  const noService=await api.search(fixture.tokens.p,{originLocalityId:ids[0],destinationLocalityId:ids[1]});
  assert.equal(noService.status,'NO_DIRECT_SERVICE'); assert.deepEqual(noService.results,[]);
});
test('L02: raw geography and suggestions hide unverified, draft and retired catalogs; SQL bypasses stay bounded',async()=>{
  await namedLocalities();
  const synthetic=await seedGeography(admin);
  await admin.query("INSERT INTO nexo.localities VALUES($1,$2,$3,$4,'San José no verificado ficticio')",[randomUUID(),synthetic.catalog,synthetic.municipalities[0],key()]);
  assert.equal((await api.suggestLocalities(fixture.tokens.p,{query:'San José'})).length,2);
  assert.ok((await sql(fixture.tokens.p,'SELECT * FROM nexo.localities')).rows.every(r=>r.catalog_id===fixture.geo.catalog));
  for(const status of ['DRAFT','RETIRED']) {
    await admin.query('UPDATE nexo.geo_catalogs SET status=$1 WHERE id=$2',[status,fixture.geo.catalog]);
    assert.deepEqual(await api.suggestLocalities(fixture.tokens.p,{query:'San José'}),[]);
    assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.localities')).rowCount,0);
  }
  await rejects(api.suggestLocalities('x'.repeat(64),{query:'San'}),/UNAUTHENTICATED/);
  for(const [q,n] of [['a',10],['San%',10],['San_',10],['San',21],['San',null]])
    await rejects(sql(fixture.tokens.p,'SELECT nexo.suggest_localities($1,$2)',[q,n]),/INVALID_LOCALITY_QUERY/);
  assert.equal((await sql('x'.repeat(64),'SELECT * FROM nexo.geo_catalogs')).rowCount,0);
});
test('L03: many matching names remain capped at twenty in deterministic order',async()=>{
  await namedLocalities();
  for(let i=0;i<30;i++) await admin.query("INSERT INTO nexo.localities VALUES($1,$2,$3,$4,$5)",[
    randomUUID(),fixture.geo.catalog,fixture.geo.municipalities[0],key(),'San prueba ficticia '+String(i).padStart(2,'0')]);
  const q={query:'San prueba',limit:20};
  const first=await api.suggestLocalities(fixture.tokens.p,q);
  assert.equal(first.length,20); assert.deepEqual(await api.suggestLocalities(fixture.tokens.p,q),first);
});
test('C01: catalog retirement serializes with both reservation and offer acceptance, without partial confirmation',async()=>{
  for(const accepting of [false,true]) {
    await admin.query("UPDATE nexo.geo_catalogs SET status='ACTIVE' WHERE id=$1",[fixture.geo.catalog]);
    const held=accepting?await hold():null;
    const blocker=new pg.Client({connectionString:url.href}); await blocker.connect();
    let result;
    try {
      await blocker.query('BEGIN');
      await blocker.query("UPDATE nexo.geo_catalogs SET status='RETIRED' WHERE id=$1",[fixture.geo.catalog]);
      const operation=accepting?api.respond(fixture.tokens.d0,key(),held.bookingIds[0],true):hold();
      result=operation.then(value=>({value}),error=>({error}));
      await waitForQueryLock(accepting?'%nexo.respond_offer(%':'%nexo.reserve(%');
      await blocker.query('COMMIT');
      assert.match((await result).error.message,/ROUTE_NOT_ELIGIBLE/);
    } finally {await blocker.query('ROLLBACK'); await blocker.end(); if(result) await result;}
    assert.equal((await admin.query("SELECT * FROM nexo.bookings WHERE status='CONFIRMED'")).rowCount,0);
  }
});
async function waitForQueryLock(pattern) {
  for(let i=0;i<200;i++) {
    const r=await admin.query("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1) AS waiting",[pattern]);
    if(r.rows[0].waiting) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Expected concurrent lock was not observed');
}
test('C02: permit revocation wins against waiting offer acceptance and retains the held booking',async()=>{
  const g=await hold();
  const blocker=new pg.Client({connectionString:url.href}); await blocker.connect(); let result;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
    result=api.respond(fixture.tokens.d0,key(),g.bookingIds[0],true).then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.respond_offer(%'); await blocker.query('COMMIT');
    assert.match((await result).error.message,/ROUTE_NOT_ELIGIBLE/);
  } finally {await blocker.query('ROLLBACK'); await blocker.end(); if(result) await result;}
  assert.equal((await admin.query('SELECT status FROM nexo.bookings WHERE id=$1',[g.bookingIds[0]])).rows[0].status,'HELD');
});
test('H01: registration is passenger-only, duplicate-safe and secret tables are inaccessible to application/provisioner',async()=>{
  const a=await managedAccount();
  assert.deepEqual(await identity.register({login:a.login_key,password}),{status:'REGISTRATION_RECEIVED'});
  assert.notEqual(a.password_hash,password); assert.match(a.password_hash,/^scrypt:32768:8:3:/);
  assert.equal((await admin.query('SELECT * FROM nexo.memberships WHERE user_id=$1',[a.user_id])).rowCount,0);
  assert.equal((await admin.query('SELECT * FROM nexo.operation_reviewers WHERE user_id=$1',[a.user_id])).rowCount,0);
  for(const table of ['identity_accounts','identity_attempts','identity_recovery'])
    await rejects(sql(fixture.tokens.adminA,'SELECT * FROM nexo.'+table),/permission denied/);
  await rejects(provisionPool.query('SELECT * FROM nexo.identity_accounts'),/permission denied/);
  await rejects(sql(fixture.tokens.adminA,"SELECT nexo.register_identity('forged','x')"),/permission denied/);
  await rejects(createIdentity(pool).login({login:a.login_key,password}),/UNSAFE_IDENTITY_RUNTIME_ROLE/);
  const privileged=new pg.Pool({connectionString:url.href});
  try {await rejects(createIdentity(privileged).login({login:a.login_key,password}),/UNSAFE_IDENTITY_RUNTIME_ROLE/);}
  finally {await privileged.end();}
});
test('H02: concurrent invalid logins persist shared abuse counters, with expiry and no issued sessions',async()=>{
  const a=await managedAccount();
  const results=await Promise.allSettled(Array.from({length:9},()=>identity.login({login:a.login_key,password:'Otra clave ficticia 99'})));
  assert.ok(results.every(r=>r.status==='rejected' && /INVALID_CREDENTIALS/.test(r.reason.message)));
  assert.equal((await admin.query('SELECT * FROM nexo.sessions WHERE user_id=$1',[a.user_id])).rowCount,0);
  assert.equal((await admin.query('SELECT attempts FROM nexo.identity_attempts WHERE bucket=$1',[hashToken('LOGIN:'+a.login_key)])).rows[0].attempts,10);
  await rejects(identity.login({login:a.login_key,password}),/INVALID_CREDENTIALS/);
  await admin.query("UPDATE nexo.identity_attempts SET started_at=now()-interval '16 minutes'");
  assert.ok((await identity.login({login:a.login_key,password})).token);
  await rejects(identity.login({login:'ausente.ficticio',password}),/INVALID_CREDENTIALS/);
});
test('H03: opaque sessions expire/revoke, logout is scoped and logout-all invalidates stale login versions',async()=>{
  const a=await managedAccount();
  const first=await identity.login({login:a.login_key,password});
  const second=await identity.login({login:a.login_key,password});
  assert.equal(first.token.length,43); assert.notEqual(first.token,second.token);
  const rows=(await admin.query('SELECT * FROM nexo.sessions WHERE user_id=$1',[a.user_id])).rows;
  assert.ok(rows.every(s=>s.token_hash!==first.token && s.token_hash!==second.token));
  assert.ok(new Date(first.expiresAt)>new Date());
  assert.equal(await api.logout(first.token),true);
  await rejects(api.logout(first.token),/UNAUTHENTICATED/);
  assert.equal(await api.logoutAll(second.token),true);
  await rejects(api.logout(second.token),/UNAUTHENTICATED/);
  await rejects(identityPool.query('SELECT nexo.issue_identity_session($1,$2,$3)',[a.user_id,a.version,hashToken(key())]),/INVALID_CREDENTIALS/);
  const third=await identity.login({login:a.login_key,password});
  await admin.query("UPDATE nexo.sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashToken(third.token)]);
  await rejects(api.suggestLocalities(third.token,{query:'San'}),/UNAUTHENTICATED/);
});
test('H04: trusted recovery is one-use under concurrency, changes password and revokes every session',async()=>{
  const a=await managedAccount(); const old=await identity.login({login:a.login_key,password});
  const code=randomBytes(32).toString('base64url');
  await provisionPool.query('SELECT nexo.provision_recovery($1,$2,$3)',[a.user_id,hashToken(code),'Recuperación de fixture verificada']);
  const next='Nueva clave ficticia ñ 43';
  const results=await Promise.allSettled([identity.recover({code,password:next}),identity.recover({code,password:next})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>/INVALID_RECOVERY/.test(r.reason.message)));
  await rejects(api.logout(old.token),/UNAUTHENTICATED/);
  await rejects(identity.login({login:a.login_key,password}),/INVALID_CREDENTIALS/);
  assert.ok((await identity.login({login:a.login_key,password:next})).token);
  const event=await sql(fixture.tokens.adminA,'SELECT * FROM nexo.identity_events');
  assert.ok(event.rows.every(e=>e.subject_id!==a.user_id));
  await rejects(admin.query("UPDATE nexo.identity_events SET reason='alterado'"),/IMMUTABLE_AUDIT/);
});
test('H05: driver management and audit stay inside A/B; only offline provisioner grants administrators/reviewers',async()=>{
  await rejects(api.setDriverMembership(fixture.tokens.p,fixture.A,fixture.other,true,'Intento ficticio'),/FORBIDDEN/);
  await rejects(api.setDriverMembership(fixture.tokens.adminA,fixture.B,fixture.other,true,'Intento cruzado'),/FORBIDDEN/);
  assert.equal(await api.setDriverMembership(fixture.tokens.adminA,fixture.A,fixture.other,true,'Alta ficticia revisada'),true);
  assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.identity_events')).rowCount,0);
  assert.ok((await sql(fixture.tokens.adminA,'SELECT * FROM nexo.identity_events')).rows.every(e=>e.association_id===fixture.A));
  for(const p of [pool,identityPool]) await rejects(p.query("SELECT nexo.provision_role($1,$2,'ASSOCIATION_ADMIN',true,'Escalada ficticia')",[fixture.p,fixture.A]),/permission denied/);
  await provisionPool.query("SELECT nexo.provision_role($1,NULL,'REVIEWER',true,'Revisor ficticio revisado')",[fixture.other]);
  assert.equal((await sql(fixture.tokens.other,'SELECT nexo.is_operation_reviewer() AS reviewer')).rows[0].reviewer,true);
  await provisionPool.query("SELECT nexo.provision_role($1,NULL,'REVIEWER',false,'Baja ficticia')",[fixture.other]);
  assert.equal((await sql(fixture.tokens.other,'SELECT nexo.is_operation_reviewer() AS reviewer')).rows[0].reviewer,false);
  await provisionPool.query("SELECT nexo.provision_role($1,$2,'ASSOCIATION_ADMIN',true,'Administrador ficticio revisado')",[fixture.other,fixture.B]);
  assert.ok((await sql(fixture.tokens.other,'SELECT * FROM nexo.vehicles')).rows.every(v=>v.association_id===fixture.B));
  await api.setDriverMembership(fixture.tokens.adminA,fixture.A,fixture.other,false,'Baja ficticia');
  assert.equal((await sql(fixture.tokens.other,"SELECT nexo.has_role($1,'DRIVER') AS active",[fixture.A])).rows[0].active,false);
});
test('H06: disabling identity revokes sessions and recovery; re-enable requires a fresh login',async()=>{
  const a=await managedAccount(), session=await identity.login({login:a.login_key,password});
  const code=randomBytes(32).toString('base64url');
  await provisionPool.query('SELECT nexo.provision_recovery($1,$2,$3)',[a.user_id,hashToken(code),'Fixture']);
  await rejects(sql(fixture.tokens.adminA,"SELECT nexo.set_identity_active($1,false,'Intento ficticio')",[a.user_id]),/permission denied/);
  await provisionPool.query("SELECT nexo.set_identity_active($1,false,'Baja ficticia')",[a.user_id]);
  await rejects(api.logout(session.token),/UNAUTHENTICATED/);
  await rejects(identity.login({login:a.login_key,password}),/INVALID_CREDENTIALS/);
  await provisionPool.query("SELECT nexo.set_identity_active($1,true,'Alta ficticia')",[a.user_id]);
  await rejects(identity.recover({code,password}),/INVALID_RECOVERY/);
  assert.ok((await identity.login({login:a.login_key,password})).token);
  await rejects(api.logout(session.token),/UNAUTHENTICATED/);
});
test('H07: stale verified logins waiting behind logout-all cannot issue a surviving session',async()=>{
  const a=await managedAccount(), session=await identity.login({login:a.login_key,password});
  const blocker=new pg.Client({connectionString:url.href}); await blocker.connect(); let pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT set_config('nexo.session_token',$1,true)",[session.token]);
    await blocker.query('SELECT nexo.logout_all()');
    pending=identityPool.query('SELECT nexo.issue_identity_session($1,$2,$3)',[a.user_id,a.version,hashToken(key())]).then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.issue_identity_session(%');
    await blocker.query('COMMIT');
    assert.match((await pending).error.message,/INVALID_CREDENTIALS/);
  } finally {await blocker.query('ROLLBACK'); await blocker.end(); if(pending) await pending;}
  assert.equal((await admin.query('SELECT * FROM nexo.sessions WHERE user_id=$1 AND revoked_at IS NULL',[a.user_id])).rowCount,0);
});
test('H08: all SECURITY DEFINER functions pin search_path and expose no PUBLIC execution',async()=>{
  const functions=await admin.query(`SELECT p.oid,p.proconfig,p.prosecdef,p.proname,
    EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND privilege_type='EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nexo'`);
  assert.ok(functions.rowCount>20);
  for(const f of functions.rows) {
    assert.equal(f.public_exec,false,f.proname);
    if(f.prosecdef) assert.ok(f.proconfig.includes('search_path=pg_catalog, nexo'),f.proname);
  }
  await rejects(identityPool.query('SELECT * FROM nexo.identity_accounts'),/permission denied/);
  await rejects(identityPool.query("SELECT nexo.provision_recovery($1,$2,'Intento')",[fixture.p,hashToken(key())]),/permission denied/);
  await rejects(sql(fixture.tokens.p,'SELECT nexo.route_eligible($1)',[fixture.ra]),/permission denied/);
  assert.equal((await sql('x'.repeat(64),'SELECT nexo.can_search_route($1) AS allowed',[fixture.ra])).rows[0].allowed,false);
  await admin.query('CREATE FUNCTION nexo.test_default_acl() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$');
  try {await rejects(sql(fixture.tokens.p,'SELECT nexo.test_default_acl()'),/permission denied/);}
  finally {await admin.query('DROP FUNCTION nexo.test_default_acl()');}
});
test('H09: replaced and expired recovery codes cannot change passwords or account versions',async()=>{
  const a=await managedAccount();
  const old=randomBytes(32).toString('base64url'), current=randomBytes(32).toString('base64url');
  for(const code of [old,current]) await provisionPool.query('SELECT nexo.provision_recovery($1,$2,$3)',[a.user_id,hashToken(code),'Fixture']);
  await rejects(identity.recover({code:old,password:'Nueva clave ficticia 44'}),/INVALID_RECOVERY/);
  await admin.query("UPDATE nexo.identity_recovery SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashToken(current)]);
  await rejects(identity.recover({code:current,password:'Nueva clave ficticia 44'}),/INVALID_RECOVERY/);
  assert.equal((await admin.query('SELECT version FROM nexo.identity_accounts WHERE user_id=$1',[a.user_id])).rows[0].version,a.version);
  assert.ok((await identity.login({login:a.login_key,password})).token);
  for(let i=0;i<6;i++) await identityPool.query("SELECT nexo.identity_attempt('recovery','LOGIN')");
  assert.equal((await identityPool.query("SELECT nexo.identity_attempt('recovery','RECOVERY') AS r")).rows[0].r.allowed,true);
});
test('H10: populated 001-007 upgrade preserves sessions, tenant roles, permits, bookings and six-seat inventory',async()=>{
  const group=await fixed(2); await acceptAll(group);
  const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');
  await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
  const copyUrl=new URL(url); copyUrl.pathname='/'+name;
  const db=new pg.Client({connectionString:copyUrl.href}); await db.connect();
  try {
    const directory=await mkdtemp(resolve('.local','seven-migrations-'));
    const names=(await admin.query('SELECT name FROM public.nexo_migrations WHERE name<$1 ORDER BY name',['008'])).rows.map(r=>r.name);
    for(const file of names) await writeFile(resolve(directory,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
    assert.equal((await migrate(db,pathToFileURL(directory+sep))).length,7);
    const tables=['users','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities',
      'routes','stops','operation_reviewers','route_authorizations','vehicles','trips','fares','bookings'];
    for(const table of tables) {
      const rows=(await admin.query('SELECT * FROM nexo.'+table)).rows;
      for(const row of rows) {
        const columns=Object.keys(row);
        await db.query(`INSERT INTO nexo.${table} (${columns.map(k=>db.escapeIdentifier(k)).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
      }
    }
    const snapshot=async()=>{
      const result={};
      for(const table of [...tables,'authorization_events']) result[table]=(await db.query('SELECT * FROM nexo.'+table+' t ORDER BY row_to_json(t)::text')).rows;
      return result;
    };
    const before=await snapshot();
    assert.deepEqual(await migrate(db),['008_locality_lookup.sql','009_identity_and_provisioning.sql']);
    assert.deepEqual(await snapshot(),before); assert.deepEqual(await migrate(db),[]);
    await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.p]);
    assert.equal((await db.query('SELECT nexo.actor() AS actor')).rows[0].actor,fixture.p);
    const four=(await db.query('SELECT nexo.reserve($1,$2) AS r',[key(),request(4,{parts:[{tripId:fixture.trips[0],seats:4}]})])).rows[0].r;
    assert.ok(four.bookingIds.length===1);
    await rejects(db.query('SELECT nexo.reserve($1,$2)',[key(),request(1,{parts:[{tripId:fixture.trips[0],seats:1}]})]),/NO_CAPACITY/);
  } finally {await db.end();}
});
test('H11: even a provisioned reviewer cannot review their own authorization request or call the old helper',async()=>{
  await provisionPool.query("SELECT nexo.provision_role($1,NULL,'REVIEWER',true,'Fixture con dos roles')",[fixture.adminA]);
  const a=await api.submitAuthorization(fixture.tokens.adminA,key(),fixture.ra,'Emisor ficticio','Referencia ficticia','2000-01-01T00:00:00Z','2100-01-01T00:00:00Z');
  await rejects(api.reviewAuthorization(fixture.tokens.adminA,key(),a.authorizationId,'VERIFIED','Autoverificación ficticia'),/FORBIDDEN_SELF_REVIEW/);
  await rejects(sql(fixture.tokens.adminA,'SELECT nexo.review_authorization_internal($1,$2,$3,$4)',[key(),a.authorizationId,'VERIFIED','Intento ficticio']),/permission denied/);
  assert.equal((await api.reviewAuthorization(fixture.tokens.reviewer,key(),a.authorizationId,'VERIFIED','Revisión ficticia separada')).status,'VERIFIED');
});
