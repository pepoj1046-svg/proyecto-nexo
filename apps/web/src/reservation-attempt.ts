import type {WebSession} from './private-api';

export type ReservationPhase='IDLE'|'SENDING'|'UNCERTAIN'|'AUTH_REQUIRED'|'RECEIVED'|'REFRESH_FAILED'|'UPDATED';
export interface ReservationReceipt{storage:'EPHEMERAL_LAB';moneyProcessed:false;bookings:{bookingId:string;tripId:string;status:string;effectiveStatus:string;seats:number;priceBOB:string}[]}
export interface ReservationPage{bookings:{bookingId:string;status:string;effectiveStatus?:string;assignmentState?:string}[];total:number;nextCursor:unknown}
export interface AttemptView{phase:ReservationPhase;busy:boolean;error:string;receipt:ReservationReceipt|null;current:ReservationPage|null}
type Body=Record<string,unknown>;
interface Attempt{readonly account:string;readonly key:string;readonly body:Body}
interface Dependencies{
 session:()=>Promise<WebSession>;
 write:(a:Attempt,s:WebSession)=>Promise<unknown>;
 read:(s:WebSession)=>Promise<ReservationPage>;
 changed:(view:AttemptView)=>void;
 protect:(pending:boolean)=>void;
 authenticate:(account:string)=>void;
 frozen:()=>void;
}
const message=(e:unknown)=>e instanceof Error?(e.name==='AbortError'?'Se interrumpió la espera del servidor.':e instanceof TypeError&&/fetch|network|load/i.test(e.message)?'No se pudo contactar con el servidor.':e.message):'No se pudo consultar el servidor.';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function receipt(value:unknown):ReservationReceipt{
 const r=value as ReservationReceipt;
 if(!r||r.storage!=='EPHEMERAL_LAB'||r.moneyProcessed!==false||!Array.isArray(r.bookings)||r.bookings.length<1||r.bookings.length>6||
  r.bookings.some(b=>!b||typeof b.bookingId!=='string'||typeof b.tripId!=='string'||!uuid.test(b.bookingId)||!uuid.test(b.tripId)||typeof b.status!=='string'||typeof b.effectiveStatus!=='string'||!Number.isInteger(b.seats)||b.seats<1||b.seats>6||typeof b.priceBOB!=='string'||!/^\d+\.\d{2}$/.test(b.priceBOB))||new Set(r.bookings.map(b=>b.bookingId)).size!==r.bookings.length)throw Error('Respuesta incompleta. La respuesta puede haberse perdido; el resultado sigue incierto.');
 return freeze(structuredClone(r));
}

// One mounted APP intention, in RAM only. Never infer rollback from an HTTP error,
// match a receipt by route/price, refresh a quote, or schedule a background POST.
export class ReservationAttempt{
 private attempt:Attempt|null=null;
 private received:ReservationReceipt|null=null;
 private running=false;
 private disposed=false;
 private view:AttemptView={phase:'IDLE',busy:false,error:'',receipt:null,current:null};
 constructor(private readonly deps:Dependencies){}
 get pending(){return this.attempt!==null;}
 get hasReceipt(){return this.received!==null;}
 activate(){this.disposed=false;}
 private update(value:Partial<AttemptView>){this.view={...this.view,...value};if(!this.disposed)this.deps.changed(this.view);}
 private async actor(){
  let s:WebSession;
  try{s=await this.deps.session();}catch(e){
   if(e instanceof Error&&'status'in e&&e.status===401&&this.attempt){this.update({phase:'AUTH_REQUIRED',receipt:null,current:null});this.deps.protect(true);this.deps.authenticate(this.attempt.account);}
   throw e;
  }
  if(this.disposed)throw Error('La vista ya no está activa.');
  if(!s.authenticated||!s.accountRef||this.attempt&&s.accountRef!==this.attempt.account){
   this.update({phase:'AUTH_REQUIRED',receipt:null,current:null});
   if(this.attempt){this.deps.protect(true);this.deps.authenticate(this.attempt.account);}
   throw Error('Esta solicitud pertenece a la cuenta original. Inicia sesión con la cuenta original para consultar o reintentar.');
  }
  return s;
 }
 private async refresh(){
  const s=await this.actor();
  this.update({phase:this.received?'RECEIVED':'UNCERTAIN',current:null});
  const current=await this.deps.read(s);
  if(!current||!Array.isArray(current.bookings)||!Number.isInteger(current.total)||current.total<current.bookings.length||current.bookings.some(b=>typeof b.bookingId!=='string'||typeof b.status!=='string'))throw Error('No se recibió una consulta válida. Actualiza la consulta sin reenviar la reserva.');
  await this.actor(); // A late response must never populate a different account.
  this.update({phase:this.received?'UPDATED':'UNCERTAIN',current,receipt:this.received});
  if(this.received)this.deps.protect(false);
 }
 private async failure(e:unknown){
  if(this.disposed)return;
  if(this.attempt){try{await this.actor();}catch{this.update({phase:this.view.phase==='AUTH_REQUIRED'?'AUTH_REQUIRED':this.received?'REFRESH_FAILED':'UNCERTAIN',receipt:null,current:null,error:message(e)});return;}}
  this.update({phase:this.received?'REFRESH_FAILED':this.attempt?'UNCERTAIN':this.view.phase==='AUTH_REQUIRED'?'AUTH_REQUIRED':'IDLE',error:message(e),receipt:this.received,current:null});
 }
 async submit(account:string,makeBody:()=>Body){
  if(this.running||this.disposed||this.received)return;
  this.running=true;this.deps.protect(true);this.update({phase:'SENDING',busy:true,error:'',current:null});
  try{
   if(!this.attempt){
    if(!account)throw Error('Revisa la solicitud con la cuenta original antes de registrar.');
    this.attempt=freeze({account,key:crypto.randomUUID(),body:structuredClone(makeBody())});this.deps.frozen();
   }
   const s=await this.actor();
   this.received=receipt(await this.deps.write(this.attempt,s));
   await this.refresh();
  }catch(e){await this.failure(e);}
  finally{this.running=false;if(!this.attempt)this.deps.protect(false);this.update({busy:false});}
 }
 async consult(){
  if(this.running||this.disposed||!this.attempt)return;
  this.running=true;this.update({busy:true,error:'',current:null});
  try{await this.refresh();}catch(e){await this.failure(e);}finally{this.running=false;this.update({busy:false});}
 }
 dispose(){this.disposed=true;this.deps.protect(false);}
}
