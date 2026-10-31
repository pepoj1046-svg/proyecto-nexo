import{object,id,actionKey}from'../domain/business.mjs';
import{assertRuntime}from'./runtime.mjs';
export const discrepancyKinds=Object.freeze(['NOT_BOARDED','ALIGHT_INCORRECT','WRONG_REPLACEMENT','OTHER_OPERATIONAL']);
export function safetyCommand(b){
 object(b,['incidentId','version','command','bookingId','memberId','confirmed']);id(b.incidentId);
 if(b.confirmed!==true||!Number.isInteger(b.version)||b.version<0||b.version>7||!['RECEIVE_MEMBER','RECEIVE_GROUP','CONFIRM_SAFE'].includes(b.command))throw new Error('INVALID_HANDOFF_COMMAND');
 if(b.command==='CONFIRM_SAFE'){if('bookingId'in b||'memberId'in b)throw new Error('INVALID_HANDOFF_COMMAND');}
 else{id(b.bookingId);if(b.command==='RECEIVE_MEMBER')id(b.memberId);else if('memberId'in b)throw new Error('INVALID_HANDOFF_COMMAND');}
 return b;
}
export function discrepancyReport(b){
 object(b,['bookingId','episode','kind','confirmed']);id(b.bookingId);
 if(b.confirmed!==true||!Number.isInteger(b.episode)||b.episode<0||b.episode>8||!discrepancyKinds.includes(b.kind))throw new Error('INVALID_DISCREPANCY');return b;
}
export function createWebSafetyService(pool){
 async function tx(token,work){const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);if(!(await c.query('SELECT nexo.actor()AS id')).rows[0].id)throw new Error('UNAUTHENTICATED');const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 return Object.freeze({
  handoffs:(token,b)=>{object(b,['tripId']);id(b.tripId);return tx(token,async c=>(await c.query('SELECT nexo.trip_handoffs($1)AS r',[b.tripId])).rows[0].r);},
  context:(token,b)=>{object(b,['bookingId']);id(b.bookingId);return tx(token,async c=>(await c.query('SELECT nexo.discrepancy_context($1)AS r',[b.bookingId])).rows[0].r);},
  command:(token,key,b)=>{safetyCommand(b);actionKey(key);return tx(token,async c=>(await c.query('SELECT nexo.handoff_command($1,$2,$3,$4,$5,$6,$7)AS r',[key,b.incidentId,b.version,b.command,b.bookingId??null,b.memberId??null,b.confirmed])).rows[0].r);},
  report:(token,key,b)=>{discrepancyReport(b);actionKey(key);return tx(token,async c=>(await c.query('SELECT nexo.report_passenger_discrepancy($1,$2,$3,$4,$5)AS r',[key,b.bookingId,b.episode,b.kind,b.confirmed])).rows[0].r);}
 });
}
