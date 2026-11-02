import{useEffect,useRef,useState}from'react';
import{privateApi}from'./private-api';import type{WebSession}from'./private-api';
import{useCommands}from'./use-command';import{PageControls}from'./Management';import type{PageCursor}from'./Management';
type Section='DRIVERS'|'VEHICLES'|'ASSIGNMENTS'|'HISTORY';
type Row={id:string;code?:string;kind?:string;status?:string;subjectRef?:string;vehicleId?:string;driverRef?:string;driverLabel?:string;capacity?:number;reason?:string;actorRef?:string;requestId?:string;reviewRequired?:boolean;createdAt?:string;details?:{priorDriverRef?:string;subjectRef?:string;vehicleId?:string;applied?:boolean;reviewRequired?:boolean}};
type Data={items:Row[];total:number;limit:number;nextCursor:PageCursor};
type Context={revision:string};
const names:Record<Section,string>={DRIVERS:'Solicitudes de choferes',VEHICLES:'Solicitudes de vehículos',ASSIGNMENTS:'Asignaciones base',HISTORY:'Historial de altas y asignaciones'};
const states:Record<string,string>={APPROVE_REVIEW_REQUIRED:'Aprobación bloqueada: revisión operativa',ASSIGN_REVIEW_REQUIRED:'Asignación bloqueada: revisión operativa',UNASSIGN_REVIEW_REQUIRED:'Retiro bloqueado: revisión operativa',PENDING:'Pendiente de revisión',APPROVED:'Aprobada técnicamente',REJECTED:'Rechazada',REQUEST_DRIVER:'Solicitud DRIVER',REQUEST_VEHICLE:'Solicitud de vehículo',APPROVE:'Aprobación',REJECT:'Rechazo',ASSIGN:'Asignación base',UNASSIGN:'Retiro de asignación base'};
export function FleetAdministration({associationId,onBusy}:{associationId:string;onBusy:(b:boolean)=>void}){
 const[section,setSection]=useState<Section>('DRIVERS'),[ctx,setCtx]=useState<Context|null>(null),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[index,setIndex]=useState(0),[code,setCode]=useState('LAB-'),[vehicle,setVehicle]=useState(''),[driver,setDriver]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<Record<string,unknown>|null>(null);
 const generation=useRef(0),cursors=useRef<PageCursor[]>([null]),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>()=>{generation.current++;onBusy(false);},[onBusy]);
 const load=async(next=section,page=0)=>{
  const g=++generation.current;setLoading(true);setData(null);setCtx(null);setError('');setSection(next);setConfirmed(false);if(page===0)cursors.current=[null];
  try{const s=await privateApi<WebSession>('/api/session');if(!s.authenticated)throw Error('La sesión ya no está activa.');
   const[c,d]=await Promise.all([privateApi<Context>('/api/fleet-admin/context',{associationId},s.csrf),privateApi<Data>('/api/fleet-admin/page',{associationId,section:next,limit:50,cursor:page===0?null:cursors.current[page]},s.csrf)]);
   if(g!==generation.current)throw Error('La consulta cambió.');setCtx(c);setData(d);setIndex(page);if(d.nextCursor)cursors.current[page+1]=d.nextCursor;else cursors.current.length=page+1;
  }catch(e){if(g===generation.current){setError(e instanceof Error?e.message:'No se pudo consultar la gestión.');setData(null);setCtx(null);setIndex(0);cursors.current=[null];}throw e;}
  finally{if(g===generation.current){setLoading(false);heading.current?.focus();}}
 };
 const command=useCommands(()=>load(section,0),'/api/fleet-admin/command',0,true),busy=loading||command.busy;
 useEffect(()=>{onBusy(busy||!!pending);},[busy,pending,onBusy]);
 useEffect(()=>{if(command.rejected){setPending(null);setCtx(null);setData(null);setConfirmed(false);}},[command.rejected]);
 const send=async(body:Record<string,unknown>)=>{setMessage('');setPending(body);const r=await command.send(body);if(r!==undefined){setPending(null);setReason('');setConfirmed(false);setMessage((r as {reviewRequired?:boolean}).reviewRequired?'Revisión operativa requerida y auditada. No se cambió el recurso, la solicitud ni el servicio.':'Actuación confirmada y auditada. No se crearon ni modificaron viajes. Actualiza el directorio para ver altas y permisos.');}};
 const act=(kind:string,more:Record<string,unknown>)=>{if(ctx)void send({kind,associationId,revision:ctx.revision,reason,...more});};
 const editable=!busy&&!pending,ready=editable&&!!ctx&&!!reason.trim()&&confirmed;
 return <section className="fleet-administration" aria-label="Altas y asignaciones administrativas" aria-busy={busy}>
  <h3>Altas y asignaciones administrativas</h3><p>Solo laboratorio: no acredita identidad oficial, licencia ni habilitación legal. Aprobar un vehículo no lo incorpora a la fila. La asignación base no sustituye al chofer de un viaje.</p>
  <div className="directory-tabs">{(Object.keys(names)as Section[]).map(s=><button className="button quiet" key={s} disabled={busy||!!pending} aria-pressed={section===s} onClick={()=>void load(s).catch(()=>{})}>{names[s]}</button>)}</div>
  <button className="button quiet" disabled={busy} onClick={()=>void load(section).catch(()=>{})}>Consultar altas y asignaciones</button>
  <h4 ref={heading} tabIndex={-1}>{names[section]}</h4>
  {loading&&<p role="status">Consultando solicitudes y permisos…</p>}{(error||command.error)&&<p className="message error" role="alert">{error||command.error}</p>}{message&&<p role="status">{message}</p>}
  {pending&&command.error&&<button className="button quiet" disabled={busy} onClick={()=>void send(pending)}>Reintentar la misma actuación de alta o asignación</button>}
  {ctx&&data&&<>
   <fieldset disabled={!editable}><legend>Motivo y confirmación de la actuación</legend>
    <label>Motivo de alta o asignación ficticia<input maxLength={200} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
    <label className="consent-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo esta actuación administrativa y su auditoría, sin alterar servicios.</label>
   </fieldset>
   {(section==='DRIVERS'||section==='VEHICLES')&&<fieldset disabled={!editable}><legend>{section==='DRIVERS'?'Solicitar incorporación DRIVER':'Solicitar vehículo ficticio'}</legend>
    <label>{section==='DRIVERS'?'Código LAB de identidad existente atestada':'Código LAB del vehículo ficticio'}<input maxLength={44} value={code} onChange={e=>{setCode(e.target.value);setConfirmed(false);}}/></label>
    {section==='DRIVERS'?<p>No crea cuentas. Una membresía revocada se gestiona en los permisos DRIVER existentes. Las atestaciones se preparan únicamente en el instalador local.</p>:<p>Tipo técnico VAGONETA_6 · Capacidad exactamente 6. Sin documentos o validaciones oficiales. El código no se reutiliza tras rechazo.</p>}
    <button className="button quiet" disabled={!ready||!/^LAB-[A-Z0-9_-]{1,40}$/.test(code.trim().toUpperCase())} onClick={()=>act(section==='DRIVERS'?'REQUEST_DRIVER':'REQUEST_VEHICLE',section==='DRIVERS'?{identityCode:code}:{vehicleCode:code,vehicleType:'VAGONETA_6',capacity:6})}>Registrar solicitud de {section==='DRIVERS'?'chofer':'vehículo'}</button>
   </fieldset>}
   {section==='ASSIGNMENTS'&&<fieldset disabled={!editable}><legend>Asignación base sin servicio activo</legend><p>Copia las referencias técnicas del directorio. Los conflictos de servicio, reservas, restricciones o custodia requieren revisión humana. Retirar la asignación anterior antes de usar su chofer en otra unidad.</p>
    <label>Referencia técnica del vehículo<input value={vehicle} onChange={e=>{setVehicle(e.target.value);setConfirmed(false);}}/></label>
    <label>Referencia técnica del chofer<input value={driver} onChange={e=>{setDriver(e.target.value);setConfirmed(false);}}/></label>
    <button className="button quiet" disabled={!ready||!vehicle||!driver} onClick={()=>act('ASSIGN',{vehicleId:vehicle,driverRef:driver})}>Guardar asignación base</button>
    <button className="button quiet" disabled={!ready||!vehicle} onClick={()=>act('UNASSIGN',{vehicleId:vehicle})}>Retirar asignación base</button>
   </fieldset>}
   {data.items.length===0?<p>Sin registros para esta consulta.</p>:<ul className="directory-items">{data.items.map(r=><li key={r.id} data-fleet-id={r.id}>
    <h5>{r.code??states[r.kind??'']??'Actuación administrativa'}</h5><p className="directory-id">Referencia técnica: {r.id}</p>
    {r.status&&<p>Estado: {states[r.status]}. {r.subjectRef&&<>Identidad técnica: {r.subjectRef}.</>} {r.vehicleId&&<>Vehículo: {r.vehicleId}.</>}</p>}
    {r.capacity&&<p>Tipo técnico VAGONETA_6 · Capacidad {r.capacity} plazas; no acredita habilitación legal ni plazas disponibles.</p>}
    {r.reason&&<p>Motivo: {r.reason} · Operador técnico: {r.actorRef}.</p>}
    {r.createdAt&&<p>{new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short',timeZone:'America/La_Paz'}).format(new Date(r.createdAt))}</p>}
    {r.details?.reviewRequired&&<p>Revisión operativa requerida; sin cambios en los recursos ni servicios.</p>}
    {r.details&&<p>Solicitud: {r.requestId??'No aplica'} · Chofer anterior: {r.details.priorDriverRef??'Sin vínculo'} · Chofer: {r.details.subjectRef??'No aplica'} · Vehículo: {r.details.vehicleId??'No aplica'}.</p>}
    {section==='ASSIGNMENTS'&&<><p>Chofer base: {r.driverLabel??'Sin asignación'} · {r.driverRef??'Sin referencia'}. Capacidad técnica: {r.capacity}. {r.reviewRequired?'Bloqueado: revisión operativa requerida.':'Sin conflicto detectado al consultar; se revalidará al guardar.'}</p><button className="button quiet" disabled={!editable} onClick={()=>{setVehicle(r.id);setDriver(r.driverRef??'');setConfirmed(false);}}>Seleccionar unidad {r.code}</button></>}
    {r.status==='PENDING'&&<><button className="button quiet" disabled={!ready} onClick={()=>act('APPROVE',{requestId:r.id})}>Aprobar solicitud {r.code}</button><button className="button quiet" disabled={!ready} onClick={()=>act('REJECT',{requestId:r.id})}>Rechazar solicitud {r.code}</button></>}
   </li>)}</ul>}
   <PageControls name="altas y asignaciones" index={index} count={data.items.length} total={data.total} next={data.nextCursor} busy={busy||!!pending} change={n=>void load(section,n).catch(()=>{})}/>
  </>}
 </section>;
}
