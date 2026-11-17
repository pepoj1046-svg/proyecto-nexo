import type{WebSession}from'./private-api';
export interface RecoveryTicket{v:1;app:'proyecto-nexo/lab';environmentId:string;accountRef:string;family:'RESERVATION_APP';key:string;createdAt:number;expiresAt:number;seal:string}
const fields=['v','app','environmentId','accountRef','family','key','createdAt','expiresAt','seal'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isRecoveryTicket(t:unknown):t is RecoveryTicket{
 if(!t||typeof t!=='object'||Array.isArray(t))return false;const a=t as RecoveryTicket;
 return Object.keys(t).length===fields.length&&fields.every(k=>Object.hasOwn(t,k))&&a.v===1&&a.app==='proyecto-nexo/lab'&&a.family==='RESERVATION_APP'&&typeof a.environmentId==='string'&&uuid.test(a.environmentId)&&typeof a.accountRef==='string'&&/^[0-9a-f]{32}$/.test(a.accountRef)&&typeof a.key==='string'&&uuid.test(a.key)&&Number.isSafeInteger(a.createdAt)&&a.createdAt>=0&&Number.isSafeInteger(a.expiresAt)&&a.expiresAt===a.createdAt+1800000&&typeof a.seal==='string'&&/^[A-Za-z0-9_-]{43}$/.test(a.seal)&&new TextEncoder().encode(JSON.stringify(t)).length<=512;
}
export function checkedTicket(t:unknown,s:WebSession):RecoveryTicket{if(!isRecoveryTicket(t)||!s.authenticated||t.accountRef!==s.accountRef||t.environmentId!==s.environmentId)throw Error('Referencia de recuperación no válida para la cuenta original. No se envió otra reserva.');return Object.freeze({...t});}
// B2 writes/retires this closed namespace; B3 reads it only after the document
// authenticated. Nothing here restores a form, fetches on boot or resends.
const namespace='nexo.lab.recovery.v1';
const storage=()=>{const value=globalThis.sessionStorage;if(!value)throw Error('STORAGE_UNAVAILABLE');return value;};
function entries(store:Storage){const raw=store.getItem(namespace);if(raw===null)return[] as RecoveryTicket[];if(new TextEncoder().encode(raw).length>8192)throw Error('STORAGE_INVALID');const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!('v'in value)||value.v!==1||!('tickets'in value)||!Array.isArray(value.tickets)||value.tickets.length>8||!value.tickets.every(isRecoveryTicket)||new Set(value.tickets.map(t=>t.key)).size!==value.tickets.length)throw Error('STORAGE_INVALID');return value.tickets as RecoveryTicket[];}
// RAM only, per document. Keys saved by this document belong to live attempts and are
// never presented as restored. References of the same account from another run are
// remembered as opaque keys so their owner sees «Inválida»; nothing else is kept.
const live=new Set<string>();
let stale:{account:string;key:string}[]=[],fault:string|null=null;
const remember=(account:string,keys:string[])=>{stale=[...stale.filter(a=>a.account===account),...keys.filter(k=>!stale.some(a=>a.account===account&&a.key===k)).map(key=>({account,key}))].slice(-8);};
function put(store:Storage,tickets:RecoveryTicket[]){if(!tickets.length){store.removeItem(namespace);if(store.getItem(namespace)!==null)throw Error('STORAGE_UNAVAILABLE');return;}const raw=JSON.stringify({v:1,tickets});if(tickets.length>8||new TextEncoder().encode(raw).length>8192)throw Error('STORAGE_FULL');store.setItem(namespace,raw);if(store.getItem(namespace)!==raw)throw Error('STORAGE_UNAVAILABLE');}
export function saveRecoveryTicket(t:RecoveryTicket,s:WebSession){try{checkedTicket(t,s);const store=storage(),all=entries(store);if(all.some(a=>a.accountRef!==s.accountRef||a.environmentId!==s.environmentId))throw Error('STORAGE_ACCOUNT');const existing=all.find(a=>a.key===t.key);if(existing&&JSON.stringify(existing)!==JSON.stringify(t))throw Error('STORAGE_CONFLICT');put(store,existing?all:[...all,t]);live.add(t.key);}catch{throw Error('No se pudo guardar la referencia local. La reserva no se enviará hasta guardar el mismo ticket válido; no se activó un modo alternativo.');}}
export function retireRecoveryTicket(t:RecoveryTicket){live.delete(t.key);try{const store=storage();put(store,entries(store).filter(a=>a.key!==t.key||a.seal!==t.seal));}catch{/* No authority comes from local storage; a failed cleanup cannot resend. */}}
export function cleanRecoveryStorage(account:string|null,environment?:string){if(account===null){stale=[];fault=null;live.clear();}else{stale=stale.filter(a=>a.account===account);if(fault!==account)fault=null;}try{const store=storage(),all=entries(store);if(account!==null)remember(account,all.filter(a=>a.accountRef===account&&a.environmentId!==environment).map(a=>a.key));put(store,account===null?[]:all.filter(a=>a.accountRef===account&&a.environmentId===environment));return true;}catch{if(account!==null)fault=account;try{storage().removeItem(namespace);}catch{}return false;}}
export interface RestoredTickets{valid:readonly RecoveryTicket[];expired:readonly RecoveryTicket[];invalid:readonly string[];fault:boolean}
const none:RestoredTickets=Object.freeze({valid:[],expired:[],invalid:[],fault:false});
// Only after the gate: an anonymous or locked document learns nothing, not even a count.
// The local clock only hides an obviously expired reference; the server decides validity.
export function readRecoveryTickets(s:WebSession|null,now=Date.now()):RestoredTickets{
 if(!s?.authenticated||!s.accountRef)return none;
 const account=s.accountRef;let all:RecoveryTicket[]=[],broken=fault===account;
 try{const store=storage();all=entries(store);const keep=all.filter(a=>a.accountRef===account&&a.environmentId===s.environmentId);
  if(keep.length!==all.length){remember(account,all.filter(a=>a.accountRef===account&&a.environmentId!==s.environmentId).map(a=>a.key));put(store,keep);}all=keep;}
 catch{broken=true;all=[];}
 const mine=all.filter(a=>!live.has(a.key));
 return Object.freeze({valid:Object.freeze(mine.filter(a=>now<a.expiresAt).map(a=>Object.freeze({...a}))),expired:Object.freeze(mine.filter(a=>now>=a.expiresAt).map(a=>Object.freeze({...a}))),invalid:Object.freeze(stale.filter(a=>a.account===account).map(a=>a.key)),fault:broken});
}
export function forgetInvalidRecovery(account:string,key:string){stale=stale.filter(a=>a.account!==account||a.key!==key);}
export function acknowledgeRecoveryFault(account:string){if(fault===account)fault=null;}
