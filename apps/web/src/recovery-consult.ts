import type{WebSession}from'./private-api';
import type{RecoveryTicket,RestoredTickets}from'./recovery-ticket';
// 5A.4-B3: client states of a restored APP reservation reference (design §7). They are
// NOT reservation states. Reading only: no path here reserves, resends, rebuilds a body,
// accepts conditions or cancels. Receipt and current state live only in RAM.
export type ConsultPhase='LISTA'|'CONSULTANDO'|'INCIERTA'|'RECIBO'|'LECTURA_PENDIENTE'|'ACTUALIZADA'|'REVISION'|'INVALIDA'|'AUTENTICAR';
export interface HistoricReceipt{readonly operation:'reserve'|'reserve_enroute';readonly groupId:string;readonly bookingIds:readonly string[];readonly originalStatus:string}
export interface CurrentBooking{readonly bookingId:string;readonly status:string;readonly effectiveStatus?:string;readonly assignmentState?:string}
export interface CurrentPage{bookings:CurrentBooking[];total:number;nextCursor:unknown}
export interface ConsultView{readonly key:string;readonly phase:ConsultPhase;readonly busy:boolean;readonly error:string;readonly receipt:HistoricReceipt|null;readonly current:readonly CurrentBooking[]|null;readonly consulted:boolean;readonly expiresAt:number|null}
export interface RecoverySnapshot{readonly account:string|null;readonly fault:boolean;readonly items:readonly ConsultView[]}
export interface ConsultDeps{
 session():Promise<WebSession>;
 receipt(s:WebSession,t:RecoveryTicket):Promise<unknown>;
 page(s:WebSession,cursor:unknown):Promise<CurrentPage>;
 retire(t:RecoveryTicket):void;
 forget(account:string,key:string):void;
 acknowledge(account:string):void;
 reauthenticate():void;
 now():number;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_CURRENT_PAGES=10;
const statusOf=(e:unknown)=>e&&typeof e==='object'&&'status'in e&&typeof e.status==='number'?e.status:0;
const codeOf=(e:unknown)=>e&&typeof e==='object'&&'code'in e&&typeof e.code==='string'?e.code:'';
const transport=(e:unknown)=>e instanceof Error&&e.name==='AbortError'?'Se interrumpió la espera del servidor.':statusOf(e)===429?'El servidor limitó las consultas. Espera un momento y vuelve a consultar.':statusOf(e)===503?'El servidor no pudo verificar la referencia ahora.':'No se pudo contactar con el servidor.';
export function parseReceipt(value:unknown,t:RecoveryTicket):{state:'NOT_OBSERVED'}|{state:'RECORDED';receipt:HistoricReceipt}{
 const v=value as Record<string,unknown>;
 if(!v||typeof v!=='object'||v.family!=='RESERVATION_APP'||v.key!==t.key||v.environmentId!==t.environmentId)throw Error('INVALID_RESPONSE');
 if(v.state==='NOT_OBSERVED'&&v.receipt===undefined)return{state:'NOT_OBSERVED'};
 const r=v.receipt as Record<string,unknown>;
 if(v.state!=='RECORDED'||!r||typeof r!=='object'||Object.keys(r).length!==4||(r.operation!=='reserve'&&r.operation!=='reserve_enroute')||typeof r.groupId!=='string'||!uuid.test(r.groupId)||!Array.isArray(r.bookingIds)||r.bookingIds.length<1||r.bookingIds.length>6||!r.bookingIds.every(id=>typeof id==='string'&&uuid.test(id))||new Set(r.bookingIds).size!==r.bookingIds.length||typeof r.originalStatus!=='string'||!/^[A-Z_]{1,40}$/.test(r.originalStatus))throw Error('INVALID_RESPONSE');
 return{state:'RECORDED',receipt:Object.freeze({operation:r.operation,groupId:r.groupId,bookingIds:Object.freeze([...r.bookingIds as string[]]),originalStatus:r.originalStatus})};
}
interface Entry{ticket:RecoveryTicket|null;view:ConsultView}
export class RecoveryStore{
 private account:string|null=null;private environment:string|null=null;private fault=false;
 private entries=new Map<string,Entry>();private generation=0;
 private snap:RecoverySnapshot=Object.freeze({account:null,fault:false,items:Object.freeze([])});
 private listeners=new Set<()=>void>();
 constructor(private readonly deps:ConsultDeps){}
 subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
 snapshot=()=>this.snap;
 private publish(){this.snap=Object.freeze({account:this.account,fault:this.fault,items:Object.freeze([...this.entries.values()].map(e=>e.view))});for(const f of this.listeners)f();}
 private set(e:Entry,v:Partial<ConsultView>){e.view=Object.freeze({...e.view,...v});this.publish();}
 private alive(g:number,e:Entry){return g===this.generation&&this.entries.get(e.view.key)===e;}
 // Called only with the authenticated capability of this document (or null). Another
 // account or a locked document drops every RAM view and every late callback.
 sync(s:WebSession|null,restored:RestoredTickets){
  const account=s?.authenticated&&s.accountRef?s.accountRef:null;
  if(account!==this.account||!account||s!.environmentId!==this.environment){this.generation++;this.entries.clear();}
  this.account=account;this.environment=account?s!.environmentId:null;this.fault=!!account&&restored.fault;
  if(account){
   const empty={busy:false,error:'',receipt:null,current:null,consulted:false};
   for(const t of restored.valid)if(!this.entries.has(t.key))this.entries.set(t.key,{ticket:t,view:Object.freeze({...empty,key:t.key,phase:'LISTA',expiresAt:t.expiresAt})});
   for(const t of restored.expired)if(!this.entries.has(t.key))this.entries.set(t.key,{ticket:t,view:Object.freeze({...empty,key:t.key,phase:'INVALIDA',consulted:true,expiresAt:t.expiresAt})});
   for(const key of restored.invalid)if(!this.entries.has(key))this.entries.set(key,{ticket:null,view:Object.freeze({...empty,key,phase:'INVALIDA',consulted:true,expiresAt:null})});
  }
  this.publish();
 }
 // D3: no new APP reservation while a restored reference of this account has never
 // received a server classification (consulted once) and was not discarded.
 blocksNewReservation(account:string|null|undefined){return!!account&&account===this.account&&[...this.entries.values()].some(e=>!e.view.consulted&&['LISTA','CONSULTANDO','INCIERTA','AUTENTICAR'].includes(e.view.phase));}
 async consult(key:string){
  const e=this.entries.get(key);if(!e||!e.ticket||e.view.busy||!['LISTA','INCIERTA','LECTURA_PENDIENTE','AUTENTICAR'].includes(e.view.phase))return;
  const t=e.ticket,g=this.generation,account=this.account!;
  if(this.deps.now()>=t.expiresAt){this.invalidate(e);return;}
  const prior=e.view.receipt;
  this.set(e,{phase:'CONSULTANDO',busy:true,error:'',current:null});
  let receipt:HistoricReceipt|null=null;
  try{
   const s=await this.deps.session();if(!this.alive(g,e))return;
   if(!s.authenticated||s.accountRef!==account){this.set(e,{phase:'AUTENTICAR',busy:false,receipt:null});this.deps.reauthenticate();return;}
   if(s.environmentId!==t.environmentId){this.invalidate(e);return;}
   let raw:unknown;
   try{raw=await this.deps.receipt(s,t);}catch(x){if(!this.alive(g,e))return;this.rejected(e,x,prior);return;}
   if(!this.alive(g,e))return;
   let parsed;try{parsed=parseReceipt(raw,t);}catch{this.set(e,{phase:prior?'LECTURA_PENDIENTE':'INCIERTA',busy:false,receipt:prior,error:'Respuesta incompleta. El resultado sigue sin confirmarse; puedes volver a consultar.'});return;}
   if(parsed.state==='NOT_OBSERVED'){this.set(e,{phase:'INCIERTA',busy:false,consulted:true,receipt:null});return;}
   receipt=parsed.receipt;this.set(e,{phase:'RECIBO',consulted:true,receipt});
   const wanted=new Set(receipt.bookingIds),found=new Map<string,CurrentBooking>();let cursor:unknown=null;
   try{
    for(let i=0;i<MAX_CURRENT_PAGES&&found.size<wanted.size;i++){
     const s2=await this.deps.session();if(!this.alive(g,e))return;
     if(!s2.authenticated||s2.accountRef!==account){this.set(e,{phase:'AUTENTICAR',busy:false,receipt:null,current:null});this.deps.reauthenticate();return;}
     const p=await this.deps.page(s2,cursor);if(!this.alive(g,e))return;
     if(!p||!Array.isArray(p.bookings)||p.bookings.some(b=>!b||typeof b.bookingId!=='string'||typeof b.status!=='string'))throw Error('INVALID_PAGE');
     for(const b of p.bookings)if(wanted.has(b.bookingId))found.set(b.bookingId,Object.freeze({bookingId:b.bookingId,status:b.status,effectiveStatus:b.effectiveStatus,assignmentState:b.assignmentState}));
     if(p.nextCursor===null||p.nextCursor===undefined)break;cursor=p.nextCursor;
    }
    const s3=await this.deps.session();if(!this.alive(g,e))return;// late page must not populate another account
    if(!s3.authenticated||s3.accountRef!==account){this.set(e,{phase:'AUTENTICAR',busy:false,receipt:null,current:null});this.deps.reauthenticate();return;}
   }catch(x){if(!this.alive(g,e))return;if(statusOf(x)===401){this.set(e,{phase:'AUTENTICAR',busy:false,receipt:null,current:null});this.deps.reauthenticate();return;}this.set(e,{phase:'LECTURA_PENDIENTE',busy:false,error:'No se pudo consultar el estado actual. El registro anterior sigue confirmado; vuelve a consultar sin repetir la reserva.'});return;}
   if(found.size<wanted.size){this.set(e,{phase:'LECTURA_PENDIENTE',busy:false,current:Object.freeze(receipt.bookingIds.filter(id=>found.has(id)).map(id=>found.get(id)!)),error:'La consulta actual no incluyó todas las reservas del registro. Vuelve a consultar más tarde.'});return;}
   this.set(e,{phase:'ACTUALIZADA',busy:false,current:Object.freeze(receipt.bookingIds.map(id=>found.get(id)!))});this.deps.retire(t);e.ticket=null;
  }catch(x){if(!this.alive(g,e))return;if(statusOf(x)===401){this.set(e,{phase:'AUTENTICAR',busy:false,receipt:null,current:null});this.deps.reauthenticate();return;}this.set(e,{phase:receipt||prior?'LECTURA_PENDIENTE':'INCIERTA',busy:false,receipt:receipt??prior,error:transport(x)});}
 }
 private rejected(e:Entry,x:unknown,prior:HistoricReceipt|null){
  const status=statusOf(x),code=codeOf(x);
  if(status===401){this.set(e,{phase:'AUTENTICAR',busy:false,receipt:null,current:null});this.deps.reauthenticate();return;}
  if(status===403&&code==='RECOVERY_UNAVAILABLE'){this.set(e,{phase:'REVISION',busy:false,consulted:true,receipt:null,current:null});return;}
  if(status===410||status===400&&code==='INVALID_RECOVERY_TICKET'){this.invalidate(e);return;}
  // 429/503/transport keep the uncertainty: never a rollback, never a resend.
  this.set(e,{phase:prior?'LECTURA_PENDIENTE':'INCIERTA',busy:false,receipt:prior,error:transport(x)});
 }
 private invalidate(e:Entry){if(e.ticket){this.deps.retire(e.ticket);e.ticket=null;}this.set(e,{phase:'INVALIDA',busy:false,consulted:true,receipt:null,current:null,error:''});}
 // Explicit local discard/close: only the local aid is removed. In-flight responses for
 // this reference are ignored afterwards. Nothing is cancelled or released.
 discard(key:string){const e=this.entries.get(key);if(!e||!this.account)return;if(e.ticket)this.deps.retire(e.ticket);this.deps.forget(this.account,key);this.entries.delete(key);this.publish();}
 acknowledgeFault(){if(this.account){this.deps.acknowledge(this.account);this.fault=false;this.publish();}}
}
