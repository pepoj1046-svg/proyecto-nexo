import {createBusinessService} from './business-service.mjs';
import {assertRuntime} from './runtime.mjs';
import {object,id,actionKey} from '../domain/business.mjs';
import {closureInput} from '../domain/stage2-closure.mjs';

const commands={
 GROUP_CONSENT:['bookingId','targetTripId','episode'],APPROVE_TRANSFER:['consentId'],RESTORE_VEHICLE:['vehicleId'],
 TERMINAL_REASSIGN:['incidentId','targetTripId','consentIds','safeTransfer'],
 ASSIGN_URBAN:['tripId','version','targetTripId'],SAFE_URBAN:['tripId','version','onboard'],
 ASSIGN_ROAD:['tripId','version','targetTripId','priority'],SAFE_ROAD:['tripId','version','onboard'],ESCALATE_ROAD:['tripId','version']
};
export function validateRecovery(b){
 if(!b||!Object.hasOwn(commands,b.kind))throw new Error('INVALID_OPERATION');
 object(b,['kind','confirmed',...commands[b.kind]]);if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
 for(const k of commands[b.kind].filter(k=>k.endsWith('Id')))id(b[k]);
 if(b.kind==='GROUP_CONSENT'&&(!Number.isInteger(b.episode)||b.episode<0||b.episode>8))throw new Error('INVALID_EPISODE');
 if(commands[b.kind].includes('version')&&(!Number.isInteger(b.version)||b.version<0||b.version>2147483647))throw new Error('INVALID_VERSION');
 if(b.kind==='TERMINAL_REASSIGN')closureInput('terminal-reassign',Object.fromEntries(Object.entries(b).filter(([k])=>k!=='kind')));
 if(commands[b.kind].includes('onboard')&&(!Number.isInteger(b.onboard)||b.onboard<0||b.onboard>6))throw new Error('INVALID_ONBOARD');
 if(commands[b.kind].includes('priority')&&!['ORIGIN','DESTINATION'].includes(b.priority))throw new Error('INVALID_TERMINAL');
 return b;
}
export function createWebRecoveryService(pool){
 const business=createBusinessService(pool);
 async function tx(token,work){const c=await pool.connect();try{
  await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
  await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);const actor=(await c.query('SELECT nexo.actor()AS id')).rows[0].id;
  if(!actor)throw new Error('UNAUTHENTICATED');const result=await work(c,actor);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const incidentFields=`SELECT f.id AS "incidentId",f.trip_id AS "tripId",f.original_vehicle AS "originalVehicleId",f.context,f.state,f.reason,f.created_at AS "createdAt",t.route_id AS "routeId",t.status,
  r.name AS route,v.label AS vehicle,o.label AS "originalVehicle",rr.version AS "roadVersion",rr.phase AS "roadPhase",rr.terminal_priority AS priority
  FROM nexo.fleet_incidents f JOIN nexo.trips t ON t.id=f.trip_id JOIN nexo.routes r ON r.id=t.route_id
  JOIN nexo.vehicles v ON v.id=t.vehicle_id LEFT JOIN nexo.vehicles o ON o.id=f.original_vehicle LEFT JOIN nexo.road_rescues rr ON rr.incident_id=f.id`;
 async function managedIncident(c,incident){
  const i=(await c.query(incidentFields+' WHERE f.id=$1 AND nexo.manage_route(t.route_id)',[id(incident)])).rows[0];
  if(!i)throw new Error('FORBIDDEN');await c.query('SELECT nexo.operational_status($1)',[i.tripId]);return i;
 }
 async function consents(c,bookingIds){return(await c.query(`SELECT c.id AS "consentId",c.booking_id AS "bookingId",c.group_id AS "groupId",c.target_trip AS "targetTripId",v.label AS vehicle,c.created_at AS "createdAt"
  FROM nexo.group_consents c JOIN nexo.trips t ON t.id=c.target_trip JOIN nexo.vehicles v ON v.id=t.vehicle_id
  WHERE c.group_id IN(SELECT group_id FROM nexo.bookings WHERE id=ANY($1::uuid[]))AND NOT EXISTS(SELECT FROM nexo.consent_uses u WHERE u.consent_id=c.id)
  ORDER BY c.created_at DESC,c.id LIMIT 50`,[bookingIds])).rows;}
 async function vehicle(c,trip){return(await c.query(`SELECT t.id AS "tripId",t.route_id AS "routeId",t.position_no AS position,v.label AS vehicle,r.name AS route
  FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id JOIN nexo.routes r ON r.id=t.route_id WHERE t.id=$1`,[trip])).rows[0];}
 return Object.freeze({
  overview:(token,b)=>{object(b,['view']);if(!['ADMIN','DRIVER'].includes(b.view))throw new Error('INVALID_VIEW');return tx(token,async(c,actor)=>{
   if(b.view==='DRIVER')return(await c.query('SELECT nexo.web_driver_incidents()AS r')).rows[0].r;
   if(!(await c.query("SELECT 1 FROM nexo.memberships WHERE user_id=$1 AND role='ASSOCIATION_ADMIN'AND active LIMIT 1",[actor])).rowCount)throw new Error('FORBIDDEN');
   return{incidents:(await c.query(incidentFields+' WHERE nexo.manage_route(t.route_id) ORDER BY f.created_at DESC,f.id LIMIT 50')).rows,limit:50,delivery:'DISABLED'};
  });},
  passenger:(token,b)=>{object(b,['bookingId']);return tx(token,async c=>(await c.query('SELECT nexo.web_booking_recovery($1)AS r',[id(b.bookingId)])).rows[0].r);},
  detail:(token,b)=>{object(b,['incidentId','priority']);if(b.priority!==undefined&&!['ORIGIN','DESTINATION'].includes(b.priority))throw new Error('INVALID_TERMINAL');return tx(token,async c=>{
   const i=await managedIncident(c,b.incidentId),snapshot=(await c.query("SELECT nexo.web_trip_snapshot($1,'ADMIN')AS r",[i.tripId])).rows[0].r;
   let choices=[];
   if(i.context==='ROAD')choices=(await c.query('SELECT nexo.road_candidates($1,$2)AS r',[i.incidentId,b.priority??null])).rows[0].r;
   else{const fn=i.context==='TERMINAL'?'terminal_replacement_candidate':'free_replacement';const candidate=(await c.query(`SELECT nexo.${fn}($1)AS id`,[i.incidentId])).rows[0].id;if(candidate)choices=[{tripId:candidate}];}
   const candidates=[];for(const choice of choices.slice(0,10)){const row=await vehicle(c,choice.tripId);if(row)candidates.push({...choice,...row});}
   let affectedBookings=snapshot.bookings.filter(b=>['CONFIRMED','COMPLETED'].includes(b.status)).map(b=>({...b,vehicle:snapshot.vehicleLabel}));
   if(i.context==='TERMINAL'&&i.state==='TRANSFERRED')affectedBookings=(await c.query(`SELECT b.id AS "bookingId",b.seats,b.status,b.price_bob AS "priceBOB",s.name AS "boardingName",d.name AS "alightingName",v.label AS vehicle
    FROM nexo.bookings b JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id
    JOIN nexo.stops s ON s.route_id=b.route_id AND s.stop_index=b.from_stop JOIN nexo.stops d ON d.route_id=b.route_id AND d.stop_index=b.to_stop
    WHERE EXISTS(SELECT FROM nexo.assignment_episodes e WHERE e.booking_id=b.id AND e.from_trip_id=$1 AND e.created_at>=(SELECT created_at FROM nexo.fleet_incidents WHERE id=$2))
    ORDER BY b.created_at,b.id LIMIT 50`,[i.tripId,i.incidentId])).rows;
   const blocked=(await c.query('SELECT blocked,incident_id FROM nexo.vehicle_blocks WHERE vehicle_id=$1',[i.originalVehicleId])).rows[0];
   const canRestore=blocked?.blocked&&blocked.incident_id===i.incidentId&&(i.context==='TERMINAL'?i.status==='QUEUED'&&snapshot.observedOnboard===0:i.state==='TRANSFERRED');
   return{incident:i,snapshot,affectedBookings,candidates,consents:await consents(c,snapshot.bookings.filter(b=>b.status==='CONFIRMED').map(b=>b.bookingId)),canRestore:!!canRestore,originalVehicleBlocked:!!blocked?.blocked,snapshotOnly:true,delivery:'DISABLED',candidateLimit:10};
  });},
  transfer:(token,b)=>{object(b,['bookingId']);return tx(token,async c=>{
   const row=(await c.query('SELECT id,trip_id,route_id FROM nexo.bookings WHERE id=$1 AND nexo.manage_route(route_id)',[id(b.bookingId)])).rows[0];
   if(!row)throw new Error('FORBIDDEN');await c.query('SELECT nexo.assignment_status($1)',[row.id]);
   const options=(await c.query('SELECT nexo.resolution_options($1)AS r',[row.id])).rows[0].r;
   for(const choice of options.alternatives){const v=await vehicle(c,choice.tripId);if(v)choice.vehicle=v.vehicle;}
   return{bookingId:row.id,consents:await consents(c,[row.id]),options,snapshotOnly:true};
  });},
  command:async(token,key,b)=>{
   validateRecovery(b);actionKey(key);
   switch(b.kind){
    case'GROUP_CONSENT':{const r=await business.consentGroup(token,key,b.bookingId,b.targetTripId,b.episode,true);return{consentId:r.consentId,seats:r.seats};}
    case'APPROVE_TRANSFER':return business.approveTerminalTransfer(token,key,b.consentId);
    case'RESTORE_VEHICLE':return business.restoreVehicle(token,key,b.vehicleId,true);
    case'TERMINAL_REASSIGN':return business.closure(token,key,'terminal-reassign',Object.fromEntries(Object.entries(b).filter(([k])=>k!=='kind')));
    case'ASSIGN_URBAN':case'SAFE_URBAN':return business.fleetCommand(token,key,b.tripId,b.version,b.kind==='ASSIGN_URBAN'?'ASSIGN':'SAFE_TRANSFER',b.targetTripId??null,b.onboard??null,true);
    case'ASSIGN_ROAD':case'SAFE_ROAD':case'ESCALATE_ROAD':return business.closure(token,key,'road-command',{tripId:b.tripId,version:b.version,command:{ASSIGN_ROAD:'ASSIGN',SAFE_ROAD:'SAFE_TRANSFER',ESCALATE_ROAD:'ESCALATE'}[b.kind],confirmed:true,...(b.kind==='ASSIGN_ROAD'?{targetTripId:b.targetTripId,priority:b.priority}:b.kind==='SAFE_ROAD'?{onboard:b.onboard}:{})});
   }
  }
 });
}
