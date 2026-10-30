export interface WebSession{authenticated:boolean;csrf:string;accountRef?:string;operator?:boolean}
const messages:Record<string,string>={FORBIDDEN_SCOPE:'Esta cuenta no administra esta ruta o terminal.',INVALID_CANCELLATION:'Revisa el motivo técnico y la confirmación de cancelación.',PAGE_CHANGED:'El listado cambió durante la consulta. Pulsa Actualizar para comenzar de nuevo; no se mezclaron páginas.',INVALID_CURSOR:'Esta página no corresponde al listado actual. Actualiza la consulta.',STALE_CONDITION:'Las condiciones declaradas cambiaron. Consulta y revisa la versión vigente.',PASSENGERS_ONBOARD:'Todavía hay personas observadas a bordo. Registra los descensos reales de laboratorio antes de continuar.',TRIP_ALREADY_STARTED:'El grupo ya inició su recorrido; esta cancelación no está permitida.',ALREADY_ACTIVE:'Ya existe una asignación activa para el vehículo o chofer. Actualiza tu operación.',NOT_AVAILABLE:'El viaje todavía no está disponible para volver a fila.',STALE_PREVIOUS_TRIP:'Existe un viaje posterior. Consulta la última asignación.',INVALID_DESTINATION_QUEUE:'La fila elegida no corresponde al destino o la asociación.',INVALID_RECOVERY_STATE:'El estado actual no permite rehabilitar esta unidad. Consulta la incidencia.',QUEUE_ORDER:'La solicitud no corresponde al primer vehículo compatible. Actualiza la fila antes de elegir.',NO_CAPACITY:'Ya no hay plazas suficientes para ese segmento.',NO_COMPATIBLE_TRANSFER:'El vehículo propuesto no admite el traslado completo. Actualiza las opciones.',NO_FREE_REPLACEMENT:'No hay un vehículo completamente libre compatible. Se requiere gestión humana.',STALE_OPERATION:'La incidencia cambió. Actualiza el estado antes de otra acción.',STALE_ASSIGNMENT:'La asignación cambió. Actualiza tu consulta.',STALE_CONSENT:'El grupo o la asignación cambió. Hace falta un consentimiento vigente.',CONSENT_USED:'Este consentimiento ya fue utilizado. Consulta la asignación actual.',SAFE_TRANSFER_REQUIRED:'Declara el traslado seguro observado antes de reasignar pasajeros abordados.',ADMIN_TERMINAL_CHOICE_REQUIRED:'Selecciona la terminal prioritaria y la primera opción autorizada actual.',PRESENCE_REQUIRED:'Verifica presencialmente la llegada antes de adelantar el grupo.',ADMIN_REVIEW_REQUIRED:'Este caso necesita revisión administrativa; no se realizó un traslado parcial.',AUTHENTICATION_REQUIRED:'Tu sesión caducó o fue revocada. Inicia sesión de nuevo.',UNAUTHENTICATED:'Tu sesión caducó o fue revocada. Inicia sesión de nuevo.',INVALID_CREDENTIALS:'Acceso no válido. Comprueba los datos ficticios o espera antes de reintentar.',CSRF_REQUIRED:'Actualiza tu sesión antes de continuar.',FORBIDDEN:'Esta cuenta no tiene permiso para esta operación.',RATE_LIMITED:'Demasiados intentos. Espera antes de reintentar.'};
async function request<T>(path:string,body?:unknown,csrf?:string,key?:string):Promise<T>{
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),18000);
 try{const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',signal:c.signal,headers:body===undefined?{}:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(messages[data.error]??`La operación no pudo completarse (${data.error??'error del servicio'}).`);return data;}finally{clearTimeout(timer);}
}

// Only coalesce in-flight session reads. There is no credential/session cache.
// Drain earlier Set-Cookie responses before a login/logout, and defer new reads
// until queued authentication writes finish; otherwise old replies can rotate it back.
let sessionRead:Promise<unknown>|null=null,authenticationWrite:Promise<unknown>|null=null;
function sharedSession<T>():Promise<T>{
 if(!sessionRead){const pending=request<unknown>('/api/session');sessionRead=pending;const clear=()=>{if(sessionRead===pending)sessionRead=null;};void pending.then(clear,clear);}
 return sessionRead as Promise<T>;
}
export function privateApi<T>(path:string,body?:unknown,csrf?:string,key?:string):Promise<T>{
 if(body!==undefined&&(path==='/api/login'||path==='/api/logout')){
  const write=authenticationWrite,read=sessionRead;
  const pending=(async()=>{if(write)await write.catch(()=>undefined);if(read)await read.catch(()=>undefined);return request<T>(path,body,csrf,key);})();
  authenticationWrite=pending;const clear=()=>{if(authenticationWrite===pending)authenticationWrite=null;};void pending.then(clear,clear);return pending;
 }
 if(path==='/api/session'&&body===undefined)return(async()=>{
  while(authenticationWrite){const write=authenticationWrite;await write.catch(()=>undefined);if(authenticationWrite===write)break;}
  return sharedSession<T>();
 })();
 return request<T>(path,body,csrf,key);
}
