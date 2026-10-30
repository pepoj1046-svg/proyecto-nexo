import { test, before, beforeEach, after } from 'node:test';
import { startWebGateway } from '../../src/http/web-gateway.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import pg from 'pg';
import { migrate } from '../../scripts/migrate.mjs';
import { createBusinessService } from '../../src/db/business-service.mjs';
import {createWebTerminalService} from '../../src/db/web-terminal-service.mjs';
import { startBusinessRuntime } from '../../src/http/business-api.mjs';
import { createService } from '../../src/db/service.mjs';
import { createIdentity } from '../../src/auth/identity.mjs';
import { createMaintenance } from '../../src/db/maintenance.mjs';
import { startTestRuntime } from '../../src/http/test-runtime.mjs';
import { postJson } from '../helpers/http.mjs';
import { seedGeography,mapRoute,permit } from '../helpers/geography.mjs';

const url = new URL(process.env.NEXO_TEST_URL || 'postgres://invalid');
if (process.env.NEXO_TEST_LOCAL !== '1' || url.hostname !== '127.0.0.1' || !/^\/nexo_test_[a-f0-9]+$/.test(url.pathname)) {
  throw new Error('Run npm run test:integration: isolated local database required');
}
const admin = new pg.Client({connectionString: url.href});
let pool, api, fixture, identityPool, provisionPool, maintenancePool, identity;
const runtimePassword = randomBytes(32).toString('hex');
before(async () => {
  await admin.connect();
  const version = await admin.query('SHOW server_version');
  console.log(`PostgreSQL real: ${version.rows[0].server_version}`);
  assert.deepEqual(await migrate(admin),['001_core.sql','002_operations.sql','003_queue.sql','004_isolation_guard.sql','005_geography_authorizations.sql','006_search_authorization_functions.sql','007_eligibility_rls.sql','008_locality_lookup.sql','009_identity_and_provisioning.sql','010_security_and_abuse.sql','011_identity_maintenance.sql','012_business_operations.sql','013_individual_operations.sql','014_terminal_operations.sql','015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);
  // A real non-owner, non-superuser login exercises grants and RLS.
  await admin.query(`CREATE ROLE nexo_test_runtime LOGIN PASSWORD '${runtimePassword}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
    GRANT nexo_app TO nexo_test_runtime`);
  const runtimeUrl = new URL(url); runtimeUrl.username='nexo_test_runtime'; runtimeUrl.password=runtimePassword;
  pool = new pg.Pool({connectionString:runtimeUrl.href,max:40});
  api=createService(pool);
  for (const [name,group] of [['identity','nexo_identity'],['provision','nexo_provisioner'],['maintenance','nexo_maintenance']]) {
    await admin.query(`CREATE ROLE nexo_test_${name} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT; GRANT ${group} TO nexo_test_${name}`);
    const loginUrl=new URL(url); loginUrl.username='nexo_test_'+name; loginUrl.password=runtimePassword;
    const trustedPool=new pg.Pool({connectionString:loginUrl.href,max:12});
    if(name==='identity') identityPool=trustedPool; else if(name==='provision') provisionPool=trustedPool; else maintenancePool=trustedPool;
  }
  identity=createIdentity(identityPool);
});
after(async () => { for(const p of [pool,identityPool,provisionPool,maintenancePool]) if(p) await p.end(); await admin.end(); });

beforeEach(async () => {
  await admin.query(`TRUNCATE nexo.web_point_profiles,nexo.late_replacements,nexo.journey_events,nexo.road_rescues,nexo.admin_route_grants,nexo.admin_limits,nexo.route_conditions,nexo.condition_history,nexo.condition_decisions,nexo.booking_contracts,nexo.association_contacts,nexo.passenger_decisions,nexo.minor_reviews,nexo.minor_cases,nexo.fleet_events,nexo.vehicle_blocks,nexo.fleet_incidents,nexo.urban_runs,nexo.movement_corrections,nexo.operational_notices,nexo.simulated_payments,nexo.consent_uses,nexo.terminal_bindings,nexo.group_consents,nexo.group_responsibles,nexo.arrival_contracts,nexo.episode_terminal_events,nexo.assignment_outcomes,nexo.assignment_episodes,nexo.terminal_config_changes,nexo.terminal_events,nexo.terminal_config,nexo.absence_drafts,nexo.member_movements,nexo.booking_members,nexo.booking_movements,nexo.security_events,nexo.identity_recovery,nexo.identity_accounts,nexo.identity_attempts,nexo.identity_events,
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

test('migrations: populated schema reapplication preserves every table and registry checksums',async()=>{
  const group=await fixed(2);await acceptAll(group);
  const account=await managedAccount('closure.fixture');await identity.login({login:account.login_key,password});
  const {rows:tables}=await admin.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexo' AND c.relkind='r' ORDER BY c.relname");
  const snapshot=async()=>{
    const result={};
    for(const {relname} of tables) result[relname]=(await admin.query('SELECT * FROM nexo.'+admin.escapeIdentifier(relname)+' t ORDER BY to_jsonb(t)::text')).rows;
    return result;
  };
  const before=await snapshot();
  assert.deepEqual(await migrate(admin),[]);
  assert.deepEqual(await snapshot(),before);
  assert.equal((await admin.query('SELECT * FROM public.nexo_migrations')).rowCount,26);
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
test('G12: applied migrations 001-025 remain byte-identical',async()=>{
  const expected={
    '025_web_recovery_reads.sql':'dd132b36adb74f8fd371f5193c221637837bb30ce083c097c0123e1b35e79467',
    '023_web_journeys.sql':'f446f0b0946056c6100b56f43c6ec71855dca636d37788fa69d17e3e9fddb212',
    '024_web_operations.sql':'08d0b3e0b18f6fbbe47b39c5233d29414419b276694bb02241f72d7f5916e2c3',
    '022_rescue_manifest_privacy.sql':'de2572bf53ee04116ba1e4da54aa3feed22385e31af024ea69fdfab44b3ed52b',
    '021_scope_read_boundaries.sql':'7bc4551a6283bf71f029ac0b99d2dc211af11b127ad60a1c1db889ab2b55e26f',
    '020_scoped_administration.sql':'643e0ba2417be17189d957e9f9562bd901c478dff0fcb0fd2fdfd24b00fcb4c6',
    '019_journey_recovery.sql':'96a311c568ed2471c354c06a3176f066cecbebedb0cecfb2abf3deb7e58f1164',
    '018_operating_contracts.sql':'77757bf35956270f6c4ba52a7140383e8cc623ec9a5bf10a6a70370d276f870e',
    '017_urban_replacement.sql':'25854b173b0154a11c013e94de2dae64f9083d4870b4f64e46cd34243fa4a3ee',
    '016_terminal_boarding.sql':'be49599eb2c11ceb5cd0c7f6dda633082eba328053611987c4a067bb2c988f35',
    '001_core.sql':'9552c0fad137a0f7d0669dd2cdef7d137a0dd7382d79468f71fb413865f5d059',
    '002_operations.sql':'787a76dc49b5359cefd23917ddca7009fd334ab44688f7e6602d36b7b93343c4',
    '003_queue.sql':'4fe53741452e3008a82690838d3f86e8308d3ddda322896ba723e94a7f4dd620',
    '004_isolation_guard.sql':'2ecd12ef4230f29a94a6bc915f8be31f2f3d5e2e1b395cc3c15555442951d401',
    '005_geography_authorizations.sql':'42e93efbfc8a70cbff8cadc0620216830b6b7e05e354335db4ddd752773e8fd5',
    '006_search_authorization_functions.sql':'e156c33c62f08e6c9bb2a9c0605fc6a841ca888fca0476f5424b99fa62d4d4de',
    '007_eligibility_rls.sql':'3fef73dc7ec20fce98505206bdc61426ba2cba321aaf83ea2fecd0b789105b03',
    '008_locality_lookup.sql':'ab3e82713198f078fbda5e424239900c41ecfa73a400aa923ead457e64e884b5',
    '009_identity_and_provisioning.sql':'e0401515ae8f564cb2d17561e960a56e6472e67085ab82fec34e41ffae41a4b6',
    '010_security_and_abuse.sql':'dace616e2de098a700035e4b61beb6d45ce722678729cb3255c92ca8c0268067',
    '015_assignment_recovery.sql':'a897f5b2e7d47dbab7e701acf16db294e097d9b20483c378f1c383a17bd53dbe',
    '014_terminal_operations.sql':'e3b1ef1322638547e97c89ec709bbdcd0bbd1110947266c330c95c916103796b',
    '013_individual_operations.sql':'e111f11211fb8153d08cc96ebe45fbc7b628efed9bf5ac5d8a48ce1ca94d92b5',
    '012_business_operations.sql':'080065cf039ddb2971f68a787a96abb4d6382f538d3ead829181ebd3d3280649',
    '011_identity_maintenance.sql':'d1c11a95fd5fec0dbb2136c13a2d6b915473ec0ea02013f2698ece0df2e4187d'
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
    assert.deepEqual(await migrate(db),['005_geography_authorizations.sql','006_search_authorization_functions.sql','007_eligibility_rls.sql','008_locality_lookup.sql','009_identity_and_provisioning.sql','010_security_and_abuse.sql','011_identity_maintenance.sql','012_business_operations.sql','013_individual_operations.sql','014_terminal_operations.sql','015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);
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
  assert.equal((await admin.query('SELECT attempts FROM nexo.identity_attempts WHERE bucket=$1',[hashToken('LOGIN:'+a.login_key)])).rows[0].attempts,7);
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
    if(f.prosecdef) assert.ok(f.proconfig.includes('search_path=pg_catalog, nexo, pg_temp'),f.proname);
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
test('H10: populated 001-009 upgrade preserves sessions, tenant roles, permits, bookings and six-seat inventory',async()=>{
  const group=await fixed(2); await acceptAll(group);
  const account=await managedAccount(); const managed=await identity.login({login:account.login_key,password});
  const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');
  await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
  const copyUrl=new URL(url); copyUrl.pathname='/'+name;
  const db=new pg.Client({connectionString:copyUrl.href}); await db.connect();
  try {
    const directory=await mkdtemp(resolve('.local','seven-migrations-'));
    const names=(await admin.query('SELECT name FROM public.nexo_migrations WHERE name<$1 ORDER BY name',['010'])).rows.map(r=>r.name);
    for(const file of names) await writeFile(resolve(directory,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
    assert.equal((await migrate(db,pathToFileURL(directory+sep))).length,9);
    const tables=['users','identity_accounts','identity_recovery','identity_attempts','identity_events','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities',
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
    // Demonstrate 009's allocation bug in the old database before applying the fix.
    await db.query("INSERT INTO nexo.identity_attempts VALUES('global',now(),1000)");
    const countBefore=(await db.query('SELECT count(*)::integer AS n FROM nexo.identity_attempts')).rows[0].n;
    assert.equal((await db.query("SELECT nexo.identity_attempt('blocked.fixture','LOGIN') AS r")).rows[0].r.allowed,false);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM nexo.identity_attempts')).rows[0].n,countBefore+1);
    const before=await snapshot();
    assert.deepEqual(await migrate(db),['010_security_and_abuse.sql','011_identity_maintenance.sql','012_business_operations.sql','013_individual_operations.sql','014_terminal_operations.sql','015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);
    assert.deepEqual(await snapshot(),before); assert.deepEqual(await migrate(db),[]);
    await db.query("SELECT set_config('nexo.session_token',$1,false)",[managed.token]);
    assert.equal((await db.query('SELECT nexo.actor() AS actor')).rows[0].actor,account.user_id);
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

test('S01: exhausted global abuse budget allocates no new buckets and logs one threshold event',async()=>{
  await admin.query("INSERT INTO nexo.identity_attempts VALUES('global:LOGIN',now(),1000)");
  for(let i=0;i<20;i++) {
    const r=await identityPool.query('SELECT nexo.identity_attempt($1,$2) AS r',['attack.ficticio.'+i,'LOGIN']);
    assert.equal(r.rows[0].r.allowed,false);
  }
  assert.equal((await admin.query('SELECT * FROM nexo.identity_attempts')).rowCount,1);
  assert.equal((await admin.query("SELECT * FROM nexo.security_events WHERE event='THROTTLED'")).rowCount,1);
  for(const p of [pool,identityPool,provisionPool,maintenancePool]) await rejects(p.query('SELECT * FROM nexo.security_events'),/permission denied/);
});
test('S02: registration cannot exhaust login; one invalid recovery code cannot block another account',async()=>{
  const a=await managedAccount();
  for(let i=0;i<5;i++) await identityPool.query('SELECT nexo.identity_attempt($1,$2)',[a.login_key,'REGISTER']);
  await rejects(identity.register({login:a.login_key,password}),/INVALID_CREDENTIALS/);
  const session=await identity.login({login:a.login_key,password});assert.ok(session.token);
  const bad=randomBytes(32).toString('base64url');
  for(let i=0;i<6;i++) await identityPool.query('SELECT nexo.identity_attempt($1,$2)',[hashToken(bad),'RECOVERY']);
  const code=randomBytes(32).toString('base64url');
  await provisionPool.query('SELECT nexo.provision_recovery($1,$2,$3)',[a.user_id,hashToken(code),'Fixture']);
  assert.equal((await identity.recover({code,password:'Nueva contraseña ficticia 45'})).status,'RECOVERED');
  await rejects(api.logout(session.token),/UNAUTHENTICATED/);
});
test('S03: mixed, elevated and object-owner runtime authority fails closed before identity/tenant operations',async()=>{
  await admin.query('GRANT nexo_identity TO nexo_test_runtime');
  try {await rejects(api.bookings(fixture.tokens.p),/UNSAFE_RUNTIME_ROLE/);}
  finally {await admin.query('REVOKE nexo_identity FROM nexo_test_runtime');}
  await admin.query('GRANT nexo_provisioner TO nexo_test_identity');
  try {await rejects(identity.login({login:'fixture.local',password}),/UNSAFE_IDENTITY_RUNTIME_ROLE/);}
  finally {await admin.query('REVOKE nexo_provisioner FROM nexo_test_identity');}
  await admin.query('GRANT pg_read_all_data TO nexo_test_runtime');
  try {await rejects(api.bookings(fixture.tokens.p),/UNSAFE_RUNTIME_ROLE/);}
  finally {await admin.query('REVOKE pg_read_all_data FROM nexo_test_runtime');}
  await admin.query('CREATE TABLE nexo.runtime_owned_fixture(id integer); ALTER TABLE nexo.runtime_owned_fixture OWNER TO nexo_test_runtime');
  try {await rejects(api.bookings(fixture.tokens.p),/UNSAFE_RUNTIME_ROLE/);}
  finally {await admin.query('DROP TABLE nexo.runtime_owned_fixture');}
  assert.deepEqual(await api.bookings(fixture.tokens.p),[]);
});
test('S04: dry-run and concurrent bounded maintenance preserve valid sessions, live counters, inventory and audit',async()=>{
  const account=await managedAccount();const session=await identity.login({login:account.login_key,password});
  await fixed(2);const bookings=(await admin.query('SELECT * FROM nexo.bookings')).rows;
  for(let i=0;i<2;i++) await admin.query("INSERT INTO nexo.sessions VALUES($1,$2,now()-interval '2 days',NULL)",[hashToken(key()),account.user_id]);
  await admin.query("INSERT INTO nexo.sessions VALUES($1,$2,now()+interval '1 day',now()-interval '2 days')",[hashToken(key()),account.user_id]);
  await admin.query("INSERT INTO nexo.identity_recovery VALUES($1,$2,now()-interval '2 days',NULL)",[hashToken(key()),account.user_id]);
  await admin.query("INSERT INTO nexo.identity_attempts VALUES('old.fixture',now()-interval '2 days',5)");
  const maintenance=createMaintenance(maintenancePool), cutoff=new Date(Date.now()-3600000).toISOString();
  const before=(await admin.query('SELECT * FROM nexo.sessions')).rowCount;
  assert.deepEqual(await maintenance.run({cutoff}),{sessions:3,recovery:1,attempts:1,dryRun:true});
  assert.equal((await admin.query('SELECT * FROM nexo.sessions')).rowCount,before);
  const results=await Promise.all([maintenance.run({cutoff,batchSize:2,dryRun:false}),maintenance.run({cutoff,batchSize:2,dryRun:false})]);
  assert.equal(results.reduce((n,r)=>n+r.sessions,0),3);
  assert.equal(results.reduce((n,r)=>n+r.recovery,0),1);
  assert.equal(results.reduce((n,r)=>n+r.attempts,0),1);
  assert.equal((await admin.query('SELECT * FROM nexo.sessions')).rowCount,before-3);
  assert.deepEqual((await admin.query('SELECT * FROM nexo.bookings')).rows,bookings);
  assert.ok((await admin.query('SELECT * FROM nexo.identity_attempts')).rowCount>0);
  assert.equal((await admin.query("SELECT * FROM nexo.security_events WHERE event='MAINTENANCE'")).rowCount,2);
  assert.equal(await api.logout(session.token),true);
  for(const p of [pool,identityPool,provisionPool])
    await rejects(p.query('SELECT nexo.maintain_identity(now(),10,false)'),/permission denied/);
  await rejects(maintenance.run({cutoff:'2100-01-01',dryRun:false}),/INVALID_MAINTENANCE/);
  await rejects(maintenancePool.query('DELETE FROM nexo.identity_events'),/permission denied/);
});
test('S05: maintenance skips locked rows and cannot clear active budgets even with cutoff now',async()=>{
  const digest=hashToken(key());
  await admin.query("INSERT INTO nexo.sessions VALUES($1,$2,now()-interval '2 days',NULL)",[digest,fixture.p]);
  await identityPool.query("SELECT nexo.identity_attempt('budget.fixture','LOGIN')");
  const blocker=new pg.Client({connectionString:url.href});await blocker.connect();
  const maintenance=createMaintenance(maintenancePool);
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT * FROM nexo.sessions WHERE token_hash=$1 FOR UPDATE',[digest]);
    const result=await maintenance.run({cutoff:new Date().toISOString(),dryRun:false});
    assert.equal(result.sessions,0);assert.equal(result.attempts,0);
  } finally {await blocker.query('ROLLBACK');await blocker.end();}
  assert.equal((await maintenance.run({cutoff:new Date().toISOString(),dryRun:false})).sessions,1);
});
test('S06: pg_temp/search_path and forged session context cannot shadow identity or read a foreign association',async()=>{
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("CREATE TEMP TABLE sessions(token_hash text,user_id uuid,expires_at timestamptz,revoked_at timestamptz) ON COMMIT DROP");
    await c.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour',NULL)",[hashToken('forged'.repeat(8)),fixture.adminB]);
    await c.query("SELECT set_config('nexo.session_token',$1,true)",['forged'.repeat(8)]);
    await c.query('SET LOCAL search_path=pg_temp,public,nexo');
    assert.equal((await c.query('SELECT nexo.actor() AS actor')).rows[0].actor,null);
    assert.equal((await c.query('SELECT * FROM nexo.vehicles')).rowCount,0);
    await c.query("SELECT set_config('nexo.session_token',$1,true)",[fixture.tokens.adminA]);
    assert.ok((await c.query('SELECT * FROM nexo.vehicles')).rows.every(v=>v.association_id===fixture.A));
    await c.query('COMMIT');
  } finally {await c.query('ROLLBACK');c.release();}
});
test('S07: concurrent logout produces at most one revocation event and no reusable session',async()=>{
  const a=await managedAccount(), session=await identity.login({login:a.login_key,password});
  const results=await Promise.allSettled(Array.from({length:10},()=>api.logout(session.token)));
  assert.ok(results.some(r=>r.status==='fulfilled'));
  assert.ok(results.every(r=>r.status==='fulfilled' || /UNAUTHENTICATED/.test(r.reason.message)));
  assert.equal((await admin.query("SELECT * FROM nexo.identity_events WHERE subject_id=$1 AND event='LOGOUT'",[a.user_id])).rowCount,1);
  await rejects(api.reserve(session.token,key(),request()),/UNAUTHENTICATED/);
});
test('S08: function grants, RLS coverage and failed-auth security records preserve least privilege',async()=>{
  const unprotected=await admin.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexo' AND c.relkind='r' AND NOT c.relrowsecurity");
  assert.deepEqual(unprotected.rows,[]);
  for(const [role,expected] of [
    ['nexo_identity',['identity_attempt','issue_identity_session','record_identity_failure','recover_identity','register_identity']],
    ['nexo_provisioner',['configure_admin_scope','provision_recovery','provision_role','set_identity_active']],
    ['nexo_maintenance',['maintain_identity']]]) {
    const rows=await admin.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nexo' AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY p.proname",[role]);
    assert.deepEqual(rows.rows.map(r=>r.proname),expected);
  }
  const a=await managedAccount();
  await rejects(identity.login({login:a.login_key,password:'Contraseña errada ficticia 99'}),/INVALID_CREDENTIALS/);
  await rejects(identity.login({login:'unknown.fixture',password}),/INVALID_CREDENTIALS/);
  const rows=(await admin.query("SELECT * FROM nexo.security_events WHERE event='INVALID_CREDENTIALS'")).rows;
  assert.equal(rows.length,2);assert.ok(rows.some(r=>r.subject_id===a.user_id));assert.ok(rows.some(r=>r.subject_id===null));
  const json=JSON.stringify(rows);assert.ok(!json.includes(password));assert.ok(!json.includes(a.login_key));
  await rejects(admin.query("UPDATE nexo.security_events SET event='THROTTLED'"),/IMMUTABLE_AUDIT/);
});
test('W01: real local HTTP register/login/suggest/search/logout enforces sessions and rejects role escalation',async()=>{
  await namedLocalities();const http=await startTestRuntime(pool,identityPool);
  try {
    const credentials={login:'http.fixture',password};
    assert.equal((await postJson(http.url,'/v1/register',{...credentials,role:'REVIEWER'})).status,400);
    assert.equal((await postJson(http.url,'/v1/register',credentials)).status,202);
    const session=await postJson(http.url,'/v1/login',credentials);assert.equal(session.status,200);
    const headers={Authorization:'Bearer '+session.body.token};
    const suggestions=await postJson(http.url,'/v1/localities/suggest',{query:'San Jose'},headers);
    assert.equal(suggestions.status,200);assert.equal(suggestions.body.length,2);
    const query={originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1]};
    const found=await postJson(http.url,'/v1/services/search',query,headers);
    assert.equal(found.status,200);assert.equal(found.body.status,'FOUND');
    assert.equal((await postJson(http.url,'/v1/services/search',{...query,coverage:'INTERMUNICIPAL'},headers)).status,400);
    assert.equal((await postJson(http.url,'/v1/logout',{},headers)).status,200);
    assert.equal((await postJson(http.url,'/v1/localities/suggest',{query:'San'},headers)).status,401);
    const account=(await admin.query("SELECT * FROM nexo.identity_accounts WHERE login_key='http.fixture'")).rows[0];
    assert.equal((await admin.query('SELECT * FROM nexo.memberships WHERE user_id=$1',[account.user_id])).rowCount,0);
  } finally {await http.close();}
});
test('W02: real local HTTP recovery revokes old tokens; invalid logins throttle without leaking SQL',async()=>{
  const a=await managedAccount();const old=await identity.login({login:a.login_key,password});
  const code=randomBytes(32).toString('base64url');
  await provisionPool.query('SELECT nexo.provision_recovery($1,$2,$3)',[a.user_id,hashToken(code),'Fixture']);
  const http=await startTestRuntime(pool,identityPool);
  try {
    assert.equal((await postJson(http.url,'/v1/recover',{code,password:'Clave nueva ficticia 99'})).status,200);
    assert.equal((await postJson(http.url,'/v1/logout',{}, {Authorization:'Bearer '+old.token})).status,401);
    const attempts=await Promise.all(Array.from({length:7},()=>postJson(http.url,'/v1/login',{login:'http.unknown',password})));
    assert.ok(attempts.some(r=>r.status===429));assert.ok(attempts.every(r=>[401,429].includes(r.status)));
    assert.ok(attempts.every(r=>!JSON.stringify(r.body).includes('SQL')));
  } finally {await http.close();}
});
test('S09: session lifetime starts after a concurrent account lock is released',async()=>{
  const a=await managedAccount(), digest=hashToken(key());
  const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let result;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT * FROM nexo.identity_accounts WHERE user_id=$1 FOR UPDATE',[a.user_id]);
    result=identityPool.query('SELECT nexo.issue_identity_session($1,$2,$3)',[a.user_id,a.version,digest]);
    await waitForQueryLock('%nexo.issue_identity_session(%');
    const released=(await blocker.query('SELECT clock_timestamp()::text AS t')).rows[0].t;
    await blocker.query('COMMIT');await result;
    assert.equal((await admin.query("SELECT expires_at >= $2::timestamptz+interval '1 hour' AS full_lifetime FROM nexo.sessions WHERE token_hash=$1",[digest,released])).rows[0].full_lifetime,true);
  } finally {await blocker.query('ROLLBACK');await blocker.end();if(result)await result;}
});
test('P01: synthetic catalog probe uses the prefix index and keeps concurrent suggestions bounded',async()=>{
  await namedLocalities();
  await admin.query("INSERT INTO nexo.localities(id,catalog_id,municipality_id,code,name) SELECT gen_random_uuid(),$1,$2,'scale-'||i,'Escala ficticia '||lpad(i::text,5,'0') FROM generate_series(1,20000) i",[fixture.geo.catalog,fixture.geo.municipalities[0]]);
  await admin.query('ANALYZE nexo.localities');
  const {rows:[plan]}=await admin.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM nexo.localities WHERE catalog_id=$1 AND nexo.locality_key(name) LIKE 'escala ficticia 1999%'",[fixture.geo.catalog]);
  assert.ok(JSON.stringify(plan).includes('locality_name_prefix'));
  const results=await Promise.all(Array.from({length:12},()=>api.suggestLocalities(fixture.tokens.p,{query:'Escala ficticia 1999',limit:20})));
  assert.ok(results.every(r=>r.length===10));assert.ok(results.every(r=>JSON.stringify(r)===JSON.stringify(results[0])));
  assert.equal((await api.suggestLocalities(fixture.tokens.p,{query:'Escala ficticia'})).length,10);
  console.log('Synthetic locality probe: 20000 generated rows, prefix index used; SQL execution ms='+plan['QUERY PLAN'][0]['Execution Time']);
});

const business=()=>createBusinessService(pool);
test('B01: priced reservations, atomic quote preconditions and historical prices share the existing inventory',async()=>{
  const b=business(), q=await b.quote(fixture.tokens.p,request(2));
  await rejects(sql(fixture.tokens.p,'SELECT nexo.reserve_business($1,$2,$3)',[key(),request(2),JSON.stringify([])]),/INVALID_QUOTE/);
  assert.equal(q.totalBOB,'20.00');assert.equal(q.currency,'BOB');
  const k=key();
  await rejects(b.reserve(fixture.tokens.p,k,{...request(2),quote:{...q,totalBOB:'19.00'}}),/QUOTE_CHANGED/);
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,0);
  assert.equal((await admin.query('SELECT * FROM nexo.actions')).rowCount,0);
  const g=await b.reserve(fixture.tokens.p,k,{...request(2),quote:q});
  assert.equal(g.totalPriceBOB,'20.00');assert.equal(g.bookings[0].priceBOB,'20.00');
  assert.deepEqual(await b.reserve(fixture.tokens.p,k,{...request(2),quote:q}),g);
  await acceptAll(g);
  const replay=await b.reserve(fixture.tokens.p,k,{...request(2),quote:q});
  assert.equal(replay.initialStatus,'HELD');assert.equal(replay.bookings[0].status,'CONFIRMED');
  await admin.query('UPDATE nexo.fares SET amount_bob=99,version=2 WHERE id=$1',[q.fareId]);
  const snapshot=await b.booking(fixture.tokens.p,g.bookingIds[0]);
  assert.equal(snapshot.price_bob,'20.00');assert.equal(snapshot.fare_version,1);assert.equal(snapshot.movementState,'UNRECORDED');
  await rejects(b.reserve(fixture.tokens.p,key(),{...request(2),quote:q}),/QUOTE_CHANGED/);
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
});
test('B02: APP and terminal race for a final seat, a single winner with six-seat segment capacity',async()=>{
  await fixed(5,0);await fixed(6,1);await fixed(6,2);
  const b=business(), results=await Promise.allSettled(Array.from({length:24},(_,i)=>i%2?
    b.walkIn(fixture.tokens.adminA,key(),request(1)):b.reserve(fixture.tokens.p,key(),request(1))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>/NO_CAPACITY/.test(r.reason.message)));
  assert.ok((await occupancy()).every(r=>r.used<=6));
  await rejects(b.walkIn(fixture.tokens.adminB,key(),request(1)),/FORBIDDEN_SOURCE/);
  await rejects(b.walkIn(fixture.tokens.p,key(),request(1)),/FORBIDDEN_SOURCE/);
});
test('B03: voluntary group split is held atomically and rejection/cancellation frees every linked leg',async()=>{
  const b=business();await fixed(4,0);
  const req={...request(5),parts:[{tripId:fixture.trips[0],seats:2},{tripId:fixture.trips[1],seats:3}],splitConsent:true,containsMinors:false};
  const g=await b.reserve(fixture.tokens.p,key(),req);
  assert.equal(g.bookings.length,2);assert.equal(g.totalPriceBOB,'50.00');
  assert.equal((await b.respond(fixture.tokens.d0,key(),g.bookings.find(x=>x.tripId===fixture.trips[0]).bookingId,true)).status,'HELD');
  await b.respond(fixture.tokens.d1,key(),g.bookings.find(x=>x.tripId===fixture.trips[1]).bookingId,false);
  assert.ok((await admin.query('SELECT status FROM nexo.bookings WHERE group_id=$1',[g.groupId])).rows.every(x=>x.status==='REJECTED'));
  const next=await b.reserve(fixture.tokens.p,key(),req);
  const cancellations=await Promise.all(Array.from({length:8},()=>b.cancel(fixture.tokens.p,key(),next.bookingIds[0])));
  assert.ok(cancellations.every(x=>x.status==='CANCELLED'));
  assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('B04: express, together-by-default, duplicate HTTP-safe keys and conflicting payloads preserve core contracts',async()=>{
  const b=business();
  const results=await Promise.all(Array.from({length:12},()=>b.reserve(fixture.tokens.p,'same-key',request(6,{express:true}))));
  assert.ok(results.every(r=>r.groupId===results[0].groupId));assert.equal(results[0].totalPriceBOB,'60.00');
  assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
  await rejects(b.reserve(fixture.tokens.p,'same-key',request(5)),/IDEMPOTENCY_CONFLICT/);
  const group=await b.reserve(fixture.tokens.p,key(),request(5));assert.equal(group.bookings.length,1);
});
test('B05: queue and manifest are RLS-scoped, ordered, bounded and reject unauthenticated readers',async()=>{
  const b=business(), g=await b.reserve(fixture.tokens.p,key(),request(2));
  assert.deepEqual((await b.queue(fixture.tokens.adminA,{routeId:fixture.ra})).map(t=>t.id),fixture.trips.slice(0,3));
  assert.equal((await b.queue(fixture.tokens.adminA,{routeId:fixture.ra,limit:1,offset:1}))[0].id,fixture.trips[1]);
  assert.deepEqual(await b.queue(fixture.tokens.adminB,{routeId:fixture.ra}),[]);
  assert.deepEqual(await b.queue(fixture.tokens.p,{routeId:fixture.ra}),[]);
  assert.equal((await b.queue(fixture.tokens.d0,{routeId:fixture.ra})).length,1);
  assert.equal((await b.manifest(fixture.tokens.d0,{tripId:fixture.trips[0]})).bookings[0].id,g.bookingIds[0]);
  await rejects(b.manifest(fixture.tokens.d1,{tripId:fixture.trips[0]}),/NOT_FOUND/);
  await rejects(b.booking(fixture.tokens.other,g.bookingIds[0]),/NOT_FOUND/);
  await rejects(b.queue('x'.repeat(64),{routeId:fixture.ra}),/UNAUTHENTICATED/);
  assert.equal((await pool.query('SELECT * FROM nexo.bookings')).rowCount,0);
});
test('B06: conflicting accept/reject requests serialize; a rejected group cannot be resurrected',async()=>{
  const b=business(),g=await b.reserve(fixture.tokens.p,key(),request(6));
  const results=await Promise.all(Array.from({length:16},(_,i)=>b.respond(fixture.tokens.d0,key(),g.bookingIds[0],i%2===0)));
  const status=(await b.booking(fixture.tokens.p,g.bookingIds[0])).status;
  assert.ok(['CONFIRMED','REJECTED'].includes(status));assert.ok(results.every(r=>r.status===status));
  assert.equal((await admin.query("SELECT * FROM nexo.audit_events WHERE action IN ('OFFER_ACCEPTED','OFFER_REJECTED')")).rowCount,1);
  assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('B07: boarding/alighting record a booking at its enabled stops, without changing tariffs or reserved seats',async()=>{
  const b=business(),g=await b.reserve(fixture.tokens.p,key(),request(6));await acceptAll(g);
  const before=(await b.booking(fixture.tokens.p,g.bookingIds[0])).price_bob;
  await rejects(b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD'),/INVALID_MOVEMENT_STATE/);
  await b.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  const boards=await Promise.all(Array.from({length:10},()=>b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD')));
  assert.ok(boards.every(r=>r.recorded));
  assert.equal((await b.booking(fixture.tokens.p,g.bookingIds[0])).movementState,'BOARDED');
  await rejects(b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'ALIGHT'),/INVALID_MOVEMENT_STATE/);
  await b.progress(fixture.tokens.d0,key(),fixture.trips[0],3);
  await b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'ALIGHT');
  const ended=await b.booking(fixture.tokens.p,g.bookingIds[0]);
  assert.equal(ended.movementState,'ALIGHTED');assert.equal(ended.price_bob,before);assert.equal(ended.seats,6);
  assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,2);
  await rejects(admin.query("UPDATE nexo.booking_movements SET kind='ALIGHT'"),/IMMUTABLE_AUDIT/);
});
test('B08: movements enforce driver, RLS A/B, progress and actual boarding/alighting permissions',async()=>{
  const b=business(),g=await b.reserve(fixture.tokens.p,key(),request(6,{from:1,to:2}));await acceptAll(g);
  await b.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await rejects(b.movement(fixture.tokens.adminA,key(),g.bookingIds[0],'BOARD'),/FORBIDDEN/);
  await rejects(b.movement(fixture.tokens.d3,key(),g.bookingIds[0],'BOARD'),/FORBIDDEN/);
  await rejects(b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD'),/INVALID_MOVEMENT_STATE/);
  await b.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=false WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await rejects(b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD'),/INVALID_MOVEMENT_STATE/);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=true WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');
  assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.booking_movements')).rowCount,0);
  assert.equal((await sql(fixture.tokens.other,'SELECT * FROM nexo.booking_movements')).rowCount,0);
  assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.booking_movements')).rowCount,1);
  await rejects(sql(fixture.tokens.d0,'DELETE FROM nexo.booking_movements'),/permission denied/);
  await b.progress(fixture.tokens.d0,key(),fixture.trips[0],2);
  await b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'ALIGHT');
});
test('B09: board/progress races share the route lock and cannot fabricate an observation at a passed stop',async()=>{
  const b=business(),g=await b.reserve(fixture.tokens.p,key(),request(6));await acceptAll(g);await b.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT * FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
    pending=b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD').then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.record_movement(%');
    await blocker.query('UPDATE nexo.trips SET current_stop=1 WHERE id=$1',[fixture.trips[0]]);await blocker.query('COMMIT');
    assert.match((await pending).error.message,/INVALID_MOVEMENT_STATE/);
  } finally {await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
  assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,0);
});
test('B10: terminal bookings on disjoint segments preserve six-seat inventory and cancellations release it once',async()=>{
  const b=business();await b.walkIn(fixture.tokens.adminA,key(),request(6,{from:0,to:1}));
  const second=await b.reserve(fixture.tokens.p,key(),request(6,{from:1,to:3}));
  assert.equal(second.bookings[0].tripId,fixture.trips[0]);
  assert.ok((await occupancy()).filter(x=>x.id===fixture.trips[0]).every(x=>x.used===6));
  await b.cancel(fixture.tokens.p,key(),second.bookingIds[0]);
  assert.deepEqual((await occupancy()).filter(x=>x.id===fixture.trips[0]).map(x=>x.used),[6,0,0]);
});
test('B11: separate business HTTP uses Bearer, idempotency, safe conflicts and never exposes identity/provisioning',async()=>{
  const http=await startBusinessRuntime(pool), headers={Authorization:'Bearer '+fixture.tokens.p,'Idempotency-Key':key()};
  try {
    assert.equal((await postJson(http.url,'/v1/login',{})).status,404);
    assert.equal((await postJson(http.url,'/business/reserve',request())).status,401);
    assert.equal((await postJson(http.url,'/business/reserve',request(),{Authorization:headers.Authorization})).status,400);
    assert.equal((await postJson(http.url,'/business/reserve',{...request(),actorId:fixture.adminA},headers)).status,400);
    const q=await postJson(http.url,'/business/quote',request(2),headers);assert.equal(q.status,200);
    const g=await postJson(http.url,'/business/reserve',{...request(2),quote:q.body},headers);assert.equal(g.status,200);assert.equal(g.body.totalPriceBOB,'20.00');
    assert.deepEqual((await postJson(http.url,'/business/reserve',{...request(2),quote:q.body},headers)).body,g.body);
    assert.equal((await postJson(http.url,'/business/reserve',request(3),headers)).status,409);
    const walk=await postJson(http.url,'/business/walk-in',request(),{...headers,'Idempotency-Key':key()});assert.equal(walk.status,403);
    assert.ok(!JSON.stringify(walk.body).includes('SQL'));
    const info=await postJson(http.url,'/business/booking',{bookingId:g.body.bookingIds[0]},headers);assert.equal(info.status,200);
    await api.logout(fixture.tokens.p);
    assert.equal((await postJson(http.url,'/business/booking',{bookingId:g.body.bookingIds[0]},headers)).status,401);
  } finally {await http.close();}
});
test('B12: populated Stage 1 (001-011) upgrades additively, preserving old bookings, sessions and every old table',async()=>{
  const g=await fixed(6);await acceptAll(g);
  const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
  const upgradeUrl=new URL(url);upgradeUrl.pathname='/'+name;
  const db=new pg.Client({connectionString:upgradeUrl.href});await db.connect();
  try {
    const dir=await mkdtemp(resolve('.local','stage1-migrations-'));
    const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'012' ORDER BY name")).rows.map(x=>x.name);
    for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
    assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,11);
    const tables=['users','identity_accounts','identity_recovery','identity_attempts','sessions','associations','memberships',
      'geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers',
      'route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','identity_events','security_events'];
    for(const table of tables)for(const row of (await admin.query('SELECT * FROM nexo.'+table)).rows) {
      const columns=Object.keys(row);await db.query(`INSERT INTO nexo.${table} (${columns.map(k=>db.escapeIdentifier(k)).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
    }
    const snapshot=async()=>{
      const result={};for(const table of [...tables,'authorization_events'])result[table]=(await db.query('SELECT * FROM nexo.'+table+' t ORDER BY to_jsonb(t)::text')).rows;return result;
    };
    const before=await snapshot();assert.deepEqual(await migrate(db),['012_business_operations.sql','013_individual_operations.sql','014_terminal_operations.sql','015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);
    assert.equal((await db.query('SELECT * FROM nexo.booking_movements')).rowCount,0);
    await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.d0]);
    await db.query('SELECT nexo.depart($1,$2)',[key(),fixture.trips[0]]);
    await db.query("SELECT nexo.record_movement($1,$2,'BOARD')",[key(),g.bookingIds[0]]);
    await db.query('SELECT nexo.progress($1,$2,3)',[key(),fixture.trips[0]]);
    await db.query("SELECT nexo.record_movement($1,$2,'ALIGHT')",[key(),g.bookingIds[0]]);
    assert.equal((await db.query('SELECT price_bob,status FROM nexo.bookings WHERE id=$1',[g.bookingIds[0]])).rows[0].price_bob,'60.00');
  } finally {await db.end();}
});
test('B13: business HTTP walk-in, driver dispatch, observations and voluntary return keep independent queues',async()=>{
  const reverse=randomUUID();
  await admin.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count) VALUES($1,$2,'Retorno ficticio','IN',1,4)",[reverse,fixture.A]);
  await mapRoute(admin,reverse,fixture.A,fixture.geo,fixture.geo.localities[1],fixture.geo.localities[0]);
  await permit(admin,reverse,fixture.A,fixture.adminA,fixture.reviewer);
  const http=await startBusinessRuntime(pool);
  const command=(path,body,token)=>postJson(http.url,'/business/'+path,body,{Authorization:'Bearer '+token,'Idempotency-Key':key()});
  try {
    const g=await command('walk-in',request(6),fixture.tokens.adminA);assert.equal(g.status,200);
    const bookingId=g.body.bookingIds[0],tripId=fixture.trips[0];
    assert.equal((await command('respond',{bookingId,accept:true},fixture.tokens.d0)).status,200);
    assert.equal((await command('depart',{tripId},fixture.tokens.adminA)).status,403);
    assert.equal((await command('depart',{tripId},fixture.tokens.d0)).body.status,'IN_TRANSIT');
    assert.equal((await command('movement',{bookingId,kind:'BOARD'},fixture.tokens.d0)).status,200);
    assert.equal((await command('progress',{tripId,stop:3},fixture.tokens.d0)).body.status,'COMPLETED');
    assert.equal((await command('movement',{bookingId,kind:'ALIGHT'},fixture.tokens.d0)).status,200);
    const returned=await command('request-queue',{previousTripId:tripId,routeId:reverse},fixture.tokens.d0);
    assert.equal(returned.status,200);assert.ok(returned.body.tripId);
    assert.deepEqual((await business().queue(fixture.tokens.adminA,{routeId:fixture.ra})).map(t=>t.id),fixture.trips.slice(1,3));
    assert.equal((await business().queue(fixture.tokens.adminA,{routeId:reverse}))[0].id,returned.body.tripId);
    assert.equal((await business().queue(fixture.tokens.adminB,{routeId:reverse})).length,0);
  } finally {await http.close();}
});

async function individualFixture(seats=6,more={}) {
  const g=await fixed(seats,0,more);await acceptAll(g);
  const members=(await business().roster(fixture.tokens.d0,g.bookingIds[0])).members;
  return {...g,members};
}
test('I01: every group size has distinct technical slots; split legs and express do not infer boarding',async()=>{
  for(let seats=1;seats<=6;seats++) {
    const g=await fixed(seats),roster=await business().roster(fixture.tokens.p,g.bookingIds[0]);
    assert.deepEqual(roster.members.map(m=>m.ordinal),Array.from({length:seats},(_,i)=>i+1));
    assert.equal(new Set(roster.members.map(m=>m.id)).size,seats);
    assert.ok(roster.members.every(m=>m.state==='UNRECORDED' && !m.legacy_aggregate));
    await api.cancel(fixture.tokens.p,key(),g.bookingIds[0]);
  }
  const split=await hold(3,{splitConsent:true,containsMinors:false,parts:[{tripId:fixture.trips[0],seats:1},{tripId:fixture.trips[1],seats:2}]});
  assert.deepEqual((await Promise.all(split.bookingIds.map(id=>business().roster(fixture.tokens.p,id)))).map(r=>r.members.length),[1,2]);
  await api.cancel(fixture.tokens.p,key(),split.bookingIds[0]);
  const express=await fixed(6,0,{express:true});
  assert.equal((await business().roster(fixture.tokens.p,express.bookingIds[0])).members.length,6);
  assert.equal((await admin.query('SELECT * FROM nexo.member_movements')).rowCount,0);
});
test('I02: six individual board/alight observations are exact-stop, idempotent and preserve price/inventory',async()=>{
  const g=await individualFixture(),b=business(),member=g.members[0].id;
  await rejects(b.memberMovement(fixture.tokens.d0,key(),member,'BOARD'),/INVALID_MOVEMENT_STATE/);
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),member,'ALIGHT'),/INVALID_MOVEMENT_STATE/);
  const before=await occupancy();
  const sameKey=key();await Promise.all(Array.from({length:12},(_,i)=>b.memberMovement(fixture.tokens.d0,i%2?sameKey:key(),member,'BOARD')));
  assert.equal((await admin.query('SELECT * FROM nexo.member_movements')).rowCount,1);
  await rejects(b.memberMovement(fixture.tokens.d0,sameKey,g.members[1].id,'BOARD'),/IDEMPOTENCY_CONFLICT/);
  await Promise.all(g.members.slice(1).map(m=>b.memberMovement(fixture.tokens.d0,key(),m.id,'BOARD')));
  assert.equal((await b.manifest(fixture.tokens.d0,{tripId:fixture.trips[0],limit:1})).observedOnboard,6);
  assert.deepEqual(await occupancy(),before);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),member,'ALIGHT'),/INVALID_MOVEMENT_STATE/);
  await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3);
  await Promise.all(g.members.map(m=>b.memberMovement(fixture.tokens.d0,key(),m.id,'ALIGHT')));
  assert.ok((await b.roster(fixture.tokens.p,g.bookingIds[0])).members.every(m=>m.state==='ALIGHTED'));
  assert.equal((await b.manifest(fixture.tokens.d0,{tripId:fixture.trips[0]})).observedOnboard,0);
  assert.equal((await b.booking(fixture.tokens.p,g.bookingIds[0])).price_bob,'60.00');
  assert.equal((await admin.query("SELECT * FROM nexo.audit_events WHERE action IN ('MEMBER_BOARDED','MEMBER_ALIGHTED')")).rowCount,12);
  await rejects(admin.query("UPDATE nexo.member_movements SET stop_index=2"),/IMMUTABLE/);
});
test('I03: RLS, grants and revoked sessions prevent individual/absence access across associations',async()=>{
  const g=await individualFixture(),b=business(),member=g.members[0].id;
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  for(const who of ['p','other','adminA','adminB','d1','d3'])
    await rejects(b.memberMovement(fixture.tokens[who],key(),member,'BOARD'),/FORBIDDEN/);
  for(const table of ['booking_members','member_movements','absence_drafts']) {
    assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.'+table)).rowCount,0);
    await rejects(sql(fixture.tokens.d0,'DELETE FROM nexo.'+table),/permission denied/);
  }
  await rejects(b.roster(fixture.tokens.other,g.bookingIds[0]),/NOT_FOUND/);
  await rejects(b.absenceDraft(fixture.tokens.adminB,key(),member,'WAITING'),/FORBIDDEN/);
  await rejects(b.absencePreview(fixture.tokens.d3,member),/NOT_FOUND/);
  for(const fn of ['record_movement_aggregate_internal','respond_offer_internal','observed_onboard']) {
    const args=fn==='observed_onboard'?'$1':fn==='respond_offer_internal'?"'x',$1,true":"'x',$1,'BOARD'";
    await rejects(sql(fixture.tokens.d0,'SELECT nexo.'+fn+'('+args+')',[g.bookingIds[0]]),/permission denied/);
  }
  await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[fixture.drivers[0]]);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),member,'BOARD'),/UNAUTHENTICATED/);
  await rejects(b.refreshOffers(fixture.tokens.d0,key(),fixture.trips[0]),/UNAUTHENTICATED/);
});
test('I04: intermediate pickup reuses segment capacity only after observed alighting, without overboarding',async()=>{
  const first=await individualFixture(6,{to:1}),later=await fixed(6,0,{from:1});await acceptAll(later);
  const b=business(),members=(await b.roster(fixture.tokens.d0,later.bookingIds[0])).members;
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),members[0].id,'BOARD'),/INVALID_MOVEMENT_STATE/);
  await Promise.all(first.members.map(m=>b.memberMovement(fixture.tokens.d0,key(),m.id,'BOARD')));
  await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),members[0].id,'BOARD'),/OBSERVED_CAPACITY_EXCEEDED/);
  await Promise.all(first.members.map(m=>b.memberMovement(fixture.tokens.d0,key(),m.id,'ALIGHT')));
  await Promise.all(members.map(m=>b.memberMovement(fixture.tokens.d0,key(),m.id,'BOARD')));
  const manifest=await b.manifest(fixture.tokens.d0,{tripId:fixture.trips[0],limit:1});
  assert.equal(manifest.observedOnboard,6);assert.deepEqual(manifest.segments.map(s=>s.reserved),[6,6,6]);
  await rejects(fixed(1,0,{from:1}),/NO_CAPACITY|QUEUE_ORDER|INCOMPATIBLE_TRIP/);
  await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3);
  await Promise.all(members.map(m=>b.memberMovement(fixture.tokens.d0,key(),m.id,'ALIGHT')));
  assert.equal((await b.manifest(fixture.tokens.d0,{tripId:fixture.trips[0]})).observedOnboard,0);
});
test('I05: legacy aggregate history stays distinct and concurrent aggregate/individual writes cannot mix',async()=>{
  const g=await individualFixture(),b=business();await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  const result=await Promise.allSettled([
    b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD'),
    b.memberMovement(fixture.tokens.d0,key(),g.members[0].id,'BOARD')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.match(result.find(r=>r.status==='rejected').reason.message,/HISTORY_ONLY/);
  const roster=await b.roster(fixture.tokens.p,g.bookingIds[0]);
  if(roster.members[0].legacy_aggregate) {
    assert.ok(roster.members.every(m=>m.state==='UNRECORDED' && m.legacy_aggregate));
    await rejects(b.memberMovement(fixture.tokens.d0,key(),g.members[1].id,'BOARD'),/AGGREGATE_HISTORY_ONLY/);
  } else await rejects(b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD'),/INDIVIDUAL_HISTORY_ONLY/);
});
test('I06: progress wins a concurrent individual observation at a passed stop; role revocation is rechecked',async()=>{
  const g=await individualFixture(),b=business();await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
    pending=b.memberMovement(fixture.tokens.d0,key(),g.members[0].id,'BOARD').then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.record_member_movement(%');
    await blocker.query("SELECT set_config('nexo.session_token',$1,true)",[fixture.tokens.d0]);
    await blocker.query('SELECT nexo.progress($1,$2,1)',[key(),fixture.trips[0]]);await blocker.query('COMMIT');
    assert.match((await pending).error.message,/INVALID_MOVEMENT_STATE/);
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
    pending=b.memberMovement(fixture.tokens.d0,key(),g.members[0].id,'BOARD').then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.record_member_movement(%');
    await blocker.query('UPDATE nexo.memberships SET active=false WHERE user_id=$1',[fixture.drivers[0]]);await blocker.query('COMMIT');
    assert.match((await pending).error.message,/FORBIDDEN/);
  } finally {await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
  assert.equal((await admin.query('SELECT * FROM nexo.member_movements')).rowCount,0);
});
test('I07: absence drafts are manual, timed, idempotent and never release seats or send notices',async()=>{
  const g=await individualFixture(),b=business(),member=g.members[0].id,before=await occupancy();
  assert.equal((await b.absencePreview(fixture.tokens.p,member)).suggestedDraft,'NOT_STARTED');
  await rejects(b.absenceDraft(fixture.tokens.d0,key(),member,'WARNING_DRAFT'),/INVALID_ABSENCE_STATE/);
  const same=key();await Promise.all(Array.from({length:8},(_,i)=>b.absenceDraft(fixture.tokens.d0,i%2?same:key(),member,'WAITING')));
  await rejects(b.absenceDraft(fixture.tokens.adminA,key(),member,'GRACE_DRAFT'),/INVALID_ABSENCE_STATE/);
  assert.equal((await b.absencePreview(fixture.tokens.p,member)).suggestedDraft,'WAITING');
  const mature=g.members[1].id;
  await admin.query("INSERT INTO nexo.absence_drafts(association_id,booking_id,member_id,kind,actor_id,created_at) VALUES($1,$2,$3,'WAITING',$4,clock_timestamp()-interval '16 minutes')",[fixture.A,g.bookingIds[0],mature,fixture.drivers[0]]);
  const preview=await b.absencePreview(fixture.tokens.adminA,mature);assert.equal(preview.suggestedDraft,'GRACE_DRAFT');assert.equal(preview.policyActive,false);
  // Preview creates nothing, and grace cannot bypass the explicit warning draft.
  await rejects(b.absenceDraft(fixture.tokens.adminA,key(),mature,'GRACE_DRAFT'),/INVALID_ABSENCE_STATE/);
  await b.absenceDraft(fixture.tokens.adminA,key(),mature,'WARNING_DRAFT');
  assert.equal((await b.absenceDraft(fixture.tokens.d0,key(),mature,'GRACE_DRAFT')).delivery,'DISABLED');
  assert.deepEqual(await occupancy(),before);assert.equal((await b.booking(fixture.tokens.p,g.bookingIds[0])).status,'CONFIRMED');
  await b.absenceDraft(fixture.tokens.adminA,key(),mature,'RESOLVED');
  assert.equal((await b.absencePreview(fixture.tokens.p,mature)).suggestedDraft,'RESOLVED');
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await b.memberMovement(fixture.tokens.d0,key(),member,'BOARD');
  assert.equal((await b.absencePreview(fixture.tokens.p,member)).suggestedDraft,'RESOLVED');
  await rejects(b.absenceDraft(fixture.tokens.d0,key(),member,'WARNING_DRAFT'),/INVALID_ABSENCE_STATE/);
  assert.ok((await admin.query('SELECT delivery FROM nexo.absence_drafts')).rows.every(r=>r.delivery==='DISABLED'));
  await rejects(admin.query('DELETE FROM nexo.absence_drafts'),/IMMUTABLE/);
});
test('I08: absence drafts require the pickup stop and cannot masquerade as boarding or absence evidence',async()=>{
  const g=await individualFixture(6,{from:1}),member=g.members[0].id,b=business();
  await rejects(b.absenceDraft(fixture.tokens.d0,key(),member,'WAITING'),/INVALID_ABSENCE_STATE/);
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=false WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await rejects(b.absenceDraft(fixture.tokens.adminA,key(),member,'WAITING'),/INVALID_ABSENCE_STATE/);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=true WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await b.absenceDraft(fixture.tokens.adminA,key(),member,'WAITING');
  assert.equal((await admin.query('SELECT * FROM nexo.member_movements')).rowCount,0);
  await rejects(b.absenceDraft(fixture.tokens.p,key(),member,'RESOLVED'),/FORBIDDEN/);
  await api.progress(fixture.tokens.d0,key(),fixture.trips[0],2);
  await rejects(b.absenceDraft(fixture.tokens.d0,key(),g.members[1].id,'WAITING'),/INVALID_ABSENCE_STATE/);
});
test('I09: permit revocation blocks even the first partial acceptance of a split group',async()=>{
  const g=await hold(3,{splitConsent:true,containsMinors:false,parts:[{tripId:fixture.trips[0],seats:1},{tripId:fixture.trips[1],seats:2}]});
  const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
  try {
    await blocker.query('BEGIN');await blocker.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
    pending=api.respond(fixture.tokens.d0,key(),g.bookingIds[0],true).then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.respond_offer(%');await blocker.query('COMMIT');
    assert.match((await pending).error.message,/ROUTE_NOT_ELIGIBLE/);
  } finally {await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
  assert.ok((await admin.query('SELECT status,driver_accepted FROM nexo.bookings')).rows.every(b=>b.status==='HELD' && !b.driver_accepted));
  assert.equal((await api.respond(fixture.tokens.d0,key(),g.bookingIds[0],false)).status,'REJECTED');
});
test('I10: simultaneous offer expiry, acceptance and retries cannot revive an expired split',async()=>{
  const g=await hold(3,{splitConsent:true,containsMinors:false,parts:[{tripId:fixture.trips[0],seats:1},{tripId:fixture.trips[1],seats:2}]});
  await admin.query("UPDATE nexo.bookings SET expires_at=clock_timestamp()-interval '1 second'");
  const b=business(),offers=await b.offers(fixture.tokens.d0,{tripId:fixture.trips[0]});
  assert.equal(offers.provisionalTtlSeconds,120);assert.equal(offers.offers[0].effective_status,'EXPIRED');
  assert.equal(offers.offers[0].status,'HELD');
  const same=key();const results=await Promise.all(Array.from({length:12},(_,i)=>i%2?
    b.refreshOffers(fixture.tokens.d0,same,fixture.trips[0]):b.respond(fixture.tokens.d1,key(),g.bookingIds[1],true)));
  assert.ok(results.every(r=>r.status===undefined || r.status==='EXPIRED'));
  assert.ok((await admin.query('SELECT status,driver_accepted FROM nexo.bookings')).rows.every(r=>r.status==='EXPIRED' && !r.driver_accepted));
  assert.ok((await occupancy()).every(r=>r.used===0));
  await rejects(b.refreshOffers(fixture.tokens.adminB,key(),fixture.trips[0]),/FORBIDDEN/);
  await rejects(b.offers(fixture.tokens.d3,{tripId:fixture.trips[0]}),/NOT_FOUND/);
  await rejects(b.respond(fixture.tokens.d0,same,g.bookingIds[0],true),/IDEMPOTENCY_CONFLICT/);
});
test('I11: HTTP individual and draft contracts reject personal data, missing keys and revoked sessions safely',async()=>{
  const g=await individualFixture(),http=await startBusinessRuntime(pool),memberId=g.members[0].id;
  const command=(path,body,token=fixture.tokens.d0,extra={})=>postJson(http.url,'/business/'+path,body,{Authorization:'Bearer '+token,'Idempotency-Key':key(),...extra});
  try {
    assert.equal((await command('roster',{bookingId:g.bookingIds[0]})).body.members.length,6);
    assert.equal((await command('member-movement',{memberId,kind:'BOARD',name:'FICTICIO'})).status,400);
    assert.equal((await command('absence-draft',{memberId,kind:'WAITING'},'invalid')).status,401);
    assert.equal((await command('absence-draft',{memberId,kind:'WAITING'},fixture.tokens.d0,{'Idempotency-Key':''})).status,400);
    assert.equal((await command('absence-draft',{memberId,kind:'WAITING'})).body.delivery,'DISABLED');
    assert.equal((await command('absence-draft',{memberId,kind:'WARNING_DRAFT'})).status,409);
    assert.equal((await command('absence-preview',{memberId})).body.policyActive,false);
    assert.equal((await command('offers',{tripId:fixture.trips[0]})).body.provisionalTtlSeconds,120);
    assert.equal((await command('refresh-offers',{tripId:fixture.trips[0]})).status,200);
    await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
    assert.equal((await command('member-movement',{memberId,kind:'BOARD'})).status,200);
    assert.equal((await command('movement',{bookingId:g.bookingIds[0],kind:'BOARD'})).status,409);
    await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[fixture.drivers[0]]);
    const denied=await command('member-movement',{memberId,kind:'BOARD'});assert.equal(denied.status,401);
    assert.deepEqual(denied.body,{error:'UNAUTHENTICATED'});
  } finally {await http.close();}
});
test('I12: populated 001-012 upgrade preserves every old row and aggregate history, without inferred member events',async()=>{
  const g=await fixed(6);await acceptAll(g);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await business().movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');
  const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
  const upgradeUrl=new URL(url);upgradeUrl.pathname='/'+name;const db=new pg.Client({connectionString:upgradeUrl.href});await db.connect();
  try {
    const dir=await mkdtemp(resolve('.local','stage2-migrations-'));
    const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'013' ORDER BY name")).rows.map(x=>x.name);
    for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
    assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,12);
    const tables=['users','identity_accounts','identity_recovery','identity_attempts','sessions','associations','memberships',
      'geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers',
      'route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','identity_events','security_events','booking_movements'];
    for(const table of tables)for(const row of (await admin.query('SELECT * FROM nexo.'+table)).rows) {
      const columns=Object.keys(row);await db.query(`INSERT INTO nexo.${table} (${columns.map(k=>db.escapeIdentifier(k)).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
    }
    const snapshot=async()=>{
      const result={};for(const table of [...tables,'authorization_events'])result[table]=(await db.query('SELECT * FROM nexo.'+table+' t ORDER BY to_jsonb(t)::text')).rows;return result;
    };
    const before=await snapshot();assert.deepEqual(await migrate(db),['013_individual_operations.sql','014_terminal_operations.sql','015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query('SELECT * FROM nexo.booking_members')).rowCount,6);
    assert.equal((await db.query('SELECT * FROM nexo.member_movements')).rowCount,0);
    assert.equal((await db.query('SELECT * FROM nexo.absence_drafts')).rowCount,0);
    assert.deepEqual(await migrate(db),[]);
    await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.d0]);
    await db.query('SELECT nexo.progress($1,$2,3)',[key(),fixture.trips[0]]);
    await db.query("SELECT nexo.record_movement($1,$2,'ALIGHT')",[key(),g.bookingIds[0]]);
    assert.equal((await db.query('SELECT price_bob FROM nexo.bookings')).rows[0].price_bob,'60.00');
  } finally {await db.end();}
});
test('I13: waiting offer acceptance rechecks driver membership and a revoked session cannot replay a receipt',async()=>{
  const g=await fixed(2),b=business(),blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
    pending=b.respond(fixture.tokens.d0,key(),g.bookingIds[0],true).then(value=>({value}),error=>({error}));
    await waitForQueryLock('%nexo.respond_offer(%');
    await blocker.query('UPDATE nexo.memberships SET active=false WHERE user_id=$1',[fixture.drivers[0]]);await blocker.query('COMMIT');
    assert.match((await pending).error.message,/FORBIDDEN/);
  } finally {await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
  assert.equal((await b.booking(fixture.tokens.p,g.bookingIds[0])).driver_accepted,false);
  await admin.query('UPDATE nexo.memberships SET active=true WHERE user_id=$1',[fixture.drivers[0]]);
  const receiptKey=key();await b.respond(fixture.tokens.d0,receiptKey,g.bookingIds[0],true);
  await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[fixture.drivers[0]]);
  await rejects(b.respond(fixture.tokens.d0,receiptKey,g.bookingIds[0],true),/UNAUTHENTICATED/);
});
test('I14: aggregate and individual bookings share the observed limit and exact stop permissions',async()=>{
  const first=await individualFixture(6,{to:1}),later=await fixed(6,0,{from:1});await acceptAll(later);const b=business();
  await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=false WHERE route_id=$1 AND stop_index=0',[fixture.ra]);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),first.members[0].id,'BOARD'),/INVALID_MOVEMENT_STATE/);
  await admin.query('UPDATE nexo.stops SET boarding_allowed=true WHERE route_id=$1 AND stop_index=0',[fixture.ra]);
  await b.memberMovement(fixture.tokens.d0,key(),first.members[0].id,'BOARD');
  await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
  await rejects(b.movement(fixture.tokens.d0,key(),later.bookingIds[0],'BOARD'),/OBSERVED_CAPACITY_EXCEEDED/);
  await admin.query('UPDATE nexo.stops SET alighting_allowed=false WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await rejects(b.memberMovement(fixture.tokens.d0,key(),first.members[0].id,'ALIGHT'),/INVALID_MOVEMENT_STATE/);
  await admin.query('UPDATE nexo.stops SET alighting_allowed=true WHERE route_id=$1 AND stop_index=1',[fixture.ra]);
  await b.memberMovement(fixture.tokens.d0,key(),first.members[0].id,'ALIGHT');
  await b.movement(fixture.tokens.d0,key(),later.bookingIds[0],'BOARD');
  const manifest=await b.manifest(fixture.tokens.d0,{tripId:fixture.trips[0],limit:1});assert.equal(manifest.observedOnboard,6);
  assert.equal(manifest.bookings[0].members[0].movements.length,2);
});
test('I15: concurrent absence draft and boarding serialize without changing bookings or manufacturing warnings',async()=>{
  const g=await individualFixture(),b=business(),member=g.members[0].id;await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  const before=await occupancy();
  const results=await Promise.allSettled([b.absenceDraft(fixture.tokens.adminA,key(),member,'WAITING'),b.memberMovement(fixture.tokens.d0,key(),member,'BOARD')]);
  assert.equal(results[1].status,'fulfilled');
  if(results[0].status==='rejected')assert.match(results[0].reason.message,/INVALID_ABSENCE_STATE/);
  assert.equal((await b.absencePreview(fixture.tokens.d0,member)).suggestedDraft,'RESOLVED');
  assert.deepEqual(await occupancy(),before);
  assert.equal((await admin.query("SELECT * FROM nexo.absence_drafts WHERE kind IN ('WARNING_DRAFT','GRACE_DRAFT')")).rowCount,0);
});
test('I16: new composite keys reject cross-association members/events and roster mutation remains denied',async()=>{
  const g=await individualFixture(),m=g.members[0].id;
  await rejects(admin.query('INSERT INTO nexo.booking_members(association_id,booking_id,ordinal) VALUES($1,$2,1)',[fixture.B,g.bookingIds[0]]),/foreign key/);
  await rejects(admin.query("INSERT INTO nexo.member_movements VALUES($1,$2,$3,'BOARD',0,$4,clock_timestamp())",[fixture.B,g.bookingIds[0],m,fixture.drivers[3]]),/foreign key/);
  await rejects(admin.query("INSERT INTO nexo.absence_drafts(association_id,booking_id,member_id,kind,actor_id) VALUES($1,$2,$3,'WAITING',$4)",[fixture.B,g.bookingIds[0],m,fixture.drivers[3]]),/foreign key/);
  await rejects(admin.query('UPDATE nexo.booking_members SET ordinal=6 WHERE id=$1',[m]),/IMMUTABLE/);
  await rejects(sql(fixture.tokens.adminA,'INSERT INTO nexo.booking_members(association_id,booking_id,ordinal) VALUES($1,$2,6)',[fixture.A,g.bookingIds[0]]),/permission denied/);
});

test('J01: declared arrival requires confirmation/config; verified offline arrival is admin-only and distinct from boarding',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];
 await rejects(b.terminalCommand(fixture.tokens.p,key(),id,'DECLARED',false),/INVALID/);
 await rejects(b.terminalCommand(fixture.tokens.p,key(),id,'DECLARED',true),/CONFIG_REQUIRED/);
 await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,120);
 await b.terminalCommand(fixture.tokens.p,key(),id,'DECLARED',true);
 let e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.declaredActive,true);assert.equal(e.verified,false);
 await rejects(b.terminalCommand(fixture.tokens.p,key(),id,'VERIFIED',true),/FORBIDDEN/);
 await b.terminalCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true);
 e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.verified,true);
 assert.equal((await b.roster(fixture.tokens.p,id)).members[0].state,'UNRECORDED');
 assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,0);
 await rejects(b.terminalEvaluation(fixture.tokens.adminB,id),/FORBIDDEN/);
});
test('J02: explicit ready event anchors 0/5/8 simulation, declarations expire without renewal and never cancel',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).readyAt,null);
 await b.terminalCommand(fixture.tokens.d0,key(),id,'READY',true);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).simulatedReadyNotice,true);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).cancellationEligibleSimulation,false);
 // Seed a past READY in an isolated fixture transaction, not a runtime clock override.
 const other=await fixed(6,1);await acceptAll(other);const oid=other.bookingIds[0];
 await admin.query("INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,created_at) VALUES($1,$2,$3,'READY',$4,clock_timestamp()-interval '9 minutes')",[fixture.A,oid,fixture.trips[1],fixture.drivers[1]]);
 let e=await b.terminalEvaluation(fixture.tokens.p,oid);assert.equal(e.offerAlternatives,true);assert.equal(e.cancellationEligibleSimulation,true);assert.equal(e.automaticCancellationEnabled,false);
 await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,1);
 await b.terminalCommand(fixture.tokens.p,key(),oid,'DECLARED',true);
 const expiration=(await admin.query("SELECT expires_at FROM nexo.terminal_events WHERE booking_id=$1 AND kind='DECLARED'",[oid])).rows[0].expires_at;
 await new Promise(resolve=>setTimeout(resolve,1100));
 await b.terminalCommand(fixture.tokens.p,key(),oid,'DECLARED',true);
 assert.deepEqual((await admin.query("SELECT expires_at FROM nexo.terminal_events WHERE booking_id=$1 AND kind='DECLARED'",[oid])).rows[0].expires_at,expiration);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,oid)).declaredActive,false);
 await b.terminalCommand(fixture.tokens.p,key(),oid,'TRANSFER_REQUEST',true);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,oid)).cancellationEligibleSimulation,false);
 assert.equal((await b.booking(fixture.tokens.p,oid)).status,'CONFIRMED');
});
test('J03: pickup five-minute clock starts only on recorded arrival at the actual pickup stop',async()=>{
 const g=await individualFixture(6,{from:1}),b=business(),id=g.bookingIds[0];
 await b.terminalCommand(fixture.tokens.p,key(),id,'PICKUP',true);
 await b.terminalCommand(fixture.tokens.d0,key(),id,'READY',true);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).simulatedReadyNotice,true);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).pickupWaitStartedAt,null);
 await rejects(b.terminalCommand(fixture.tokens.d0,key(),id,'PICKUP_ARRIVED',true),/INVALID/);
 await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
 await b.terminalCommand(fixture.tokens.d0,key(),id,'PICKUP_ARRIVED',true);
 const e=await b.terminalEvaluation(fixture.tokens.p,id);assert.ok(e.pickupWaitStartedAt);assert.equal(e.pickupFiveMinutesElapsed,false);assert.equal(e.cancellationEligibleSimulation,false);
});
test('J04: supervised A to C skips full B, preserves group/price/member IDs and reoffers to the destination driver',async()=>{
 const g=await individualFixture(2),fill=await fixed(4);await acceptAll(fill);
 const fullB=await fixed(6,1);await acceptAll(fullB);const b=business(),id=g.bookingIds[0];
 await b.terminalCommand(fixture.tokens.p,key(),id,'TRANSFER_REQUEST',true);
 assert.equal((await b.transferCandidates(fixture.tokens.adminA,id,'LATER'))[0].trip_id,fixture.trips[2]);
 const before=await b.booking(fixture.tokens.p,id),k=key();
 await Promise.all(Array.from({length:8},()=>b.transferBooking(fixture.tokens.adminA,k,id,fixture.trips[2],'LATER')));
 const after=await b.booking(fixture.tokens.p,id);assert.equal(after.trip_id,fixture.trips[2]);assert.equal(after.price_bob,before.price_bob);assert.equal(after.seats,2);assert.equal(after.status,'HELD');assert.deepEqual(after.members,before.members);
 await rejects(b.respond(fixture.tokens.d0,key(),id,true),/FORBIDDEN/);
 await b.respond(fixture.tokens.d2,key(),id,true);assert.equal((await b.booking(fixture.tokens.p,id)).status,'CONFIRMED');
 assert.equal((await admin.query("SELECT * FROM nexo.audit_events WHERE action='BOOKING_TRANSFERRED'")).rowCount,1);
 assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('J05: verified group can advance B to A only by admin confirmation; capacity and queue positions survive',async()=>{
 const a=await individualFixture(6),b=business();await b.terminalCommand(fixture.tokens.p,key(),a.bookingIds[0],'TRANSFER_REQUEST',true);
 await b.transferBooking(fixture.tokens.adminA,key(),a.bookingIds[0],fixture.trips[1],'LATER');await acceptAll(a);
 await b.terminalCommand(fixture.tokens.adminA,key(),a.bookingIds[0],'VERIFIED',true);
 const proposals=await b.advancementCandidates(fixture.tokens.adminA,fixture.trips[0]);assert.equal(proposals[0].bookingId,a.bookingIds[0]);
 await rejects(b.transferBooking(fixture.tokens.p,key(),a.bookingIds[0],fixture.trips[0],'EARLIER'),/FORBIDDEN/);
 await b.transferBooking(fixture.tokens.adminA,key(),a.bookingIds[0],fixture.trips[0],'EARLIER');await acceptAll(a);
 await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 assert.equal((await b.queue(fixture.tokens.adminA,{routeId:fixture.ra}))[0].id,fixture.trips[1]);
 await b.memberMovement(fixture.tokens.d0,key(),a.members[0].id,'BOARD');
 await rejects(b.transferBooking(fixture.tokens.adminA,key(),a.bookingIds[0],fixture.trips[1],'LATER'),/NO_COMPATIBLE/);
});
test('J06: no alternative and concurrent competing transfers preserve original reservations atomically',async()=>{
 const g=await individualFixture(4),other=await fixed(2);await acceptAll(other);const b=business();
 for(const id of [g.bookingIds[0],other.bookingIds[0]])await b.terminalCommand(fixture.tokens.p,key(),id,'TRANSFER_REQUEST',true);
 const fill=await fixed(4,1);await acceptAll(fill);const full=await fixed(6,2);await acceptAll(full);
 await rejects(b.transferBooking(fixture.tokens.adminA,key(),g.bookingIds[0],fixture.trips[1],'LATER'),/NO_COMPATIBLE/);
 assert.equal((await b.booking(fixture.tokens.p,g.bookingIds[0])).trip_id,fixture.trips[0]);
 const results=await Promise.allSettled(Array.from({length:8},()=>b.transferBooking(fixture.tokens.adminA,key(),other.bookingIds[0],fixture.trips[1],'LATER')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok((await occupancy()).every(r=>r.used<=6));
 await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[fixture.adminA]);
 await rejects(b.transferBooking(fixture.tokens.adminA,key(),g.bookingIds[0],fixture.trips[1],'LATER'),/UNAUTHENTICATED/);
});

test('J09: populated 001-013 upgrade preserves every old row and aggregate history, without inferred member events',async()=>{
  const g=await fixed(6);await acceptAll(g);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
  await business().movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');
  const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
  const upgradeUrl=new URL(url);upgradeUrl.pathname='/'+name;const db=new pg.Client({connectionString:upgradeUrl.href});await db.connect();
  try {
    const dir=await mkdtemp(resolve('.local','stage2-migrations-'));
    const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'014' ORDER BY name")).rows.map(x=>x.name);
    for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
    assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,13);
    const tables=['users','identity_accounts','identity_recovery','identity_attempts','sessions','associations','memberships',
      'geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers',
      'route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','identity_events','security_events','booking_movements','booking_members','member_movements','absence_drafts'];
    await db.query("DO $$ BEGIN IF to_regclass('nexo.booking_contracts') IS NOT NULL THEN ALTER TABLE nexo.bookings DISABLE TRIGGER capture_booking_contract;END IF;END $$");
    await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members');
    for(const table of tables)for(const row of (await admin.query('SELECT * FROM nexo.'+table)).rows) {
      const columns=Object.keys(row);await db.query(`INSERT INTO nexo.${table} (${columns.map(k=>db.escapeIdentifier(k)).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
    }
    await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members');
    await db.query("DO $$ BEGIN IF to_regclass('nexo.booking_contracts') IS NOT NULL THEN ALTER TABLE nexo.bookings ENABLE TRIGGER capture_booking_contract;END IF;END $$");
    const snapshot=async()=>{
      const result={};for(const table of [...tables,'authorization_events'])result[table]=(await db.query('SELECT * FROM nexo.'+table+' t ORDER BY to_jsonb(t)::text')).rows;return result;
    };
    const before=await snapshot();assert.deepEqual(await migrate(db),['014_terminal_operations.sql','015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query('SELECT * FROM nexo.booking_members')).rowCount,6);
    assert.equal((await db.query('SELECT * FROM nexo.member_movements')).rowCount,0);
    assert.equal((await db.query('SELECT * FROM nexo.absence_drafts')).rowCount,0);
    assert.deepEqual(await migrate(db),[]);
    await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.d0]);
    await db.query('SELECT nexo.progress($1,$2,3)',[key(),fixture.trips[0]]);
    await db.query("SELECT nexo.record_movement($1,$2,'ALIGHT')",[key(),g.bookingIds[0]]);
    assert.equal((await db.query('SELECT price_bob FROM nexo.bookings')).rows[0].price_bob,'60.00');
  } finally {await db.end();}
});
test('J07: offline WALK_IN verification works; NULL passenger never permits foreign cancellation or arrival',async()=>{
 const b=business(),g=await b.walkIn(fixture.tokens.adminA,key(),request(6));await acceptAll(g);const id=g.bookingIds[0];
 for(const token of [fixture.tokens.other,fixture.tokens.adminB]) {
  await rejects(b.cancel(token,key(),id),/FORBIDDEN/);
  await rejects(b.terminalCommand(token,key(),id,'VERIFIED',true),/FORBIDDEN/);
  await rejects(b.terminalEvaluation(token,id),/FORBIDDEN/);
 }
 await b.terminalCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true);
 assert.equal((await b.terminalEvaluation(fixture.tokens.adminA,id)).verified,true);
 await rejects(sql(fixture.tokens.p,"SELECT nexo.cancel_internal('x',$1)",[id]),/permission denied/);
});
test('J08: arrival, explicit cancellation and dispatch serialize; no automatic absence effect is applied',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];
 const results=await Promise.allSettled([
 b.terminalCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true),
 b.cancel(fixture.tokens.p,key(),id),b.depart(fixture.tokens.d0,key(),fixture.trips[0])]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 const booking=await b.booking(fixture.tokens.p,id),trip=(await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[0]])).rows[0];
 assert.ok((booking.status==='CANCELLED' && trip.status==='QUEUED') || (booking.status==='CONFIRMED' && trip.status==='IN_TRANSIT'));
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).cancellationEligibleSimulation,false);
 assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('J10: HTTP terminal operations reject personal fields, forged verification and malformed IDs',async()=>{
 const g=await individualFixture(),http=await startBusinessRuntime(pool),bookingId=g.bookingIds[0];
 const command=(path,body,token=fixture.tokens.p)=>postJson(http.url,'/business/'+path,body,{Authorization:'Bearer '+token,'Idempotency-Key':key()});
 try {
  assert.equal((await command('terminal-config',{associationId:fixture.A,declarationSeconds:120},fixture.tokens.adminA)).status,200);
  assert.equal((await command('terminal-command',{bookingId,command:'DECLARED',confirmed:true})).status,200);
  assert.equal((await command('terminal-command',{bookingId,command:'VERIFIED',confirmed:true})).status,403);
  assert.equal((await command('terminal-command',{bookingId,command:'DECLARED',confirmed:true,name:'FICTICIO'})).status,400);
  assert.equal((await command('terminal-evaluation',{bookingId:'bad'})).status,400);
  assert.equal((await command('terminal-evaluation',{bookingId})).body.declaredActive,true);
 }finally{await http.close();}
});
test('J11: two independent groups compete for one destination capacity without partial reassignment',async()=>{
 const a=await individualFixture(3),bgroup=await fixed(3);await acceptAll(bgroup);const b=business();
 const occupied=await fixed(3,1);await acceptAll(occupied);const full=await fixed(6,2);await acceptAll(full);
 for(const id of [a.bookingIds[0],bgroup.bookingIds[0]])await b.terminalCommand(fixture.tokens.p,key(),id,'TRANSFER_REQUEST',true);
 const results=await Promise.allSettled([a,bgroup].map(g=>b.transferBooking(fixture.tokens.adminA,key(),g.bookingIds[0],fixture.trips[1],'LATER')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.ok((await occupancy()).every(r=>r.used<=6));
 assert.equal((await admin.query('SELECT * FROM nexo.bookings WHERE trip_id=$1',[fixture.trips[0]])).rowCount,1);
});

async function transferredGroup(seats=6) {
 const g=await individualFixture(seats),b=business(),id=g.bookingIds[0];
 await b.episodeCommand(fixture.tokens.p,key(),id,'TRANSFER_REQUEST',true,0);
 await b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[1],'LATER',0);
 return {...g,id,b};
}
test('K01: rejected destination remains a visible incident; only approved, accepted recovery confirms the same group',async()=>{
 const {id,b,members}=await transferredGroup(3);
 await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 for(const token of [fixture.tokens.p,fixture.tokens.adminA]) {
  const s=await b.assignmentStatus(token,id);assert.equal(s.state,'RECOVERY_PENDING');assert.equal(s.confirmedAssignment,false);assert.equal(s.confirmedTripId,null);assert.equal(s.proposedTripId,null);
  assert.equal(s.originalTripId,fixture.trips[0]);assert.equal(s.assignedTripId,fixture.trips[1]);assert.equal(s.automaticRestoration,false);
 }
 assert.equal((await b.recoveryQueue(fixture.tokens.adminA,{routeId:fixture.ra}))[0].bookingId,id);
 assert.equal((await b.booking(fixture.tokens.p,id)).assignment.recoveryRequired,true);
 const before=await b.booking(fixture.tokens.p,id);
 assert.equal((await b.transferCandidates(fixture.tokens.adminA,id,'RECOVER'))[0].trip_id,fixture.trips[0]);
 await b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1);
 assert.equal((await b.assignmentStatus(fixture.tokens.p,id)).state,'OFFER_PENDING');
 await b.respondAssignment(fixture.tokens.d0,key(),id,2,true);
 const after=await b.booking(fixture.tokens.p,id);assert.equal(after.status,'CONFIRMED');assert.equal(after.price_bob,before.price_bob);assert.equal(after.seats,3);assert.deepEqual(after.members,members);
 const s=after.assignment;assert.equal(s.confirmedTripId,fixture.trips[0]);assert.deepEqual(s.episodes.map(e=>e.trip_id),[fixture.trips[0],fixture.trips[1],fixture.trips[0]]);
 assert.ok(s.outcomes.some(o=>o.episode===1 && o.kind==='REJECTED'));assert.ok(s.outcomes.some(o=>o.episode===2 && o.kind==='CONFIRMED'));
 assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
 assert.equal((await b.recoveryQueue(fixture.tokens.adminA,{routeId:fixture.ra})).length,0);
});
test('K02: lazy expiry detects a recovery incident and never restores a departed original vehicle',async()=>{
 const {id,b}=await transferredGroup();
 const replacement=await fixed(6);await acceptAll(replacement);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 await admin.query("UPDATE nexo.bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 assert.equal((await b.assignmentStatus(fixture.tokens.p,id)).state,'RECOVERY_PENDING');
 assert.equal((await b.booking(fixture.tokens.p,id)).status,'HELD');
 const choices=await b.transferCandidates(fixture.tokens.adminA,id,'RECOVER');assert.deepEqual(choices.map(c=>c.trip_id),[fixture.trips[2]]);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1),/QUEUE_ORDER/);
 await b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[2],'RECOVER',1);
 const state=await b.assignmentStatus(fixture.tokens.p,id);assert.ok(state.outcomes.some(o=>o.episode===1 && o.kind==='EXPIRED'));
 assert.equal(state.originalTripId,fixture.trips[0]);assert.equal(state.assignedTripId,fixture.trips[2]);
 assert.equal((await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[0]])).rows[0].status,'IN_TRANSIT');
 assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('K03: no recovery capacity leaves a visible incident, with price, members and failed history intact',async()=>{
 const {id,b,members}=await transferredGroup();await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 const a=await fixed(6);await acceptAll(a);const other=await fixed(6,1);await acceptAll(other);const c=await fixed(6,2);await acceptAll(c);
 const before=await b.booking(fixture.tokens.p,id);
 assert.deepEqual(await b.transferCandidates(fixture.tokens.adminA,id,'RECOVER'),[]);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1),/NO_COMPATIBLE_TRANSFER/);
 const after=await b.booking(fixture.tokens.p,id);assert.equal(after.status,'REJECTED');assert.equal(after.assignment.state,'RECOVERY_PENDING');assert.equal(after.price_bob,before.price_bob);assert.deepEqual(after.members,members);assert.equal(after.assignment.episodes.length,2);
 assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('K04: two administrators and concurrent retry keys cannot allocate two recovery episodes',async()=>{
 const {id,b}=await transferredGroup(2);await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 await admin.query("INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true)",[fixture.A,fixture.other]);
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>b.transferAssignment(fixture.tokens[i%2?'adminA':'other'],key(),id,fixture.trips[0],'RECOVER',1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.filter(r=>r.status==='rejected').every(r=>/STALE_ASSIGNMENT/.test(r.reason.message)));
 const s=await b.assignmentStatus(fixture.tokens.p,id);assert.equal(s.episode,2);assert.ok([fixture.adminA,fixture.other].includes(s.episodes[2].approved_by));
 assert.equal((await admin.query('SELECT * FROM nexo.booking_members')).rowCount,2);assert.ok((await occupancy()).every(r=>r.used<=6));
 const k=key();await b.respondAssignment(fixture.tokens.d0,k,id,2,true);
 assert.deepEqual(await b.respondAssignment(fixture.tokens.d0,k,id,2,true),{status:'CONFIRMED',episode:2});
 await rejects(b.respondAssignment(fixture.tokens.d0,k,id,1,true),/IDEMPOTENCY_CONFLICT/);
});
test('K05: repeated A/B episodes reset clocks and require fresh presence, with a finite review limit',async()=>{
 const g=await individualFixture(),id=g.bookingIds[0],b=business();
 await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,120);
 await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);
 await b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,0);
 await b.episodeCommand(fixture.tokens.d0,key(),id,'READY',true,0);
 for(let n=0;n<8;n++) {
  const forward=n%2===0,target=forward?1:0;
  await b.episodeCommand(fixture.tokens[forward?'p':'adminA'],key(),id,forward?'TRANSFER_REQUEST':'VERIFIED',true,n);
  await b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[target],forward?'LATER':'EARLIER',n);
  await b.respondAssignment(fixture.tokens['d'+target],key(),id,n+1,true);
  const e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.readyAt,null);assert.equal(e.verified,false);assert.equal(e.declaredActive,false);assert.equal(e.responded,false);assert.equal(e.cancellationEligibleSimulation,false);
 }
 const s=await b.assignmentStatus(fixture.tokens.p,id);assert.equal(s.episode,8);assert.equal(s.episodeLimitReached,true);assert.equal(s.episodes.length,9);assert.equal(s.originalTripId,fixture.trips[0]);
 await b.episodeCommand(fixture.tokens.p,key(),id,'TRANSFER_REQUEST',true,8);
 assert.deepEqual(await b.transferCandidates(fixture.tokens.adminA,id,'LATER'),[]);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[1],'LATER',8),/NO_COMPATIBLE_TRANSFER/);
 await rejects(b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,0),/STALE_ASSIGNMENT/);
 await rejects(b.respondAssignment(fixture.tokens.d0,key(),id,0,true),/STALE_ASSIGNMENT/);
 assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
});
test('K06: verified arrival prevails over expired declaration; compensating corrections retain evidence and change effective state',async()=>{
 const g=await individualFixture(),id=g.bookingIds[0],b=business();
 await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,1);
 await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);
 await new Promise(resolve=>setTimeout(resolve,1100));
 await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);
 await b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,0);
 await admin.query("INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,created_at) VALUES($1,$2,$3,'READY',$4,clock_timestamp()-interval '9 minutes')",[fixture.A,id,fixture.trips[0],fixture.drivers[0]]);
 let e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.declaredActive,false);assert.equal(e.verified,true);assert.equal(e.cancellationEligibleSimulation,false);
 const original=e.verificationEventId,k=key(),before=await b.booking(fixture.tokens.p,id);
 const attempts=await Promise.allSettled(Array.from({length:8},()=>b.correctArrival(fixture.tokens.adminA,k,id,0,original,'OPERATOR_ERROR')));
 for(const result of attempts)assert.equal(result.status,'fulfilled',result.reason?.message);
 e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.verified,false);assert.equal(e.cancellationEligibleSimulation,true);assert.equal(e.automaticCancellationEnabled,false);
 assert.equal((await admin.query('SELECT * FROM nexo.terminal_events WHERE id=$1',[original])).rowCount,1);
 await b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,0);
 e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.verified,true);assert.notEqual(e.verificationEventId,original);
 await b.correctArrival(fixture.tokens.adminA,key(),id,0,original,'OPERATOR_ERROR');
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).verified,true);
 const history=await b.terminalHistory(fixture.tokens.p,{bookingId:id});assert.equal(history.events.filter(x=>x.kind==='VERIFICATION_WITHDRAWN').length,1);
 assert.equal(history.events.find(x=>x.kind==='VERIFICATION_WITHDRAWN').reason,'OPERATOR_ERROR');
 const after=await b.booking(fixture.tokens.p,id);assert.equal(after.status,before.status);assert.equal(after.price_bob,before.price_bob);assert.deepEqual(after.members,before.members);
});
test('K07: declaration correction is admin-only, reasoned, immutable and cannot renew its expiry',async()=>{
 const g=await individualFixture(),id=g.bookingIds[0],b=business();await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,120);
 await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);const e=await b.terminalEvaluation(fixture.tokens.p,id),target=e.declarationEventId;
 for(const who of ['p','adminB','d0'])await rejects(b.correctArrival(fixture.tokens[who],key(),id,0,target,'OPERATOR_ERROR'),/FORBIDDEN/);
 await rejects(b.correctArrival(fixture.tokens.adminA,key(),id,0,target,''),/INVALID_CORRECTION/);
 await rejects(b.correctArrival(fixture.tokens.adminA,key(),id,0,key(),'OPERATOR_ERROR'),/INVALID_CORRECTION_TARGET/);
 await b.correctArrival(fixture.tokens.adminA,key(),id,0,target,'PASSENGER_CORRECTION');
 await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).declaredActive,false);
 await rejects(admin.query('UPDATE nexo.episode_terminal_events SET reason=reason'),/IMMUTABLE/);
 await rejects(sql(fixture.tokens.adminA,'DELETE FROM nexo.episode_terminal_events'),/permission denied/);
 assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.episode_terminal_events')).rowCount,0);
 await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[fixture.adminA]);
 await rejects(b.correctArrival(fixture.tokens.adminA,key(),id,0,target,'OPERATOR_ERROR'),/UNAUTHENTICATED/);
});
test('K08: configuration changes retain actor and both durations without changing an existing declaration',async()=>{
 const g=await individualFixture(),id=g.bookingIds[0],b=business();
 await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,120);await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);
 const target=(await b.terminalEvaluation(fixture.tokens.p,id)).declarationEventId;
 const before=(await admin.query('SELECT expires_at FROM nexo.terminal_events WHERE id=$1',[target])).rows[0];
 await b.configureTerminal(fixture.tokens.adminA,key(),fixture.A,300);await b.episodeCommand(fixture.tokens.p,key(),id,'DECLARED',true,0);
 assert.deepEqual((await admin.query('SELECT expires_at FROM nexo.terminal_events WHERE id=$1',[target])).rows[0],before);
 const changes=(await sql(fixture.tokens.adminA,'SELECT * FROM nexo.terminal_config_changes ORDER BY created_at,id')).rows;
 assert.equal(changes.length,2);assert.equal(changes[0].previous_seconds,null);assert.equal(changes[1].previous_seconds,120);assert.equal(changes[1].declaration_seconds,300);assert.equal(changes[1].actor_id,fixture.adminA);
 assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.terminal_config_changes')).rowCount,0);
 await rejects(admin.query('DELETE FROM nexo.terminal_config_changes'),/IMMUTABLE/);
});
test('K09: correcting presence races safely with departure and can never modify an in-transit or boarded reservation',async()=>{
 const g=await individualFixture(),id=g.bookingIds[0],b=business();await b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,0);
 const event=(await b.terminalEvaluation(fixture.tokens.p,id)).verificationEventId;
 const r=await Promise.allSettled([b.correctArrival(fixture.tokens.adminA,key(),id,0,event,'OPERATOR_ERROR'),api.depart(fixture.tokens.d0,key(),fixture.trips[0])]);
 assert.equal(r[1].status,'fulfilled');if(r[0].status==='rejected')assert.match(r[0].reason.message,/INVALID_CORRECTION_STATE/);
 await rejects(b.correctArrival(fixture.tokens.adminA,key(),id,0,event,'OPERATOR_ERROR'),/INVALID_CORRECTION_STATE/);
 await b.memberMovement(fixture.tokens.d0,key(),g.members[0].id,'BOARD');
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).cancellationEligibleSimulation,false);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[1],'LATER',0),/NO_COMPATIBLE_TRANSFER/);
 assert.equal((await b.roster(fixture.tokens.p,id)).members[0].state,'BOARDED');
});
test('K10: capacity lost after a recovery proposal rolls back and preserves the pending incident',async()=>{
 const {id,b}=await transferredGroup();await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
 try {
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
  pending=b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1).then(value=>({value}),error=>({error}));
  await waitForQueryLock('%nexo.transfer_assignment(%');
  await blocker.query("SELECT set_config('nexo.session_token',$1,true)",[fixture.tokens.other]);
  await blocker.query('SELECT nexo.reserve($1,$2)',[key(),request(6)]);await blocker.query('COMMIT');
  assert.match((await pending).error.message,/QUEUE_ORDER/);
 }finally{await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
 const s=await b.assignmentStatus(fixture.tokens.p,id);assert.equal(s.episode,1);assert.equal(s.state,'RECOVERY_PENDING');assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('K11: tariff incompatibility and revoked route permissions preserve recovery incidents instead of changing price',async()=>{
 const {id,b}=await transferredGroup(2);await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 const before=await b.booking(fixture.tokens.p,id);
 await admin.query('UPDATE nexo.fares SET amount_bob=amount_bob+1 WHERE id=$1',[before.fare_id]);
 assert.deepEqual(await b.transferCandidates(fixture.tokens.adminA,id,'RECOVER'),[]);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1),/TRANSFER_CONDITIONS_CHANGED/);
 await admin.query('UPDATE nexo.fares SET amount_bob=amount_bob-1 WHERE id=$1',[before.fare_id]);
 await admin.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1),/ROUTE_NOT_ELIGIBLE/);
 assert.equal((await b.booking(fixture.tokens.p,id)).price_bob,before.price_bob);assert.equal((await b.assignmentStatus(fixture.tokens.p,id)).state,'RECOVERY_PENDING');
});
test('K12: episode-aware local HTTP validates optimistic versions, corrections, roles and safe errors',async()=>{
 const g=await individualFixture(),id=g.bookingIds[0],http=await startBusinessRuntime(pool);
 const command=(path,body,token=fixture.tokens.adminA)=>postJson(http.url,'/business/'+path,body,{Authorization:'Bearer '+token,'Idempotency-Key':key()});
 try {
  assert.equal((await command('episode-command',{bookingId:id,episode:0,command:'VERIFIED',confirmed:true})).status,200);
  const e=await command('terminal-evaluation',{bookingId:id});
  assert.equal((await command('correct-arrival',{bookingId:id,episode:0,eventId:e.body.verificationEventId,reason:'OPERATOR_ERROR'})).status,200);
  assert.equal((await command('correct-arrival',{bookingId:id,episode:0,eventId:e.body.verificationEventId})).status,400);
  assert.equal((await command('assignment-status',{bookingId:id},fixture.tokens.p)).body.episode,0);
  assert.equal((await command('terminal-history',{bookingId:id,limit:1},fixture.tokens.p)).body.events.length,1);
  assert.equal((await command('episode-command',{bookingId:id,episode:1,command:'VERIFIED',confirmed:true})).status,409);
  assert.equal((await command('recovery-queue',{routeId:fixture.ra},fixture.tokens.p)).status,403);
  assert.equal((await command('assignment-transfer',{bookingId:id,targetTripId:fixture.trips[1],direction:'RECOVER'},fixture.tokens.adminA)).status,400);
 }finally{await http.close();}
});
test('K13: populated 001-014 upgrade preserves all old rows, movements and a legacy failed-transfer incident',async()=>{
 const failed=await fixed(6);await acceptAll(failed);const travelling=await fixed(6,1);await acceptAll(travelling);
 await api.depart(fixture.tokens.d1,key(),fixture.trips[1]);await business().movement(fixture.tokens.d1,key(),travelling.bookingIds[0],'BOARD');
 // Model the persisted 014 layout; 015-only tables are deliberately not copied.
 await admin.query("INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,target_trip) VALUES($1,$2,$3,'TRANSFERRED',$4,$5)",[fixture.A,failed.bookingIds[0],fixture.trips[0],fixture.adminA,fixture.trips[2]]);
 await admin.query("UPDATE nexo.bookings SET trip_id=$2,status='REJECTED',driver_accepted=false WHERE id=$1",[failed.bookingIds[0],fixture.trips[2]]);
 const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));
 const upgradeUrl=new URL(url);upgradeUrl.pathname='/'+name;const db=new pg.Client({connectionString:upgradeUrl.href});await db.connect();
 try {
  const dir=await mkdtemp(resolve('.local','stage2-recovery-migrations-'));
  const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'015' ORDER BY name")).rows.map(x=>x.name);
  for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
  assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,14);
  const tables=['users','identity_accounts','identity_recovery','identity_attempts','sessions','associations','memberships',
   'geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers','route_authorizations',
   'vehicles','trips','fares','bookings','actions','audit_events','identity_events','security_events','booking_movements','booking_members','member_movements','absence_drafts','terminal_config','terminal_events'];
  await db.query("DO $$ BEGIN IF to_regclass('nexo.booking_contracts') IS NOT NULL THEN ALTER TABLE nexo.bookings DISABLE TRIGGER capture_booking_contract;END IF;END $$");
    await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members');
  for(const table of tables)for(const row of (await admin.query('SELECT * FROM nexo.'+table)).rows) {
   const columns=Object.keys(row);await db.query(`INSERT INTO nexo.${table} (${columns.map(k=>db.escapeIdentifier(k)).join(',')}) VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
  }
  await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members');
    await db.query("DO $$ BEGIN IF to_regclass('nexo.booking_contracts') IS NOT NULL THEN ALTER TABLE nexo.bookings ENABLE TRIGGER capture_booking_contract;END IF;END $$");
  const snapshot=async()=>{
   const result={};for(const table of [...tables,'authorization_events'])result[table]=(await db.query('SELECT * FROM nexo.'+table+' t ORDER BY to_jsonb(t)::text')).rows;return result;
  };
  const before=await snapshot();assert.deepEqual(await migrate(db),['015_assignment_recovery.sql','016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);
  await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.p]);
  const incident=(await db.query('SELECT nexo.assignment_status($1) AS s',[failed.bookingIds[0]])).rows[0].s;
  assert.equal(incident.state,'RECOVERY_PENDING');assert.equal(incident.originalTripId,fixture.trips[0]);assert.equal(incident.assignedTripId,fixture.trips[2]);assert.equal(incident.episodes[0].source,'LEGACY_TRANSFER');
  assert.equal((await db.query('SELECT * FROM nexo.episode_terminal_events')).rowCount,0);
  await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.d1]);
  await db.query('SELECT nexo.progress($1,$2,3)',[key(),fixture.trips[1]]);await db.query("SELECT nexo.record_movement($1,$2,'ALIGHT')",[key(),travelling.bookingIds[0]]);
  assert.equal((await db.query('SELECT price_bob FROM nexo.bookings WHERE id=$1',[failed.bookingIds[0]])).rows[0].price_bob,'60.00');
 }finally{await db.end();}
});
test('K14: recovery rechecks administrator permissions after a concurrent route lock',async()=>{
 const {id,b}=await transferredGroup(2);await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
 try {
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
  pending=b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1).then(value=>({value}),error=>({error}));
  await waitForQueryLock('%nexo.transfer_assignment(%');
  await blocker.query('UPDATE nexo.memberships SET active=false WHERE user_id=$1',[fixture.adminA]);await blocker.query('COMMIT');assert.match((await pending).error.message,/FORBIDDEN/);
 }finally{await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
 assert.equal((await b.assignmentStatus(fixture.tokens.p,id)).episode,1);
 await rejects(b.transferAssignment(fixture.tokens.adminB,key(),id,fixture.trips[0],'RECOVER',1),/FORBIDDEN/);
 await rejects(b.assignmentStatus(fixture.tokens.other,id),/FORBIDDEN/);
 for(const table of ['assignment_episodes','assignment_outcomes','episode_terminal_events']) {
  assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.'+table)).rowCount,0);
  await rejects(sql(fixture.tokens.p,'DELETE FROM nexo.'+table),/permission denied/);
 }
 await rejects(sql(fixture.tokens.p,'SELECT nexo.assignment_episode($1)',[id]),/permission denied/);
 await rejects(admin.query('UPDATE nexo.assignment_episodes SET price_bob=price_bob'),/IMMUTABLE/);
});
test('K15: expiry, recovery and explicit cancellation race without duplicated capacity or silent restoration',async()=>{
 const {id,b}=await transferredGroup(3);await admin.query("UPDATE nexo.bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 const results=await Promise.allSettled([
  b.refreshOffers(fixture.tokens.d1,key(),fixture.trips[1]),
  b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'RECOVER',1),
  b.cancel(fixture.tokens.p,key(),id),
  b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,1)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 const s=await b.assignmentStatus(fixture.tokens.p,id);assert.ok(s.episode===1 || s.episode===2);
 assert.ok(['RECOVERY_PENDING','OFFER_PENDING','CANCELLED'].includes(s.state));
 assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);assert.equal((await admin.query('SELECT * FROM nexo.booking_members')).rowCount,3);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).automaticCancellationEnabled,false);assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('K16: destination acceptance revalidates a concurrent tariff change and keeps the agreed price unchanged',async()=>{
 const {id,b}=await transferredGroup(2),before=await b.booking(fixture.tokens.p,id);
 const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
 try {
  await blocker.query('BEGIN');await blocker.query('UPDATE nexo.fares SET amount_bob=amount_bob+1 WHERE id=$1',[before.fare_id]);
  pending=b.respondAssignment(fixture.tokens.d1,key(),id,1,true).then(value=>({value}),error=>({error}));
  await waitForQueryLock('%nexo.respond_assignment(%');await blocker.query('COMMIT');
  assert.match((await pending).error.message,/TRANSFER_CONDITIONS_CHANGED/);
 }finally{await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
 const after=await b.booking(fixture.tokens.p,id);assert.equal(after.price_bob,before.price_bob);assert.equal(after.status,'HELD');assert.equal(after.driver_accepted,false);
 assert.ok(!after.assignment.outcomes.some(o=>o.episode===1 && o.kind==='CONFIRMED'));
 await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);assert.equal((await b.assignmentStatus(fixture.tokens.p,id)).state,'RECOVERY_PENDING');
});

async function cityRun({busyB=true}={}) {
 const a=await fixed(4),pickup=await fixed(2,0,{from:1});await acceptAll(a);await acceptAll(pickup);
 let busy;if(busyB){busy=await fixed(1,1);await acceptAll(busy);}
 const b=business(),trip=fixture.trips[0];
 await b.terminalObservation(fixture.tokens.adminA,key(),a.bookingIds[0],null,'BOARD',4,3,true);
 const state=await b.beginUrban(fixture.tokens.d0,key(),trip,2,true);
 return {b,trip,a,pickup,busy,state};
}
async function confirmBreakdown(run) {
 let s=await run.b.fleetCommand(fixture.tokens.d0,key(),run.trip,run.state.version,'REPORT',null,null,true);
 return run.b.fleetCommand(fixture.tokens.adminA,key(),run.trip,s.version,'CONFIRM',null,null,true);
}
test('L01: approved transfer is immediately binding, preserves group/price and informs responsible and destination driver',async()=>{
 const g=await individualFixture(3),b=business(),id=g.bookingIds[0];
 assert.equal((await b.groupStatus(fixture.tokens.p,id)).paymentState,'UNVERIFIED');
 await rejects(b.consentGroup(fixture.tokens.other,key(),id,fixture.trips[1],0,true),/FORBIDDEN/);
 const c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true),k=key();
 const before=await b.booking(fixture.tokens.p,id);
 const results=await Promise.allSettled(Array.from({length:8},()=>b.approveTerminalTransfer(fixture.tokens.adminA,k,c.consentId)));
 for(const r of results)assert.equal(r.status,'fulfilled',r.reason?.message);
 assert.ok(results.every(r=>r.value.status==='CONFIRMED'));
 const after=await b.booking(fixture.tokens.p,id);assert.equal(after.trip_id,fixture.trips[1]);assert.equal(after.price_bob,before.price_bob);assert.equal(after.driver_accepted,false);assert.deepEqual(after.members,before.members);
 await rejects(b.respond(fixture.tokens.d1,key(),id,false),/TERMINAL_RESERVATION_BINDING/);
 await rejects(b.respondAssignment(fixture.tokens.d1,key(),id,1,false),/TERMINAL_RESERVATION_BINDING/);
 await rejects(b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[0],'EARLIER',1),/NO_COMPATIBLE|TERMINAL_RESERVATION_BINDING/);
 assert.equal((await b.notices(fixture.tokens.d1))[0].delivery,'DISABLED');assert.ok((await b.notices(fixture.tokens.p)).some(n=>n.kind==='GROUP_TRANSFER_CONFIRMED'));
 assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
 await rejects(b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId),/CONSENT_USED/);
});
test('L02: explicit whole-group consent permits atomic recomposition into a free third trufi, never automatic splitting',async()=>{
 const g=await hold(3,{splitConsent:true,containsMinors:false,parts:[{tripId:fixture.trips[0],seats:1},{tripId:fixture.trips[1],seats:2}]});await acceptAll(g);
 const b=business(),id=g.bookingIds[0],before=await Promise.all(g.bookingIds.map(id=>b.booking(fixture.tokens.p,id)));
 const c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[2],0,true);
 const result=await b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId);assert.equal(result.bookingIds.length,2);
 for(let i=0;i<g.bookingIds.length;i++) {
  const after=await b.booking(fixture.tokens.p,g.bookingIds[i]);assert.equal(after.trip_id,fixture.trips[2]);assert.equal(after.price_bob,before[i].price_bob);assert.equal(after.seats,before[i].seats);assert.deepEqual(after.members,before[i].members);assert.equal(after.status,'CONFIRMED');
 }
 assert.equal((await admin.query('SELECT * FROM nexo.booking_members')).rowCount,3);assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('L03: walk-in responsible is registered explicitly; simulated payment requires association verification and never implies a real payment',async()=>{
 const b=business(),g=await b.walkIn(fixture.tokens.adminA,key(),request(2));await acceptAll(g);const id=g.bookingIds[0];
 assert.equal((await b.groupStatus(fixture.tokens.adminA,id)).responsibleId,null);
 await b.registerResponsible(fixture.tokens.adminA,key(),id,fixture.p,true);
 assert.equal((await b.booking(fixture.tokens.p,id)).id,id);
 assert.equal((await b.groupStatus(fixture.tokens.p,id)).paymentState,'UNVERIFIED');
 await rejects(b.simulatePayment(fixture.tokens.p,key(),id,'VERIFIED_SIMULATED',true),/FORBIDDEN/);
 await b.simulatePayment(fixture.tokens.adminA,key(),id,'VERIFIED_SIMULATED',true);
 assert.equal((await b.groupStatus(fixture.tokens.p,id)).paymentState,'VERIFIED_SIMULATED');assert.equal((await b.groupStatus(fixture.tokens.p,id)).paymentIsReal,false);
 await b.simulatePayment(fixture.tokens.adminA,key(),id,'REVOKED_SIMULATED',true);
 assert.equal((await b.groupStatus(fixture.tokens.p,id)).paymentState,'REVOKED_SIMULATED');
 const c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);await b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId);
 assert.equal((await b.booking(fixture.tokens.p,id)).price_bob,'20.00');
});
test('L04: new arrival contract uses 120 provisional seconds without renewing an existing declaration or absence clock',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];
 await b.terminalCommand(fixture.tokens.d0,key(),id,'READY',true);
 const ready=(await b.terminalEvaluation(fixture.tokens.p,id)).readyAt;
 await b.terminalArrival(fixture.tokens.p,key(),id,0,true);
 const first=(await admin.query("SELECT created_at,expires_at FROM nexo.terminal_events WHERE booking_id=$1 AND kind='DECLARED'",[id])).rows[0];
 assert.ok(Math.abs((first.expires_at-first.created_at)/1000-120)<1);
 await b.terminalArrival(fixture.tokens.p,key(),id,0,true);
 assert.deepEqual((await admin.query("SELECT created_at,expires_at FROM nexo.terminal_events WHERE booking_id=$1 AND kind='DECLARED'",[id])).rows[0],first);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).readyAt,ready);
 // A separate past episode event proves expiry without sleeping 120 seconds.
 const other=await fixed(6,1);await acceptAll(other);const oid=other.bookingIds[0];
 await admin.query("INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,created_at,expires_at) VALUES($1,$2,$3,'DECLARED',$4,clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '1 second')",[fixture.A,oid,fixture.trips[1],fixture.p]);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,oid)).declaredActive,false);
 await b.terminalCommand(fixture.tokens.adminA,key(),oid,'VERIFIED',true);assert.equal((await b.terminalEvaluation(fixture.tokens.p,oid)).verified,true);
});
test('L05: administrator boards at terminal after exact reservation checks, with immutable compensating corrections',async()=>{
 const g=await individualFixture(2),b=business(),id=g.bookingIds[0];
 await rejects(b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',3,3,true),/INVALID_BOARDING_CHECK/);
 await b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',2,3,true);
 let manifest=await b.manifest(fixture.tokens.adminA,{tripId:fixture.trips[0]});assert.equal(manifest.observedOnboard,2);
 const fact=(await b.movementHistory(fixture.tokens.p,id))[0].fact_key,price=(await b.booking(fixture.tokens.p,id)).price_bob;
 await rejects(b.correctMovement(fixture.tokens.p,key(),id,fact,'OPERATOR_ERROR',true),/FORBIDDEN/);
 await b.correctMovement(fixture.tokens.adminA,key(),id,fact,'OPERATOR_ERROR',true);
 assert.equal((await b.manifest(fixture.tokens.adminA,{tripId:fixture.trips[0]})).observedOnboard,0);
 assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,1);
 await b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',2,3,true);
 manifest=await b.manifest(fixture.tokens.adminA,{tripId:fixture.trips[0]});assert.equal(manifest.observedOnboard,2);
 assert.equal((await b.movementHistory(fixture.tokens.p,id)).filter(f=>f.voided).length,1);
 assert.equal((await b.booking(fixture.tokens.p,id)).price_bob,price);assert.equal((await b.booking(fixture.tokens.p,id)).movementState,'BOARDED');
});
test('L06: binding adoption blocks arbitrary rejection while legacy held offers and recovery retain their contract',async()=>{
 const g=await individualFixture(2),b=business(),id=g.bookingIds[0];
 await b.activateTerminal(fixture.tokens.adminA,key(),id);
 await rejects(b.respond(fixture.tokens.d0,key(),id,false),/TERMINAL_RESERVATION_BINDING/);
 const legacy=await b.reserve(fixture.tokens.p,key(),request(2));
 assert.equal((await b.respond(fixture.tokens.d0,key(),legacy.bookingIds[0],false)).status,'REJECTED');
 assert.equal((await b.booking(fixture.tokens.p,id)).status,'CONFIRMED');
});
test('L07: stale group consent, foreign administrators and unavailable destinations cannot partially transfer a group',async()=>{
 const g=await individualFixture(3),b=business(),id=g.bookingIds[0],c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);
 await rejects(b.approveTerminalTransfer(fixture.tokens.adminB,key(),c.consentId),/FORBIDDEN/);
 await b.cancel(fixture.tokens.p,key(),id);
 await rejects(b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId),/STALE_CONSENT/);
 assert.equal((await b.booking(fixture.tokens.p,id)).status,'CANCELLED');assert.equal((await admin.query('SELECT * FROM nexo.consent_uses')).rowCount,0);
});
test('F01: broken A with four aboard and two pending skips occupied B, assigns free C exclusively, then completes pickups before main travel',async()=>{
 const run=await cityRun(),{b,trip,a,pickup}=run;
 const before=(await b.manifest(fixture.tokens.adminA,{tripId:trip})).bookings.map(x=>({id:x.id,price:x.price_bob,seats:x.seats}));
 let s=await confirmBreakdown(run);assert.equal(s.phase,'AWAITING_REPLACEMENT');assert.equal(s.observedOnboard,4);assert.equal(s.pendingPickupSeats,2);
 assert.equal(await b.freeReplacement(fixture.tokens.adminA,s.incidentId),fixture.trips[2]);
 s=await b.fleetCommand(fixture.tokens.adminA,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true);
 assert.equal((await b.manifest(fixture.tokens.adminA,{tripId:trip})).trip.status,'RESCUE');
 assert.equal(s.phase,'RESCUE');assert.equal(s.vehicleId,fixture.vehicles[2]);assert.equal(s.exclusive,true);assert.equal(s.mainStartedAt,null);
 assert.equal((await admin.query('SELECT status,completed_at FROM nexo.trips WHERE id=$1',[fixture.trips[2]])).rows[0].status,'WITHDRAWN');
 await rejects(b.progress(fixture.tokens.d0,key(),trip,1),/FORBIDDEN/);
 await rejects(b.progress(fixture.tokens.d2,key(),trip,1),/OPERATION_BLOCKED/);
 await rejects(b.fleetCommand(fixture.tokens.d2,key(),trip,s.version,'SAFE_TRANSFER',null,3,true),/INVALID_SAFE_TRANSFER/);
 s=await b.fleetCommand(fixture.tokens.d2,key(),trip,s.version,'SAFE_TRANSFER',null,4,true);
 assert.equal(s.observedOnboard,4);assert.equal((await admin.query('SELECT * FROM nexo.booking_movements WHERE booking_id=$1',[a.bookingIds[0]])).rowCount,1);
 assert.equal((await b.progress(fixture.tokens.d2,key(),trip,1)).status,'URBAN_COLLECTION');
 s=await b.operationalStatus(fixture.tokens.d2,trip);assert.equal(s.mainStartedAt,null);assert.equal(s.pendingPickupSeats,2);
 await rejects(b.progress(fixture.tokens.d2,key(),trip,2),/PICKUPS_PENDING/);
 await b.terminalObservation(fixture.tokens.adminA,key(),pickup.bookingIds[0],null,'BOARD',2,3,true);
 await b.progress(fixture.tokens.d2,key(),trip,2);s=await b.operationalStatus(fixture.tokens.d2,trip);
 assert.equal(s.phase,'URBAN_COLLECTION');assert.equal(s.mainStartedAt,null);assert.equal(s.observedOnboard,6);
 s=await b.fleetCommand(fixture.tokens.d2,key(),trip,s.version,'MAIN_START',null,null,true);assert.equal(s.phase,'MAIN_TRIP');assert.ok(s.mainStartedAt);
 const after=(await b.manifest(fixture.tokens.adminA,{tripId:trip})).bookings.map(x=>({id:x.id,price:x.price_bob,seats:x.seats}));assert.deepEqual(after,before);
 assert.deepEqual((await b.queue(fixture.tokens.adminA,{routeId:fixture.ra})).map(t=>t.id),[fixture.trips[1]]);
 await b.progress(fixture.tokens.d2,key(),trip,3);assert.equal((await b.operationalStatus(fixture.tokens.d2,trip)).phase,'COMPLETED');
 assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('F02: no completely free vehicle leaves a visible confirmed incident and never promises a replacement',async()=>{
 const run=await cityRun(),occupied=await fixed(6,2);await acceptAll(occupied);const {b,trip}=run;
 let s=await confirmBreakdown(run);assert.equal(await b.freeReplacement(fixture.tokens.adminA,s.incidentId),null);
 await rejects(b.fleetCommand(fixture.tokens.adminA,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true),/NO_FREE_REPLACEMENT/);
 s=await b.operationalStatus(fixture.tokens.p,trip);assert.equal(s.phase,'AWAITING_REPLACEMENT');assert.equal(s.vehicleId,fixture.vehicles[0]);assert.equal(s.replacementVehicleId,null);
 assert.equal((await b.booking(fixture.tokens.p,run.a.bookingIds[0])).status,'CONFIRMED');
});
test('F03: two administrators cannot assign the same empty C twice',async()=>{
 const run=await cityRun(),{b,trip}=run,s=await confirmBreakdown(run);
 await admin.query("INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true)",[fixture.A,fixture.other]);
 const results=await Promise.allSettled([fixture.tokens.adminA,fixture.tokens.other].map(token=>b.fleetCommand(token,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/STALE_OPERATION/);
 assert.equal((await admin.query("SELECT * FROM nexo.trips WHERE vehicle_id=$1 AND status IN ('QUEUED','IN_TRANSIT')",[fixture.vehicles[2]])).rowCount,1);
 assert.equal((await admin.query("SELECT * FROM nexo.fleet_events WHERE kind='REPLACEMENT_ASSIGNED'")).rowCount,1);
});
test('F04: new reservation racing replacement either owns C capacity or loses without overbooking or partial rescue',async()=>{
 const run=await cityRun(),{b,trip}=run,s=await confirmBreakdown(run);
 const results=await Promise.allSettled([b.fleetCommand(fixture.tokens.adminA,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true),b.reserve(fixture.tokens.other,key(),request(6))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/NO_CAPACITY|NO_FREE_REPLACEMENT/);
 assert.ok((await occupancy()).every(r=>r.used<=6));
 const state=await b.operationalStatus(fixture.tokens.adminA,trip);assert.ok(['RESCUE','AWAITING_REPLACEMENT'].includes(state.phase));
});
test('F05: replacement failure rolls back queue withdrawal, carrier, notices and action; retry succeeds once',async()=>{
 const run=await cityRun(),{b,trip}=run,s=await confirmBreakdown(run),k=key();
 await admin.query(`CREATE FUNCTION nexo.test_assignment_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${trip}' AND NEW.vehicle_id='${fixture.vehicles[2]}' THEN RAISE EXCEPTION 'TEST_ASSIGNMENT_FAILURE'; END IF;RETURN NEW;END $$`);
 await admin.query('CREATE TRIGGER test_assignment_failure BEFORE UPDATE ON nexo.trips FOR EACH ROW EXECUTE FUNCTION nexo.test_assignment_failure()');
 try{await rejects(b.fleetCommand(fixture.tokens.adminA,k,trip,s.version,'ASSIGN',fixture.trips[2],null,true),/TEST_ASSIGNMENT_FAILURE/);}finally{await admin.query('DROP TRIGGER test_assignment_failure ON nexo.trips');await admin.query('DROP FUNCTION nexo.test_assignment_failure()');}
 assert.equal((await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[2]])).rows[0].status,'QUEUED');assert.equal((await b.operationalStatus(fixture.tokens.adminA,trip)).vehicleId,fixture.vehicles[0]);
 const retry=await b.fleetCommand(fixture.tokens.adminA,k,trip,s.version,'ASSIGN',fixture.trips[2],null,true);assert.equal(retry.phase,'RESCUE');
 assert.deepEqual(await b.fleetCommand(fixture.tokens.adminA,k,trip,s.version,'ASSIGN',fixture.trips[2],null,true),retry);
});
test('F06: original vehicle stays blocked until safe transfer and explicit authorized repair release',async()=>{
 const run=await cityRun(),{b,trip}=run;let s=await confirmBreakdown(run);
 s=await b.fleetCommand(fixture.tokens.adminA,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true);
 await rejects(b.restoreVehicle(fixture.tokens.adminA,key(),fixture.vehicles[0],true),/INVALID_RECOVERY_STATE/);
 await rejects(b.restoreVehicle(fixture.tokens.adminB,key(),fixture.vehicles[0],true),/FORBIDDEN/);
 await b.fleetCommand(fixture.tokens.d2,key(),trip,s.version,'SAFE_TRANSFER',null,4,true);
 assert.equal((await admin.query('SELECT blocked FROM nexo.vehicle_blocks WHERE vehicle_id=$1',[fixture.vehicles[0]])).rows[0].blocked,true);
 await b.restoreVehicle(fixture.tokens.adminA,key(),fixture.vehicles[0],true);
 assert.equal((await admin.query('SELECT blocked FROM nexo.vehicle_blocks WHERE vehicle_id=$1',[fixture.vehicles[0]])).rows[0].blocked,false);
 assert.equal((await b.operationalStatus(fixture.tokens.adminA,trip)).vehicleId,fixture.vehicles[2]);
});
test('L08: an erroneous alighting is compensated without overwriting history and a later true alighting is a new fact',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 await b.movement(fixture.tokens.d0,key(),id,'BOARD');await b.progress(fixture.tokens.d0,key(),fixture.trips[0],3);await b.movement(fixture.tokens.d0,key(),id,'ALIGHT');
 const fact=(await b.movementHistory(fixture.tokens.p,id)).find(f=>f.kind==='ALIGHT').fact_key;
 await b.correctMovement(fixture.tokens.adminA,key(),id,fact,'OPERATOR_ERROR',true);
 assert.equal((await b.manifest(fixture.tokens.adminA,{tripId:fixture.trips[0]})).observedOnboard,6);
 await b.movement(fixture.tokens.d0,key(),id,'ALIGHT');
 assert.equal((await b.manifest(fixture.tokens.adminA,{tripId:fixture.trips[0]})).observedOnboard,0);
 assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,2);
 assert.equal((await b.movementHistory(fixture.tokens.p,id)).filter(f=>f.kind==='ALIGHT').length,2);
});
test('L09: correction cannot put nine passengers aboard after later segment passengers already boarded',async()=>{
 const first=await fixed(3,0,{to:1}),through=await fixed(3),later=await fixed(3,0,{from:1});for(const g of [first,through,later])await acceptAll(g);
 const b=business();await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 for(const g of [first,through])await b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');
 await b.progress(fixture.tokens.d0,key(),fixture.trips[0],1);await b.movement(fixture.tokens.d0,key(),first.bookingIds[0],'ALIGHT');await b.movement(fixture.tokens.d0,key(),later.bookingIds[0],'BOARD');
 const fact=(await b.movementHistory(fixture.tokens.p,first.bookingIds[0])).find(f=>f.kind==='ALIGHT').fact_key;
 await rejects(b.correctMovement(fixture.tokens.adminA,key(),first.bookingIds[0],fact,'OPERATOR_ERROR',true),/OBSERVED_CAPACITY_EXCEEDED/);
 assert.equal((await b.manifest(fixture.tokens.adminA,{tripId:fixture.trips[0]})).observedOnboard,6);assert.equal((await admin.query('SELECT * FROM nexo.movement_corrections')).rowCount,0);
});
test('F07: revoked route or session and foreign association cannot approve a replacement; incident remains visible',async()=>{
 const run=await cityRun(),{b,trip}=run,s=await confirmBreakdown(run);
 await rejects(b.freeReplacement(fixture.tokens.adminB,s.incidentId),/FORBIDDEN/);
 const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
 try {
  await blocker.query('BEGIN');await blocker.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE route_id=$1",[fixture.ra]);
  pending=b.fleetCommand(fixture.tokens.adminA,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true).then(value=>({value}),error=>({error}));
  await waitForQueryLock('%nexo.fleet_command(%');await blocker.query('COMMIT');assert.match((await pending).error.message,/ROUTE_NOT_ELIGIBLE/);
 }finally{await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
 assert.equal((await b.operationalStatus(fixture.tokens.p,trip)).phase,'AWAITING_REPLACEMENT');
 await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[fixture.adminA]);
 await rejects(b.fleetCommand(fixture.tokens.adminA,key(),trip,s.version,'ASSIGN',fixture.trips[2],null,true),/UNAUTHENTICATED/);
 assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.fleet_incidents')).rowCount,0);
 await rejects(sql(fixture.tokens.d0,'UPDATE nexo.vehicle_blocks SET blocked=false'),/permission denied/);
 await rejects(admin.query('DELETE FROM nexo.fleet_events'),/IMMUTABLE/);
});
test('F08: two different broken runs competing for one C yield one rescue and one pending incident',async()=>{
 const a=await fixed(6),d=await fixed(6,1);await acceptAll(a);await acceptAll(d);const b=business(),states=[];
 for(let idx=0;idx<2;idx++) {
  let s=await b.beginUrban(fixture.tokens['d'+idx],key(),fixture.trips[idx],2,true);
  s=await b.fleetCommand(fixture.tokens['d'+idx],key(),fixture.trips[idx],s.version,'REPORT',null,null,true);
  s=await b.fleetCommand(fixture.tokens.adminA,key(),fixture.trips[idx],s.version,'CONFIRM',null,null,true);states.push(s);
  assert.equal(await b.freeReplacement(fixture.tokens.adminA,s.incidentId),fixture.trips[2]);
 }
 const results=await Promise.allSettled(states.map((s,i)=>b.fleetCommand(fixture.tokens.adminA,key(),fixture.trips[i],s.version,'ASSIGN',fixture.trips[2],null,true)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/NO_FREE_REPLACEMENT/);
 assert.equal((await admin.query("SELECT * FROM nexo.trips WHERE vehicle_id=$1 AND status IN ('QUEUED','IN_TRANSIT')",[fixture.vehicles[2]])).rowCount,1);
 assert.equal((await admin.query("SELECT * FROM nexo.urban_runs WHERE phase='AWAITING_REPLACEMENT'")).rowCount,1);
 assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,2);
});
test('F09: new operational HTTP rejects GPS, unchecked boarding, forged roles and stale versions',async()=>{
 const run=await cityRun(),http=await startBusinessRuntime(pool),{b,trip}=run;
 const command=(path,body,token=fixture.tokens.adminA)=>postJson(http.url,'/business/'+path,body,{Authorization:'Bearer '+token,'Idempotency-Key':key()});
 try {
  assert.equal((await command('operational-status',{tripId:trip},fixture.tokens.p)).body.phase,'URBAN_COLLECTION');
  assert.equal((await command('fleet-command',{tripId:trip,version:1,command:'REPORT',confirmed:true,gps:[0,0]},fixture.tokens.d0)).status,400);
  assert.equal((await command('fleet-command',{tripId:trip,version:1,command:'REPORT',confirmed:true},fixture.tokens.adminB)).status,403);
  const report=await command('fleet-command',{tripId:trip,version:1,command:'REPORT',confirmed:true},fixture.tokens.d0);assert.equal(report.status,200);
  assert.equal((await command('fleet-command',{tripId:trip,version:1,command:'CONFIRM',confirmed:true})).status,409);
  assert.equal((await command('fleet-history',{tripId:trip,limit:1})).body.length,1);
  assert.equal((await command('terminal-observation',{bookingId:run.pickup.bookingIds[0],seats:2,destination:3,kind:'BOARD',confirmed:false})).status,400);
  assert.equal((await b.operationalStatus(fixture.tokens.p,trip)).mainStartedAt,null);
 }finally{await http.close();}
});
test('F10: populated 001-015 upgrade preserves every old row and history, then continues legacy movements normally',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];
 await b.episodeCommand(fixture.tokens.p,key(),id,'TRANSFER_REQUEST',true,0);await b.transferAssignment(fixture.tokens.adminA,key(),id,fixture.trips[1],'LATER',0);await acceptAll(g);
 await b.episodeCommand(fixture.tokens.adminA,key(),id,'VERIFIED',true,1);await api.depart(fixture.tokens.d1,key(),fixture.trips[1]);await b.movement(fixture.tokens.d1,key(),id,'BOARD');
 const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));const target=new URL(url);target.pathname='/'+name;
 const db=new pg.Client({connectionString:target.href});await db.connect();
 try {
  const dir=await mkdtemp(resolve('.local','stage2-operational-migrations-'));
  const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'016' ORDER BY name")).rows.map(x=>x.name);
  for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));
  assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,15);
  const tables=['users','identity_accounts','identity_recovery','identity_attempts','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers','route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','identity_events','security_events','booking_movements','booking_members','member_movements','absence_drafts','terminal_config','terminal_events','assignment_episodes','assignment_outcomes','episode_terminal_events','terminal_config_changes'];
  await db.query("DO $$ BEGIN IF to_regclass('nexo.booking_contracts') IS NOT NULL THEN ALTER TABLE nexo.bookings DISABLE TRIGGER capture_booking_contract;END IF;END $$");
    await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members');await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER assignment_tracking');
  for(const table of tables)for(const row of (await admin.query('SELECT * FROM nexo.'+table)).rows) {
   const columns=Object.keys(row);await db.query(`INSERT INTO nexo.${table} (${columns.map(k=>db.escapeIdentifier(k)).join(',')}) OVERRIDING SYSTEM VALUE VALUES (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
  }
  await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members');
    await db.query("DO $$ BEGIN IF to_regclass('nexo.booking_contracts') IS NOT NULL THEN ALTER TABLE nexo.bookings ENABLE TRIGGER capture_booking_contract;END IF;END $$");await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER assignment_tracking');
  await db.query("SELECT setval(pg_get_serial_sequence('nexo.episode_terminal_events','serial'),coalesce(max(serial),1),max(serial) IS NOT NULL) FROM nexo.episode_terminal_events");
  const snapshot=async()=>{const result={};for(const table of [...tables,'authorization_events'])result[table]=(await db.query('SELECT * FROM nexo.'+table+' t ORDER BY to_jsonb(t)::text')).rows;return result;};
  const before=await snapshot();assert.deepEqual(await migrate(db),['016_terminal_boarding.sql','017_urban_replacement.sql','018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);
  assert.equal((await db.query('SELECT * FROM nexo.urban_runs')).rowCount,0);assert.equal((await db.query('SELECT * FROM nexo.movement_corrections')).rowCount,0);
  await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.d1]);await db.query('SELECT nexo.progress($1,$2,3)',[key(),fixture.trips[1]]);await db.query("SELECT nexo.record_movement($1,$2,'ALIGHT')",[key(),id]);
  assert.equal((await db.query('SELECT price_bob,status FROM nexo.bookings WHERE id=$1',[id])).rows[0].price_bob,'60.00');
 }finally{await db.end();}
});
test('L10: a legacy recovery incident can enter the approved binding contract without another discretionary driver acceptance',async()=>{
 const {id,b}=await transferredGroup(2);await b.respondAssignment(fixture.tokens.d1,key(),id,1,false);
 const fill=await fixed(6);await acceptAll(fill);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 const c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[2],1,true);
 const result=await b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId);assert.equal(result.status,'CONFIRMED');
 assert.equal((await b.assignmentStatus(fixture.tokens.p,id)).recoveryRequired,false);assert.equal((await b.booking(fixture.tokens.p,id)).price_bob,'20.00');
 await rejects(b.respond(fixture.tokens.d2,key(),id,false),/TERMINAL_RESERVATION_BINDING/);
});
test('L11: effective terminal boarding suppresses absence eligibility and prevents cancellation from releasing occupied seats',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];
 await admin.query("INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,created_at) VALUES($1,$2,$3,'READY',$4,clock_timestamp()-interval '9 minutes')",[fixture.A,id,fixture.trips[0],fixture.drivers[0]]);
 assert.equal((await b.terminalEvaluation(fixture.tokens.p,id)).cancellationEligibleSimulation,true);
 await b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',6,3,true);
 let e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.boarded,true);assert.equal(e.verified,false);assert.equal(e.cancellationEligibleSimulation,false);
 await rejects(b.cancel(fixture.tokens.p,key(),id),/PASSENGERS_ONBOARD/);
 const fact=(await b.movementHistory(fixture.tokens.p,id))[0].fact_key;await b.correctMovement(fixture.tokens.adminA,key(),id,fact,'OPERATOR_ERROR',true);
 e=await b.terminalEvaluation(fixture.tokens.p,id);assert.equal(e.boarded,false);assert.equal(e.cancellationEligibleSimulation,true);
 assert.equal(e.automaticCancellationEnabled,false);assert.equal((await b.booking(fixture.tokens.p,id)).status,'CONFIRMED');
});
test('L12: a fully approved group departs without a second driver acceptance or a fabricated acceptance flag',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0],c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);
 await b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId);
 assert.equal((await b.booking(fixture.tokens.p,id)).driver_accepted,false);assert.equal((await b.groupStatus(fixture.tokens.p,id)).confirmationAuthority,'ADMIN_APPROVED');
 await b.terminalObservation(fixture.tokens.d1,key(),id,null,'BOARD',6,3,true);
 assert.equal((await b.depart(fixture.tokens.d1,key(),fixture.trips[1])).status,'IN_TRANSIT');assert.equal((await b.groupStatus(fixture.tokens.p,id)).paymentState,'UNVERIFIED');
});
test('F11: legitimate terminal impediment is recorded instead of arbitrary rejection and requires explicit authorized clearance',async()=>{
 const g=await individualFixture(3),b=business(),id=g.bookingIds[0],trip=fixture.trips[0];await b.activateTerminal(fixture.tokens.adminA,key(),id);
 await rejects(b.respond(fixture.tokens.d0,key(),id,false),/TERMINAL_RESERVATION_BINDING/);
 let s=await b.terminalImpediment(fixture.tokens.d0,key(),trip,'REPORT','MECHANICAL_FAILURE',true);assert.equal(s.phase,'OPERATIONAL_INCIDENT');
 await rejects(b.terminalImpediment(fixture.tokens.d0,key(),trip,'CONFIRM','MECHANICAL_FAILURE',true),/FORBIDDEN/);
 s=await b.terminalImpediment(fixture.tokens.adminA,key(),trip,'CONFIRM','MECHANICAL_FAILURE',true);assert.equal(s.incidentState,'CONFIRMED');
 assert.equal((await b.booking(fixture.tokens.p,id)).status,'CONFIRMED');assert.equal(await b.freeReplacement(fixture.tokens.adminA,s.incidentId),null);
 await b.restoreVehicle(fixture.tokens.adminA,key(),fixture.vehicles[0],true);s=await b.operationalStatus(fixture.tokens.p,trip);assert.equal(s.phase,'QUEUED');assert.equal(s.incidentState,'CLEARED');
});
test('L13: terminal boarding waiting behind a group transfer cannot record a stale vehicle assignment',async()=>{
 const g=await individualFixture(2),b=business(),id=g.bookingIds[0],consent=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);
 const blocker=new pg.Client({connectionString:url.href});await blocker.connect();let pending;
 try {
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM nexo.routes WHERE id=$1 FOR UPDATE',[fixture.ra]);
  pending=b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',2,3,true).then(value=>({value}),error=>({error}));
  await waitForQueryLock('%nexo.terminal_observation(%');await blocker.query("SELECT set_config('nexo.session_token',$1,true)",[fixture.tokens.adminA]);
  await blocker.query('SELECT nexo.approve_terminal_transfer($1,$2)',[key(),consent.consentId]);await blocker.query('COMMIT');assert.match((await pending).error.message,/STALE_ASSIGNMENT/);
 }finally{await blocker.query('ROLLBACK');await blocker.end();if(pending)await pending;}
 assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,0);assert.equal((await b.booking(fixture.tokens.p,id)).trip_id,fixture.trips[1]);
});

const closure=(op,body,token=fixture.tokens.adminA,k=key())=>business().closure(token,k,op,body);
const condition=(state='DESVIO',more={})=>({routeId:fixture.ra,state,reason:state==='NORMAL'?'NORMAL':'BLOCKADE',description:state==='NORMAL'?'':'Recorrido alternativo ficticio, sin verificación de transitabilidad',affectedStops:[],confirmed:true,...more});
async function terminalIncident(seats=4,busy=2) {
 const fill=await fixed(6);await acceptAll(fill);const own=await fixed(busy,1);await acceptAll(own);await api.cancel(fixture.tokens.p,key(),fill.bookingIds[0]);
 const g=await fixed(seats);await acceptAll(g);const b=business();
 await b.terminalImpediment(fixture.tokens.d0,key(),fixture.trips[0],'REPORT','MECHANICAL_FAILURE',true);
 const state=await b.terminalImpediment(fixture.tokens.adminA,key(),fixture.trips[0],'CONFIRM','MECHANICAL_FAILURE',true);
 return {g,b,own,incidentId:state.incidentId};
}
async function roadIncident() {
 const g=await individualFixture(),b=business();await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await b.movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');
 await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
 let s=await closure('road-command',{tripId:fixture.trips[0],version:0,command:'REPORT',confirmed:true},fixture.tokens.d0);
 s=await closure('road-command',{tripId:fixture.trips[0],version:s.version,command:'CONFIRM',confirmed:true});return {g,b,state:s};
}
async function reverseQueue() {
 const r=randomUUID();await admin.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code)VALUES($1,$2,'Retorno ficticio','IN',1,4,'V-FICTICIO','Y-FICTICIO')",[r,fixture.A]);
 await mapRoute(admin,r,fixture.A,fixture.geo,fixture.geo.localities[1],fixture.geo.localities[0]);await permit(admin,r,fixture.A,fixture.adminA,fixture.reviewer);
 await admin.query('UPDATE nexo.trips SET route_id=$1 WHERE id=$2',[r,fixture.trips[1]]);return r;
}
test('Q01: terminal incident uses B existing seats atomically, preserves prices, group and source block',async()=>{
 const x=await terminalIncident();const target=fixture.trips[1],id=x.g.bookingIds[0];
 assert.equal(await closure('terminal-replacement',{incidentId:x.incidentId}),target);
 const consent=await x.b.consentGroup(fixture.tokens.p,key(),id,target,0,true);
 const body={incidentId:x.incidentId,targetTripId:target,consentIds:[consent.consentId],safeTransfer:false,confirmed:true},k=key();
 const rs=await Promise.allSettled(Array.from({length:8},()=>closure('terminal-reassign',body,fixture.tokens.adminA,k)));
 for(const r of rs)assert.equal(r.status,'fulfilled',r.reason?.message);
 const after=await x.b.booking(fixture.tokens.p,id);assert.equal(after.trip_id,target);assert.equal(after.price_bob,'40.00');assert.equal(after.seats,4);assert.equal(after.status,'CONFIRMED');assert.equal(after.members.length,4);
 assert.equal((await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[0]])).rows[0].status,'WITHDRAWN');
 assert.ok((await occupancy()).every(r=>r.used<=6));assert.equal((await admin.query('SELECT * FROM nexo.journey_events WHERE kind=\'TERMINAL_REASSIGNED\'')).rowCount,1);
 await rejects(api.respond(fixture.tokens.d1,key(),id,false),/TERMINAL_RESERVATION_BINDING/);
 assert.equal((await admin.query('SELECT blocked FROM nexo.vehicle_blocks')).rows[0].blocked,true);
 await x.b.restoreVehicle(fixture.tokens.adminA,key(),fixture.vehicles[0],true);
});
test('Q02: insufficient B is skipped for C without moving B reservations or changing relative queue order',async()=>{
 const x=await terminalIncident(4,4);assert.equal(await closure('terminal-replacement',{incidentId:x.incidentId}),fixture.trips[2]);
 const consent=await x.b.consentGroup(fixture.tokens.p,key(),x.g.bookingIds[0],fixture.trips[2],0,true);
 await closure('terminal-reassign',{incidentId:x.incidentId,targetTripId:fixture.trips[2],consentIds:[consent.consentId],safeTransfer:false,confirmed:true});
 assert.equal((await x.b.booking(fixture.tokens.p,x.own.bookingIds[0])).trip_id,fixture.trips[1]);
 assert.deepEqual((await x.b.queue(fixture.tokens.adminA,{routeId:fixture.ra})).map(t=>t.id),[fixture.trips[1],fixture.trips[2]]);
});
test('Q03: observed terminal passengers require actual safe-transfer declaration, no invented BOARD/ALIGHT',async()=>{
 const x=await terminalIncident();const id=x.g.bookingIds[0];
 // Incident is already blocked: use a new fixture observation recorded before the incident.
 await admin.query("INSERT INTO nexo.booking_movements VALUES($1,$2,'BOARD',0,$3,clock_timestamp())",[fixture.A,id,fixture.adminA]);
 const consent=await x.b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);
 const body={incidentId:x.incidentId,targetTripId:fixture.trips[1],consentIds:[consent.consentId],safeTransfer:false,confirmed:true};
 await rejects(closure('terminal-reassign',body),/SAFE_TRANSFER_REQUIRED/);
 const before=(await admin.query('SELECT * FROM nexo.booking_movements')).rows;
 await closure('terminal-reassign',{...body,safeTransfer:true});
 assert.deepEqual((await admin.query('SELECT * FROM nexo.booking_movements')).rows,before);
 assert.equal((await x.b.operationalStatus(fixture.tokens.d1,fixture.trips[1])).observedOnboard,4);
});
test('Q04: terminal relocation rejects cross-association admin, stale consent and rolls back every partial move',async()=>{
 const x=await terminalIncident();const id=x.g.bookingIds[0];const c=await x.b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);
 const body={incidentId:x.incidentId,targetTripId:fixture.trips[1],consentIds:[c.consentId],safeTransfer:false,confirmed:true};
 await rejects(closure('terminal-reassign',body,fixture.tokens.adminB),/FORBIDDEN/);
 await admin.query("CREATE FUNCTION nexo.q_rollback()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='TERMINAL_REASSIGNED' THEN RAISE EXCEPTION 'Q_INJECTED_FAILURE';END IF;RETURN NEW;END$$;CREATE TRIGGER q_rollback BEFORE INSERT ON nexo.journey_events FOR EACH ROW EXECUTE FUNCTION nexo.q_rollback()");
 try{await rejects(closure('terminal-reassign',body),/Q_INJECTED_FAILURE/);}finally{await admin.query('DROP TRIGGER q_rollback ON nexo.journey_events;DROP FUNCTION nexo.q_rollback()');}
 assert.equal((await x.b.booking(fixture.tokens.p,id)).trip_id,fixture.trips[0]);assert.equal((await admin.query('SELECT * FROM nexo.consent_uses')).rowCount,0);
 await api.cancel(fixture.tokens.p,key(),id);await rejects(closure('terminal-reassign',body),/UNACCEPTED_OFFERS|STALE_CONSENT/);
});
test('Q05: road rescue prioritizes a completely free destination unit, preserves manifest and requires safe transfer',async()=>{
 const reverse=await reverseQueue();const x=await roadIncident();
 const candidates=await closure('road-candidates',{incidentId:x.state.incidentId,priority:'DESTINATION'});assert.equal(candidates[0].tripId,fixture.trips[1]);assert.equal(candidates[0].routeId,reverse);assert.equal(candidates[0].travelTimeKnown,false);
 await rejects(closure('road-command',{tripId:fixture.trips[0],version:2,command:'ASSIGN',targetTripId:fixture.trips[1],priority:'ORIGIN',confirmed:true}),/ADMIN_TERMINAL_CHOICE_REQUIRED/);
 let s=await closure('road-command',{tripId:fixture.trips[0],version:2,command:'ASSIGN',targetTripId:fixture.trips[1],priority:'DESTINATION',confirmed:true});assert.equal(s.phase,'ASSIGNED');
 assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.road_rescues')).rowCount,0);
 assert.equal((await sql(fixture.tokens.p,'SELECT * FROM nexo.journey_events')).rowCount,0);
 assert.equal((await sql(fixture.tokens.adminB,'SELECT * FROM nexo.road_rescues')).rowCount,0);
 assert.equal((await sql(fixture.tokens.d1,'SELECT * FROM nexo.road_rescues')).rowCount,1);
 assert.equal((await x.b.operationalStatus(fixture.tokens.p,fixture.trips[0])).roadRescue.phase,'ASSIGNED');
 await rejects(api.progress(fixture.tokens.d1,key(),fixture.trips[0],2),/OPERATION_BLOCKED/);
 await rejects(api.progress(fixture.tokens.d0,key(),fixture.trips[0],2),/FORBIDDEN/);
 s=await closure('road-command',{tripId:fixture.trips[0],version:s.version,command:'SAFE_TRANSFER',onboard:6,confirmed:true},fixture.tokens.d1);assert.equal(s.phase,'TRANSFERRED');
 const b=await x.b.booking(fixture.tokens.p,x.g.bookingIds[0]);assert.equal(b.trip_id,fixture.trips[0]);assert.equal(b.price_bob,'60.00');assert.equal(b.members.length,6);
 assert.equal((await admin.query('SELECT * FROM nexo.booking_movements')).rowCount,1);
 await api.progress(fixture.tokens.d1,key(),fixture.trips[0],3);await x.b.movement(fixture.tokens.d1,key(),b.id,'ALIGHT');
 await x.b.restoreVehicle(fixture.tokens.adminA,key(),fixture.vehicles[0],true);
});
test('Q06: road selection falls back to origin if destination is occupied; no priority is guessed from distance',async()=>{
 const reverse=await reverseQueue();await admin.query("INSERT INTO nexo.fares(association_id,route_id,from_stop,to_stop,express,version,amount_bob,valid_from)VALUES($1,$2,0,3,false,1,10,now()-interval '1 day')",[fixture.A,reverse]);
 const own=await api.reserve(fixture.tokens.other,key(),{routeId:reverse,from:0,to:3,seats:1});await api.respond(fixture.tokens.d1,key(),own.bookingIds[0],true);
 const x=await roadIncident();const choices=await closure('road-candidates',{incidentId:x.state.incidentId,priority:'DESTINATION'});assert.deepEqual(choices.map(c=>c.tripId),[fixture.trips[2]]);assert.equal(choices[0].terminal,'ORIGIN');
 const unranked=await closure('road-candidates',{incidentId:x.state.incidentId});assert.equal(unranked[0].requiresAdminChoice,true);
 await closure('road-command',{tripId:fixture.trips[0],version:2,command:'ASSIGN',targetTripId:fixture.trips[2],priority:'DESTINATION',confirmed:true});
 assert.equal((await business().booking(fixture.tokens.other,own.bookingIds[0])).trip_id,fixture.trips[1]);
});
test('Q07: no free road unit creates explicit urgent review without fake rescue or releasing seats',async()=>{
 const g=await fixed(6);await acceptAll(g);const own=await fixed(1,1);await acceptAll(own);const last=await fixed(6,2);await acceptAll(last);
 await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await business().movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');
 let s=await closure('road-command',{tripId:fixture.trips[0],version:0,command:'REPORT',confirmed:true},fixture.tokens.d0);s=await closure('road-command',{tripId:fixture.trips[0],version:s.version,command:'CONFIRM',confirmed:true});
 s=await closure('road-command',{tripId:fixture.trips[0],version:s.version,command:'ESCALATE',confirmed:true});assert.equal(s.urgent,true);assert.equal(s.phase,'URGENT_REVIEW');
 assert.equal((await business().booking(fixture.tokens.p,g.bookingIds[0])).status,'CONFIRMED');assert.equal((await admin.query("SELECT count(*)::int AS n FROM nexo.trips WHERE status='WITHDRAWN'")).rows[0].n,0);
});
test('Q08: two road rescues compete for one free vehicle with exactly one atomic winner',async()=>{
 const a=await fixed(6);await acceptAll(a);const second=await fixed(6,1);await acceptAll(second);
 for(const [index,g]of [[0,a],[1,second]]){await api.depart(fixture.tokens['d'+index],key(),fixture.trips[index]);await business().movement(fixture.tokens['d'+index],key(),g.bookingIds[0],'BOARD');await closure('road-command',{tripId:fixture.trips[index],version:0,command:'REPORT',confirmed:true},fixture.tokens['d'+index]);await closure('road-command',{tripId:fixture.trips[index],version:1,command:'CONFIRM',confirmed:true});}
 const rs=await Promise.allSettled([0,1].map(index=>closure('road-command',{tripId:fixture.trips[index],version:2,command:'ASSIGN',targetTripId:fixture.trips[2],priority:'ORIGIN',confirmed:true})));
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal((await admin.query("SELECT * FROM nexo.fleet_incidents WHERE context='ROAD' AND state='ASSIGNED'")).rowCount,1);
 assert.equal((await admin.query("SELECT * FROM nexo.trips WHERE status='WITHDRAWN'")).rowCount,1);assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('Q09: road rescue is idempotent and revalidates revoked permits, sessions and scoped terminals',async()=>{
 const x=await roadIncident();const body={tripId:fixture.trips[0],version:2,command:'ASSIGN',targetTripId:fixture.trips[1],priority:'ORIGIN',confirmed:true};
 await admin.query("UPDATE nexo.route_authorizations SET status='REVOKED' WHERE id=$1",[fixture.authorizations[fixture.ra]]);
 await rejects(closure('road-command',body),/NO_FREE_REPLACEMENT|ROUTE_NOT_ELIGIBLE/);
 await admin.query("UPDATE nexo.route_authorizations SET status='VERIFIED' WHERE id=$1",[fixture.authorizations[fixture.ra]]);
 const k=key();const rs=await Promise.allSettled(Array.from({length:8},()=>closure('road-command',body,fixture.tokens.adminA,k)));for(const r of rs)assert.equal(r.status,'fulfilled',r.reason?.message);
 await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp()WHERE user_id=$1',[fixture.adminA]);await rejects(closure('road-command',body,fixture.tokens.adminA,k),/UNAUTHENTICATED/);
});
test('Q10: four onboard plus two future pickups may depart; en-route offers reuse disjoint segments without waiting',async()=>{
 const a=await fixed(4,0,{to:1});await acceptAll(a);const pickup=await fixed(2,0,{from:1});await acceptAll(pickup);
 const b=business();await b.terminalObservation(fixture.tokens.adminA,key(),a.bookingIds[0],null,'BOARD',4,1,true);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 const later=await closure('reserve-enroute',{tripId:fixture.trips[0],routeId:fixture.ra,from:1,to:3,seats:4},fixture.tokens.other);await api.respond(fixture.tokens.d0,key(),later.bookingId,true);
 await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);await b.movement(fixture.tokens.d0,key(),a.bookingIds[0],'ALIGHT');await b.movement(fixture.tokens.d0,key(),pickup.bookingIds[0],'BOARD');await b.movement(fixture.tokens.d0,key(),later.bookingId,'BOARD');
 assert.equal((await b.operationalStatus(fixture.tokens.d0,fixture.trips[0])).observedOnboard,6);assert.ok((await occupancy()).every(r=>r.used<=6));assert.equal(later.priceBOB,'40.00');
 await api.progress(fixture.tokens.d0,key(),fixture.trips[0],2);await rejects(closure('reserve-enroute',{tripId:fixture.trips[0],routeId:fixture.ra,from:1,to:3,seats:1},fixture.tokens.p),/PICKUP_PASSED/);
});
test('Q11: simultaneous APP and walk-in en-route requests for last segment seat have one winner',async()=>{
 const g=await fixed(6,0,{to:1});await acceptAll(g);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 const five=await closure('reserve-enroute',{tripId:fixture.trips[0],routeId:fixture.ra,from:1,to:3,seats:5},fixture.tokens.p);await api.respond(fixture.tokens.d0,key(),five.bookingId,true);
 const rs=await Promise.allSettled(Array.from({length:16},(_,i)=>closure(i%2?'reserve-enroute':'walk-in-enroute',{tripId:fixture.trips[0],routeId:fixture.ra,from:1,to:3,seats:1},i%2?fixture.tokens.other:fixture.tokens.adminA)));
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('Q12: a driver may pass an unaccepted en-route pickup, expiring it without waiting, reacceptance or return',async()=>{
 const g=await fixed(6,0,{to:1});await acceptAll(g);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 const pending=await closure('reserve-enroute',{tripId:fixture.trips[0],routeId:fixture.ra,from:1,to:3,seats:1},fixture.tokens.p);
 await api.progress(fixture.tokens.d0,key(),fixture.trips[0],2);assert.equal((await api.respond(fixture.tokens.d0,key(),pending.bookingId,true)).status,'EXPIRED');
 await rejects(api.progress(fixture.tokens.d0,key(),fixture.trips[0],1),/INVALID_PROGRESS/);assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('Q13: diversion changes only new fares, requires acceptance for existing boarding and records human alternative',async()=>{
 const g=await fixed(2);await acceptAll(g);const b=business(),id=g.bookingIds[0];const fare=(await b.booking(fixture.tokens.p,id)).fare_id;
 const c=await closure('route-condition',condition('DESVIO',{fareId:fare,amountBOB:'15.00'}));
 assert.equal((await b.booking(fixture.tokens.p,id)).price_bob,'20.00');assert.equal((await b.quote(fixture.tokens.p,request(2))).totalBOB,'30.00');
 await rejects(b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',2,3,true),/CONDITION_ACCEPTANCE_REQUIRED/);
 await closure('condition-decision',{bookingId:id,revision:c.revision,decision:'ADMIN_REVIEW',confirmed:true});
 await rejects(closure('condition-decision',{bookingId:id,revision:c.revision,decision:'ACCEPT',confirmed:true}),/FORBIDDEN/);
 await closure('condition-decision',{bookingId:id,revision:c.revision,decision:'ACCEPT',confirmed:true},fixture.tokens.p);
 await b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',2,3,true);
});
test('Q14: route suspension retains reservations and public contact, blocks new sales and affected detour stops',async()=>{
 const g=await fixed(6);await acceptAll(g);await closure('association-contact',{associationId:fixture.A,contactCode:'LAB-TERMINAL-A',confirmed:true});
 await closure('route-condition',condition('SUSPENDIDA'));await rejects(hold(1),/ROUTE_NOT_ELIGIBLE/);
 await rejects(api.depart(fixture.tokens.d0,key(),fixture.trips[0]),/ROUTE_CONDITION_BLOCKED/);
 await rejects(business().terminalObservation(fixture.tokens.adminA,key(),g.bookingIds[0],null,'BOARD',6,3,true),/ROUTE_CONDITION_BLOCKED/);
 const publicRows=await business().publicAvailability({originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1]});
 const ours=publicRows.services.filter(s=>s.associationId===fixture.A);assert.ok(ours.length>0);assert.ok(ours.every(s=>s.state==='SUSPENDIDA'&&s.availableSeats===0&&s.contactCode==='LAB-TERMINAL-A'));
 assert.equal((await business().booking(fixture.tokens.p,g.bookingIds[0])).status,'CONFIRMED');
 await closure('route-condition',condition('DESVIO',{affectedStops:[1]}));await rejects(hold(1,{from:1}),/ROUTE_CONDITION_BLOCKED/);
 await closure('route-condition',condition('NORMAL'));assert.equal((await hold(1)).status,'HELD');
});
test('Q15: limited terminal admins cannot read or mutate another route using new or legacy SQL; offline grants cannot escalate',async()=>{
 const reverse=await reverseQueue();const g=await individualFixture(2);
 await provisionPool.query("SELECT nexo.provision_role($1,$2,'ASSOCIATION_ADMIN',true,'Ficción de revisión de alcances')",[fixture.other,fixture.A]);
 await admin.query("INSERT INTO nexo.operational_notices(association_id,trip_id,recipient_id,kind)VALUES($1,$2,$3,'SCOPE_TEST')",[fixture.A,fixture.trips[0],fixture.drivers[0]]);
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[reverse]]);
 const rows=await sql(fixture.tokens.adminA,'SELECT * FROM nexo.bookings');assert.equal(rows.rowCount,0);
 const auths=await sql(fixture.tokens.adminA,'SELECT * FROM nexo.route_authorizations');assert.deepEqual(auths.rows.map(a=>a.route_id),[reverse]);
 const authEvents=await sql(fixture.tokens.adminA,'SELECT * FROM nexo.authorization_events');assert.equal(authEvents.rowCount,1);assert.equal(authEvents.rows[0].authorization_id,auths.rows[0].id);
 assert.equal((await sql(fixture.tokens.adminA,'SELECT * FROM nexo.identity_events WHERE subject_id=$1',[fixture.other])).rowCount,0);
 await rejects(business().terminalCommand(fixture.tokens.adminA,key(),g.bookingIds[0],'VERIFIED',true),/FORBIDDEN_SCOPE/);
 await rejects(business().simulatePayment(fixture.tokens.adminA,key(),g.bookingIds[0],'VERIFIED_SIMULATED',true),/FORBIDDEN_SCOPE/);
 await rejects(closure('route-condition',condition('NORMAL')),/FORBIDDEN/);
 await rejects(sql(fixture.tokens.adminA,'SELECT nexo.configure_admin_scope($1,$2,$3,false)',[fixture.adminA,fixture.A,[]]),/permission denied/);
 await rejects(sql(fixture.tokens.adminA,'SELECT nexo.scope_core_terminal_command($1,$2,$3,true)',[key(),g.bookingIds[0],'VERIFIED']),/permission denied/);
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[fixture.ra]]);
 await business().terminalCommand(fixture.tokens.adminA,key(),g.bookingIds[0],'VERIFIED',true);
 assert.equal((await sql(fixture.tokens.adminA,'SELECT * FROM nexo.bookings')).rowCount,1);
 assert.deepEqual(await business().advancementCandidates(fixture.tokens.adminA,fixture.trips[0]),[]);
 await rejects(business().advancementCandidates(fixture.tokens.adminA,fixture.trips[1]),/FORBIDDEN_SCOPE/);
 assert.ok((await business().notices(fixture.tokens.adminA)).some(n=>n.kind==='SCOPE_TEST'));
 assert.ok((await admin.query("SELECT * FROM nexo.identity_events WHERE event='ADMIN_SCOPE_RESTRICTED'")).rowCount>=2);
});
test('Q16: only the general reviewer enables associations; pending or suspended associations cannot sell',async()=>{
 await closure('association-review',{associationId:fixture.A,state:'PENDING',confirmed:true},fixture.tokens.reviewer);
 await rejects(hold(1),/ROUTE_NOT_ELIGIBLE/);await rejects(closure('association-review',{associationId:fixture.A,state:'ACTIVE',confirmed:true}),/FORBIDDEN/);
 const pub=await business().publicAvailability({originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1]});assert.ok(pub.services.every(s=>s.associationId!==fixture.A));
 await closure('association-review',{associationId:fixture.A,state:'ACTIVE',confirmed:true},fixture.tokens.reviewer);assert.equal((await hold(1)).status,'HELD');
 await closure('association-review',{associationId:fixture.A,state:'SUSPENDED',confirmed:true},fixture.tokens.reviewer);await rejects(hold(1),/ROUTE_NOT_ELIGIBLE/);
});
test('Q17: minor special cases remain pending until human simulated verification and keep companions together',async()=>{
 const g=await individualFixture(3),b=business(),id=g.bookingIds[0],members=g.members;
 const body={memberId:members[0].id,kind:'AUTHORIZED_COMPANION',companionId:members[1].id,result:'PENDING',confirmed:true};
 await closure('minor-review',body);await rejects(b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',3,3,true),/MINOR_REVIEW_REQUIRED/);
 await rejects(closure('minor-review',{...body,result:'VERIFIED_SIMULATED'},fixture.tokens.adminB),/FORBIDDEN/);
 await closure('minor-review',{...body,result:'VERIFIED_SIMULATED'});
 await rejects(b.terminalObservation(fixture.tokens.adminA,key(),id,members[0].id,'BOARD',3,3,true),/COMPANION_REQUIRED/);
 const c=await b.consentGroup(fixture.tokens.p,key(),id,fixture.trips[1],0,true);await b.approveTerminalTransfer(fixture.tokens.adminA,key(),c.consentId);
 assert.equal((await b.booking(fixture.tokens.p,id)).members.length,3);
 await b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',3,3,true);
});
test('Q18: unaccompanied and parent-accompanied cases store only technical verification and deny rejection bypass',async()=>{
 const g=await individualFixture(3),b=business(),id=g.bookingIds[0];
 await closure('minor-review',{memberId:g.members[0].id,kind:'UNACCOMPANIED',result:'REJECTED',confirmed:true});
 await rejects(b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',3,3,true),/MINOR_REVIEW_REQUIRED/);
 await closure('minor-review',{memberId:g.members[0].id,kind:'UNACCOMPANIED',result:'VERIFIED_SIMULATED',confirmed:true});
 await closure('minor-review',{memberId:g.members[1].id,kind:'PARENT_ACCOMPANIED',companionId:g.members[2].id,result:'VERIFIED_SIMULATED',confirmed:true});
 await b.terminalObservation(fixture.tokens.adminA,key(),id,null,'BOARD',3,3,true);
 const rows=(await admin.query('SELECT * FROM nexo.minor_cases')).rows;assert.equal(rows.length,2);assert.ok(!JSON.stringify(rows).includes('birth'));
});
test('Q19: late passenger requests alternative; admin creates new inventory once, never resurrects cancelled booking or charges twice',async()=>{
 const g=await individualFixture(2),b=business(),id=g.bookingIds[0];await api.cancel(fixture.tokens.p,key(),id);
 await closure('passenger-decision',{bookingId:id,decision:'REQUEST_ALTERNATIVE',confirmed:true},fixture.tokens.p);
 const body={bookingId:id,targetTripId:fixture.trips[1],cancelOnly:false,confirmed:true},k=key();
 const rs=await Promise.allSettled(Array.from({length:8},()=>closure('late-resolution',body,fixture.tokens.adminA,k)));
 for(const r of rs)assert.equal(r.status,'fulfilled',r.reason?.message);
 const r=rs[0].value;assert.notEqual(r.replacementBookingId,id);assert.equal((await b.booking(fixture.tokens.p,id)).status,'CANCELLED');assert.equal((await b.booking(fixture.tokens.p,r.replacementBookingId)).price_bob,'20.00');assert.equal(r.moneyProcessed,false);
 assert.equal((await admin.query('SELECT * FROM nexo.late_replacements')).rowCount,1);await rejects(closure('late-resolution',body),/ADMIN_REVIEW_REQUIRED/);
});
test('Q20: late resolution requires passenger choice and capacity; refund supplies synthetic association contact only',async()=>{
 const g=await individualFixture(2),id=g.bookingIds[0];await closure('association-contact',{associationId:fixture.A,contactCode:'LAB-DEVOLUCIONES',confirmed:true});
 await rejects(closure('late-resolution',{bookingId:id,cancelOnly:true,confirmed:true}),/PASSENGER_DECISION_REQUIRED/);
 const decision=await closure('passenger-decision',{bookingId:id,decision:'CANCEL_REQUEST',confirmed:true},fixture.tokens.p);assert.equal(decision.contactCode,'LAB-DEVOLUCIONES');
 const result=await closure('late-resolution',{bookingId:id,cancelOnly:true,confirmed:true});assert.equal(result.status,'CANCELLED');assert.equal(result.moneyProcessed,false);
 const refund=await closure('passenger-decision',{bookingId:id,decision:'REFUND_CONTACT_REQUESTED',confirmed:true},fixture.tokens.p);assert.equal(refund.associationResponsibleForRefund,true);
});
test('Q21: anonymous local availability exposes no personal fields; all other closure operations still require sessions',async()=>{
 const g=await individualFixture(3);const h=await startBusinessRuntime(pool);
 try{
  const r=await postJson(h.url,'/business/closure/public-availability',{originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1]});assert.equal(r.status,200);assert.ok(r.body.services.some(s=>s.confirmedSeats===3&&s.availableSeats===3));
  const text=JSON.stringify(r.body);for(const secret of [fixture.p,fixture.adminA,fixture.tokens.p,g.bookingIds[0],'passenger_id','driver_id','phone','login','password'])assert.ok(!text.includes(secret));
  assert.equal((await postJson(h.url,'/business/closure/road-candidates',{incidentId:randomUUID()})).status,401);
  assert.equal((await postJson(h.url,'/business/closure/route-condition',{...condition(),gps:[0,0]},{Authorization:'Bearer '+fixture.tokens.adminA,'Idempotency-Key':key()})).status,400);
  assert.equal((await postJson(h.url,'/business/closure/public-availability',{originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1],passengerId:fixture.p})).status,400);
 }finally{await h.close();}
});
test('Q22: association history is paginated, isolated and immutable without arbitrary retention or deletion',async()=>{
 const g=await individualFixture(2);await closure('route-condition',condition());const history=await closure('operating-history',{routeId:fixture.ra,limit:2});assert.equal(history.events.length,2);assert.equal(history.retentionPolicyPending,true);
 await rejects(closure('operating-history',{routeId:fixture.ra},fixture.tokens.adminB),/FORBIDDEN/);
 await rejects(admin.query("UPDATE nexo.condition_history SET snapshot='{}'"),/IMMUTABLE_AUDIT/);
 await rejects(sql(fixture.tokens.adminA,'DELETE FROM nexo.journey_events'),/permission denied/);assert.equal((await business().booking(fixture.tokens.p,g.bookingIds[0])).price_bob,'20.00');
});

test('Q23: populated 001-017 upgrade preserves all original rows, then old boarding and new route contracts work',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];await b.activateTerminal(fixture.tokens.adminA,key(),id);await b.simulatePayment(fixture.tokens.adminA,key(),id,'VERIFIED_SIMULATED',true);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await b.movement(fixture.tokens.d0,key(),id,'BOARD');
 const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));const target=new URL(url);target.pathname='/'+name;const db=new pg.Client({connectionString:target.href});await db.connect();
 try{
  const dir=await mkdtemp(resolve('.local','stage2-closure-migrations-'));const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'018' ORDER BY name")).rows.map(x=>x.name);
  for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,17);
  const tables=['users','identity_accounts','identity_recovery','identity_attempts','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers','route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','identity_events','security_events','booking_movements','booking_members','member_movements','absence_drafts','terminal_config','terminal_events','assignment_episodes','assignment_outcomes','episode_terminal_events','terminal_config_changes','group_responsibles','group_consents','consent_uses','terminal_bindings','simulated_payments','operational_notices','arrival_contracts','movement_corrections','urban_runs','fleet_incidents','vehicle_blocks','fleet_events'];
  await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings DISABLE TRIGGER assignment_tracking');
  for(const table of tables)for(const row of(await admin.query('SELECT * FROM nexo.'+table)).rows){const cols=Object.keys(row);await db.query(`INSERT INTO nexo.${table}(${cols.map(x=>db.escapeIdentifier(x)).join(',')})OVERRIDING SYSTEM VALUE VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}
  await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings ENABLE TRIGGER assignment_tracking');
  const oldTables=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexo' AND c.relkind='r' ORDER BY c.relname")).rows.map(r=>r.relname);
  const snapshot=async()=>{const x={};for(const t of oldTables)x[t]=(await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(t)+' t ORDER BY to_jsonb(t)::text')).rows;return x;};
  const before=await snapshot();assert.deepEqual(await migrate(db),['018_operating_contracts.sql','019_journey_recovery.sql','020_scoped_administration.sql','021_scope_read_boundaries.sql','022_rescue_manifest_privacy.sql','023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);
  assert.equal((await db.query('SELECT * FROM nexo.booking_contracts')).rowCount,0);assert.equal((await db.query('SELECT * FROM nexo.road_rescues')).rowCount,0);
  await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.d0]);await db.query('SELECT nexo.progress($1,$2,3)',[key(),fixture.trips[0]]);await db.query("SELECT nexo.record_movement($1,$2,'ALIGHT')",[key(),id]);
  assert.equal((await db.query('SELECT price_bob FROM nexo.bookings WHERE id=$1',[id])).rows[0].price_bob,'60.00');
  await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.adminA]);await db.query("SELECT nexo.set_route_condition($1,$2,'NORMAL','NORMAL','','{}'::integer[],NULL,NULL,true)",[key(),fixture.ra]);
 }finally{await db.end();}
});
test('Q24: restricted terminal grant revocation serializes against operations and cannot replay a forbidden receipt',async()=>{
 const g=await individualFixture(2),b=business(),id=g.bookingIds[0];await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[fixture.ra]]);
 const action=key();await b.terminalCommand(fixture.tokens.adminA,action,id,'VERIFIED',true);
 const c=await provisionPool.connect();try{
  await c.query('BEGIN');await c.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[]]);
  const waiting=b.terminalCommand(fixture.tokens.adminA,action,id,'VERIFIED',true);const checked=waiting.then(value=>({value}),error=>({error}));
  await c.query('COMMIT');assert.match((await checked).error?.message??'',/FORBIDDEN_SCOPE/);
 }finally{await c.query('ROLLBACK');c.release();}
 await rejects(closure('operating-history',{routeId:fixture.ra}),/FORBIDDEN/);
});

