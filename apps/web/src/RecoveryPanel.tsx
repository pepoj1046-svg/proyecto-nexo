import{useEffect,useRef,useState,useSyncExternalStore}from'react';
import{recoveryStore}from'./recovery-store';
import type{ConsultView}from'./recovery-consult';
import{bookingState}from'./Functional';
// 5A.4-B3 «Operación anterior». Rendered only for the authenticated account of this
// document; before the gate it renders nothing (no account, count, route or summary).
const text:Record<ConsultView['phase'],string>={
 AUTENTICAR:'Inicia sesión con la cuenta original para consultar una operación anterior.',
 LISTA:'Iniciaste sesión. Puedes consultar esta referencia; el servidor todavía debe verificarla. La operación no se repetirá.',
 CONSULTANDO:'Consultando el resultado autorizado. La operación no se está reenviando.',
 INCIERTA:'Todavía no se observó un recibo. La operación pudo ejecutarse o seguir pendiente. Puedes volver a consultar.',
 RECIBO:'El servidor confirmó un registro anterior; falta consultar su estado actual.',
 LECTURA_PENDIENTE:'El servidor confirmó un registro anterior; falta consultar su estado actual.',
 ACTUALIZADA:'El servidor confirmó el registro anterior. Abajo se muestra su estado actual.',
 REVISION:'No podemos recuperar esta referencia con los permisos actuales. Requiere revisión.',
 INVALIDA:'La referencia temporal caducó o corresponde a otra ejecución. No se canceló ninguna operación.'
};
const discardText='Eliminar esta referencia solo borra la ayuda local. No demuestra que la operación haya fallado ni cancela reservas.';
const time=(ms:number)=>new Intl.DateTimeFormat('es-BO',{hour:'2-digit',minute:'2-digit',timeZone:'America/La_Paz'}).format(new Date(ms));
export function RecoveryPanel(){
 const snap=useSyncExternalStore(recoveryStore.subscribe,recoveryStore.snapshot,recoveryStore.snapshot);
 const title=useRef<HTMLHeadingElement>(null);
 if(!snap.account||!snap.items.length&&!snap.fault)return null;
 return <section className="recovery-console previous-operation" aria-labelledby="previous-operation-title">
  <h2 id="previous-operation-title" ref={title} tabIndex={-1}>Operación anterior</h2>
  <p>Referencias temporales guardadas en esta pestaña para la cuenta con la que iniciaste sesión. Consultarlas no repite ninguna reserva.</p>
  {snap.fault&&<div className="message error" role="alert"><span>No se pudo leer la referencia temporal guardada en esta pestaña. Eso no demuestra que una operación anterior haya fallado ni que se haya registrado; revisa «Mis reservas».</span><button type="button" className="text-button" onClick={()=>{recoveryStore.acknowledgeFault();title.current?.focus();}}>Entendido</button></div>}
  {snap.items.map((v,i)=><Reference key={v.key} view={v} index={i+1} onClosed={()=>title.current?.focus()}/>)}
 </section>;
}
function Reference({view:v,index,onClosed}:{view:ConsultView;index:number;onClosed:()=>void}){
 const[confirming,setConfirming]=useState(false),root=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),confirmButton=useRef<HTMLButtonElement>(null),focused=useRef(false);
 // The consult button stays mounted (aria-disabled) while the request runs, so focus is kept.
 const consultable=['LISTA','INCIERTA','LECTURA_PENDIENTE','AUTENTICAR','CONSULTANDO','RECIBO'].includes(v.phase),closable=v.phase==='ACTUALIZADA'||v.phase==='INVALIDA';
 // Keep focus inside this reference when its buttons change; never steal it otherwise.
 useEffect(()=>{if(focused.current&&root.current&&!root.current.contains(document.activeElement))heading.current?.focus();},[v.phase,v.busy,confirming]);
 useEffect(()=>{if(confirming)confirmButton.current?.focus();},[confirming]);
 const label=`Referencia temporal ${index}`,blocking=v.error&&v.phase!=='CONSULTANDO';
 return <article ref={root} className="previous-reference" aria-labelledby={`ref-${v.key}`} aria-busy={v.busy} onFocus={()=>{focused.current=true;}} onBlur={e=>{if(!root.current?.contains(e.relatedTarget as Node|null))focused.current=false;}}>
  <h3 id={`ref-${v.key}`} ref={heading} tabIndex={-1}>{label}{v.expiresAt&&consultable?<small> · ayuda local hasta las {time(v.expiresAt)}</small>:null}</h3>
  <p role="status" aria-live="polite" aria-atomic="true">{text[v.phase]}</p>
  {blocking&&<p className="message error" role="alert">{v.error}</p>}
  {v.receipt&&<div className="recovery-detail"><p><strong>Registro histórico</strong> (no es disponibilidad actual): {v.receipt.bookingIds.length} {v.receipt.bookingIds.length===1?'reserva':'reservas'}{v.receipt.operation==='reserve_enroute'?' en recorrido':''}, estado original «{bookingState(v.receipt.originalStatus)}».</p></div>}
  {v.current&&v.current.length>0&&<section aria-label="Estado actual autorizado"><h4>Estado actual</h4><ul>{v.current.map(b=><li key={b.bookingId}><span className="directory-id">{b.bookingId}</span> · {bookingState(b.assignmentState??b.effectiveStatus??b.status)}</li>)}</ul><p>Puede haber cambiado desde esta consulta. No confirma salida ni abordaje.</p></section>}
  {v.phase==='INVALIDA'&&<p>Consulta «Mis reservas» con tu cuenta para ver tus reservas actuales.</p>}
  {!confirming&&<div className="session-actions">
   {consultable&&<button type="button" className="button primary" aria-disabled={v.busy} onClick={()=>{if(!v.busy)void recoveryStore.consult(v.key);}}>{v.busy?'Consultando…':'Consultar resultado'}</button>}
   {closable?<button type="button" className="button quiet" onClick={()=>{recoveryStore.discard(v.key);onClosed();}}>Cerrar</button>
    :<button type="button" className="button quiet" onClick={()=>setConfirming(true)}>Eliminar referencia</button>}
  </div>}
  {confirming&&<div role="group" aria-labelledby={`discard-${v.key}`} className="message error"><p id={`discard-${v.key}`}>{discardText}</p><div className="session-actions"><button ref={confirmButton} type="button" className="button primary" onClick={()=>{recoveryStore.discard(v.key);onClosed();}}>Eliminar solo la ayuda local</button><button type="button" className="button quiet" onClick={()=>{setConfirming(false);}}>Conservar referencia</button></div></div>}
 </article>;
}
