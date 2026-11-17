import {object,id,actionKey} from '../domain/business.mjs';
import {directoryRequest} from './web-directory-service.mjs';
import {assertRuntime} from './runtime.mjs';
const fields={REQUEST_DRIVER:['identityCode'],REQUEST_VEHICLE:['vehicleCode','vehicleType','capacity'],APPROVE:['requestId'],REJECT:['requestId'],ASSIGN:['vehicleId','driverRef'],UNASSIGN:['vehicleId']};
export function fleetAdminRequest(kind,b){
 if(kind==='context'){object(b,['associationId']);id(b.associationId);return b;}
 if(kind==='page'){
  object(b,['associationId','section','limit','cursor']);id(b.associationId);
  if(!['DRIVERS','VEHICLES','ASSIGNMENTS','HISTORY'].includes(b.section))throw Error('INVALID_FLEET_SECTION');
  directoryRequest({associationId:b.associationId,section:'DRIVERS',limit:b.limit??50,cursor:b.cursor??null});return b;
 }
 if(kind!=='command'||typeof b?.kind!=='string'||!Object.hasOwn(fields,b.kind))throw Error('INVALID_FLEET_COMMAND');
 object(b,['kind','associationId','revision','reason','confirmed',...fields[b.kind]]);id(b.associationId);
 if(b.confirmed!==true||typeof b.revision!=='string'||!/^[a-f0-9]{64}$/.test(b.revision)||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>200)throw Error('INVALID_FLEET_COMMAND');
 const result={...b};
 for(const f of fields[b.kind]){
  if(f.endsWith('Id')||f==='driverRef')id(b[f]);
  if(f.endsWith('Code')){if(typeof b[f]!=='string')throw Error('INVALID_FLEET_COMMAND');result[f]=b[f].trim().toUpperCase();if(!/^LAB-[A-Z0-9_-]{1,40}$/.test(result[f]))throw Error('INVALID_FLEET_COMMAND');}
 }
 if(b.kind==='REQUEST_VEHICLE'&&(b.capacity!==6||b.vehicleType!=='VAGONETA_6'))throw Error('INVALID_FLEET_VEHICLE');return result;
}
export function createWebFleetAdminService(pool){
 async function call(token,kind,body,key){
  const b=fleetAdminRequest(kind,body);if(kind==='command')actionKey(key);
  const c=await pool.connect();try{
   await assertRuntime(c,'nexo_app');await c.query(kind==='command'?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
   await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
   const args=kind==='context'?['SELECT nexo.web_fleet_context($1)AS r',[b.associationId]]:kind==='page'?['SELECT nexo.web_fleet_page($1,$2,$3,$4)AS r',[b.associationId,b.section,b.limit??50,b.cursor??null]]:['SELECT nexo.web_fleet_command($1,$2)AS r',[key,b]];
   const r=(await c.query(...args)).rows[0].r;await c.query('COMMIT');return r;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 return Object.freeze({context:(t,b)=>call(t,'context',b),page:(t,b)=>call(t,'page',b),command:(t,k,b)=>call(t,'command',b,k)});
}