test('Q25: road assignment racing a new booking on the substitute never steals committed capacity',async()=>{
 const x=await roadIncident();const body={tripId:fixture.trips[0],version:2,command:'ASSIGN',targetTripId:fixture.trips[1],priority:'ORIGIN',confirmed:true};
 const rs=await Promise.allSettled([closure('road-command',body),api.reserve(fixture.tokens.other,key(),request(1))]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length>=1,true);
 const target=(await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[1]])).rows[0];
 if(target.status==='WITHDRAWN')assert.equal((await admin.query("SELECT * FROM nexo.bookings WHERE trip_id=$1 AND status IN('HELD','CONFIRMED')",[fixture.trips[1]])).rowCount,0);
 else assert.equal(rs[0].status,'rejected');assert.ok((await occupancy()).every(r=>r.used<=6));
});
test('Q26: late cancellation after departure is explicit, preserves old price and never frees observed passengers',async()=>{
 const g=await individualFixture(),b=business(),id=g.bookingIds[0];await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
 await closure('passenger-decision',{bookingId:id,decision:'REQUEST_ALTERNATIVE',confirmed:true},fixture.tokens.p);
 const r=await closure('late-resolution',{bookingId:id,targetTripId:fixture.trips[1],cancelOnly:false,confirmed:true});assert.equal(r.priceBOB,'60.00');assert.equal((await b.booking(fixture.tokens.p,id)).status,'CANCELLED');
 await b.terminalObservation(fixture.tokens.adminA,key(),r.replacementBookingId,null,'BOARD',6,3,true);
 await closure('passenger-decision',{bookingId:r.replacementBookingId,decision:'CANCEL_REQUEST',confirmed:true},fixture.tokens.p);
 await rejects(closure('late-resolution',{bookingId:r.replacementBookingId,cancelOnly:true,confirmed:true}),/ADMIN_REVIEW_REQUIRED/);
});
test('Q27: en-route progress versus acceptance cannot confirm a pickup already passed, nor leave a waiting offer',async()=>{
 const g=await fixed(6,0,{to:1});await acceptAll(g);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 const pending=await closure('reserve-enroute',{tripId:fixture.trips[0],routeId:fixture.ra,from:1,to:3,seats:1},fixture.tokens.p);
 const rs=await Promise.allSettled([api.progress(fixture.tokens.d0,key(),fixture.trips[0],2),api.respond(fixture.tokens.d0,key(),pending.bookingId,true)]);
 for(const r of rs)assert.equal(r.status,'fulfilled',r.reason?.message);
 const row=(await business().booking(fixture.tokens.p,pending.bookingId));assert.ok(['EXPIRED','CONFIRMED'].includes(row.status));
 if(row.status==='CONFIRMED')assert.ok((await admin.query("SELECT * FROM nexo.journey_events WHERE kind='MISSED_PICKUP_REVIEW' AND payload->>'bookingId'=$1",[pending.bookingId])).rowCount>0);
});

