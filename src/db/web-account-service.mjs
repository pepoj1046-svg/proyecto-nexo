import{assertRuntime}from'./runtime.mjs';
import{object}from'../domain/business.mjs';

// 5A.5 "Mi cuenta". Read-only projection of the actor's own account: display label
// and active roles. No identifier of the user, no session data and no writes. The
// actor is derived from the session inside PostgreSQL and re-checked after reading.
const ROLES=new Set(['ASSOCIATION_ADMIN','DRIVER']);
export function shapeAccount(r){
  if(!r||typeof r.label!=='string'||!Array.isArray(r.roles))throw new Error('ACCOUNT_UNAVAILABLE');
  return{label:r.label.slice(0,120),editableFields:[],
    roles:r.roles.filter(x=>x&&typeof x.association==='string'&&typeof x.role==='string').map(x=>({association:x.association.slice(0,120),role:ROLES.has(x.role)?x.role:'OTHER',restricted:x.restricted===true}))};
}
export function createWebAccountService(pool){return Object.freeze({read:async(token,b)=>{
  object(b??{},[]);
  const c=await pool.connect();try{
    await assertRuntime(c,'nexo_app');await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");
    await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
    const before=(await c.query('SELECT nexo.actor()AS actor')).rows[0].actor;if(!before)throw Error('UNAUTHENTICATED');
    const result=shapeAccount((await c.query('SELECT nexo.web_my_account()AS result')).rows[0].result);
    if((await c.query('SELECT nexo.actor()AS actor')).rows[0].actor!==before)throw Error('UNAUTHENTICATED');
    await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}});}
