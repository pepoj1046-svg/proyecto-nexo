import{object,id,actionKey}from'../domain/business.mjs';
import{closureInput}from'../domain/stage2-closure.mjs';
import{assertRuntime}from'./runtime.mjs';
export function declaration(b){
 object(b,['routeId','expectedRevision','state','reason','description','affectedStops','additionalMinutes','fareId','amountBOB','confirmed']);
 const{expectedRevision,additionalMinutes,...native}=b;closureInput('route-condition',native);
 if(!Number.isInteger(expectedRevision)||expectedRevision<0||expectedRevision>2147483647)throw new Error('INVALID_VERSION');
 if(additionalMinutes!==null&&additionalMinutes!==undefined&&(!Number.isInteger(additionalMinutes)||additionalMinutes<0||additionalMinutes>10080))throw new Error('INVALID_DURATION');
 return b;
}
export function conditionCommand(b){object(b,['bookingId','revision','decision','confirmed']);id(b.bookingId);if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483647||!['ACCEPT','REJECT','CANCEL_REQUEST','RESOLVE_CANCEL'].includes(b.decision)||b.confirmed!==true)throw new Error('INVALID_DECISION');return b;}
export function createWebConditionService(pool){
 async function tx(token,work){const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);if(!(await c.query('SELECT nexo.actor()AS id')).rows[0].id)throw new Error('UNAUTHENTICATED');const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 return Object.freeze({
  context:(token,b)=>{object(b,['bookingId']);return tx(token,async c=>(await c.query('SELECT nexo.web_condition_context($1)AS r',[id(b.bookingId)])).rows[0].r);},
  route:(token,b)=>{object(b,['tripId']);return tx(token,async c=>(await c.query('SELECT nexo.web_condition_route($1)AS r',[id(b.tripId)])).rows[0].r);},
  declare:(token,key,b)=>{declaration(b);actionKey(key);return tx(token,async c=>(await c.query('SELECT nexo.web_declare_condition($1,$2)AS r',[key,b])).rows[0].r);},
  command:(token,key,b)=>{conditionCommand(b);actionKey(key);return tx(token,async c=>(await c.query('SELECT nexo.web_condition_command($1,$2,$3,$4,$5)AS r',[key,b.bookingId,b.revision,b.decision,b.confirmed])).rows[0].r);}
 });
}