test('Q28: companion boarding corrections and progress cannot leave an individually boarded minor unaccompanied',async()=>{
 const g=await individualFixture(6),b=business(),id=g.bookingIds[0],minor=g.members[0].id,companion=g.members[1].id;
 await closure('minor-review',{memberId:minor,kind:'AUTHORIZED_COMPANION',companionId:companion,result:'VERIFIED_SIMULATED',confirmed:true});
 await b.terminalObservation(fixture.tokens.adminA,key(),id,companion,'BOARD',6,3,true);await b.terminalObservation(fixture.tokens.adminA,key(),id,minor,'BOARD',6,3,true);
 await rejects(b.correctMovement(fixture.tokens.adminA,key(),id,'member:'+companion+':BOARD','OPERATOR_ERROR',true),/COMPANION_REQUIRED/);
 await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3);
 await b.memberMovement(fixture.tokens.d0,key(),companion,'ALIGHT');await rejects(api.progress(fixture.tokens.d0,key(),fixture.trips[0],3),/COMPANION_REQUIRED/);
 await b.memberMovement(fixture.tokens.d0,key(),minor,'ALIGHT');
});
test('Q29: cancellation options show live alternatives before a decision and standard cancel returns association refund contact',async()=>{
 const g=await individualFixture(2),id=g.bookingIds[0];await closure('association-contact',{associationId:fixture.A,contactCode:'LAB-ADMINISTRACION',confirmed:true});
 const options=await closure('resolution-options',{bookingId:id},fixture.tokens.p);assert.equal(options.alternatives[0].tripId,fixture.trips[1]);assert.equal(options.snapshotOnly,true);
 const cancel=await api.cancel(fixture.tokens.p,key(),id);assert.equal(cancel.contactCode,'LAB-ADMINISTRACION');assert.equal(cancel.moneyProcessed,false);assert.equal(cancel.associationResponsibleForRefund,true);
 await rejects(closure('resolution-options',{bookingId:id},fixture.tokens.other),/FORBIDDEN/);
});
test('Q30: road rescue transaction failure rolls back carrier, withdrawn queue, incident and action together',async()=>{
 const x=await roadIncident();
 await admin.query("CREATE FUNCTION nexo.q_road_rollback()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='ROAD_ASSIGN' THEN RAISE EXCEPTION 'Q_ROAD_FAILURE';END IF;RETURN NEW;END$$;CREATE TRIGGER q_road_rollback BEFORE INSERT ON nexo.journey_events FOR EACH ROW EXECUTE FUNCTION nexo.q_road_rollback()");
 const k=key();try{await rejects(closure('road-command',{tripId:fixture.trips[0],version:2,command:'ASSIGN',targetTripId:fixture.trips[1],priority:'ORIGIN',confirmed:true},fixture.tokens.adminA,k),/Q_ROAD_FAILURE/);}finally{await admin.query('DROP TRIGGER q_road_rollback ON nexo.journey_events;DROP FUNCTION nexo.q_road_rollback()');}
 assert.equal((await admin.query('SELECT vehicle_id FROM nexo.trips WHERE id=$1',[fixture.trips[0]])).rows[0].vehicle_id,fixture.vehicles[0]);assert.equal((await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[1]])).rows[0].status,'QUEUED');assert.equal((await admin.query('SELECT * FROM nexo.actions WHERE action_key=$1',[k])).rowCount,0);assert.equal((await admin.query('SELECT state FROM nexo.fleet_incidents WHERE id=$1',[x.state.incidentId])).rows[0].state,'CONFIRMED');
});

