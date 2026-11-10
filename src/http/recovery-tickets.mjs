import{randomBytes,randomUUID,createHmac,timingSafeEqual}from'node:crypto';
const ttl=1800000,fields=['v','app','environmentId','accountRef','family','key','createdAt','expiresAt','seal'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const error=code=>Object.assign(new Error(code),{status:code==='RECOVERY_UNAVAILABLE'?403:code==='RECOVERY_TICKET_EXPIRED'||code==='ENVIRONMENT_CHANGED'?410:400,code});
export function ticketShape(t){return!!t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).length===fields.length&&fields.every(k=>Object.hasOwn(t,k))&&t.v===1&&t.app==='proyecto-nexo/lab'&&t.family==='RESERVATION_APP'&&typeof t.environmentId==='string'&&uuid.test(t.environmentId)&&typeof t.accountRef==='string'&&/^[0-9a-f]{32}$/.test(t.accountRef)&&typeof t.key==='string'&&uuid.test(t.key)&&Number.isSafeInteger(t.createdAt)&&t.createdAt>=0&&Number.isSafeInteger(t.expiresAt)&&t.expiresAt===t.createdAt+ttl&&typeof t.seal==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t.seal)&&Buffer.byteLength(JSON.stringify(t))<=512;}
export function createRecoveryTickets({environmentId,origin,clock=Date.now,monotonic=()=>performance.now()}={}){
 const secret=randomBytes(32),baseWall=clock(),baseMono=monotonic();let lastWall=baseWall,lastElapsed=0,invalid=false;
 const now=()=>{const wall=clock(),elapsed=monotonic()-baseMono;if(!Number.isFinite(wall)||!Number.isFinite(elapsed)||elapsed<lastElapsed||wall<lastWall||Math.abs(wall-(baseWall+elapsed))>1000)invalid=true;lastWall=wall;lastElapsed=elapsed;if(invalid)throw error('ENVIRONMENT_CHANGED');return baseWall+elapsed;};
 const canonical=t=>JSON.stringify([t.v,t.app,origin,t.environmentId,t.accountRef,t.family,t.key,t.createdAt,t.expiresAt]);
 const sign=t=>createHmac('sha256',secret).update(canonical(t)).digest('base64url');
 function verify(t,account){
  if(!ticketShape(t))throw error('INVALID_RECOVERY_TICKET');now();
  // An old epoch cannot be authenticated after its signing secret is lost.
  // This generic classification discloses no account/receipt or current secret.
  if(t.environmentId!==environmentId)throw error('ENVIRONMENT_CHANGED');
  if(!timingSafeEqual(Buffer.from(sign(t)),Buffer.from(t.seal)))throw error('INVALID_RECOVERY_TICKET');
  if(t.accountRef!==account)throw error('RECOVERY_UNAVAILABLE');
  const time=now();if(t.createdAt>time||time>=t.expiresAt)throw error('RECOVERY_TICKET_EXPIRED');return t;
 }
 return Object.freeze({
  issue(account){if(typeof account!=='string'||!/^[0-9a-f]{32}$/.test(account))throw error('RECOVERY_UNAVAILABLE');const createdAt=Math.floor(now()),t={v:1,app:'proyecto-nexo/lab',environmentId,accountRef:account,family:'RESERVATION_APP',key:randomUUID(),createdAt,expiresAt:createdAt+ttl};return Object.freeze({...t,seal:sign(t)});},
  verify,observedAt:()=>Math.floor(now()),invalidate:()=>{invalid=true;},
  header(value,account,key){let t;try{if(typeof value!=='string'||Buffer.byteLength(value)>512)throw Error();t=JSON.parse(value);}catch{throw error('INVALID_RECOVERY_TICKET');}verify(t,account);if(t.key!==key)throw error('INVALID_RECOVERY_TICKET');return t;}
 });
}
