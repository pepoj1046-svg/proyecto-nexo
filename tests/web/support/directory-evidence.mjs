import pg from 'pg';
import {createHash} from 'node:crypto';
// Independent table witness. No runtime or browser receives this connection.
export async function directoryEvidence(){
 const config=JSON.parse(process.env.NEXO_WEB_AUDIT_CONFIG??'null');
 if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||config?.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(config.database))throw new Error('FRESH_LOCAL_AUDIT_REQUIRED');
 const db=new pg.Client({...config,options:'-c default_transaction_read_only=on',application_name:'nexo-directory-readonly-witness',query_timeout:5000});await db.connect();
 return{close:()=>db.end(),async driverForVehicle(){return(await db.query("SELECT t.driver_id FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE v.label='FICTICIO-OPERATIVO'")).rows[0].driver_id;},async access(id){return{active:(await db.query("SELECT active FROM nexo.memberships WHERE user_id=$1 AND role='DRIVER'",[id])).rows[0].active,events:(await db.query("SELECT id,event,actor_id,reason FROM nexo.identity_events WHERE subject_id=$1 AND event IN('DRIVER_ENABLED','DRIVER_DISABLED')ORDER BY created_at,id",[id])).rows};},async historyIds(association){return(await db.query("SELECT id::text FROM nexo.identity_events WHERE association_id=$1 AND event IN('DRIVER_ENABLED','DRIVER_DISABLED','DRIVER_ACCESS_REVIEW_REQUIRED','CONTACT_UPDATED')ORDER BY id",[association])).rows.map(r=>r.id);},async association(){return(await db.query("SELECT id FROM nexo.associations WHERE name LIKE 'Horizonte del Chaco%'")).rows[0].id;},async expected(association,section){
  const queries={DRIVERS:"SELECT user_id::text id FROM nexo.memberships WHERE association_id=$1 AND role='DRIVER'",VEHICLES:'SELECT id::text FROM nexo.vehicles WHERE association_id=$1',ROUTES:'SELECT id::text FROM nexo.routes WHERE association_id=$1',POINTS:"SELECT route_id::text||':'||stop_index AS id FROM nexo.stops WHERE association_id=$1",FARES:'SELECT id::text FROM nexo.fares WHERE association_id=$1'};
  return(await db.query(queries[section],[association])).rows.map(x=>x.id).sort();
 },async snapshot(administration=false){
  const hashes={};await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{for(const {tablename}of(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='nexo'AND tablename NOT IN('sessions','identity_accounts','identity_attempts','identity_recovery','identity_events','security_events')ORDER BY tablename")).rows){
   if(administration&&['memberships','actions','audit_events','association_contacts'].includes(tablename))continue;
   const rows=(await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(tablename)+' x ORDER BY to_jsonb(x)::text')).rows;hashes[tablename]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }return hashes;}finally{await db.query('ROLLBACK');}
 }};
}
