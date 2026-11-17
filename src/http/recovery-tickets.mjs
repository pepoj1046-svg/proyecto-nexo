import{randomBytes,randomUUID,createHmac,timingSafeEqual}from'node:crypto';
const ttl=1800000,fields=['v','app','environmentId','accountRef','family','key','createdAt','expiresAt','seal'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const error=code=>Object.assign(new Error(code),{status:code==='RECOVERY_UNAVAILABLE'?403:code==='RECOVERY_TICKET_EXPIRED'||code==='ENVIRONMENT_CHANGED'?410:400,code});
export function ticketShape(t){return!!t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).length===fields.length&&fields.every(k=>Object.hasOwn(t,k))&&t.v===1&&t.app==='proyecto-nexo/lab'&&t.family==='RESERVATION_APP'&&typeof t.environmentId==='string'&&uuid.test(t.environmentId)&&typeof t.accountRef==='string'&&/^[0-9a-f]{32}$/.test(t.accountRef)&&typeof t.key==='string'&&uuid.test(t.key)&&Number.isSafeInteger(t.createdAt)&&t.createdAt>=0&&Number.isSafeInteger(t.expiresAt)&&t.expiresAt===t.createdAt+ttl&&typeof t.seal==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t.seal)&&Buffer.byteLength(JSON.stringify(t))<=512;}
// One epoch = signing secret + environmentId + monotonic anchor, all in RAM.
// After invalidation the caller may regenerate a NEW epoch (D2-B, 5A.4-B3): the old
// secret is dropped, so a ticket of a previous epoch can never authenticate again.
export function createRecoveryTickets({environmentId,origin,clock=Date.now,monotonic=()=>performance.now(),newEnvironmentId=randomUUID}={}){
 let epoch;
 const anchor=id=>{const wall=clock(),mono=monotonic();epoch={id,secret:randomBytes(32),baseWall:wall,baseMono:mono,lastWall:wall,lastElapsed:0,invalid:false};};
 anchor(environmentId);
 const now=()=>{const e=epoch,wall=clock(),elapsed=monotonic()-e.baseMono;if(!Number.isFinite(wall)||!Number.isFinite(elapsed)||elapsed<e.lastElapsed||wall<e.lastWall||Math.abs(wall-(e.baseWall+elapsed))>1000)e.invalid=true;e.lastWall=wall;e.lastElapsed=elapsed;if(e.invalid)throw error('ENVIRONMENT_CHANGED');return e.baseWall+elapsed;};
 const canonical=t=>JSON.stringify([t.v,t.app,origin,t.environmentId,t.accountRef,t.family,t.key,t.createdAt,t.expiresAt]);
 const sign=(t,e=epoch)=>createHmac('sha256',e.secret).update(canonical(t)).digest('base64url');
 function verify(t,account){
  if(!ticketShape(t))throw error('INVALID_RECOVERY_TICKET');const e=epoch;now();
  // An old epoch cannot be authenticated after its signing secret is lost.
  // This generic classification discloses no account/receipt or current secret.
  if(t.environmentId!==e.id)throw error('ENVIRONMENT_CHANGED');
  if(!timingSafeEqual(Buffer.from(sign(t,e)),Buffer.from(t.seal)))throw error('INVALID_RECOVERY_TICKET');
  if(t.accountRef!==account)throw error('RECOVERY_UNAVAILABLE');
  const time=now();if(epoch!==e)throw error('ENVIRONMENT_CHANGED');if(t.createdAt>time||time>=t.expiresAt)throw error('RECOVERY_TICKET_EXPIRED');return t;
 }
 return Object.freeze({
  issue(account){if(typeof account!=='string'||!/^[0-9a-f]{32}$/.test(account))throw error('RECOVERY_UNAVAILABLE');const e=epoch,createdAt=Math.floor(now()),t={v:1,app:'proyecto-nexo/lab',environmentId:e.id,accountRef:account,family:'RESERVATION_APP',key:randomUUID(),createdAt,expiresAt:createdAt+ttl};if(epoch!==e)throw error('ENVIRONMENT_CHANGED');return Object.freeze({...t,seal:sign(t,e)});},
  verify,observedAt:()=>Math.floor(now()),invalidate:()=>{epoch.invalid=true;},
  get invalid(){return epoch.invalid;},get environmentId(){return epoch.id;},
  // Only a caller that has just re-verified the database marker may call this.
  // A valid epoch is never replaced; there is no timer or loop here.
  regenerate(){if(!epoch.invalid)return epoch.id;const old=epoch.id;let id;do id=newEnvironmentId();while(id===old);anchor(id);return id;},
  header(value,account,key){let t;try{if(typeof value!=='string'||Buffer.byteLength(value)>512)throw Error();t=JSON.parse(value);}catch{throw error('INVALID_RECOVERY_TICKET');}verify(t,account);if(t.key!==key)throw error('INVALID_RECOVERY_TICKET');return t;}
 });
}
