import pg from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';

// Independent SQL witness, not a browser/API feature. Config arrives only through
// the fresh-cluster runner's private IPC, then the Playwright worker environment.
// No credentials, sessions or identity tables are included in evidence or traces.
export async function operationEvidence(project){
 const config=JSON.parse(process.env.NEXO_WEB_AUDIT_CONFIG??'null');
 if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||config?.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(config.database)||!Number.isInteger(config.port))throw new Error('FRESH_LOCAL_AUDIT_REQUIRED');
 const db=new pg.Client({...config,options:'-c default_transaction_read_only=on',application_name:'nexo-e2e-readonly-witness',query_timeout:5000});
 await db.connect();const steps=[];
 return{steps,close:()=>db.end(),async read(tripId){
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   if(tripId===undefined)tripId=(await db.query("SELECT t.id FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE v.label='FICTICIO-OPERATIVO'")).rows[0].id;
   const trip=(await db.query(`SELECT t.id,t.route_id,t.vehicle_id,t.driver_id,v.label AS vehicle,t.status,t.current_stop,t.departed_at,t.completed_at,v.capacity,
    r.phase,r.version,r.main_stop,r.main_started_at,nexo.observed_onboard(t.id) AS native_onboard,
    current_setting('transaction_read_only') AS read_only,current_setting('server_version') AS postgres
    FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id LEFT JOIN nexo.urban_runs r ON r.trip_id=t.id WHERE t.id=$1`,[tripId])).rows[0];
   const bookings=(await db.query(`SELECT b.id,b.trip_id,b.route_id,b.group_id,b.source,b.seats,b.from_stop,b.to_stop,b.status,b.price_bob,b.fare_id,b.fare_version,
    (SELECT count(*)::integer FROM nexo.booking_members m WHERE m.booking_id=b.id) AS members,
    (SELECT array_agg(m.id ORDER BY m.ordinal) FROM nexo.booking_members m WHERE m.booking_id=b.id) AS member_ids
    FROM nexo.bookings b WHERE b.trip_id=$1 ORDER BY b.from_stop,b.id`,[tripId])).rows;
   const movements=(await db.query(`SELECT m.booking_id,m.member_id,m.kind,m.stop_index,u.label AS actor
    FROM nexo.effective_movements m JOIN nexo.bookings b ON b.id=m.booking_id JOIN nexo.users u ON u.id=m.actor_id
    WHERE b.trip_id=$1 ORDER BY m.created_at,m.fact_key`,[tripId])).rows;
   const segments=(await db.query(`SELECT s.stop_index,
    coalesce(sum(b.seats)FILTER(WHERE b.status='CONFIRMED'),0)::integer AS confirmed,
    coalesce(sum(b.seats)FILTER(WHERE nexo.live(b)),0)::integer AS reserved
    FROM nexo.stops s LEFT JOIN nexo.bookings b ON b.route_id=s.route_id AND b.trip_id=$1 AND b.from_stop<=s.stop_index AND b.to_stop>s.stop_index
    WHERE s.route_id=$2 AND s.stop_index<3 GROUP BY s.stop_index ORDER BY s.stop_index`,[tripId,trip.route_id])).rows;
   const events=(await db.query(`SELECT e.kind,e.booking_id,u.label AS actor FROM nexo.terminal_timeline e JOIN nexo.users u ON u.id=e.actor_id WHERE e.trip_id=$1 ORDER BY e.created_at,e.serial,e.id`,[tripId])).rows;
   const audits=(await db.query(`SELECT e.action,e.entity_id,u.label AS actor FROM nexo.audit_events e JOIN nexo.users u ON u.id=e.actor_id
    WHERE e.entity_id=$1 OR e.entity_id IN(SELECT id FROM nexo.bookings WHERE trip_id=$1) ORDER BY e.created_at,e.id`,[tripId])).rows;
   const fleet=(await db.query('SELECT kind FROM nexo.fleet_events WHERE trip_id=$1 ORDER BY created_at,id',[tripId])).rows;
   const incidents=(await db.query(`SELECT f.id,f.context,f.state,f.original_vehicle,f.replacement_vehicle,f.replacement_queue_trip,r.phase AS road_phase,r.version AS road_version FROM nexo.fleet_incidents f LEFT JOIN nexo.road_rescues r ON r.incident_id=f.id WHERE f.trip_id=$1 ORDER BY f.created_at,f.id`,[tripId])).rows;
   const journey=(await db.query('SELECT kind FROM nexo.journey_events WHERE trip_id=$1 ORDER BY created_at,id',[tripId])).rows;
   const onboard=movements.filter(m=>m.kind==='BOARD'&&!movements.some(a=>a.kind==='ALIGHT'&&a.booking_id===m.booking_id&&a.member_id===m.member_id))
    .reduce((n,m)=>n+(m.member_id?1:bookings.find(b=>b.id===m.booking_id).seats),0);
   expect(trip.read_only).toBe('on');expect(trip.capacity).toBe(6);expect(onboard).toBe(trip.native_onboard);expect(onboard).toBeGreaterThanOrEqual(0);expect(onboard).toBeLessThanOrEqual(6);
   for(const s of segments){expect(s.reserved).toBeGreaterThanOrEqual(0);expect(s.reserved).toBeLessThanOrEqual(6);expect(s.confirmed).toBeLessThanOrEqual(s.reserved);}
   return{trip,bookings,movements,segments,events,audits,fleet,incidents,journey,onboard};
  }finally{await db.query('ROLLBACK');}
 },async record(label,state){steps.push({label,...state});await mkdir('.local/e2e-incremento-3',{recursive:true});await writeFile(`.local/e2e-incremento-3/estados-${project}.json`,JSON.stringify(steps,null,2));}};
}
