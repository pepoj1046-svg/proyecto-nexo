import {createBusinessService} from './business-service.mjs';
import {assertRuntime} from './runtime.mjs';
import {object,id,actionKey} from '../domain/business.mjs';
import {cursorPage} from './web-management-service.mjs';
import {pointIndex} from './web-reservation-service.mjs';
const kinds=['ARRIVED','PICKUP_REQUEST','VERIFY','PICKUP_ARRIVED','BOARD','ALIGHT','ACCEPT','DEPART','BEGIN_COLLECTION','MAIN_START','PROGRESS','REPORT_TERMINAL','CONFIRM_TERMINAL','REPORT_URBAN','CONFIRM_URBAN','REPORT_ROAD','CONFIRM_ROAD'];
export function validateOperation(b){
 if(!b||!kinds.includes(b.kind))throw new Error('INVALID_OPERATION');
 const booking=['ARRIVED','PICKUP_REQUEST','VERIFY','PICKUP_ARRIVED','BOARD','ALIGHT','ACCEPT'].includes(b.kind);
 const movement=['BOARD','ALIGHT'].includes(b.kind);
 const point=['PROGRESS','BEGIN_COLLECTION'].includes(b.kind);
 const version=['MAIN_START','REPORT_URBAN','CONFIRM_URBAN','REPORT_ROAD','CONFIRM_ROAD'].includes(b.kind);
 object(b,['kind','confirmed',...(booking?['bookingId']:['tripId']),...(booking&&b.kind!=='ACCEPT'?['episode']:[]),...(movement?['tripId','memberId','seats','alightingPointId']:[]),...(point?['pointId']:[]),...(version?['version']:[]),...(b.kind.includes('TERMINAL')?['reason']:[])]);
 if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
 if(booking)id(b.bookingId);if(!booking||movement)id(b.tripId);if(b.memberId!==undefined)id(b.memberId);
 if(booking&&b.kind!=='ACCEPT'&&(!Number.isInteger(b.episode)||b.episode<0||b.episode>8))throw new Error('INVALID_EPISODE');
 if(movement&&(!Number.isInteger(b.seats)||b.seats<1||b.seats>6||typeof b.alightingPointId!=='string'))throw new Error('INVALID_BOARDING_CHECK');
 if(point&&typeof b.pointId!=='string')throw new Error('INVALID_AUTHORIZED_POINTS');
 if(version&&(!Number.isInteger(b.version)||b.version<0))throw new Error('INVALID_VERSION');
 if(b.kind.includes('TERMINAL')&&!['MECHANICAL_FAILURE','EMERGENCY_DECLARED','OPERATIONAL_BARRIER'].includes(b.reason))throw new Error('INVALID_INCIDENT');
 return b;
}
export function createWebOperationsService(pool){
 const business=createBusinessService(pool);
 async function tx(token,work){const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);const actor=(await c.query('SELECT nexo.actor()AS id')).rows[0].id;if(!actor)throw new Error('UNAUTHENTICATED');const result=await work(c,actor);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const view=b=>{if(!['ADMIN','DRIVER','PASSENGER'].includes(b.view))throw new Error('INVALID_VIEW');};
 const tripRoute=(token,trip)=>tx(token,async c=>{const t=(await c.query('SELECT route_id FROM nexo.trips WHERE id=$1',[trip])).rows[0];if(!t)throw new Error('FORBIDDEN');return t.route_id;});
 return Object.freeze({
  overview:(token,b)=>{object(b,['view']);view(b);if(b.view==='PASSENGER')throw new Error('INVALID_VIEW');return tx(token,async(c,actor)=>{
   const role=b.view==='ADMIN'?'ASSOCIATION_ADMIN':'DRIVER';if(!(await c.query('SELECT 1 FROM nexo.memberships WHERE user_id=$1 AND role=$2 AND active LIMIT 1',[actor,role])).rowCount)throw new Error('FORBIDDEN');
   return{trips:(await c.query(`SELECT t.id AS "tripId",r.name AS route,a.name AS association,v.label AS "vehicleLabel",t.status,t.position_no AS position FROM nexo.trips t JOIN nexo.routes r ON r.id=t.route_id JOIN nexo.associations a ON a.id=t.association_id JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE t.status<>'WITHDRAWN'AND ($1='ADMIN'AND nexo.manage_route(t.route_id)OR $1='DRIVER'AND t.driver_id=$2 AND nexo.drives(t.id))ORDER BY a.name,r.id,t.position_no,t.id LIMIT 50`,[b.view,actor])).rows};});},
  snapshot:(token,b)=>{object(b,['view','tripId','limit','cursor','bookingId']);view(b);id(b.tripId);if(b.bookingId!==undefined){id(b.bookingId);if(b.view!=='PASSENGER')throw new Error('INVALID_VIEW');}const q=cursorPage(Object.fromEntries(Object.entries(b).filter(([k])=>['limit','cursor'].includes(k))));return tx(token,async c=>(await c.query('SELECT nexo.web_trip_page($1,$2,$3,$4,$5)AS result',[b.tripId,b.view,q.limit,q.cursor,b.bookingId??null])).rows[0].result);},
  command:async(token,key,request)=>{
   const b=validateOperation(request);actionKey(key);
   switch(b.kind){
    case'ARRIVED':return business.terminalArrival(token,key,b.bookingId,b.episode,true);
    case'PICKUP_REQUEST':case'VERIFY':case'PICKUP_ARRIVED':return business.episodeCommand(token,key,b.bookingId,{PICKUP_REQUEST:'PICKUP',VERIFY:'VERIFIED',PICKUP_ARRIVED:'PICKUP_ARRIVED'}[b.kind],true,b.episode);
    case'ACCEPT':return business.respond(token,key,b.bookingId,true);
    case'BOARD':case'ALIGHT':return tx(token,async c=>{const row=(await c.query('SELECT route_id FROM nexo.bookings WHERE id=$1',[b.bookingId])).rows[0];if(!row)throw new Error('FORBIDDEN');const destination=pointIndex(b.alightingPointId,row.route_id);return(await c.query('SELECT nexo.web_observation($1,$2,$3,$4,$5,$6,$7,$8)AS result',[key,b.bookingId,b.tripId,b.episode,b.memberId??null,b.kind,b.seats,destination])).rows[0].result;});
    case'DEPART':return business.depart(token,key,b.tripId);
    case'PROGRESS':return business.progress(token,key,b.tripId,pointIndex(b.pointId,await tripRoute(token,b.tripId)));
    case'BEGIN_COLLECTION':{const s=await tx(token,async c=>(await c.query("SELECT nexo.web_trip_snapshot($1,'DRIVER')AS result",[b.tripId])).rows[0].result);if(b.pointId!==s.mainPointId)throw new Error('INVALID_URBAN_STATE');return business.beginUrban(token,key,b.tripId,pointIndex(b.pointId,s.routeId),true);}
    case'MAIN_START':case'REPORT_URBAN':case'CONFIRM_URBAN':return business.fleetCommand(token,key,b.tripId,b.version,{MAIN_START:'MAIN_START',REPORT_URBAN:'REPORT',CONFIRM_URBAN:'CONFIRM'}[b.kind],null,null,true);
    case'REPORT_TERMINAL':case'CONFIRM_TERMINAL':return business.terminalImpediment(token,key,b.tripId,b.kind==='REPORT_TERMINAL'?'REPORT':'CONFIRM',b.reason,true);
    case'REPORT_ROAD':case'CONFIRM_ROAD':return business.closure(token,key,'road-command',{tripId:b.tripId,version:b.version,command:b.kind==='REPORT_ROAD'?'REPORT':'CONFIRM',confirmed:true});
   }
  }
 });
}
