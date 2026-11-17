import pg from 'pg';
import {createHash} from 'node:crypto';
export async function routeConfigEvidence(){
 const config=JSON.parse(process.env.NEXO_WEB_AUDIT_CONFIG??'null');
 if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||config?.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(config.database))throw Error('LOCAL_AUDIT_REQUIRED');
 const db=new pg.Client({...config,options:'-c default_transaction_read_only=on',query_timeout:5000});await db.connect();
 return {close:()=>db.end(),
  async native(){return(await db.query("SELECT t.route_id,t.association_id,t.id trip_id FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE v.label='FICTICIO-OPERATIVO'")).rows[0];},
  async foreign(){return(await db.query("SELECT r.id route_id,r.association_id FROM nexo.routes r JOIN nexo.associations a ON a.id=r.association_id WHERE a.name LIKE 'Unión del Sur%' ORDER BY r.id LIMIT 1")).rows[0];},
  async draft(id){return(await db.query('SELECT * FROM nexo.config_drafts WHERE id=$1',[id])).rows[0];},
  async drafts(name){return(await db.query("SELECT * FROM nexo.config_drafts WHERE spec->>'name'=$1 ORDER BY id",[name])).rows;},
  async published(id){return(await db.query('SELECT r.*,(SELECT count(*) FROM nexo.trips WHERE route_id=r.id) trips,(SELECT count(*) FROM nexo.route_authorizations WHERE route_id=r.id) permits FROM nexo.routes r WHERE r.id=$1',[id])).rows[0];},
  async fare(id){return(await db.query('SELECT f.*,s.selected_until FROM nexo.fares f LEFT JOIN nexo.fare_selection_ends s ON s.fare_id=f.id WHERE f.id=$1',[id])).rows[0];},
  async selectedAt(route,instant){return(await db.query('SELECT id FROM nexo.new_request_fares WHERE route_id=$1 AND from_stop=0 AND to_stop=3 AND NOT express AND valid_from<=$2 AND(valid_until IS NULL OR valid_until>$2)',[route,instant])).rows.map(r=>r.id);},
  async ids(a,section){const query=section==='HISTORY'?'SELECT id FROM nexo.config_events WHERE association_id=$1 ORDER BY id':section==='FARES'?'SELECT id FROM nexo.fares WHERE association_id=$1 ORDER BY id':'SELECT id FROM nexo.config_drafts WHERE association_id=$1 AND kind=$2 ORDER BY id';return(await db.query(query,section.endsWith('DRAFTS')?[a,section==='ROUTE_DRAFTS'?'ROUTE':'FARE']:[a])).rows.map(r=>r.id);},
  async events(){return(await db.query('SELECT * FROM nexo.config_events ORDER BY id')).rows;},
  async operations(){const result={};await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{for(const table of ['trips','bookings','booking_members','booking_contracts','fleet_incidents','terminal_handoffs','terminal_handoff_receipts','road_rescues','member_movements','movement_corrections','group_consents','assignment_episodes','route_authorizations'])result[table]=createHash('sha256').update(JSON.stringify((await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(table)+' x ORDER BY to_jsonb(x)::text')).rows)).digest('hex');return result;}finally{await db.query('ROLLBACK');}}
 };
}
