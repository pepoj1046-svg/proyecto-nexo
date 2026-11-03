import {object,id} from '../domain/business.mjs';
import {assertRuntime} from './runtime.mjs';
export const directorySections=Object.freeze(['ASSOCIATIONS','DRIVERS','VEHICLES','ROUTES','POINTS','FARES']);
export function directoryRequest(b){
 object(b,['associationId','section','limit','cursor']);
 const {associationId=null,section,limit=50,cursor=null}=b;
 if(!directorySections.includes(section)||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('INVALID_PAGE');
 if(section==='ASSOCIATIONS'){if(associationId!==null)throw new Error('INVALID_PAGE');}else id(associationId);
 if(cursor!==null){
  object(cursor,['v','scope','permissions','revision','size','key']);
  if(cursor.v!==1||cursor.size!==limit||typeof cursor.key!=='string'||cursor.key.length<1||cursor.key.length>64
   ||['scope','permissions','revision'].some(k=>typeof cursor[k]!=='string'||!/^[a-f0-9]{64}$/.test(cursor[k])))throw new Error('INVALID_CURSOR');
 }
 return {associationId,section,limit,cursor};
}
export function createWebDirectoryService(pool){
 return Object.freeze({page:async(token,body)=>{
  const q=directoryRequest(body),c=await pool.connect();
  try{
   await assertRuntime(c,'nexo_app');await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
   await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
   await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
   const r=(await c.query('SELECT nexo.web_admin_directory($1,$2,$3,$4)AS r',[q.associationId,q.section,q.limit,q.cursor])).rows[0].r;
   await c.query('COMMIT');return r;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }});
}
