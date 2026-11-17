import{object,id,actionKey}from'../domain/business.mjs';
import{assertRuntime}from'./runtime.mjs';
const fields={
 RESPONSIBILITY:['bookingId','version','command','code','reason'],ABSENCE:['bookingId','episode','memberId','reason'],
 MINOR:['bookingId','episode','memberId','scenario','companionId','result'],REVIEW:['reportId','version','result','reason','factKey'],
 EXCEPTION:['bookingId','episode','command','targetTripId'],ACCOUNT:['tripId','userRef','enabled','reason']
};
const version=(n,max=2147483647)=>{if(!Number.isInteger(n)||n<0||n>max)throw new Error('INVALID_VERSION');};
const choice=(v,values)=>{if(!values.includes(v))throw new Error('INVALID_CARE_COMMAND');};
export function careCommand(b){
 if(!b||!Object.hasOwn(fields,b.kind))throw new Error('INVALID_CARE_COMMAND');object(b,['kind','confirmed',...fields[b.kind]]);
 if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
 for(const k of['bookingId','reportId','tripId','userRef'])if(fields[b.kind].includes(k))id(b[k]);
 if('episode'in b)version(b.episode,8);else if(fields[b.kind].includes('episode'))throw new Error('INVALID_VERSION');
 if(fields[b.kind].includes('version'))version(b.version);
 if(b.kind==='RESPONSIBILITY'){
  choice(b.command,['CREATE_OFFLINE','LINK_ACCOUNT','UNLINK_ACCOUNT','REPLACE_OFFLINE']);choice(b.reason,['IN_PERSON_SIMULATED','WRONG_LINK_CONFIRMED','WRONG_RESPONSIBLE_CONFIRMED']);
  if((b.command==='LINK_ACCOUNT')!==('code'in b)||'code'in b&&(typeof b.code!=='string'||!/^[a-f0-9]{64}$/.test(b.code)))throw new Error('INVALID_LINK_CODE');
 }else if(b.kind==='ABSENCE'){if('memberId'in b)id(b.memberId);choice(b.reason,['NOT_PRESENT_AT_BOARDING','PICKUP_NOT_PRESENT']);}
 else if(b.kind==='MINOR'){
  id(b.memberId);choice(b.scenario,['PARENT_ACCOMPANIED','AUTHORIZED_COMPANION','UNACCOMPANIED']);choice(b.result,['PENDING','VERIFIED_SIMULATED','REJECTED']);
  if((b.scenario==='UNACCOMPANIED')===('companionId'in b))throw new Error('INVALID_COMPANION');if('companionId'in b)id(b.companionId);
 }else if(b.kind==='REVIEW'){
  choice(b.result,['DOCUMENTED','PENDING_POLICY','NO_CHANGE','NATIVE_CORRECTION']);choice(b.reason,['EVIDENCE_REVIEWED','POLICY_REQUIRED','PHYSICAL_FACT_NOT_CONFIRMED','OPERATOR_ERROR','WRONG_RESERVATION','WRONG_MEMBER']);
  if((b.result==='NATIVE_CORRECTION')!==('factKey'in b)||'factKey'in b&&(typeof b.factKey!=='string'||!b.factKey||b.factKey.length>200))throw new Error('INVALID_CORRECTION_TARGET');
 }else if(b.kind==='EXCEPTION'){
  choice(b.command,['REQUEST_ALTERNATIVE','CANCEL_REQUEST','LATE_REPLACE','LATE_CANCEL']);if((b.command==='LATE_REPLACE')!==('targetTripId'in b))throw new Error('INVALID_TARGET');if('targetTripId'in b)id(b.targetTripId);
 }else if(b.kind==='ACCOUNT'){if(typeof b.enabled!=='boolean')throw new Error('INVALID_ACCOUNT_COMMAND');choice(b.reason,['ACCESS_REVIEW','ACCESS_REVOKED','ACCESS_RESTORED']);}
 return b;
}
export function createWebCareService(pool){
 async function tx(token,work){const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);if(!(await c.query('SELECT nexo.actor()AS id')).rows[0].id)throw new Error('UNAUTHENTICATED');const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const call=(token,query,values)=>tx(token,async c=>(await c.query(query,values)).rows[0].r);
 return Object.freeze({
  context:(token,b)=>{object(b,['bookingId']);return call(token,'SELECT nexo.care_context($1)AS r',[id(b.bookingId)]);},
  review:(token,b)=>{object(b,['reportId']);return call(token,'SELECT nexo.care_review_context($1)AS r',[id(b.reportId)]);},
  accounts:(token,b)=>{object(b,['tripId']);return call(token,'SELECT nexo.care_accounts($1)AS r',[id(b.tripId)]);},
  list:(token,b)=>{object(b,['limit','cursor']);const size=b.limit??50;version(size,100);if(!size)throw new Error('INVALID_PAGE');if(b.cursor!==null&&b.cursor!==undefined)id(b.cursor);return call(token,'SELECT nexo.care_responsible_list($1,$2)AS r',[size,b.cursor??null]);},
  code:(token,key,b)=>{object(b,['confirmed']);if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');actionKey(key);return call(token,'SELECT nexo.care_link_code($1,$2)AS r',[key,b.confirmed]);},
  command:(token,key,b)=>{
   careCommand(b);actionKey(key);
   switch(b.kind){
    case'RESPONSIBILITY':return call(token,'SELECT nexo.care_responsibility($1,$2,$3,$4,$5,$6,$7)AS r',[key,b.bookingId,b.version,b.command,b.code??null,b.reason,b.confirmed]);
    case'ABSENCE':return call(token,'SELECT nexo.care_absence($1,$2,$3,$4,$5,$6)AS r',[key,b.bookingId,b.episode,b.memberId??null,b.reason,b.confirmed]);
    case'MINOR':return call(token,'SELECT nexo.care_minor($1,$2,$3,$4,$5,$6,$7,$8)AS r',[key,b.bookingId,b.episode,b.memberId,b.scenario,b.companionId??null,b.result,b.confirmed]);
    case'REVIEW':return call(token,'SELECT nexo.care_review($1,$2,$3,$4,$5,$6,$7)AS r',[key,b.reportId,b.version,b.result,b.reason,b.factKey??null,b.confirmed]);
    case'EXCEPTION':return call(token,'SELECT nexo.care_exception($1,$2,$3,$4,$5,$6)AS r',[key,b.bookingId,b.episode,b.command,b.targetTripId??null,b.confirmed]);
    case'ACCOUNT':return call(token,'SELECT nexo.care_account_command($1,$2,$3,$4,$5,$6)AS r',[key,b.tripId,b.userRef,b.enabled,b.reason,b.confirmed]);
   }
  }
 });
}
