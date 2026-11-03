import{object,id,actionKey}from'../domain/business.mjs';import{directoryRequest}from'./web-directory-service.mjs';import{assertRuntime}from'./runtime.mjs';
const fields={CREATE_ROUTE:['sourceRouteId','spec'],CREATE_FARE:['routeId','spec'],EDIT:['draftId','spec'],VALIDATE:['draftId'],PUBLISH:['draftId'],RETIRE_ROUTE:['routeId'],RETIRE_FARE:['routeId','fareId']};
const fail=()=>{throw Error('INVALID_CONFIG_SPEC');};
const text=(v,min=0)=>{if(typeof v!=='string'||v.trim().length<min||v.length>100||/[\u0000-\u001f\u007f]/.test(v))fail();};
const exact=(v,keys)=>{object(v,keys);if(keys.some(k=>!Object.hasOwn(v,k)))fail();};
const nullableId=v=>{if(v!==null)id(v);};
export function configSpec(s){
 if(s&&Object.hasOwn(s,'points')){
  exact(s,['name','direction','originId','destinationId','points']);text(s.name,1);if(!['OUT','IN'].includes(s.direction)||!Array.isArray(s.points)||s.points.length>64)fail();nullableId(s.originId);nullableId(s.destinationId);
  for(const p of s.points){exact(p,['index','name','localityId','kind','boardingAllowed','alightingAllowed','mainDeparture']);text(p.name);nullableId(p.localityId);if(!Number.isInteger(p.index)||p.index<0||p.index>63||!['TERMINAL','URBAN','ROAD','UNCLASSIFIED'].includes(p.kind)||['boardingAllowed','alightingAllowed','mainDeparture'].some(k=>typeof p[k]!=='boolean'))fail();}
 }else{
  exact(s,['from','to','express','amountBOB','validFrom','validUntil','replaceFareId']);if(!Number.isInteger(s.from)||s.from<0||s.from>999999||!Number.isInteger(s.to)||s.to<0||s.to>999999||typeof s.express!=='boolean'||typeof s.amountBOB!=='string'||!/^\d{1,10}\.\d{2}$/.test(s.amountBOB))fail();nullableId(s.replaceFareId);
  for(const f of['validFrom','validUntil'])if(s[f]!==null&&(typeof s[f]!=='string'||!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(s[f])||!Number.isFinite(Date.parse(s[f]))))fail();
 }return s;
}
export function routeConfigRequest(kind,b){
 if(kind==='context'){object(b,['associationId','routeId']);id(b.associationId);if(b.routeId!==undefined)nullableId(b.routeId);return b;}
 if(kind==='detail'){object(b,['associationId','draftId']);id(b.associationId);id(b.draftId);return b;}
 if(kind==='page'){
  object(b,['associationId','routeId','section','limit','cursor']);id(b.associationId);if(b.routeId!==undefined)nullableId(b.routeId);
  if(!['ROUTE_DRAFTS','FARE_DRAFTS','FARES','HISTORY'].includes(b.section))throw Error('INVALID_CONFIG_SECTION');directoryRequest({associationId:b.associationId,section:'DRIVERS',limit:b.limit??50,cursor:b.cursor??null});return b;
 }
 if(kind!=='command'||typeof b?.kind!=='string'||!Object.hasOwn(fields,b.kind))throw Error('INVALID_CONFIG_COMMAND');
 object(b,['kind','associationId','revision','reason','confirmed',...fields[b.kind]]);id(b.associationId);
 if(b.confirmed!==true||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>200||typeof b.revision!=='string'||!/^[a-f0-9]{64}$/.test(b.revision))throw Error('INVALID_CONFIG_COMMAND');
 for(const field of fields[b.kind]){if(field==='spec')configSpec(b.spec);else if(field==='sourceRouteId'){if(b[field]!==undefined)nullableId(b[field]);}else id(b[field]);}
 if(b.kind==='CREATE_ROUTE'&&!Object.hasOwn(b.spec,'points')||b.kind==='CREATE_FARE'&&Object.hasOwn(b.spec,'points'))fail();return b;
}
export function createWebRouteConfigService(pool){
 async function call(token,kind,body,key){
  const b=routeConfigRequest(kind,body);if(kind==='command')actionKey(key);const c=await pool.connect();try{
   await assertRuntime(c,'nexo_app');await c.query(kind==='command'?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
   const args=kind==='context'?['SELECT nexo.web_config_context($1,$2)AS r',[b.associationId,b.routeId??null]]:kind==='detail'?['SELECT nexo.web_config_detail($1,$2)AS r',[b.associationId,b.draftId]]:kind==='page'?['SELECT nexo.web_config_page($1,$2,$3,$4,$5)AS r',[b.associationId,b.section,b.routeId??null,b.limit??50,b.cursor??null]]:['SELECT nexo.web_config_command($1,$2)AS r',[key,b]];
   const r=(await c.query(...args)).rows[0].r;await c.query('COMMIT');return r;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }return Object.freeze({context:(t,b)=>call(t,'context',b),detail:(t,b)=>call(t,'detail',b),page:(t,b)=>call(t,'page',b),command:(t,k,b)=>call(t,'command',b,k)});
}
