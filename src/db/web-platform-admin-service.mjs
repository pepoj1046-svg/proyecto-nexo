import {object,id,actionKey} from '../domain/business.mjs';
import {assertRuntime} from './runtime.mjs';
const code=x=>typeof x==='string'&&/^LAB-[A-Z0-9_-]{1,40}$/.test(x);
export function platformRequest(kind,b){
 if(kind==='context'){object(b,['associationId']);if(b.associationId!==null&&b.associationId!==undefined)id(b.associationId);return b;}
 if(kind==='page'){
  object(b,['associationId','section','limit','cursor']);if(b.associationId!==null&&b.associationId!==undefined)id(b.associationId);
  if(!['ASSOCIATIONS','CANDIDATES','HISTORY'].includes(b.section)||b.section!=='HISTORY'&&b.associationId!=null||!Number.isInteger(b.limit??50)||(b.limit??50)<1||(b.limit??50)>100)throw new Error('INVALID_PAGE');
  if(b.cursor!=null){object(b.cursor,['v','scope','revision','size','key']);if(b.cursor.v!==1||b.cursor.size!==(b.limit??50)||!['scope','revision'].every(k=>typeof b.cursor[k]==='string'&&/^[a-f0-9]{64}$/.test(b.cursor[k]))||typeof b.cursor.key!=='string'||b.cursor.key.length<1||b.cursor.key.length>64)throw new Error('INVALID_CURSOR');}return b;
 }
 if(kind==='command'){
  object(b,b.kind==='REGISTER'?['kind','labCode','name','reason','confirmed']:b.kind==='STATE_REVIEW'?['kind','associationId','revision','reason','confirmed']:['kind','associationId','identityCode','revision','reason','confirmed']);
  if(!['REGISTER','DELEGATE','REVOKE','STATE_REVIEW'].includes(b.kind)||b.confirmed!==true||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>200)throw new Error('INVALID_PLATFORM_COMMAND');
  if(b.kind==='REGISTER'){if(!code(b.labCode)||typeof b.name!=='string'||!/^LAB-[A-Z0-9 _-]{1,80}$/.test(b.name))throw new Error('INVALID_PLATFORM_ASSOCIATION');}
  else{id(b.associationId);if(typeof b.revision!=='string'||!/^[a-f0-9]{64}$/.test(b.revision)||b.kind!=='STATE_REVIEW'&&!code(b.identityCode))throw new Error('INVALID_PLATFORM_COMMAND');}return b;
 }
 throw new Error('INVALID_PLATFORM_COMMAND');
}
export function createWebPlatformAdminService(pool){
 async function call(token,kind,b,key){platformRequest(kind,b);if(kind==='command')actionKey(key);const c=await pool.connect();try{
  await assertRuntime(c,'nexo_app');await c.query(kind==='command'?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
  const q=kind==='context'?['SELECT nexo.web_platform_context($1)AS r',[b.associationId??null]]:kind==='page'?['SELECT nexo.web_platform_page($1,$2,$3,$4)AS r',[b.associationId??null,b.section,b.limit??50,b.cursor??null]]:['SELECT nexo.web_platform_command($1,$2)AS r',[key,b]];
  const r=(await c.query(...q)).rows[0].r;await c.query('COMMIT');return r;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 return Object.freeze({context:(t,b)=>call(t,'context',b),page:(t,b)=>call(t,'page',b),command:(t,k,b)=>call(t,'command',b,k)});
}
