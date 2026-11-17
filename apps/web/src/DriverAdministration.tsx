import {useEffect,useRef,useState} from 'react';
import {privateApi} from './private-api';
import type {WebSession} from './private-api';
import {useCommands} from './use-command';
import {PageControls} from './Management';
import type {PageCursor} from './Management';
type Context={associationId:string;member:null|{id:string;label:string;active:boolean;revision:string;reviewRequired:boolean};contact:null|{code:string;updatedAt:string}};
type Event={id:string;actorRef:string|null;subjectRef:string|null;event:string;reason:string;createdAt:string};
type History={items:Event[];total:number;limit:number;nextCursor:PageCursor};
type Result={applied?:boolean;reviewRequired?:boolean;active?:boolean};
const events:Record<string,string>={DRIVER_ENABLED:'Permiso DRIVER habilitado',DRIVER_DISABLED:'Permiso DRIVER revocado',DRIVER_ACCESS_REVIEW_REQUIRED:'Cambio bloqueado: revisión necesaria',CONTACT_UPDATED:'Contacto ficticio actualizado'};
const when=(s:string)=>new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short',timeZone:'America/La_Paz'}).format(new Date(s));

export function DriverAdministration({associationId,userRef,onBusy,onMember}:{associationId:string;userRef:string|null;onBusy:(b:boolean)=>void;onMember:(id:string,active:boolean)=>void}){
 const[data,setData]=useState<Context|null>(null),[history,setHistory]=useState<History|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reason,setReason]=useState(''),[agreed,setAgreed]=useState(false),[contact,setContact]=useState('LAB-'),[contactAgreed,setContactAgreed]=useState(false),[index,setIndex]=useState(0),[pending,setPending]=useState<Record<string,unknown>|null>(null),[pendingContact,setPendingContact]=useState<Record<string,unknown>|null>(null);
 const generation=useRef(0),cursors=useRef<PageCursor[]>([null]);
 useEffect(()=>()=>{generation.current++;onBusy(false);},[onBusy]);
 const load=async(page=0)=>{
  const g=++generation.current;setLoading(true);setData(null);setHistory(null);setError('');setAgreed(false);setContactAgreed(false);if(page===0)cursors.current=[null];
  try{
   const s=await privateApi<WebSession>('/api/session');if(!s.authenticated)throw new Error('La sesión ya no está activa.');
   const [context,h]=await Promise.all([privateApi<Context>('/api/driver-admin/context',{associationId,userRef},s.csrf),privateApi<History>('/api/driver-admin/history',{associationId,userRef,limit:50,cursor:page===0?null:cursors.current[page]},s.csrf)]);
   if(g!==generation.current)throw new Error('La consulta cambió.');
   setData(context);setHistory(h);setContact(context.contact?.code??'LAB-');setIndex(page);if(h.nextCursor)cursors.current[page+1]=h.nextCursor;else cursors.current.length=page+1;
   if(context.member)onMember(context.member.id,context.member.active);
  }catch(e){if(g===generation.current){setData(null);setHistory(null);cursors.current=[null];setIndex(0);setError(e instanceof Error?e.message:'No se pudo consultar la administración.');}throw e;}
  finally{if(g===generation.current)setLoading(false);}
 };
 const refresh=async()=>load(0),command=useCommands(refresh,'/api/driver-admin/command',0,true),contactCommand=useCommands(refresh,'/api/driver-admin/contact',0,true);
 // Only a definitive rejected POST retires intent. A committed POST followed
 // by a failed refresh remains uncertain and retains its original body/key.
 useEffect(()=>{if(command.rejected){setPending(null);setData(null);setHistory(null);setAgreed(false);}},[command.rejected]);
 useEffect(()=>{if(contactCommand.rejected){setPendingContact(null);setData(null);setHistory(null);setContactAgreed(false);}},[contactCommand.rejected]);
 const busy=loading||command.busy||contactCommand.busy;
 useEffect(()=>{onBusy(busy||!!pending||!!pendingContact);},[busy,pending,pendingContact,onBusy]);
 const send=async(body:Record<string,unknown>,isContact=false)=>{
  setMessage('');if(isContact)setPendingContact(body);else setPending(body);
  const r=await(isContact?contactCommand:command).send(body)as Result|undefined;
  if(r!==undefined){if(isContact)setPendingContact(null);else setPending(null);setReason('');setMessage(r.reviewRequired?'Revisión administrativa necesaria: no se cambió el permiso ni la operación.':'Actuación confirmada y auditada. Consulta el estado actualizado.');}
 };
 return <section className="driver-administration" aria-label="Administración de permisos DRIVER existentes" aria-busy={busy}>
  <h3>{userRef?'Gestionar membresía DRIVER existente':'Contacto e historial de la asociación'}</h3>
  <p>Solo laboratorio ficticio. No crea cuentas o membresías; no acredita identidad ni habilitación legal.</p>
  <button className="button quiet" disabled={busy} onClick={()=>void load(0).catch(()=>{})}>{loading?'Consultando gestión…':'Consultar estado e historial administrativo'}</button>
  {loading&&<p role="status">Consultando permisos e historial…</p>}
  {(error||command.error||contactCommand.error)&&<p className="message error" role="alert">{error||command.error||contactCommand.error}</p>}
  {message&&<p role="status">{message}</p>}
  {pending&&command.error&&<button className="button quiet" disabled={busy} onClick={()=>void send(pending)}>Reintentar el mismo cambio de permiso</button>}
  {pendingContact&&contactCommand.error&&<button className="button quiet" disabled={busy} onClick={()=>void send(pendingContact,true)}>Reintentar el mismo contacto</button>}
  {data&&<>
   {data.member&&<fieldset disabled={busy||!!pending||!!pendingContact}><legend>{data.member.label} · DRIVER {data.member.active?'activo':'inactivo'}</legend><p>Referencia técnica: {data.member.id}. Asociación: {associationId}.</p>
    {data.member.reviewRequired&&<p className="message">Revisión administrativa necesaria: existe fila o servicio del chofer, o una incidencia/recepción pendiente en la asociación. No se permite retirar el acceso ni restaurar una fila implícitamente.</p>}
    <label>Motivo administrativo ficticio<input maxLength={200} value={reason} onChange={e=>{setReason(e.target.value);setAgreed(false);}}/></label>
    <label className="consent-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>Confirmo cambiar únicamente este permiso DRIVER existente y registrar el motivo.</label>
    <button className="button quiet" disabled={!reason.trim()||!agreed||data.member.reviewRequired} onClick={()=>void send({associationId,userRef:data.member?.id,enabled:!data.member?.active,revision:data.member?.revision,reason})}>{data.member.active?'Revocar permiso DRIVER existente':'Restaurar permiso DRIVER existente'}</button>
    <p>Restaurar un permiso no rehabilita vehículos, restaura sesiones revocadas ni devuelve posiciones de fila.</p>
   </fieldset>}
   {!userRef&&<fieldset disabled={busy||!!pending||!!pendingContact}><legend>Contacto técnico ficticio</legend><p>Contacto actual: {data.contact?.code??'Sin contacto registrado'}. Código de laboratorio; no es teléfono ni contacto legal o comercial validado.</p>
    <label>Código de contacto ficticio<input maxLength={44} value={contact} onChange={e=>{setContact(e.target.value);setContactAgreed(false);}}/></label>
    <label className="consent-check"><input type="checkbox" checked={contactAgreed} onChange={e=>setContactAgreed(e.target.checked)}/>Confirmo registrar únicamente un código LAB ficticio.</label>
    <button className="button quiet" disabled={!contactAgreed||!/^LAB-[A-Z0-9_-]{1,40}$/.test(contact)} onClick={()=>void send({associationId,contactCode:contact},true)}>Guardar contacto ficticio</button>
   </fieldset>}
   {history&&<section aria-label="Historial administrativo autorizado"><h4>Historial administrativo autorizado</h4>{history.items.length===0?<p>Sin actuaciones registradas para esta consulta.</p>:<ul>{history.items.map(e=><li key={e.id} data-admin-event={e.id}><strong>{events[e.event]??'Actuación administrativa'}</strong> · {when(e.createdAt)}<p>Motivo: {e.reason}</p><p>Actor técnico: {e.actorRef??'No registrado'} · Sujeto técnico: {e.subjectRef??'Asociación'}</p></li>)}</ul>}<PageControls name="historial de permisos" index={index} count={history.items.length} total={history.total} next={history.nextCursor} busy={busy||!!pending||!!pendingContact} change={n=>void load(n).catch(()=>{})}/></section>}
  </>}
 </section>;
}
