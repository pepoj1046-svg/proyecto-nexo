import{assertRuntime}from'./runtime.mjs';
// No action payload/result is ever returned through this adapter. SQL is a closed
// projection and the transaction has no business writes, row locks or hold expiry.
export function createWebAppReceiptService(pool){return Object.freeze({read:async(token,key)=>{
 const c=await pool.connect();try{
  await assertRuntime(c,'nexo_app');await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
  const before=(await c.query('SELECT nexo.actor()AS actor')).rows[0].actor;if(!before)throw Error('UNAUTHENTICATED');
  const r=(await c.query('SELECT nexo.web_app_reservation_receipt($1)AS result',[key])).rows[0].result;
  if((await c.query('SELECT nexo.actor()AS actor')).rows[0].actor!==before)throw Error('UNAUTHENTICATED');
  let result;if(r?.state==='NOT_OBSERVED')result={state:'NOT_OBSERVED'};
  else if(r?.state==='RECORDED'&&r.receipt&&['reserve','reserve_enroute'].includes(r.receipt.operation)&&['HELD','CONFIRMED'].includes(r.receipt.originalStatus)&&Array.isArray(r.receipt.bookingIds)&&r.receipt.bookingIds.length>0){const{operation,groupId,bookingIds,originalStatus}=r.receipt;result={state:'RECORDED',receipt:{operation,groupId,bookingIds,originalStatus}};}
  else throw Error('RECOVERY_UNAVAILABLE');
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}});}
