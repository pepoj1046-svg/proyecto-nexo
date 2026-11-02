import pg from'pg';import{createHash}from'node:crypto';
export async function fleetEvidence(){
 const config=JSON.parse(process.env.NEXO_WEB_AUDIT_CONFIG??'null');if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||config?.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(config.database))throw Error('LOCAL_AUDIT_REQUIRED');
 const db=new pg.Client({...config,options:'-c default_transaction_read_only=on',query_timeout:5000});await db.connect();
 return{close:()=>db.end(),async association(){return(await db.query("SELECT id FROM nexo.associations WHERE name LIKE 'Horizonte del Chaco%'")).rows[0].id;},
 async operatingDriver(){return(await db.query("SELECT t.driver_id,t.vehicle_id FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE v.label='FICTICIO-OPERATIVO'")).rows[0];},
 async request(code){return(await db.query('SELECT * FROM nexo.fleet_requests WHERE lab_code=$1 ORDER BY kind',[code])).rows;},
 async base(vehicle){return(await db.query('SELECT * FROM nexo.fleet_base_assignments WHERE vehicle_id=$1',[vehicle])).rows[0];},
 async events(){return(await db.query('SELECT * FROM nexo.fleet_admin_events ORDER BY id')).rows;},
 async ids(a,section){return(await db.query(section==='HISTORY'?'SELECT id FROM nexo.fleet_admin_events WHERE association_id=$1 ORDER BY id':'SELECT id FROM nexo.fleet_requests WHERE association_id=$1 AND kind=$2 ORDER BY id',section==='HISTORY'?[a]:[a,section==='DRIVERS'?'DRIVER':'VEHICLE'])).rows.map(r=>r.id);},
 async snapshot(){const hashes={};await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{for(const t of['routes','stops','trips','bookings','booking_members','booking_contracts','fares','fleet_incidents','terminal_handoffs','terminal_handoff_receipts','road_rescues','member_movements','movement_corrections','group_consents','assignment_episodes','route_authorizations'])hashes[t]=createHash('sha256').update(JSON.stringify((await db.query('SELECT * FROM nexo.'+db.escapeIdentifier(t)+' x ORDER BY to_jsonb(x)::text')).rows)).digest('hex');return hashes;}finally{await db.query('ROLLBACK');}}
 };
}