test('Q31: terminal relocation handles more than six distinct groups on disjoint segments while preserving six simultaneous seats',async()=>{
 const b=business(),groups=[];
 for(const segment of [{from:0,to:1},{from:1,to:3}])for(let n=0;n<6;n++){const g=await fixed(1,0,segment);await acceptAll(g);groups.push(g);}
 await b.terminalImpediment(fixture.tokens.d0,key(),fixture.trips[0],'REPORT','MECHANICAL_FAILURE',true);const incident=await b.terminalImpediment(fixture.tokens.adminA,key(),fixture.trips[0],'CONFIRM','MECHANICAL_FAILURE',true);
 const consents=[];for(const g of groups)consents.push((await b.consentGroup(fixture.tokens.p,key(),g.bookingIds[0],fixture.trips[1],0,true)).consentId);
 await closure('terminal-reassign',{incidentId:incident.incidentId,targetTripId:fixture.trips[1],consentIds:consents,safeTransfer:false,confirmed:true});
 assert.equal((await admin.query("SELECT * FROM nexo.bookings WHERE trip_id=$1 AND status='CONFIRMED'",[fixture.trips[1]])).rowCount,12);assert.ok((await occupancy()).every(r=>r.used<=6));
});

test('V01: browser gateway reuses PostgreSQL public availability and catalogue without exposing a session or private fields',async()=>{
 await namedLocalities();const g=await individualFixture(4);const web=await startWebGateway({pool,catalogToken:fixture.tokens.other,localTest:true});
 try{
  const headers={Origin:web.url};const suggestions=await postJson(web.url,'/api/localities',{query:'San Jose'},headers);assert.equal(suggestions.status,200);assert.ok(suggestions.body.length>=1);
  const result=await postJson(web.url,'/api/availability',{originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1]},headers);assert.equal(result.status,200);assert.equal(result.body.mode,'LOCAL_LAB');assert.equal(result.body.reservationWritesEnabled,false);
  const t=result.body.services.find(s=>s.tripId===fixture.trips[0]);assert.equal(t.confirmedSeats,4);assert.equal(t.availableSeats,2);assert.equal(t.segments[0].available,2);assert.equal(t.boardingName,'Parada ficticia 0');
  const text=JSON.stringify(result.body);for(const privateValue of [fixture.tokens.other,fixture.tokens.p,fixture.p,fixture.adminA,g.bookingIds[0],'passenger_id','password'])assert.ok(!text.includes(privateValue));
  const page=await fetch(web.url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);assert.equal(page.headers.get('access-control-allow-origin'),null);
 }finally{await web.close();}
});
test('V02: browser gateway denies cross-origin, forged hosts, credentials, public writes and administrative escalation',async()=>{
 const web=await startWebGateway({pool,catalogToken:fixture.tokens.p,localTest:true});try{
  for(const path of ['/api/admin/overview','/api/driver/overview','/api/passenger/overview'])assert.equal((await fetch(web.url+path)).status,401);
  assert.equal((await postJson(web.url,'/api/localities',{query:'Ya'},{Origin:'https://external.invalid'})).status,403);
  assert.equal((await postJson(web.url,'/api/localities',{query:'Ya'})).status,403);
  assert.equal((await postJson(web.url,'/api/localities',{query:'Ya'},{Origin:web.url,Host:'external.invalid'})).status,403);
  assert.equal((await postJson(web.url,'/api/localities',{query:'Ya',role:'ASSOCIATION_ADMIN'},{Origin:web.url})).status,400);
  assert.equal((await postJson(web.url,'/api/localities',{query:'Ya'},{Origin:web.url,Authorization:'Bearer '+fixture.tokens.adminA})).status,400);
  assert.equal((await postJson(web.url,'/api/reserve',{routeId:fixture.ra},{Origin:web.url})).status,404);
  assert.equal((await fetch(web.url+'/.env')).status,404);assert.equal((await fetch(web.url+'/api/localities')).status,405);
  assert.equal((await postJson(web.url,'/api/localities',{}, {Origin:web.url},{raw:'{bad'})).status,400);
  assert.equal((await postJson(web.url,'/api/localities',{}, {Origin:web.url},{raw:'x'.repeat(3000)})).status,413);
 }finally{await web.close();}
});
test('V03: browser results retain visible suspended routes and reject stale origin pickup through existing backend rules',async()=>{
 await namedLocalities();const web=await startWebGateway({pool,catalogToken:fixture.tokens.other,localTest:true});try{
  const g=await fixed(6);await acceptAll(g);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
  await closure('route-condition',condition('SUSPENDIDA'));
  const r=await postJson(web.url,'/api/availability',{originLocalityId:fixture.geo.localities[0],destinationLocalityId:fixture.geo.localities[1]},{Origin:web.url});assert.equal(r.status,200);
  assert.ok(r.body.services.filter(s=>s.associationId===fixture.A).every(s=>s.state==='SUSPENDIDA'&&s.availableSeats===0));assert.ok(r.body.services.every(s=>s.tripId!==fixture.trips[0]));
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM nexo.bookings')).rows[0].n,1);
 }finally{await web.close();}
});
test('V04: browser facade rejects privileged pools, bounds requests and sanitizes catalogue failures',async()=>{
 const ownerPool=new pg.Pool({connectionString:url.href,max:1});try{await rejects(startWebGateway({pool:ownerPool,catalogToken:fixture.tokens.p,localTest:true}),/UNSAFE_RUNTIME_ROLE/);}finally{await ownerPool.end();}
 await rejects(startWebGateway({pool,catalogToken:fixture.tokens.p}),/LOCAL_TEST_ONLY/);
 const web=await startWebGateway({localTest:true,service:{localities:()=>{throw new Error('SQL_FAKE_SECRET');},availability:()=>({})}});
 try{
  const r=await postJson(web.url,'/api/localities',{query:'Ya'},{Origin:web.url});assert.equal(r.status,503);assert.deepEqual(r.body,{error:'CATALOG_UNAVAILABLE'});
  let last;for(let i=0;i<121;i++)last=await fetch(web.url+'/api/session');assert.equal(last.status,429);assert.equal(last.headers.get('retry-after'),'60');
 }finally{await web.close();}
});

