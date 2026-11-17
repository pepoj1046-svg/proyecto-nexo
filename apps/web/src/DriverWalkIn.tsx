import {useEffect,useRef,useState} from 'react';
import {privateApi} from './private-api';
import type {WebSession} from './private-api';
import {useCommands} from './use-command';
import {money} from './model';

// 4B.1. Every rule (trip in turn, unstaffed hours, terminal point, no minors) is
// decided by PostgreSQL; these views only explain the server's answer.
const errorText=(error:unknown)=>error instanceof Error?error.message:'No se pudo consultar el servidor.';
async function read<T>(path:string,body:unknown){
  const s=await privateApi<WebSession>('/api/session');
  if(!s.authenticated)throw new Error('Inicia sesión nuevamente.');
  return privateApi<T>(path,body,s.csrf);
}
const weekdays=['','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const reasons:Record<string,string>={
  NOT_QUEUED:'Tu trufi no está en fila. Solo se registra en la terminal antes de salir.',
  NOT_IN_TURN:'Tu trufi no es el que está en turno. El registro corresponde al primero de la fila.',
  STAFFED_HOURS:'Ahora es horario con personal de la asociación, o la asociación no configuró su horario sin personal.',
  NO_TERMINAL_POINT:'La ruta no tiene una terminal de subida registrada.'
};
interface Point{id:string;order:number;name:string;kind:string;boardingAllowed:boolean;alightingAllowed:boolean}
interface DriverContext{tripId:string;allowed:boolean;reason:string|null;inTurn:boolean;unstaffedNow:boolean;vehicle:string;points:Point[]}
interface Quote{fareId:string;fareVersion:number;totalBOB:string}
interface Receipt{bookingIds:string[];initialStatus:string;totalPriceBOB:string}

function MinorProtocol(){
  return <details className="minor-protocol"><summary>Si viaja un menor de edad</summary>
    <p>No registres a menores en este horario. Si un adulto quiere enviar a un menor, debe hacerlo con la asociación en horario con personal: quien lo envía da su contacto, el de quien lo recibe y el lugar de entrega, y se verifica el permiso de viaje de la Defensoría.</p>
    <p>Si un menor llega solo, llama a sus padres o tutores al número que te dé; deben presentarse en la parada. Si no te da un número o no responden, llama a las autoridades correspondientes. Esta aplicación no hace llamadas.</p>
  </details>;
}

