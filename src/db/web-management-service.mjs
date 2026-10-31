import {createBusinessService} from './business-service.mjs';
import {assertRuntime} from './runtime.mjs';
import {object,id,actionKey} from '../domain/business.mjs';
export function cursorPage(b){
 object(b,['limit','cursor']);const limit=b.limit??50,cursor=b.cursor??null;
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('INVALID_PAGE');
 if(cursor!==null){object(cursor,['v','scope','revision','size','createdAt','id']);id(cursor.id);
  if(cursor.v!==1||cursor.size!==limit||typeof cursor.scope!=='string'||!/^[a-f0-9]{64}$/.test(cursor.scope)||typeof cursor.revision!=='string'||!/^[a-f0-9]{64}$/.test(cursor.revision)||typeof cursor.createdAt!=='string'||cursor.createdAt.length>40||!Number.isFinite(Date.parse(cursor.createdAt)))throw new Error('INVALID_CURSOR');}
 return {limit,cursor};
}
export function managementCommand(b){
 if(!b||!['ADMIN_CANCEL','REVIEW_CONDITION'].includes(b.kind))throw new Error('INVALID_OPERATION');
 object(b,['kind','bookingId','confirmed',...(b.kind==='ADMIN_CANCEL'?['tripId','episode','reason']:['revision'])]);id(b.bookingId);
 if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
 if(b.kind==='ADMIN_CANCEL'){
  id(b.tripId);if(!Number.isInteger(b.episode)||b.episode<0||b.episode>8||!['OPERATOR_ERROR','WRONG_RESERVATION','PASSENGER_CORRECTION'].includes(b.reason))throw new Error('INVALID_CANCELLATION');
 }else if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483647)throw new Error('INVALID_VERSION');
 return b;
}
export function createWebManagementService(pool){
 const business=createBusinessService(pool);
 async function tx(token,work){const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);if(!(await c.query('SELECT nexo.actor()AS id')).rows[0].id)throw new Error('UNAUTHENTICATED');const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function managed(c,booking){const row=(await c.query('SELECT id FROM nexo.bookings WHERE id=$1 AND nexo.manage_route(route_id)',[id(booking)])).rows[0];if(!row)throw new Error('FORBIDDEN');await c.query('SELECT nexo.assignment_status($1)',[row.id]);return row;}
 return Object.freeze({
  detail:(token,b)=>{object(b,['bookingId']);return tx(token,async c=>(await c.query('SELECT nexo.web_admin_booking($1)AS r',[id(b.bookingId)])).rows[0].r);},
  command:async(token,key,request)=>{const b=managementCommand(request);actionKey(key);
   if(b.kind==='ADMIN_CANCEL')return tx(token,async c=>(await c.query('SELECT nexo.web_admin_cancel($1,$2,$3,$4,$5,$6)AS r',[key,b.bookingId,b.tripId,b.episode,b.reason,b.confirmed])).rows[0].r);
   await tx(token,c=>managed(c,b.bookingId));
   return business.closure(token,key,'condition-decision',{bookingId:b.bookingId,revision:b.revision,decision:'ADMIN_REVIEW',confirmed:true});
  }
 });
}
