import{cleanRecoveryStorage}from'./recovery-ticket';
export class PrivateApiError extends Error{constructor(message:string,readonly status:number,readonly code:string){super(message);this.name='PrivateApiError';}}
export interface WebSession{authenticated:boolean;csrf:string;accountRef?:string;operator?:boolean;documentId:string;generation:number;environmentId:string}
const messages:Record<string,string>={CONFIG_BUSY:'Otra operación ocupa la configuración. Reintenta la misma intención con su clave.',STALE_CONFIG:'La configuración cambió. Consulta y confirma de nuevo.',STALE_CONFIG_VALIDATION:'Las dependencias cambiaron después de validar. Edita o valida de nuevo.',CONFIG_STATE_CONFLICT:'Ese estado ya fue publicado o retirado.',CONFIG_VALIDATION_REQUIRED:'Valida el borrador antes de publicarlo.',CONFIG_ROUTE_CONFLICT:'Ya existe esa ruta dirigida. Prepara una versión de la ruta existente.',CONFIG_ROUTE_RETIRED:'La ruta fue retirada para nuevas solicitudes.',CONFIG_FARE_OVERLAP:'La vigencia se solapa. Selecciona el predecesor compatible.',CONFIG_FARE_PREDECESSOR_CHANGED:'La tarifa predecesora cambió. Consulta la publicación actual.',INVALID_CONFIG_SPEC:'Revisa los campos y las referencias de la configuración.',FLEET_ADMIN_BUSY:'Administración ocupada por otra operación. Reintenta la misma actuación conservando su clave.',STALE_FLEET_STATE:'El estado cambió. Consulta y confirma una nueva actuación.',FLEET_IDENTITY_CONFLICT:'Ya existe esa solicitud o membresía. Usa la gestión de permisos existentes.',FLEET_VEHICLE_CONFLICT:'Código de vehículo reservado o duplicado. Requiere revisión.',FLEET_DECISION_CONFLICT:'La solicitud ya fue revisada.',FLEET_ASSIGNMENT_CONFLICT:'La asignación no es compatible con los vínculos actuales.',FLEET_IDENTITY_REVIEW_REQUIRED:'La identidad o atestación cambió. Requiere revisión humana.',FLEET_OPERATION_REVIEW_REQUIRED:'Hay actividad o custodia pendiente. No se cambió la asignación.',INVALID_FLEET_IDENTITY:'Código LAB no atestado, bloqueado o restringido.',INVALID_FLEET_DRIVER:'Chofer no habilitado técnicamente en esta asociación.',INVALID_FLEET_VEHICLE:'Vehículo incompatible o ajeno a esta asociación.',LAST_ADMIN_PROTECTED:'No se puede retirar al último administrador efectivo.',LAST_PLATFORM_ADMIN_PROTECTED:'La única autoridad general está protegida.',STALE_PLATFORM_STATE:'El estado administrativo cambió. Consulta y confirma una nueva actuación.',INVALID_PLATFORM_IDENTITY:'Identidad técnica no acreditada o no habilitada para esta delegación.',ADMIN_SCOPE_REVIEW_REQUIRED:'El alcance restringido requiere revisión; no se ampliaron permisos.',ADMIN_DECISION_CONFLICT:'La delegación ya tiene ese estado.',ASSOCIATION_CODE_CONFLICT:'Ese código de asociación ya está registrado.',INVALID_DRIVER_IDENTITY:'La identidad técnica está deshabilitada. Requiere revisión; restaurar DRIVER no activa una identidad ni sus sesiones.',INVALID_EXISTING_DRIVER:'No existe esa membresía DRIVER en la asociación autorizada.',STALE_DRIVER_ACCESS:'La membresía cambió. Consulta el estado actual antes de una nueva actuación.',DRIVER_SERVICE_REVIEW_REQUIRED:'Hay servicio, fila o custodia pendiente. Se necesita revisión administrativa; no se modificó el permiso.',STALE_RESPONSIBILITY:'El vínculo cambió. Consulta la revisión actual.',INVALID_LINK_CODE:'El código no es válido, ya se utilizó o su sesión ya no está activa.',RESPONSIBLE_REVIEW_REQUIRED:'Primero registra el responsable presencial ficticio bajo revisión administrativa.',RESPONSIBLE_ALREADY_REGISTERED:'Ya existe un responsable. Utiliza la corrección explícita y auditada.',ACCOUNT_ALREADY_LINKED:'Desvincula el acceso equivocado antes de enlazar otra cuenta.',MANAGED_RESPONSIBILITY_REQUIRED:'Este vínculo se gestiona mediante el procedimiento auditado de responsables.',NO_LINKED_ACCOUNT:'Esta reserva no tiene cuenta digital vinculada.',BOARDING_HISTORY_REVIEW_REQUIRED:'Existe historial de abordaje: la ausencia requiere revisión humana.',NO_ABSENCE_CANDIDATES:'No hay integrantes pendientes sin ausencia ya registrada.',LEGAL_POLICY_REVIEW_REQUIRED:'La autorización legal de este caso no está definida; queda bajo revisión humana.',MINOR_LINK_REVIEW_REQUIRED:'El contrato no permite cambiar automáticamente el tipo o acompañante. Requiere revisión humana.',PHYSICAL_REVIEW_REQUIRED:'Este hecho físico o traslado requiere revisión humana; no fue modificado.',STALE_REVIEW:'Otra persona revisó el reporte. Consulta su versión actual.',CUSTODY_REVIEW_REQUIRED:'La corrección afectaría un traslado seguro. No existe una reversión autorizada.',RESPONSIBILITY_CONSENT_REVIEW_REQUIRED:'El vínculo fue corregido y la decisión anterior no renueva autoridad. Se requiere revisión humana.',FRESH_RESPONSIBLE_DECISION_REQUIRED:'Hace falta una solicitud vigente del responsable actual.',HANDOFF_PENDING:'El sustituto debe completar la recepción y confirmación del traslado seguro antes de continuar.',RECEIVER_DRIVER_REQUIRED:'Solo el chofer receptor activo puede confirmar la recepción.',STALE_HANDOFF:'La recepción cambió. Consulta el estado actual.',RECEPTION_INCOMPLETE:'Todavía faltan personas por recibir; no se puede confirmar el traslado seguro.',ALREADY_RECEIVED:'Esta persona ya tiene recepción registrada.',ASSIGNMENT_NOT_DECLINABLE:'La reserva está asignada por turno. Si hay un impedimento real, reporta una incidencia.',NO_DRIVER_DECISION_REQUIRED:'Esta reserva no requiere aceptación del chofer.',CONDITION_REJECTED:'El responsable rechazó estas condiciones. Se requiere revisión; no se registró el abordaje.',DECISION_CONFLICT:'Ya existe una decisión distinta para esta versión. Actualiza la consulta.',NO_CAPACITY:'Ya no hay plazas suficientes. Vuelve a consultar una alternativa sin cambiar el intento anterior.',FORBIDDEN_SCOPE:'Esta cuenta no administra esta ruta o terminal.',INVALID_CANCELLATION:'Revisa el motivo técnico y la confirmación de cancelación.',PAGE_CHANGED:'El listado cambió durante la consulta. Pulsa Actualizar para comenzar de nuevo; no se mezclaron páginas.',INVALID_CURSOR:'Esta página no corresponde al listado actual. Actualiza la consulta.',STALE_CONDITION:'Las condiciones declaradas cambiaron. Consulta y revisa la versión vigente.',PASSENGERS_ONBOARD:'Todavía hay personas observadas a bordo. Registra los descensos reales de laboratorio antes de continuar.',TRIP_ALREADY_STARTED:'El grupo ya inició su recorrido; esta cancelación no está permitida.',ALREADY_ACTIVE:'Ya existe una asignación activa para el vehículo o chofer. Actualiza tu operación.',NOT_AVAILABLE:'El viaje todavía no está disponible para volver a fila.',STALE_PREVIOUS_TRIP:'Existe un viaje posterior. Consulta la última asignación.',INVALID_DESTINATION_QUEUE:'La fila elegida no corresponde al destino o la asociación.',INVALID_RECOVERY_STATE:'El estado actual no permite rehabilitar esta unidad. Consulta la incidencia.',QUEUE_ORDER:'La solicitud no corresponde al primer vehículo compatible. Actualiza la fila antes de elegir.',NO_COMPATIBLE_TRANSFER:'El vehículo propuesto no admite el traslado completo. Actualiza las opciones.',NO_FREE_REPLACEMENT:'No hay un vehículo completamente libre compatible. Se requiere gestión humana.',STALE_OPERATION:'La incidencia cambió. Actualiza el estado antes de otra acción.',STALE_ASSIGNMENT:'La asignación cambió. Actualiza tu consulta.',STALE_CONSENT:'El grupo o la asignación cambió. Hace falta un consentimiento vigente.',CONSENT_USED:'Este consentimiento ya fue utilizado. Consulta la asignación actual.',SAFE_TRANSFER_REQUIRED:'Declara el traslado seguro observado antes de reasignar pasajeros abordados.',ADMIN_TERMINAL_CHOICE_REQUIRED:'Selecciona la terminal prioritaria y la primera opción autorizada actual.',PRESENCE_REQUIRED:'Verifica presencialmente la llegada antes de adelantar el grupo.',ADMIN_REVIEW_REQUIRED:'Este caso necesita revisión administrativa; no se realizó un traslado parcial.',AUTHENTICATION_REQUIRED:'Tu sesión caducó o fue revocada. Inicia sesión de nuevo.',UNAUTHENTICATED:'Tu sesión caducó o fue revocada. Inicia sesión de nuevo.',INVALID_CREDENTIALS:'Acceso no válido. Comprueba los datos ficticios o espera antes de reintentar.',CSRF_REQUIRED:'Actualiza tu sesión antes de continuar.',FORBIDDEN:'Esta cuenta no tiene permiso para esta operación.',RATE_LIMITED:'Demasiados intentos. Espera antes de reintentar.'};
// Each ES module instance belongs to one document. No proof is persisted or
// broadcast. Cookies alone can only bootstrap a new anonymous document.
let capability:WebSession|null=null,revision=0,lastAccount:string|null=null;
let lock:{account:string|null}|null=null;
const listeners=new Set<()=>void>();
export const subscribeDocument=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};};
export const documentLock=()=>lock;
export function suspendDocument(){
 if(!lock)lock={account:capability?.accountRef??lastAccount};
 capability=null;revision++;sessionRead=null;
 for(const f of listeners)f();
}
export function unlockDocument(s:WebSession){
 if(!s.authenticated||lock?.account&&s.accountRef!==lock.account)return false;
 lock=null;for(const f of listeners)f();return true;
}
const stale=()=>new PrivateApiError('El contexto cambió. Autentica la cuenta original antes de consultar de nuevo.',401,'AUTHENTICATION_REQUIRED');
function validSession(value:WebSession){return typeof value.documentId==='string'&&/^[0-9a-f-]{36}$/.test(value.documentId)&&Number.isSafeInteger(value.generation)&&typeof value.csrf==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.csrf)&&typeof value.environmentId==='string';}
async function request<T>(path:string,body?:unknown,csrf?:string,key?:string,ticket?:unknown,bootstrap=false):Promise<T>{
 if(lock&&!['/api/session','/api/login'].includes(path))throw stale();
 const frame=revision,proof=bootstrap?null:capability;
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);
 try{
  const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',signal:c.signal,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(proof?{'X-Nexo-Document':proof.documentId,'X-Nexo-Generation':String(proof.generation)}:{}),...((csrf??proof?.csrf)?{'X-CSRF-Token':csrf??proof!.csrf}:{}),...(key?{'Idempotency-Key':key}:{}),...(ticket?{'X-Nexo-Recovery-Ticket':JSON.stringify(ticket)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();
  // A response cannot repopulate the UI after pagehide or an authority change.
  if(frame!==revision||!bootstrap&&proof!==capability)throw stale();
  if(!r.ok)throw new PrivateApiError(messages[data.error]??`La operación no pudo completarse (${data.error??'error del servicio'}).`,r.status,typeof data.error==='string'?data.error:'REQUEST_REJECTED');
  if(path==='/api/session'||path==='/api/login'){
   if(!validSession(data))throw stale();
   if(path==='/api/session'&&proof&&(data.documentId!==proof.documentId||data.generation!==proof.generation||data.csrf!==proof.csrf||data.environmentId!==proof.environmentId))throw stale();
   if(path==='/api/login'){revision++;capability=data;lastAccount=data.accountRef??null;cleanRecoveryStorage(data.accountRef??null,data.environmentId);}
   else if(!proof)capability=data;
  }else if(path==='/api/logout'){revision++;capability=null;lastAccount=null;cleanRecoveryStorage(null);}
  return data;
 }finally{clearTimeout(timer);}
}
let sessionRead:Promise<unknown>|null=null,authenticationWrite:Promise<unknown>|null=null;
function sharedSession<T>():Promise<T>{
 if(!sessionRead){const pending=request<unknown>('/api/session');sessionRead=pending;const clear=()=>{if(sessionRead===pending)sessionRead=null;};void pending.then(clear,clear);}
 return sessionRead as Promise<T>;
}
// Only an explicit password submission may replace an expired/revoked context
// with a new anonymous bootstrap. No business operation is retried here.
export async function prepareLogin():Promise<WebSession>{
 try{return await privateApi<WebSession>('/api/session');}catch(e){
  if(!(e instanceof PrivateApiError)||![401,403].includes(e.status))throw e;
  capability=null;revision++;return privateApi<WebSession>('/api/session');
 }
}
export function privateApi<T>(path:string,body?:unknown,csrf?:string,key?:string,ticket?:unknown):Promise<T>{
 if(body!==undefined&&(path==='/api/login'||path==='/api/logout')){
  const write=authenticationWrite,read=sessionRead,frame=revision;
  const pending=(async()=>{if(write)await write.catch(()=>undefined);if(read)await read.catch(()=>undefined);if(frame!==revision)throw stale();return request<T>(path,body,csrf,key,ticket);})();
  authenticationWrite=pending;const clear=()=>{if(authenticationWrite===pending)authenticationWrite=null;};void pending.then(clear,clear);return pending;
 }
 if(path==='/api/session'&&body===undefined)return(async()=>{
  while(authenticationWrite){const write=authenticationWrite;await write.catch(()=>undefined);if(authenticationWrite===write)break;}
  return sharedSession<T>();
 })();
 return request<T>(path,body,csrf,key,ticket);
}