// Increment 2: browser-authenticated facade still uses the original inventory and identity RPCs.
const journeys=async()=> (await import('../../src/db/web-reservation-service.mjs')).createWebReservationService(pool);
const webJourney=(seats=1,from=0,to=3,trip=0)=>({routeId:fixture.ra,tripId:fixture.trips[trip],boardingPointId:fixture.ra+':'+from,alightingPointId:fixture.ra+':'+to,seats,flow:'QUEUE'});
async function webQuote(s,body,token=fixture.tokens.p){const q=await s.quote(token,body);return{...body,confirmed:true,quote:{fareId:q.fareId,fareVersion:q.fareVersion,totalBOB:q.totalBOB}};}
test('W01: exact point lookup validates ordered enabled stops, preserves all segments and leaks no identities',async()=>{
 await namedLocalities();const service=(await import('../../src/db/web-catalog-service.mjs')).createWebCatalogService(pool,fixture.tokens.other);
 const points=await service.points({routeId:fixture.ra});assert.equal(points.length,4);assert.equal(points[0].name,'Parada ficticia 0');
 const snapshot=await service.segment({routeId:fixture.ra,boardingPointId:points[1].id,alightingPointId:points[3].id});assert.equal(snapshot.services[0].segments.length,2);assert.equal(snapshot.services[0].from,1);assert.equal(snapshot.services[0].fareBOB,'10.00');
 for(const[x,y]of[[3,1],[1,1]])await rejects(service.segment({routeId:fixture.ra,boardingPointId:points[x].id,alightingPointId:points[y].id}),/INVALID_AUTHORIZED_POINTS/);
 await admin.query('UPDATE nexo.stops SET boarding_allowed=false WHERE route_id=$1 AND stop_index=1',[fixture.ra]);await rejects(service.segment({routeId:fixture.ra,boardingPointId:points[1].id,alightingPointId:points[3].id}),/INVALID_AUTHORIZED_POINTS/);
 for(const value of[fixture.p,fixture.tokens.p,'passengerId','bookingId'])assert.ok(!JSON.stringify(snapshot).includes(value));
});
test('W02: own history includes legacy reservations, original fare, assigned vehicle and effective expiration only for the actor',async()=>{
 const g=await fixed(2);const s=await journeys();let list=await s.list(fixture.tokens.p);assert.equal(list.bookings.length,1);assert.equal(list.bookings[0].bookingId,g.bookingIds[0]);assert.equal(list.bookings[0].priceBOB,'20.00');assert.equal(list.bookings[0].vehicleLabel,'FICTICIO-0');assert.equal(list.bookings[0].effectiveStatus,'HELD');
 assert.equal((await s.list(fixture.tokens.other)).bookings.length,0);assert.equal((await s.list(fixture.tokens.adminA)).bookings.length,0);
 await admin.query("UPDATE nexo.bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[g.bookingIds[0]]);list=await s.list(fixture.tokens.p);assert.equal(list.bookings[0].effectiveStatus,'EXPIRED');
});
test('W03: persistent request is pending until legitimate driver acceptance; passenger and other association cannot accept',async()=>{
 const s=await journeys(),body=await webQuote(s,webJourney(2));const r=await s.reserve(fixture.tokens.p,key(),body),id=r.bookings[0].bookingId;assert.equal(r.bookings[0].status,'HELD');assert.equal((await s.list(fixture.tokens.p)).bookings.length,1);
 await rejects(s.accept(fixture.tokens.p,key(),{bookingId:id,confirmed:true}),/FORBIDDEN/);await rejects(s.accept(fixture.tokens.d3,key(),{bookingId:id,confirmed:true}),/FORBIDDEN/);
 assert.equal((await s.operatorList(fixture.tokens.d0)).offers.length,1);assert.equal((await s.operatorList(fixture.tokens.d3)).offers.length,0);
 await s.accept(fixture.tokens.d0,key(),{bookingId:id,confirmed:true});assert.equal((await s.list(fixture.tokens.p)).bookings[0].effectiveStatus,'CONFIRMED');
});
test('W04: concurrent double click returns one booking and competing accounts cannot consume the last seat twice',async()=>{
 const s=await journeys(),fill=await fixed(5);await acceptAll(fill);const body=await webQuote(s,webJourney()),k=key();const retry=await Promise.all([s.reserve(fixture.tokens.p,k,body),s.reserve(fixture.tokens.p,k,body)]);assert.equal(retry[0].bookings[0].bookingId,retry[1].bookings[0].bookingId);assert.equal((await admin.query('SELECT count(*)::int AS n FROM nexo.bookings WHERE trip_id=$1',[fixture.trips[0]])).rows[0].n,2);
 await rejects(s.reserve(fixture.tokens.other,key(),body),/NO_CAPACITY/);assert.ok((await occupancy()).every(x=>x.used<=6));
});
test('W05: per-segment quote and idempotent replay preserve agreed price after fare/permission change',async()=>{
 const s=await journeys(),body=await webQuote(s,webJourney(3,1,3));const k=key(),a=await s.reserve(fixture.tokens.p,k,body);assert.equal(a.bookings[0].priceBOB,'30.00');await admin.query('UPDATE nexo.fares SET amount_bob=99 WHERE id=$1',[body.quote.fareId]);const b=await s.reserve(fixture.tokens.p,k,body);assert.equal(a.bookings[0].bookingId,b.bookings[0].bookingId);assert.equal(b.bookings[0].priceBOB,'30.00');
 await rejects(s.reserve(fixture.tokens.p,key(),body),/QUOTE_CHANGED/);await rejects(s.reserve(fixture.tokens.p,k,{...body,seats:2}),/IDEMPOTENCY_CONFLICT/);
});
test('W06: passed pickup, revoked driver and inactive sessions cannot create or accept browser reservations',async()=>{
 const s=await journeys(),full=await fixed(6);await acceptAll(full);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await api.progress(fixture.tokens.d0,key(),fixture.trips[0],1);
 const body=await webQuote(s,{...webJourney(),flow:'ENROUTE'});await rejects(s.reserve(fixture.tokens.p,key(),body),/PICKUP_PASSED_OR_INCOMPATIBLE/);
 await admin.query("UPDATE nexo.sessions SET revoked_at=clock_timestamp()WHERE user_id=$1",[fixture.p]);await rejects(s.list(fixture.tokens.p),/UNAUTHENTICATED/);
});
async function browserLogin(web,loginName='browser.ficticio'){
 await identity.register({login:loginName,password});const initial=await fetch(web.url+'/api/session');const anon=await initial.json(),cookie=initial.headers.get('set-cookie').split(';')[0];
 const r=await postJson(web.url,'/api/login',{login:loginName,password},{Origin:web.url,Cookie:cookie,'X-CSRF-Token':anon.csrf});assert.equal(r.status,200);
 return{cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.csrf,anonCookie:cookie,anonCsrf:anon.csrf,login:loginName};
}
test('W07: browser login rotates handle/CSRF, HttpOnly cookie hides SQL token and logout revokes copied cookie',async()=>{
 const web=await startWebGateway({pool,identityPool,catalogToken:fixture.tokens.other,localTest:true});try{
  const a=await browserLogin(web);assert.notEqual(a.cookie,a.anonCookie);assert.notEqual(a.csrf,a.anonCsrf);
  let r=await fetch(web.url+'/api/passenger/bookings',{headers:{Cookie:a.cookie}});assert.equal(r.status,200);assert.deepEqual((await r.json()).bookings,[]);
  r=await fetch(web.url+'/api/session',{headers:{Cookie:a.cookie}});const session=await r.json();assert.equal(session.authenticated,true);assert.ok(!('token'in session));
  assert.equal((await postJson(web.url,'/api/logout',{}, {Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.anonCsrf})).status,403);
  assert.equal((await postJson(web.url,'/api/logout',{}, {Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.csrf})).status,200);
  assert.equal((await fetch(web.url+'/api/passenger/bookings',{headers:{Cookie:a.cookie}})).status,401);
 }finally{await web.close();}
});
test('W08: cross-origin/CSRF writes, forged identity, expired and SQL-revoked browser sessions are denied',async()=>{
 const web=await startWebGateway({pool,identityPool,catalogToken:fixture.tokens.other,localTest:true});try{
  const a=await browserLogin(web);const headers={Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.csrf};
  assert.equal((await postJson(web.url,'/api/reservations',webJourney(),{...headers,Origin:'https://external.invalid'})).status,403);
  assert.equal((await postJson(web.url,'/api/reservations',webJourney(),{Origin:web.url,Cookie:a.cookie})).status,403);
  assert.equal((await postJson(web.url,'/api/reservations/quote',{...webJourney(),userId:fixture.p},headers)).status,400);
  const user=(await admin.query('SELECT user_id FROM nexo.identity_accounts WHERE login_key=$1',[a.login])).rows[0].user_id;await admin.query("UPDATE nexo.sessions SET expires_at=clock_timestamp()-interval '1 second'WHERE user_id=$1",[user]);
  assert.equal((await fetch(web.url+'/api/passenger/bookings',{headers:{Cookie:a.cookie}})).status,401);
 }finally{await web.close();}
});
test('W09: two different passengers race for the final seat, with exactly one persistent winner',async()=>{
 const s=await journeys(),fill=await fixed(5);await acceptAll(fill);const body=await webQuote(s,webJourney());const r=await Promise.allSettled([s.reserve(fixture.tokens.p,key(),body),s.reserve(fixture.tokens.other,key(),body)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.match(r.find(x=>x.status==='rejected').reason.message,/NO_CAPACITY/);assert.ok((await occupancy()).every(x=>x.used<=6));
});
test('W10: driver membership revocation blocks legitimate offers without changing the reservation or inventing confirmation',async()=>{
 const s=await journeys(),r=await s.reserve(fixture.tokens.p,key(),await webQuote(s,webJourney())),id=r.bookings[0].bookingId;await admin.query("UPDATE nexo.memberships SET active=false WHERE user_id=$1 AND role='DRIVER'",[fixture.drivers[0]]);await rejects(s.accept(fixture.tokens.d0,key(),{bookingId:id,confirmed:true}),/FORBIDDEN|OPERATION_BLOCKED/);assert.equal((await s.list(fixture.tokens.p)).bookings[0].status,'HELD');
});
test('W11: additive 023 upgrades a populated 001-022 database without rewriting any previous table',async()=>{
 const g=await individualFixture(2);const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));const target=new URL(url);target.pathname='/'+name;const db=new pg.Client({connectionString:target.href});await db.connect();
 try{const dir=await mkdtemp(resolve('.local','stage3-web-migrations-'));const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'023'ORDER BY name")).rows.map(x=>x.name);for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,22);
 const tables=['users','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers','route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','booking_members','assignment_episodes','assignment_outcomes','booking_contracts'];
 await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER capture_booking_contract;ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings DISABLE TRIGGER assignment_tracking');for(const t of tables)for(const row of(await admin.query('SELECT * FROM nexo.'+t)).rows){const cols=Object.keys(row);await db.query(`INSERT INTO nexo.${t}(${cols.map(x=>db.escapeIdentifier(x)).join(',')})OVERRIDING SYSTEM VALUE VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER capture_booking_contract;ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings ENABLE TRIGGER assignment_tracking');
 const all=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='nexo'ORDER BY tablename")).rows.map(x=>x.tablename),snapshot=async()=>{const r={};for(const t of all)r[t]=(await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(t)+' x ORDER BY to_jsonb(x)::text')).rows;return r;};const before=await snapshot();assert.deepEqual(await migrate(db),['023_web_journeys.sql','024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);
 await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.p]);assert.equal((await db.query('SELECT nexo.passenger_reservations()AS r')).rows[0].r.bookings[0].bookingId,g.bookingIds[0]);
 }finally{await db.end();}
});