export function DriverWalkInSale({tripId,onUpdated}:{tripId:string;onUpdated:()=>Promise<void>}){
  const [context,setContext]=useState<DriverContext|null>(null),[from,setFrom]=useState(''),[to,setTo]=useState(''),[seats,setSeats]=useState(1),[quote,setQuote]=useState<Quote|null>(null),[agreed,setAgreed]=useState(false),[noMinors,setNoMinors]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[frozen,setFrozen]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null),[intent,setIntent]=useState(0);
  const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
  const command=useCommands(async()=>{},'/api/walk-in/driver-register',intent),busy=loading||command.busy;
  const journey={tripId,boardingPointId:from,alightingPointId:to,seats};
  const open=async()=>{const g=++generation.current;setLoading(true);setError('');setContext(null);try{const c=await read<DriverContext>('/api/walk-in/driver-context',{tripId});if(g===generation.current){setContext(c);setFrom(c.points.find(p=>p.boardingAllowed)?.id??'');setTo([...c.points].reverse().find(p=>p.alightingAllowed)?.id??'');setQuote(null);setAgreed(false);setNoMinors(false);}}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const changed=()=>{generation.current++;setQuote(null);setAgreed(false);setError('');};
  const review=async()=>{const g=++generation.current;setLoading(true);setError('');setQuote(null);setAgreed(false);try{const q=await read<Quote>('/api/walk-in/driver-quote',journey);if(g===generation.current)setQuote(q);}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const save=async()=>{if(!quote||!agreed||!noMinors||busy)return;setFrozen(true);const r=await command.send({...journey,quote:{fareId:quote.fareId,fareVersion:quote.fareVersion,totalBOB:quote.totalBOB},noMinors:true});if(r){setReceipt(r as Receipt);await onUpdated();}};
  return <section className="walk-in-sale driver-walk-in" aria-label="Registrar pasajero en terminal"><h2>Registrar pasajero en terminal</h2>
    <p>Solo en el horario sin personal que configura tu asociación y solo en tu trufi cuando está en turno. Mismo inventario que la aplicación; grupo junto de 1 a 6 plazas, sin nombres ni documentos. No se registra pago.</p>
    {!context&&<button className="button quiet" disabled={busy} onClick={()=>void open()}>Comprobar si puedo registrar</button>}
    {context&&<>{!context.allowed?<><p role="status">{reasons[context.reason??'']??'El servidor no habilita el registro en este momento.'}</p><button className="button quiet" disabled={busy} onClick={()=>void open()}>Volver a comprobar</button></>:<>
      <p>{context.vehicle} · en turno · horario sin personal.</p>
      <fieldset disabled={busy||frozen}><legend>Grupo presencial y recorrido</legend>
        <label>Subida en terminal<select aria-label="Subida en terminal" value={from} onChange={e=>{changed();setFrom(e.target.value);}}>{context.points.filter(p=>p.boardingAllowed).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Bajada<select aria-label="Bajada del grupo" value={to} onChange={e=>{changed();setTo(e.target.value);}}>{context.points.filter(p=>p.alightingAllowed).map(p=><option key={p.id} value={p.id} disabled={p.order<=(context.points.find(x=>x.id===from)?.order??-1)}>{p.name}</option>)}</select></label>
        <label>Plazas del grupo<input aria-label="Plazas del grupo" type="number" min="1" max="6" value={seats} onChange={e=>{changed();setSeats(Number(e.target.value));}}/></label>
        <button className="button quiet" disabled={!from||!to||!Number.isInteger(seats)||seats<1||seats>6} onClick={()=>void review()}>Revisar importe</button></fieldset>
      <MinorProtocol/>
      {quote&&!receipt&&<><p>Importe: <strong>{money(quote.totalBOB)}</strong> · tarifa versión {quote.fareVersion}. La consulta no retiene plazas.</p>
        <label className="consent-check"><input type="checkbox" checked={noMinors} disabled={busy||frozen} onChange={e=>setNoMinors(e.target.checked)}/>Confirmo que en este grupo no viaja ningún menor de edad.</label>
        <label className="consent-check"><input type="checkbox" checked={agreed} disabled={busy||frozen} onChange={e=>setAgreed(e.target.checked)}/>Confirmo todo el grupo, los puntos y este importe ficticio.</label>
        <button className="button primary" disabled={busy||!agreed||!noMinors} onClick={()=>void save()}>{frozen?'Reintentar el mismo registro':'Registrar grupo'}</button></>}
    </>}
    {receipt&&<div role="status" className="message success"><div><strong>Grupo registrado.</strong><p>{receipt.initialStatus==='CONFIRMED'?'Reserva confirmada en tu trufi por turno.':'Registro pendiente.'} No implica abordaje ni salida. La asociación verá este registro a tu nombre.</p>{receipt.bookingIds.map(id=><p key={id}>Referencia: <code>{id}</code></p>)}<p>Importe conservado: {money(receipt.totalPriceBOB)}.</p><button className="button quiet" onClick={()=>{setIntent(x=>x+1);setReceipt(null);setFrozen(false);setQuote(null);setAgreed(false);setNoMinors(false);}}>Registrar otro grupo</button></div></div>}
    </>}{loading&&<p role="status">Consultando el servidor…</p>}{(error||command.error)&&<p role="alert" className="message error">{error||command.error}</p>}
  </section>;
}

interface Window{weekday:number;start:string;end:string}
interface Schedule{revision:number;windows:Window[];unstaffedNow:boolean;editable:boolean;timeZone:string}
interface Registration{bookingId:string;createdAt:string;route:string;vehicle:string;driver:string;seats:number;status:string;priceBOB:string}
const when=(value:string)=>new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short',timeZone:'America/La_Paz'}).format(new Date(value));
export function UnstaffedHours({associationId}:{associationId:string}){
  const [schedule,setSchedule]=useState<Schedule|null>(null),[draft,setDraft]=useState<Window[]>([]),[agreed,setAgreed]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[list,setList]=useState<{items:Registration[];offset:number;hasMore:boolean}|null>(null),[intent,setIntent]=useState(0);
  const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
  const load=async()=>{const g=++generation.current;setLoading(true);setError('');try{const s=await read<Schedule>('/api/unstaffed/schedule',{associationId});if(g===generation.current){setSchedule(s);setDraft(s.windows);setAgreed(false);}}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const command=useCommands(async result=>{if(result&&typeof result==='object'&&'revision'in result){const s=result as Schedule;setSchedule(x=>x?{...x,...s}:x);setDraft(s.windows);setAgreed(false);setIntent(n=>n+1);}},'/api/unstaffed/command',intent),busy=loading||command.busy;
  const registrations=async(offset=0)=>{const g=++generation.current;setLoading(true);setError('');try{const r=await read<{items:Registration[];offset:number;hasMore:boolean}>('/api/walk-in/driver-registrations',{associationId,limit:10,offset});if(g===generation.current)setList(r);}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const update=(i:number,patch:Partial<Window>)=>{setAgreed(false);setDraft(d=>d.map((w,j)=>j===i?{...w,...patch}:w));};
  const valid=draft.every(w=>w.start!==w.end&&/^\d\d:\d\d$/.test(w.start)&&/^\d\d:\d\d$/.test(w.end))&&new Set(draft.map(w=>w.weekday+':'+w.start)).size===draft.length&&draft.length<=21;
  return <section className="unstaffed-hours" aria-label="Horario sin personal" aria-busy={busy}><h3>Horario sin personal y registros de choferes</h3>
    <p>En estas franjas, el chofer del trufi en turno puede registrar pasajeros en la terminal. Fuera de ellas solo registra la asociación, que siempre conserva ese permiso. Hora de Bolivia (America/La_Paz). Una franja cuyo fin es anterior a su inicio sigue hasta el día siguiente.</p>
    <button className="button quiet" disabled={busy} onClick={()=>void load()}>{schedule?'Actualizar horario':'Consultar horario sin personal'}</button>
    <button className="button quiet" disabled={busy} onClick={()=>void registrations(0)}>Consultar registros de choferes</button>
    {schedule&&<><p role="status">{schedule.unstaffedNow?'Ahora es horario sin personal: el chofer en turno puede registrar.':'Ahora no es horario sin personal.'} Revisión {schedule.revision}.</p>
      {schedule.editable?<fieldset disabled={busy}><legend>Franjas semanales</legend>
        {draft.length===0&&<p>Sin franjas: los choferes no pueden registrar.</p>}
        {draft.map((w,i)=><div className="unstaffed-window" key={i}>
          <label>Día<select aria-label={'Día de la franja '+(i+1)} value={w.weekday} onChange={e=>update(i,{weekday:Number(e.target.value)})}>{weekdays.slice(1).map((d,n)=><option key={d} value={n+1}>{d}</option>)}</select></label>
          <label>Desde<input aria-label={'Inicio de la franja '+(i+1)} type="time" step="60" value={w.start} onChange={e=>update(i,{start:e.target.value})}/></label>
          <label>Hasta<input aria-label={'Fin de la franja '+(i+1)} type="time" step="60" value={w.end} onChange={e=>update(i,{end:e.target.value})}/></label>
          <button className="button quiet" onClick={()=>{setAgreed(false);setDraft(d=>d.filter((_,j)=>j!==i));}}>Quitar franja {i+1}</button></div>)}
        <button className="button quiet" disabled={draft.length>=21} onClick={()=>{setAgreed(false);setDraft(d=>[...d,{weekday:1,start:'18:00',end:'06:00'}]);}}>Añadir franja</button>
        {!valid&&<p role="alert" className="message error">Revisa las franjas: inicio y fin distintos, sin repetir día e inicio, hasta 21.</p>}
        <label className="consent-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>Confirmo este horario. Se aplica de inmediato y queda registrado a mi nombre.</label>
        <button className="button primary" disabled={!agreed||!valid} onClick={()=>void command.send({associationId,expectedRevision:schedule.revision,windows:draft})}>Guardar horario</button>
      </fieldset>:<><p>Solo un administrador con alcance completo de la asociación puede cambiar el horario.</p><ul>{schedule.windows.map(w=><li key={w.weekday+w.start}>{weekdays[w.weekday]}: {w.start} a {w.end}</li>)}</ul></>}</>}
    {list&&<><h4>Registrados por choferes</h4>{list.items.length===0?<p role="status">No hay registros de choferes en tu ámbito.</p>:<ul className="driver-registrations">{list.items.map(r=><li key={r.bookingId}><strong>{when(r.createdAt)}</strong> · {r.driver} · {r.vehicle} · {r.route} · {r.seats} {r.seats===1?'plaza':'plazas'} · {money(r.priceBOB)} · {r.status}<br/><code>{r.bookingId}</code></li>)}</ul>}
      <p>Solo para trazabilidad: consultar esta lista no cambia reservas.</p>
      <nav className="terminal-pagination" aria-label="Páginas de registros de choferes"><button className="button quiet" disabled={busy||list.offset===0} onClick={()=>void registrations(Math.max(0,list.offset-10))}>Registros anteriores</button><button className="button quiet" disabled={busy||!list.hasMore} onClick={()=>void registrations(list.offset+10)}>Registros siguientes</button></nav></>}
    {(error||command.error)&&<p role="alert" className="message error">{error||command.error}</p>}
  </section>;
}
