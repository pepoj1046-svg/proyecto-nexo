import {object,id,actionKey} from '../domain/business.mjs';
import {directoryRequest} from './web-directory-service.mjs';
import {assertRuntime} from './runtime.mjs';

export function driverAdminRequest(kind,b){
 if(kind==='context'){object(b,['associationId','userRef']);id(b.associationId);if(b.userRef!==undefined&&b.userRef!==null)id(b.userRef);return b;}
 if(kind==='history'){
  object(b,['associationId','userRef','limit','cursor']);id(b.associationId);if(b.userRef!==undefined&&b.userRef!==null)id(b.userRef);
  directoryRequest({associationId:b.associationId,section:'DRIVERS',limit:b.limit??50,cursor:b.cursor??null});return b;
 }
 if(kind==='contact'){object(b,['associationId','contactCode','confirmed']);id(b.associationId);if(b.confirmed!==true||typeof b.contactCode!=='string'||!/^LAB-[A-Z0-9_-]{1,40}$/.test(b.contactCode))throw new Error('INVALID_SYNTHETIC_CONTACT');return b;}
 if(kind==='command'){
  object(b,['associationId','userRef','enabled','revision','reason','confirmed']);id(b.associationId);id(b.userRef);
  if(b.confirmed!==true||typeof b.enabled!=='boolean'||typeof b.revision!=='string'||!/^[a-f0-9]{64}$/.test(b.revision)
   ||typeof b.reason!=='string'||b.reason.trim().length<1||b.reason.length>200)throw new Error('INVALID_DRIVER_COMMAND');return b;
 }
 throw new Error('INVALID_DRIVER_COMMAND');
}
export function createWebDriverAdminService(pool){
 async function call(token,kind,b,key){
  driverAdminRequest(kind,b);if(kind==='command'||kind==='contact')actionKey(key);
  const c=await pool.connect();try{
   await assertRuntime(c,'nexo_app');await c.query(kind==='command'||kind==='contact'?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
   await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
   const query=kind==='context'?['SELECT nexo.web_driver_admin_context($1,$2)AS r',[b.associationId,b.userRef??null]]:
    kind==='history'?['SELECT nexo.web_driver_admin_history($1,$2,$3,$4)AS r',[b.associationId,b.userRef??null,b.limit??50,b.cursor??null]]:
    kind==='contact'?['SELECT nexo.set_association_contact($1,$2,$3,$4)AS r',[key,b.associationId,b.contactCode,b.confirmed]]:
    ['SELECT nexo.web_driver_admin_command($1,$2,$3,$4,$5,$6,$7)AS r',[key,b.associationId,b.userRef,b.enabled,b.revision,b.reason,b.confirmed]];
   const r=(await c.query(...query)).rows[0].r;await c.query('COMMIT');return r;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 return Object.freeze({context:(t,b)=>call(t,'context',b),history:(t,b)=>call(t,'history',b),command:(t,k,b)=>call(t,'command',b,k),contact:(t,k,b)=>call(t,'contact',b,k)});
}
