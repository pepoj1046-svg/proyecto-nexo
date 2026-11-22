import{useEffect,useRef,useState,useSyncExternalStore}from'react';
import{Icon}from'./icons';
import{privateApi,subscribeSession,currentSession}from'./private-api';
import type{WebSession}from'./private-api';
import{readForAccount,assertSameAccount}from'./private-read';

// Etapa 6A: in-app notices generated from real trip facts. Read on demand (no polling)
// and never sent outside the app. Tracking is by stops; there is no GPS.
type Notice={id:string;kind:string;route:string;stop:string|null;createdAt:string;expiresAt:string;read:boolean;channel:string};
export const noticeText:Record<string,(n:Notice)=>string>={
 RESERVA_CONFIRMADA:n=>`Tu reserva en ${n.route} quedó confirmada.`,
 RESERVA_CANCELADA:n=>`Tu reserva en ${n.route} fue cancelada o rechazada.`,
 RESERVA_VENCIDA:n=>`Tu reserva en ${n.route} venció sin confirmarse.`,
 VIAJE_SALIO:n=>`El trufi de tu viaje en ${n.route} salió.`,
 TRUFI_SE_ACERCA:n=>`El trufi se acerca a tu parada${n.stop?` (${n.stop})`:''}: está a una parada.`,
 TRUFI_EN_TU_PARADA:n=>`El trufi llegó a tu parada${n.stop?` (${n.stop})`:''}.`,
 VIAJE_TERMINADO:n=>`Tu viaje en ${n.route} terminó. Puedes valorarlo.`,
};
const message=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
const time=(s:string)=>new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short',timeZone:'America/La_Paz'}).format(new Date(s));

export function NoticesPanel(){
 const[items,setItems]=useState<Notice[]|null>(null),[unread,setUnread]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[session,setSession]=useState<WebSession|null>(null);
 const generation=useRef(0);
 const live=useSyncExternalStore(subscribeSession,currentSession,()=>null);
 const load=async()=>{const g=++generation.current;setError('');
  try{const s=await privateApi<WebSession>('/api/session');if(g!==generation.current)return;
   if(!s.authenticated){setSession(null);setItems(null);return;}
   const r=await readForAccount<{items:Notice[];unread:number}>('/api/notices/mine',{},s);if(g!==generation.current)return;
   setSession(s);setItems(r.items);setUnread(r.unread);}
  catch(e){if(g===generation.current)setError(message(e));}};
 useEffect(()=>{void load();return()=>{generation.current++;};},[live?.accountRef]);
 const markAll=async()=>{if(!session||!items)return;const ids=items.filter(i=>!i.read).map(i=>i.id).slice(0,50);if(!ids.length)return;setBusy(true);setError('');
  try{await assertSameAccount(session);await privateApi('/api/notices/read',{ids},session.csrf);await load();}catch(e){setError(message(e));}finally{setBusy(false);}};
 if(!session&&!error)return null;
 return <section className="notices-panel" aria-labelledby="notices-title">
  <h2 id="notices-title"><Icon name="info" size={22}/>Avisos de tus viajes{unread>0&&<span className="notice-count">{unread} sin leer</span>}</h2>
  <p>Se generan con lo que registra la operación, paso a paso por paradas (sin GPS). Solo aparecen aquí: el laboratorio no envía SMS, correos ni llamadas. Caducan a las 24 horas.</p>
  <div className="notice-actions"><button type="button" className="button quiet" onClick={()=>void load()}>Actualizar avisos</button>{unread>0&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void markAll()}>Marcar todos como leídos</button>}</div>
  {error&&<p role="alert" className="message error">{error}</p>}
  {items&&(items.length?<ol className="notice-list">{items.map(n=><li key={n.id} className={n.read?'read':'unread'}><span className="notice-time">{time(n.createdAt)}</span><span>{(noticeText[n.kind]??(()=>'Aviso del viaje.'))(n)}</span>{!n.read&&<span className="visually-hidden">(sin leer)</span>}</li>)}</ol>
   :<p>No tienes avisos en las últimas 24 horas.</p>)}
 </section>;
}
