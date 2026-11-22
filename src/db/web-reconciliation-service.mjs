import{assertRuntime}from'./runtime.mjs';
import{object,id,actionKey}from'../domain/business.mjs';

// Etapa 7A. Simulated daily cash reconciliation. Amounts travel as strings with two
// decimals to avoid floating point; PostgreSQL computes the expected amount.
const day=/^\d{4}-\d{2}-\d{2}$/,amount=/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;
export function validateDayQuery(b){object(b,['associationId','day']);id(b.associationId);if(typeof b.day!=='string'||!day.test(b.day)||Number.isNaN(Date.parse(b.day+'T00:00:00Z')))throw new Error('INVALID_DAY');return b;}
export function validateClosing(b){
 object(b,['associationId','day','declaredBOB','note']);validateDayQuery({associationId:b.associationId,day:b.day});
 if(typeof b.declaredBOB!=='string'||!amount.test(b.declaredBOB))throw new Error('INVALID_AMOUNT');
 if(b.note!==null&&b.note!==undefined&&(typeof b.note!=='string'||b.note.length>200))throw new Error('INVALID_NOTE');
 return{associationId:b.associationId,day:b.day,declaredBOB:b.declaredBOB,note:b.note?.trim()||null};
}
export function createWebReconciliationService(pool){
 async function tx(token,readOnly,work){
  const c=await pool.connect();
  try{
   await assertRuntime(c,'nexo_app');await c.query(readOnly?'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY':'BEGIN');
   await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
   await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
   const before=(await c.query('SELECT nexo.actor()AS actor')).rows[0].actor;if(!before)throw new Error('UNAUTHENTICATED');
   const result=await work(c);
   if((await c.query('SELECT nexo.actor()AS actor')).rows[0].actor!==before)throw new Error('UNAUTHENTICATED');
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 const one=async(c,q,v=[])=>(await c.query(q,v)).rows[0].r;
 return Object.freeze({
  associations:async(token,b)=>{object(b??{},[]);return tx(token,true,c=>one(c,'SELECT nexo.web_reconciliation_associations()AS r'));},
  view:async(token,b)=>{const q=validateDayQuery(b);return tx(token,true,c=>one(c,'SELECT nexo.web_reconciliation($1,$2::date)AS r',[q.associationId,q.day]));},
  close:async(token,key,b)=>{actionKey(key);const q=validateClosing(b);return tx(token,false,c=>one(c,'SELECT nexo.web_close_cash_day($1,$2,$3::date,$4::numeric,$5)AS r',[key,q.associationId,q.day,q.declaredBOB,q.note]));},
 });
}