const operations=async()=> (await import('../../src/db/web-operations-service.mjs')).createWebOperationsService(pool);
const opSnapshot=(s,token=fixture.tokens.d0,view='DRIVER',tripId=fixture.trips[0])=>s.snapshot(token,{view,tripId});
const opBody=(kind,b={})=>({kind,confirmed:true,...b});
async function observeBody(id,more={}){const b=(await admin.query('SELECT * FROM nexo.bookings WHERE id=$1',[id])).rows[0];return opBody('BOARD',{bookingId:id,tripId:b.trip_id,episode:0,seats:b.seats,alightingPointId:b.route_id+':'+b.to_stop,...more});}
test('O01: operational overviews enforce driver ownership, association and restricted terminal grants',async()=>{
 const s=await operations();assert.equal((await s.overview(fixture.tokens.d0,{view:'DRIVER'})).trips.length,1);assert.equal((await s.overview(fixture.tokens.adminA,{view:'ADMIN'})).trips.length,3);
 await rejects(s.overview(fixture.tokens.p,{view:'ADMIN'}),/FORBIDDEN/);await rejects(opSnapshot(s,fixture.tokens.d3),/FORBIDDEN/);await rejects(opSnapshot(s,fixture.tokens.adminB,'ADMIN'),/FORBIDDEN/);
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[]]);assert.equal((await s.overview(fixture.tokens.adminA,{view:'ADMIN'})).trips.length,0);await rejects(opSnapshot(s,fixture.tokens.adminA,'ADMIN'),/FORBIDDEN_SCOPE/);
});
test('O02: passenger projection contains only own members and presence, never another group or identity',async()=>{
 const a=await fixed(2),b=await fixed(2,0,{source:'APP'});await acceptAll(a);await acceptAll(b);await admin.query('UPDATE nexo.bookings SET passenger_id=$1 WHERE id=$2',[fixture.other,b.bookingIds[0]]);const s=await operations(),snapshot=await opSnapshot(s,fixture.tokens.p,'PASSENGER');assert.equal(snapshot.bookings.length,1);assert.equal(snapshot.bookings[0].bookingId,a.bookingIds[0]);assert.equal(snapshot.confirmedSeats,4);
 const text=JSON.stringify(snapshot);for(const value of[b.bookingIds[0],fixture.other,fixture.adminA,fixture.drivers[0],fixture.tokens.p,'responsibleId','actor_id','password'])assert.ok(!text.includes(value));
 await rejects(opSnapshot(s,fixture.tokens.other,'PASSENGER',fixture.trips[1]),/FORBIDDEN/);
});
test('O03: arrival and verification stay separate; four terminal boards plus two urban pickups complete a driver-controlled trip',async()=>{
 const a=await fixed(4),pickup=await fixed(2,0,{from:1});await acceptAll(a);await acceptAll(pickup);await admin.query("INSERT INTO nexo.web_point_profiles VALUES($1,$2,1,'URBAN',true)",[fixture.A,fixture.ra]);const s=await operations();let snapshot=await opSnapshot(s);assert.equal(snapshot.status,'QUEUED');assert.equal(snapshot.departureEligible,true);assert.equal(snapshot.observedOnboard,0);assert.equal((await admin.query('SELECT departed_at FROM nexo.trips WHERE id=$1',[fixture.trips[0]])).rows[0].departed_at,null);
 await s.command(fixture.tokens.p,key(),opBody('ARRIVED',{bookingId:a.bookingIds[0],episode:0}));snapshot=await opSnapshot(s);assert.equal(snapshot.bookings[0].presence.declaredActive,true);assert.equal(snapshot.bookings[0].presence.verified,false);
 await s.command(fixture.tokens.adminA,key(),opBody('VERIFY',{bookingId:a.bookingIds[0],episode:0}));assert.equal((await opSnapshot(s)).bookings[0].presence.verified,true);
 await s.command(fixture.tokens.adminA,key(),await observeBody(a.bookingIds[0]));assert.equal((await opSnapshot(s)).observedOnboard,4);
 await rejects(s.command(fixture.tokens.adminA,key(),opBody('DEPART',{tripId:fixture.trips[0]})),/FORBIDDEN/);
 await rejects(s.command(fixture.tokens.d0,key(),opBody('BEGIN_COLLECTION',{tripId:fixture.trips[0],pointId:fixture.ra+':2'})),/INVALID_URBAN_STATE/);await s.command(fixture.tokens.d0,key(),opBody('BEGIN_COLLECTION',{tripId:fixture.trips[0],pointId:fixture.ra+':1'}));snapshot=await opSnapshot(s);assert.equal(snapshot.phase,'URBAN_COLLECTION');assert.equal(snapshot.observedOnboard,4);assert.equal(snapshot.confirmedSeats,6);
 await s.command(fixture.tokens.d0,key(),opBody('PROGRESS',{tripId:fixture.trips[0],pointId:fixture.ra+':1'}));snapshot=await opSnapshot(s);await rejects(s.command(fixture.tokens.d0,key(),opBody('MAIN_START',{tripId:fixture.trips[0],version:snapshot.version})),/PICKUPS_PENDING/);
 await s.command(fixture.tokens.d0,key(),await observeBody(pickup.bookingIds[0]));snapshot=await opSnapshot(s);assert.equal(snapshot.observedOnboard,6);await s.command(fixture.tokens.d0,key(),opBody('MAIN_START',{tripId:fixture.trips[0],version:snapshot.version}));assert.equal((await opSnapshot(s)).phase,'MAIN_TRIP');
 await s.command(fixture.tokens.d0,key(),opBody('PROGRESS',{tripId:fixture.trips[0],pointId:fixture.ra+':3'}));assert.equal((await opSnapshot(s)).status,'COMPLETED');for(const g of[a,pickup])await s.command(fixture.tokens.d0,key(),await observeBody(g.bookingIds[0],{kind:'ALIGHT'}));assert.equal((await opSnapshot(s)).observedOnboard,0);assert.equal((await admin.query('SELECT * FROM nexo.simulated_payments')).rowCount,0);
});
test('O04: concurrent observation retries record one fact and reject stale assignment or foreign point payloads',async()=>{
 const g=await individualFixture(3),s=await operations(),body=await observeBody(g.bookingIds[0]),k=key();await rejects(s.command(fixture.tokens.d0,key(),{...body,episode:1}),/STALE_ASSIGNMENT/);await rejects(s.command(fixture.tokens.d0,key(),{...body,alightingPointId:fixture.rb+':3'}),/INVALID_AUTHORIZED_POINTS/);
 await Promise.all([s.command(fixture.tokens.d0,k,body),s.command(fixture.tokens.d0,k,body)]);assert.equal((await admin.query("SELECT * FROM nexo.effective_movements WHERE booking_id=$1 AND kind='BOARD'",[g.bookingIds[0]])).rowCount,1);assert.equal((await opSnapshot(s)).observedOnboard,3);await rejects(s.command(fixture.tokens.d0,k,{...body,seats:2}),/IDEMPOTENCY_CONFLICT/);
});
test('O05: individual observation cannot mix aggregate history, exceed six physical seats or use the wrong stop',async()=>{
 const g=await individualFixture(2),s=await operations(),body=await observeBody(g.bookingIds[0]),members=(await business().roster(fixture.tokens.d0,g.bookingIds[0])).members;
 await s.command(fixture.tokens.d0,key(),{...body,memberId:members[0].id});await rejects(s.command(fixture.tokens.d0,key(),body),/INDIVIDUAL_HISTORY_ONLY/);await rejects(s.command(fixture.tokens.d0,key(),{...body,kind:'ALIGHT',memberId:members[0].id}),/INVALID_MOVEMENT_STATE/);await s.command(fixture.tokens.d0,key(),{...body,memberId:members[1].id});assert.equal((await opSnapshot(s)).observedOnboard,2);
});
test('O06: revoked sessions, driver and terminal grants block web operations without changing the declaration',async()=>{
 const g=await individualFixture(2),id=g.bookingIds[0],s=await operations();await s.command(fixture.tokens.p,key(),opBody('ARRIVED',{bookingId:id,episode:0}));await admin.query("UPDATE nexo.sessions SET revoked_at=clock_timestamp()WHERE user_id=$1",[fixture.p]);await rejects(opSnapshot(s,fixture.tokens.p,'PASSENGER'),/UNAUTHENTICATED/);
 await admin.query("UPDATE nexo.memberships SET active=false WHERE user_id=$1 AND role='DRIVER'",[fixture.drivers[0]]);await rejects(s.command(fixture.tokens.d0,key(),await observeBody(id)),/FORBIDDEN/);
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[]]);await rejects(s.command(fixture.tokens.adminA,key(),await observeBody(id)),/FORBIDDEN/);
});
test('O07: incidents block departure without cancellation, money or notifications and require the proper administrator',async()=>{
 const g=await individualFixture(6),s=await operations();await s.command(fixture.tokens.d0,key(),opBody('REPORT_TERMINAL',{tripId:fixture.trips[0],reason:'MECHANICAL_FAILURE'}));let snapshot=await opSnapshot(s);assert.equal(snapshot.operationAllowed,false);assert.equal(snapshot.bookings[0].status,'CONFIRMED');await rejects(s.command(fixture.tokens.adminB,key(),opBody('CONFIRM_TERMINAL',{tripId:fixture.trips[0],reason:'MECHANICAL_FAILURE'})),/FORBIDDEN/);
 await s.command(fixture.tokens.adminA,key(),opBody('CONFIRM_TERMINAL',{tripId:fixture.trips[0],reason:'MECHANICAL_FAILURE'}));await rejects(s.command(fixture.tokens.d0,key(),opBody('DEPART',{tripId:fixture.trips[0]})),/OPERATION_BLOCKED/);snapshot=await opSnapshot(s);assert.equal(snapshot.incident.state,'CONFIRMED');assert.equal(snapshot.automaticCancellation,false);assert.equal(snapshot.delivery,'DISABLED');
});
test('O08: HTTP operations require session, CSRF and native authorization rather than a browser role',async()=>{
 const web=await startWebGateway({pool,identityPool,catalogToken:fixture.tokens.other,localTest:true});try{
  assert.equal((await postJson(web.url,'/api/operations/overview',{view:'ADMIN'},{Origin:web.url})).status,403);const a=await browserLogin(web,'web.operations'),headers={Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.csrf};
  assert.equal((await postJson(web.url,'/api/operations/overview',{view:'ADMIN'},headers)).status,403);assert.equal((await postJson(web.url,'/api/operations/snapshot',{view:'PASSENGER',tripId:fixture.trips[0]},headers)).status,403);
  assert.equal((await postJson(web.url,'/api/operations/command',opBody('DEPART',{tripId:fixture.trips[0],role:'DRIVER'}),{...headers,'Idempotency-Key':key()})).status,400);
 }finally{await web.close();}
});
test('O09: named points have explicit offline types only; unknown old stops remain unclassified and profiles are not writable',async()=>{
 await namedLocalities();const service=(await import('../../src/db/web-catalog-service.mjs')).createWebCatalogService(pool,fixture.tokens.other);let points=await service.points({routeId:fixture.ra});assert.ok(points.every(p=>p.kind==='UNCLASSIFIED'));
 await admin.query("INSERT INTO nexo.web_point_profiles VALUES($1,$2,0,'TERMINAL',false),($1,$2,1,'URBAN',true),($1,$2,2,'ROAD',false)",[fixture.A,fixture.ra]);points=await service.points({routeId:fixture.ra});assert.deepEqual(points.map(p=>p.kind),['TERMINAL','URBAN','ROAD','UNCLASSIFIED']);await rejects(sql(fixture.tokens.adminA,"UPDATE nexo.web_point_profiles SET kind='ROAD'"),/permission denied/);assert.equal((await opSnapshot(await operations())).mainPointId,fixture.ra+':1');await closure('route-condition',{routeId:fixture.ra,state:'DESVIO',reason:'BLOCKADE',description:'Punto ficticio temporalmente inhabilitado',affectedStops:[1],confirmed:true});points=await service.points({routeId:fixture.ra});assert.equal(points[1].boardingAllowed,false);assert.equal(points[1].alightingAllowed,false);
});
test('O10: boarding and progress serialize at an urban pickup without inventing movements, with one physical inventory',async()=>{
 const run=await cityRun({busyB:false}),s=await operations(),body=await observeBody(run.pickup.bookingIds[0]);const outcomes=await Promise.allSettled([s.command(fixture.tokens.d0,key(),opBody('PROGRESS',{tripId:run.trip,pointId:fixture.ra+':1'})),s.command(fixture.tokens.d0,key(),body)]);assert.equal(outcomes[0].status,'fulfilled');if(outcomes[1].status==='rejected'){assert.match(outcomes[1].reason.message,/INVALID_MOVEMENT_STATE/);await s.command(fixture.tokens.d0,key(),body);}assert.equal((await opSnapshot(s)).observedOnboard,6);assert.ok((await occupancy()).every(x=>x.used<=6));
});
test('O11: populated increment-2 database upgrades from 023 to 024 preserving every historical table and price',async()=>{
 const g=await individualFixture(2);const name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));const target=new URL(url);target.pathname='/'+name;const db=new pg.Client({connectionString:target.href});await db.connect();try{
  const dir=await mkdtemp(resolve('.local','stage3-operation-migrations-'));const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'024'ORDER BY name")).rows.map(x=>x.name);for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,23);
  const tables=['users','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers','route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','booking_members','assignment_episodes','assignment_outcomes','booking_contracts'];
  await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings DISABLE TRIGGER assignment_tracking;ALTER TABLE nexo.bookings DISABLE TRIGGER capture_booking_contract');for(const t of tables)for(const row of(await admin.query('SELECT * FROM nexo.'+t)).rows){const cols=Object.keys(row);await db.query(`INSERT INTO nexo.${t}(${cols.map(x=>db.escapeIdentifier(x)).join(',')})OVERRIDING SYSTEM VALUE VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings ENABLE TRIGGER assignment_tracking;ALTER TABLE nexo.bookings ENABLE TRIGGER capture_booking_contract');
  const old=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='nexo'ORDER BY tablename")).rows.map(x=>x.tablename);const snapshot=async()=>{const r={};for(const t of old)r[t]=(await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(t)+' x ORDER BY to_jsonb(x)::text')).rows;return r;};const before=await snapshot();assert.deepEqual(await migrate(db),['024_web_operations.sql','025_web_recovery_reads.sql','026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.p]);const own=(await db.query("SELECT nexo.web_trip_snapshot($1,'PASSENGER')AS r",[fixture.trips[0]])).rows[0].r;assert.equal(own.bookings[0].bookingId,g.bookingIds[0]);assert.equal(own.bookings[0].priceBOB,'20.00');assert.ok(own.points.every(p=>p.kind==='UNCLASSIFIED'));assert.equal(own.mainPointId,null);
 }finally{await db.end();}
});
test('O12: an expired declaration remains visible as history, without renewing presence or cancelling seats',async()=>{
 const g=await individualFixture(2),id=g.bookingIds[0],s=await operations();await admin.query("INSERT INTO nexo.episode_terminal_events(association_id,booking_id,episode,trip_id,kind,actor_id,created_at,expires_at)VALUES($1,$2,0,$3,'DECLARED',$4,clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '1 minute')",[fixture.A,id,fixture.trips[0],fixture.p]);let snapshot=await opSnapshot(s,fixture.tokens.p,'PASSENGER');assert.equal(snapshot.bookings[0].presence.declarationRecorded,true);assert.equal(snapshot.bookings[0].presence.declaredActive,false);assert.equal(snapshot.bookings[0].status,'CONFIRMED');assert.equal(snapshot.segments[0].reserved,2);await s.command(fixture.tokens.adminA,key(),opBody('VERIFY',{bookingId:id,episode:0}));snapshot=await opSnapshot(s,fixture.tokens.p,'PASSENGER');assert.equal(snapshot.bookings[0].presence.verified,true);assert.equal(snapshot.automaticCancellation,false);
});

