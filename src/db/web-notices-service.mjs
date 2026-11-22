import{assertRuntime}from'./runtime.mjs';
import{object,id}from'../domain/business.mjs';

// Etapa 6A. Passenger notices: read own unexpired notices and mark them read. The
// notices themselves are created by PostgreSQL triggers from real trip facts.
export function validateMark(b){
 object(b,['ids']);
 if(!Array.isArray(b.ids)||b.ids.length<1||b.ids.length>50||new Set(b.ids).size!==b.ids.length)throw new Error('INVALID_NOTICES');
 for(const x of b.ids)id(x);
 return b.ids;
}
export function createWebNoticesService(pool){
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
 return Object.freeze({
  mine:async(token,b)=>{object(b??{},[]);return tx(token,true,async c=>(await c.query('SELECT nexo.web_my_notices()AS r')).rows[0].r);},
  markRead:async(token,b)=>{const ids=validateMark(b);return tx(token,false,async c=>(await c.query('SELECT nexo.web_mark_notices_read($1::uuid[])AS r',[ids])).rows[0].r);},
 });
}