const recoveries=async()=>(await import('../../src/db/web-recovery-service.mjs')).createWebRecoveryService(pool);
const recoveryBody=(kind,b)=>({kind,confirmed:true,...b});
test('R01: recovery passenger metadata excludes foreign groups, identities and raw rescue manifests',async()=>{
 const a=await individualFixture(3),other=await fixed(1);await acceptAll(other);await admin.query('UPDATE nexo.bookings SET passenger_id=$1 WHERE id=$2',[fixture.other,other.bookingIds[0]]);
 const r=await recoveries(),p=await r.passenger(fixture.tokens.p,{bookingId:a.bookingIds[0]});assert.equal(p.groupSeats,3);assert.equal(p.vehicle,'FICTICIO-0');assert.equal(p.status,'CONFIRMED');
 const text=JSON.stringify(p);for(const hidden of[other.bookingIds[0],fixture.other,fixture.p,fixture.drivers[0],'responsibleId','snapshot','manifest','password_hash'])assert.ok(!text.includes('"'+hidden+'"'));
 await rejects(r.passenger(fixture.tokens.p,{bookingId:other.bookingIds[0]}),/FORBIDDEN/);await rejects(r.passenger(fixture.tokens.adminA,{bookingId:a.bookingIds[0]}),/FORBIDDEN/);
 for(const view of['ADMIN','DRIVER'])await rejects(r.overview(fixture.tokens.p,{view}),/FORBIDDEN/);
});
test('R02: terminal recovery uses native consent and atomic relocation even for concurrent duplicate receipts',async()=>{
 const x=await terminalIncident(),r=await recoveries(),id=x.g.bookingIds[0],before=await x.b.booking(fixture.tokens.p,id);
 let d=await r.detail(fixture.tokens.adminA,{incidentId:x.incidentId});assert.equal(d.candidates[0].tripId,fixture.trips[1]);assert.equal(d.consents.length,0);
 const consent=await r.command(fixture.tokens.p,key(),recoveryBody('GROUP_CONSENT',{bookingId:id,targetTripId:fixture.trips[1],episode:0}));d=await r.detail(fixture.tokens.adminA,{incidentId:x.incidentId});assert.equal(d.consents[0].consentId,consent.consentId);
 const body=recoveryBody('TERMINAL_REASSIGN',{incidentId:x.incidentId,targetTripId:fixture.trips[1],consentIds:[consent.consentId],safeTransfer:false}),k=key();
 const rs=await Promise.allSettled(Array.from({length:6},()=>r.command(fixture.tokens.adminA,k,body)));for(const q of rs)assert.equal(q.status,'fulfilled',q.reason?.message);
 const after=await x.b.booking(fixture.tokens.p,id);assert.equal(after.trip_id,fixture.trips[1]);assert.equal(after.price_bob,before.price_bob);assert.deepEqual(after.members,before.members);assert.equal(after.status,'CONFIRMED');
 const p=await r.passenger(fixture.tokens.p,{bookingId:id});assert.equal(p.vehicle,'FICTICIO-1');assert.equal(p.episode,1);assert.equal(p.incidents[0].state,'TRANSFERRED');assert.equal(p.consents[0].used,true);const historical=await r.detail(fixture.tokens.adminA,{incidentId:x.incidentId});assert.deepEqual(historical.affectedBookings.map(b=>b.bookingId),[id]);assert.equal(historical.affectedBookings[0].vehicle,'FICTICIO-1');
 assert.equal((await admin.query("SELECT * FROM nexo.journey_events WHERE kind='TERMINAL_REASSIGNED'")).rowCount,1);assert.ok((await occupancy()).every(s=>s.used<=6));
});
test('R03: ordinary web transfer needs whole-group consent and administrative approval',async()=>{
 const g=await individualFixture(4),r=await recoveries(),id=g.bookingIds[0];const c=await r.command(fixture.tokens.p,key(),recoveryBody('GROUP_CONSENT',{bookingId:id,targetTripId:fixture.trips[1],episode:0}));
 const body=recoveryBody('APPROVE_TRANSFER',{consentId:c.consentId});await rejects(r.command(fixture.tokens.p,key(),body),/FORBIDDEN/);assert.equal((await r.transfer(fixture.tokens.adminA,{bookingId:id})).consents.length,1);
 await r.command(fixture.tokens.adminA,key(),body);assert.equal((await r.passenger(fixture.tokens.p,{bookingId:id})).tripId,fixture.trips[1]);const ownList=(await(await journeys()).list(fixture.tokens.p)).bookings;assert.equal(ownList[0].confirmationAuthority,'ADMIN_APPROVED');assert.equal(ownList[0].driverAccepted,false);assert.equal((await admin.query('SELECT * FROM nexo.bookings')).rowCount,1);
 await rejects(r.command(fixture.tokens.adminA,key(),body),/CONSENT_USED/);await rejects(r.transfer(fixture.tokens.adminB,{bookingId:id}),/FORBIDDEN/);await business().terminalImpediment(fixture.tokens.d0,key(),fixture.trips[0],'REPORT','MECHANICAL_FAILURE',true);assert.deepEqual((await r.passenger(fixture.tokens.p,{bookingId:id})).incidents,[]);
});
test('R04: urban rescue exposes own former-driver history and requires exact safe transfer from the new driver',async()=>{
 const run=await cityRun({busyB:false}),state=await confirmBreakdown(run),r=await recoveries();const d=await r.detail(fixture.tokens.adminA,{incidentId:state.incidentId});assert.equal(d.candidates[0].tripId,fixture.trips[1]);
 const body=recoveryBody('ASSIGN_URBAN',{tripId:run.trip,version:state.version,targetTripId:fixture.trips[1]});await rejects(r.command(fixture.tokens.d0,key(),body),/FORBIDDEN/);
 const results=await Promise.allSettled([r.command(fixture.tokens.adminA,key(),body),r.command(fixture.tokens.adminA,key(),body)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/STALE_OPERATION/);
 const history=await r.overview(fixture.tokens.d0,{view:'DRIVER'});assert.equal(history.incidents.length,1);assert.equal(history.incidents[0].currentDriver,false);assert.equal(history.incidents[0].currentVehicle,'FICTICIO-1');assert.ok(!JSON.stringify(history).includes(run.pickup.bookingIds[0]));
 const op=await run.b.operationalStatus(fixture.tokens.d1,run.trip),safe=recoveryBody('SAFE_URBAN',{tripId:run.trip,version:op.version,onboard:5});await rejects(r.command(fixture.tokens.d1,key(),safe),/INVALID_SAFE_TRANSFER/);await rejects(r.command(fixture.tokens.d0,key(),{...safe,onboard:4}),/FORBIDDEN/);
 await r.command(fixture.tokens.d1,key(),{...safe,onboard:4});assert.equal((await run.b.operationalStatus(fixture.tokens.d1,run.trip)).phase,'URBAN_COLLECTION');assert.equal((await admin.query("SELECT * FROM nexo.effective_movements WHERE kind='BOARD'")).rowCount,1);
 const current=await run.b.operationalStatus(fixture.tokens.d1,run.trip),second=await run.b.fleetCommand(fixture.tokens.d1,key(),run.trip,current.version,'REPORT',null,null,true);const former=await r.overview(fixture.tokens.d0,{view:'DRIVER'});assert.equal(former.incidents.length,1);assert.deepEqual(former.incidents[0].operation,{phase:'ASSIGNMENT_CHANGED'});assert.ok(!JSON.stringify(former).includes(second.incidentId));
});
test('R05: road rescue respects terminal scope, current driver authority and stable reservation history',async()=>{
 const x=await roadIncident(),reverse=await reverseQueue(),r=await recoveries(),id=x.g.bookingIds[0],before=await x.b.booking(fixture.tokens.p,id);
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[fixture.ra]]);let d=await r.detail(fixture.tokens.adminA,{incidentId:x.state.incidentId,priority:'DESTINATION'});assert.ok(d.candidates.every(c=>c.tripId!==fixture.trips[1]));
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[fixture.ra,reverse]]);d=await r.detail(fixture.tokens.adminA,{incidentId:x.state.incidentId,priority:'DESTINATION'});assert.equal(d.candidates[0].tripId,fixture.trips[1]);assert.equal(d.candidates[0].terminal,'DESTINATION');
 const body=recoveryBody('ASSIGN_ROAD',{tripId:fixture.trips[0],version:x.state.version,targetTripId:fixture.trips[1],priority:'DESTINATION'});await rejects(r.command(fixture.tokens.d0,key(),body),/FORBIDDEN/);await rejects(r.detail(fixture.tokens.adminB,{incidentId:x.state.incidentId}),/FORBIDDEN/);
 await r.command(fixture.tokens.adminA,key(),body);const op=await x.b.operationalStatus(fixture.tokens.d1,fixture.trips[0]);assert.equal(op.phase,'ROAD_RESCUE');await r.command(fixture.tokens.d1,key(),recoveryBody('SAFE_ROAD',{tripId:fixture.trips[0],version:op.roadRescue.version,onboard:6}));
 const after=await x.b.booking(fixture.tokens.p,id);assert.equal(after.trip_id,before.trip_id);assert.equal(after.price_bob,before.price_bob);assert.deepEqual(after.members,before.members);assert.equal((await r.passenger(fixture.tokens.p,{bookingId:id})).vehicle,'FICTICIO-1');assert.equal((await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[1]])).rows[0].status,'WITHDRAWN');
});
test('R06: revoked sessions, memberships and terminal grants block recovery reads and operations',async()=>{
 const x=await terminalIncident(),r=await recoveries();await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[]]);await rejects(r.detail(fixture.tokens.adminA,{incidentId:x.incidentId}),/FORBIDDEN/);
 await admin.query("UPDATE nexo.memberships SET active=false WHERE user_id=$1 AND role='DRIVER'",[fixture.drivers[0]]);await rejects(r.overview(fixture.tokens.d0,{view:'DRIVER'}),/FORBIDDEN/);
 await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp()WHERE user_id=$1',[fixture.p]);await rejects(r.passenger(fixture.tokens.p,{bookingId:x.g.bookingIds[0]}),/UNAUTHENTICATED/);assert.equal((await admin.query('SELECT status FROM nexo.bookings WHERE id=$1',[x.g.bookingIds[0]])).rows[0].status,'CONFIRMED');
});
test('R07: recovery HTTP requires CSRF, strict schema and SQL-derived authority without arbitrary RPCs',async()=>{
 const web=await startWebGateway({pool,identityPool,catalogToken:fixture.tokens.other,localTest:true});try{const a=await browserLogin(web,'web.recovery'),headers={Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.csrf};
 assert.equal((await postJson(web.url,'/api/recovery/overview',{view:'ADMIN'},headers)).status,403);assert.equal((await postJson(web.url,'/api/recovery/overview',{view:'DRIVER'},{Origin:web.url,Cookie:a.cookie})).status,403);
 assert.equal((await postJson(web.url,'/api/recovery/command',recoveryBody('ASSIGN_ROAD',{tripId:fixture.trips[0],version:2,targetTripId:fixture.trips[1],priority:'ORIGIN',actorId:fixture.adminA}),{...headers,'Idempotency-Key':key()})).status,400);assert.equal((await postJson(web.url,'/api/recovery/passenger',{bookingId:randomUUID()},headers)).status,403);assert.equal((await postJson(web.url,'/api/recovery/sql',{},headers)).status,404);
 }finally{await web.close();}
});
test('R08: populated 024 upgrade preserves all rows and adds only minimal recovery read functions',async()=>{
 const g=await individualFixture(2),name='nexo_test_upgrade_'+randomBytes(6).toString('hex');await admin.query('CREATE DATABASE '+admin.escapeIdentifier(name));const target=new URL(url);target.pathname='/'+name;const db=new pg.Client({connectionString:target.href});await db.connect();try{
 const dir=await mkdtemp(resolve('.local','stage3-recovery-migrations-'));const files=(await admin.query("SELECT name FROM public.nexo_migrations WHERE name<'025'ORDER BY name")).rows.map(x=>x.name);for(const file of files)await writeFile(resolve(dir,file),await readFile(new URL('../../database/migrations/'+file,import.meta.url)));assert.equal((await migrate(db,pathToFileURL(dir+sep))).length,24);
 const tables=['users','sessions','associations','memberships','geo_catalogs','departments','provinces','municipalities','localities','routes','stops','operation_reviewers','route_authorizations','vehicles','trips','fares','bookings','actions','audit_events','booking_members','assignment_episodes','assignment_outcomes','booking_contracts'];
 await db.query('ALTER TABLE nexo.bookings DISABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings DISABLE TRIGGER assignment_tracking;ALTER TABLE nexo.bookings DISABLE TRIGGER capture_booking_contract');for(const t of tables)for(const row of(await admin.query('SELECT * FROM nexo.'+t)).rows){const cols=Object.keys(row);await db.query(`INSERT INTO nexo.${t}(${cols.map(x=>db.escapeIdentifier(x)).join(',')})OVERRIDING SYSTEM VALUE VALUES(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}await db.query('ALTER TABLE nexo.bookings ENABLE TRIGGER create_booking_members;ALTER TABLE nexo.bookings ENABLE TRIGGER assignment_tracking;ALTER TABLE nexo.bookings ENABLE TRIGGER capture_booking_contract');
 const old=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='nexo'ORDER BY tablename")).rows.map(x=>x.tablename),snapshot=async()=>{const r={};for(const t of old)r[t]=(await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(t)+' x ORDER BY to_jsonb(x)::text')).rows;return r;};const before=await snapshot();await writeFile(resolve(dir,'025_web_recovery_reads.sql'),await readFile(new URL('../../database/migrations/025_web_recovery_reads.sql',import.meta.url)));assert.deepEqual(await migrate(db,pathToFileURL(dir+sep)),['025_web_recovery_reads.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),['026_web_queue_return.sql']);assert.deepEqual(await snapshot(),before);assert.deepEqual(await migrate(db),[]);await db.query("SELECT set_config('nexo.session_token',$1,false)",[fixture.tokens.p]);const own=(await db.query('SELECT nexo.web_booking_recovery($1)AS r',[g.bookingIds[0]])).rows[0].r;assert.equal(own.status,'CONFIRMED');assert.equal(own.groupSeats,2);
 }finally{await db.end();await admin.query('DROP DATABASE '+admin.escapeIdentifier(name));}
});

const terminalWeb=()=>createWebTerminalService(pool);
const terminalBody=(kind,fields)=>({kind,confirmed:true,...fields});
const saleBody=(seats=2)=>({tripId:fixture.trips[0],boardingPointId:fixture.ra+':0',alightingPointId:fixture.ra+':3',seats});
async function quotedSale(s,seats=2){const b=saleBody(seats),q=await s.quote(fixture.tokens.adminA,b);return{...b,quote:{fareId:q.fareId,fareVersion:q.fareVersion,totalBOB:q.totalBOB},confirmed:true};}
test('Z01: administrative directory is scoped, paginated and counts simultaneous segments without passenger identities',async()=>{
 const s=terminalWeb();const g=await fixed(4);await acceptAll(g);
 const first=await s.directory(fixture.tokens.adminA,{limit:1});assert.equal(first.trips.length,1);assert.equal(first.hasMore,true);assert.equal(first.trips[0].confirmed,4);assert.equal(first.trips[0].reserved,4);assert.equal(first.trips[0].onboard,0);
 const a=await fixed(6,1,{from:0,to:1}),b=await fixed(6,1,{from:1,to:3});await acceptAll(a);await acceptAll(b);const disjoint=(await s.directory(fixture.tokens.adminA,{})).trips.find(t=>t.tripId===fixture.trips[1]);assert.equal(disjoint.reserved,6);assert.equal(disjoint.confirmed,6);assert.ok(!JSON.stringify(first).includes(fixture.p));const next=await s.directory(fixture.tokens.adminA,{limit:1,offset:1});assert.notEqual(first.trips[0].tripId,next.trips[0].tripId);
 await rejects(s.directory(fixture.tokens.p,{}),/FORBIDDEN/);await rejects(s.directory(fixture.tokens.d0,{}),/FORBIDDEN/);
 assert.equal((await s.directory(fixture.tokens.adminA,{routeId:fixture.rb})).trips.length,0);
 await provisionPool.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[fixture.adminA,fixture.A,[]]);assert.equal((await s.directory(fixture.tokens.adminA,{})).trips.length,0);
});
test('Z02: web walk-ins share APP inventory, preserve quoted amount and repeat one native receipt',async()=>{
 const s=terminalWeb(),q=await quotedSale(s,4),k=key();await rejects(s.walkIn(fixture.tokens.p,key(),q),/FORBIDDEN/);await rejects(s.saleContext(fixture.tokens.adminB,{tripId:fixture.trips[0]}),/FORBIDDEN/);
 const r=await s.walkIn(fixture.tokens.adminA,k,q),again=await s.walkIn(fixture.tokens.adminA,k,q);assert.deepEqual(again,r);assert.equal(r.initialStatus,'HELD');assert.equal(r.totalPriceBOB,'40.00');
 const b=await business().booking(fixture.tokens.adminA,r.bookingIds[0]);assert.equal(b.source,'WALK_IN');assert.equal(b.passenger_id,undefined);assert.equal((await admin.query('SELECT passenger_id FROM nexo.bookings WHERE id=$1',[r.bookingIds[0]])).rows[0].passenger_id,null);assert.equal(b.seats,4);
 const app=await api.reserve(fixture.tokens.p,key(),{routeId:fixture.ra,from:0,to:3,seats:2,parts:[{tripId:fixture.trips[0],seats:2}]});
 assert.equal((await s.directory(fixture.tokens.adminA,{})).trips[0].reserved,6);
 await rejects(s.walkIn(fixture.tokens.adminA,key(),await quotedSale(s,1)),/QUEUE_ORDER|NO_CAPACITY/);
 await api.respond(fixture.tokens.d0,key(),r.bookingIds[0],true);await acceptAll(app);await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);
 assert.deepEqual(await s.walkIn(fixture.tokens.adminA,k,q),r,'receipt survives departure');assert.equal((await business().booking(fixture.tokens.adminA,r.bookingIds[0])).price_bob,'40.00');
});
test('Z03: simultaneous APP and web terminal requests never commit more than six in the same segment',async()=>{
 const s=terminalWeb(),q=await quotedSale(s,4);
 const rs=await Promise.allSettled([s.walkIn(fixture.tokens.adminA,key(),q),api.reserve(fixture.tokens.p,key(),{routeId:fixture.ra,from:0,to:3,seats:4,parts:[{tripId:fixture.trips[0],seats:4}]})]);
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.match(rs.find(r=>r.status==='rejected').reason.message,/QUEUE_ORDER|NO_CAPACITY/);
 assert.equal((await s.directory(fixture.tokens.adminA,{})).trips[0].reserved,4);
});
test('Z04: own-group cancellation and driver rejection are explicit, atomic and cannot access foreign reservations',async()=>{
 const s=terminalWeb(),g=await fixed(4),id=g.bookingIds[0];
 await rejects(s.command(fixture.tokens.other,key(),terminalBody('CANCEL_BOOKING',{bookingId:id})),/FORBIDDEN/);
 await rejects(s.command(fixture.tokens.p,key(),terminalBody('REJECT_OFFER',{bookingId:id})),/FORBIDDEN/);
 const rejectKey=key();await s.command(fixture.tokens.d0,rejectKey,terminalBody('REJECT_OFFER',{bookingId:id}));await s.command(fixture.tokens.d0,rejectKey,terminalBody('REJECT_OFFER',{bookingId:id}));assert.equal((await business().booking(fixture.tokens.p,id)).status,'REJECTED');
 const h=await fixed(3);await acceptAll(h);const body=terminalBody('CANCEL_BOOKING',{bookingId:h.bookingIds[0]}),k=key();const rs=await Promise.all(Array.from({length:6},()=>s.command(fixture.tokens.p,k,body)));assert.ok(rs.every(r=>r.status==='CANCELLED'));
 assert.equal((await admin.query("SELECT count(*)::integer AS n FROM nexo.audit_events WHERE entity_id=$1 AND action='GROUP_CANCELLED'",[h.groupId])).rows[0].n,1);
 const onboard=await individualFixture(2);await business().terminalObservation(fixture.tokens.adminA,key(),onboard.bookingIds[0],null,'BOARD',2,3,true);await rejects(s.command(fixture.tokens.p,key(),terminalBody('CANCEL_BOOKING',{bookingId:onboard.bookingIds[0]})),/PASSENGERS_ONBOARD/);
});
test('Z05: voluntary destination return requires observed disembarkation and concurrent requests append exactly once',async()=>{
 const s=terminalWeb(),g=await individualFixture(),target=await reverseQueue();await api.depart(fixture.tokens.d0,key(),fixture.trips[0]);await business().movement(fixture.tokens.d0,key(),g.bookingIds[0],'BOARD');await api.progress(fixture.tokens.d0,key(),fixture.trips[0],3);
 const body=terminalBody('RETURN_QUEUE',{tripId:fixture.trips[0],routeId:target});assert.equal((await s.returnOptions(fixture.tokens.d0,{tripId:fixture.trips[0]})).reason,'ONBOARD_PENDING');
 await rejects(s.command(fixture.tokens.d0,key(),body),/PASSENGERS_ONBOARD/);await rejects(s.command(fixture.tokens.adminA,key(),body),/FORBIDDEN/);await rejects(s.command(fixture.tokens.d3,key(),body),/FORBIDDEN/);
 await business().movement(fixture.tokens.d0,key(),g.bookingIds[0],'ALIGHT');assert.equal((await s.returnOptions(fixture.tokens.d0,{tripId:fixture.trips[0]})).canReturn,true);
 const keys=[key(),key()],rs=await Promise.allSettled(keys.map(k=>s.command(fixture.tokens.d0,k,body)));assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.match(rs.find(r=>r.status==='rejected').reason.message,/ALREADY_ACTIVE/);
 const winner=rs.findIndex(r=>r.status==='fulfilled'),r=rs[winner].value;assert.equal(Number(r.position),3);await business().terminalImpediment(fixture.tokens.d0,key(),r.tripId,'REPORT','MECHANICAL_FAILURE',true);
 assert.deepEqual(await s.command(fixture.tokens.d0,keys[winner],body),r,'replay is retained even after a later incident');assert.deepEqual(await api.requestQueue(fixture.tokens.d0,keys[winner],fixture.trips[0],target),r);await admin.query("UPDATE nexo.memberships SET active=false WHERE user_id=$1 AND role='DRIVER'",[fixture.drivers[0]]);await rejects(s.command(fixture.tokens.d0,keys[winner],body),/FORBIDDEN/);
 assert.equal((await business().booking(fixture.tokens.p,g.bookingIds[0])).status,'COMPLETED');assert.equal((await admin.query('SELECT count(*)::integer AS n FROM nexo.trips WHERE route_id=$1',[target])).rows[0].n,2);
});
test('Z06: vehicle restoration uses native scope/repair rules, never dispatches or creates a replacement',async()=>{
 const x=await terminalIncident(),r=await recoveries();const details=await r.detail(fixture.tokens.adminA,{incidentId:x.incidentId});assert.equal(details.canRestore,true);assert.equal(details.originalVehicleBlocked,true);
 const body=recoveryBody('RESTORE_VEHICLE',{vehicleId:fixture.vehicles[0]});await rejects(r.command(fixture.tokens.d0,key(),body),/FORBIDDEN/);await rejects(r.command(fixture.tokens.adminB,key(),body),/FORBIDDEN/);
 const k=key();await r.command(fixture.tokens.adminA,k,body);await r.command(fixture.tokens.adminA,k,body);assert.equal((await r.detail(fixture.tokens.adminA,{incidentId:x.incidentId})).originalVehicleBlocked,false);
 assert.equal((await admin.query('SELECT status FROM nexo.trips WHERE id=$1',[fixture.trips[0]])).rows[0].status,'QUEUED');assert.equal((await admin.query("SELECT count(*)::integer AS n FROM nexo.fleet_events WHERE kind='VEHICLE_RESTORED'")).rows[0].n,1);await business().terminalObservation(fixture.tokens.adminA,key(),x.g.bookingIds[0],null,'BOARD',4,3,true);const later=await business().terminalImpediment(fixture.tokens.d0,key(),fixture.trips[0],'REPORT','MECHANICAL_FAILURE',true);assert.equal((await r.detail(fixture.tokens.adminA,{incidentId:later.incidentId})).canRestore,false);await rejects(r.command(fixture.tokens.adminA,key(),body),/INVALID_RECOVERY_STATE/);
});
test('Z07: every fixed private POST is CSRF guarded, public reads cannot select a mutation and revoked sessions stay denied',async()=>{
 const web=await startWebGateway({pool,identityPool,catalogToken:fixture.tokens.other,localTest:true});try{
 const initial=await fetch(web.url+'/api/session'),anon=await initial.json(),cookie=initial.headers.get('set-cookie').split(';')[0];
 for(const path of ['/api/login','/api/logout','/api/reservations','/api/reservations/quote','/api/operator/accept','/api/operations/overview','/api/operations/snapshot','/api/operations/command','/api/recovery/overview','/api/recovery/detail','/api/recovery/passenger','/api/recovery/transfer','/api/recovery/command','/api/terminal/directory','/api/terminal/sale-context','/api/terminal/quote','/api/terminal/walk-in','/api/terminal/return-options','/api/terminal/command']){
  const r=await postJson(web.url,path,{}, {Origin:web.url,Cookie:cookie});assert.equal(r.status,403,path);assert.equal(r.body.error,'CSRF_REQUIRED',path);
 }
 assert.equal((await postJson(web.url,'/api/terminal/command',{}, {Origin:web.url,Cookie:cookie,'X-CSRF-Token':anon.csrf})).status,401);
 for(const path of ['/api/terminal/constructor','/api/login/','/api/recovery/command?public=true'])assert.equal((await postJson(web.url,path,{}, {Origin:web.url,Cookie:cookie})).status,404);
 assert.equal((await postJson(web.url,'/api/localities',{query:'Ya'}, {Origin:web.url})).status,200);
 assert.equal((await postJson(web.url,'/api/localities',{kind:'RETURN_QUEUE'}, {Origin:web.url})).status,400);
 const a=await browserLogin(web,'terminal.revocation');await postJson(web.url,'/api/logout',{}, {Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.csrf});assert.equal((await postJson(web.url,'/api/terminal/directory',{}, {Origin:web.url,Cookie:a.cookie,'X-CSRF-Token':a.csrf})).status,403);
 }finally{await web.close();}
});
test('Z08: new return wrapper exposes no generic privileges and revoked sessions block reads and mutations',async()=>{
 const s=terminalWeb();await admin.query('UPDATE nexo.sessions SET revoked_at=clock_timestamp()WHERE user_id=$1',[fixture.drivers[0]]);await rejects(s.returnOptions(fixture.tokens.d0,{tripId:fixture.trips[0]}),/UNAUTHENTICATED/);
 await rejects(s.command(fixture.tokens.d0,key(),terminalBody('RETURN_QUEUE',{tripId:fixture.trips[0],routeId:fixture.ra})),/UNAUTHENTICATED/);
 const privileges=(await admin.query("SELECT has_function_privilege('nexo_app','nexo.web_request_queue(text,uuid,uuid)','EXECUTE')AS app,has_function_privilege('nexo_app','nexo.scope_core_restore_vehicle(text,uuid,boolean)','EXECUTE')AS internal")).rows[0];assert.equal(privileges.app,true);assert.equal(privileges.internal,false);
 const path=(await admin.query("SELECT proconfig FROM pg_proc WHERE oid='nexo.web_request_queue(text,uuid,uuid)'::regprocedure")).rows[0].proconfig;assert.ok(path.some(x=>x==='search_path=pg_catalog, nexo, pg_temp'));const acl=(await admin.query("SELECT EXISTS(SELECT FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a WHERE p.oid='nexo.web_request_queue(text,uuid,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')AS public")).rows[0];assert.equal(acl.public,false);
});
