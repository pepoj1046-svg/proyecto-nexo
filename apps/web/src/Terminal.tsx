import {useEffect,useRef,useState} from 'react';
import {privateApi} from './private-api';
import type {WebSession} from './private-api';
import {useCommands} from './use-command';
import {money} from './model';
import type {OperationPoint} from './operation-model';

const errorText=(error:unknown)=>error instanceof Error?error.message:'No se pudo consultar la operación.';
async function read<T>(path:string,body:unknown){
  const s=await privateApi<WebSession>('/api/session');
  if(!s.authenticated)throw new Error('Inicia sesión nuevamente.');
  return privateApi<T>(path,body,s.csrf);
}
const labels:Record<string,string>={QUEUED:'En fila',IN_TRANSIT:'En recorrido',COMPLETED:'Viaje finalizado',WITHDRAWN:'Retirado de fila'};
interface Directory{
  trips:{tripId:string;routeId:string;route:string;association:string;vehicle:string;status:string;position:string;onboard:number;blocked:boolean;confirmed:number;reserved:number}[];
  routes:{id:string;name:string;association:string}[];hasMore:boolean;offset:number;limit:number;
}
export function FleetDirectory({onSelect}:{onSelect:(tripId:string)=>Promise<void>}){
  const [active,setActive]=useState(false),[data,setData]=useState<Directory|null>(null),[routes,setRoutes]=useState<Directory['routes']>([]),[route,setRoute]=useState(''),[status,setStatus]=useState('ALL'),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
  const load=async(routeId=route,filter=status,page=offset)=>{
    const g=++generation.current;setActive(true);setBusy(true);setError('');setData(null);
    try{const r=await read<Directory>('/api/terminal/directory',{limit:5,offset:page,status:filter,...(routeId?{routeId}:{})});if(g===generation.current){setData(r);setRoutes(r.routes);setOffset(page);}}
    catch(e){if(g===generation.current){setRoutes([]);setError(errorText(e));}}finally{if(g===generation.current)setBusy(false);}
  };
  return <section className="fleet-directory" aria-label="Directorio de vehículos, viajes y filas"><h2>Vehículos, viajes y filas</h2>
    <button className="button quiet" disabled={busy} onClick={()=>void load()}>{active?'Actualizar vehículos y filas':'Consultar vehículos y filas'}</button>
    {active&&<><p>Consulta de hasta cinco servicios por página, incluidos históricos. Las cifras son máximos por segmento, sin reserva de cupos ni habilitación de rescate.</p>
      <div className="terminal-filters"><label>Ruta y asociación<select aria-label="Filtrar ruta y asociación" disabled={busy} value={route} onChange={e=>{setRoute(e.target.value);void load(e.target.value,status,0);}}><option value="">Todas las rutas autorizadas</option>{routes.map(r=><option key={r.id} value={r.id}>{r.name} · {r.association}</option>)}</select></label>
      <label>Estado del servicio<select aria-label="Filtrar estado del servicio" disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);void load(route,e.target.value,0);}}><option value="ALL">Todos los estados</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div></>}
    {busy&&<p role="status">Consultando vehículos autorizados…</p>}
    {data&&<><p role="status">Página {Math.floor(data.offset/data.limit)+1}. Orden registrado por asociación, ruta y posición.</p><div className="fleet-grid">{data.trips.map(t=><article className="fleet-card" key={t.tripId}><h3>{t.vehicle}</h3><p>{t.association} · {t.route}</p><p><strong>{labels[t.status]}</strong> · posición registrada {t.position}</p><p>{t.confirmed}/6 confirmadas · {t.reserved}/6 comprometidas, máximo por tramo · {t.onboard} personas observadas a bordo.</p><p>{t.blocked?'Unidad bloqueada por incidencia.':'Sin bloqueo de unidad registrado; se revalidan permisos y estado al operar.'}</p>{t.status!=='WITHDRAWN'?<button className="button quiet" onClick={()=>void onSelect(t.tripId)}>Ver operación de {t.vehicle}</button>:<p>Consulta su incidencia para el historial y la resolución permitida. No se reincorpora automáticamente.</p>}</article>)}</div>{data.trips.length===0&&<p>No hay servicios accesibles con estos filtros.</p>}
      <nav className="terminal-pagination" aria-label="Páginas del directorio"><button className="button quiet" disabled={busy||offset===0} onClick={()=>void load(route,status,Math.max(0,offset-data.limit))}>Página anterior</button><button className="button quiet" disabled={busy||!data.hasMore||offset+data.limit>10000} onClick={()=>void load(route,status,offset+data.limit)}>Página siguiente</button></nav></>}
    {error&&<p role="alert" className="message error">{error}</p>}
  </section>;
}

interface SaleContext{tripId:string;routeId:string;status:string;operationAllowed:boolean;vehicle:string;points:OperationPoint[]}
interface Quote{fareId:string;fareVersion:number;totalBOB:string;currency:string}
interface Receipt{bookingIds:string[];initialStatus:string;totalPriceBOB:string}
export function WalkInSale({tripId,onUpdated}:{tripId:string;onUpdated:()=>Promise<void>}){
  const [context,setContext]=useState<SaleContext|null>(null),[from,setFrom]=useState(''),[to,setTo]=useState(''),[seats,setSeats]=useState(1),[quote,setQuote]=useState<Quote|null>(null),[agreed,setAgreed]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[frozen,setFrozen]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null),[intent,setIntent]=useState(0);
  const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
  const command=useCommands(async()=>{},'/api/terminal/walk-in',intent),busy=loading||command.busy;
  const journey={tripId,boardingPointId:from,alightingPointId:to,seats};
  const open=async()=>{const g=++generation.current;setLoading(true);setError('');setContext(null);try{const c=await read<SaleContext>('/api/terminal/sale-context',{tripId});if(g===generation.current){setContext(c);setFrom(c.points.find(p=>p.boardingAllowed)?.id??'');setTo([...c.points].reverse().find(p=>p.alightingAllowed)?.id??'');setQuote(null);setAgreed(false);}}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const changed=()=>{generation.current++;setQuote(null);setAgreed(false);setError('');};
  const review=async()=>{const g=++generation.current;setLoading(true);setError('');setQuote(null);setAgreed(false);try{const q=await read<Quote>('/api/terminal/quote',journey);if(g===generation.current)setQuote(q);}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const save=async()=>{if(!quote||!agreed||busy)return;setFrozen(true);const r=await command.send({...journey,quote:{fareId:quote.fareId,fareVersion:quote.fareVersion,totalBOB:quote.totalBOB}});if(r){setReceipt(r as Receipt);await onUpdated();}};
  return <section className="walk-in-sale" aria-label="Reservas presenciales"><h2>Reservas presenciales</h2>
    {!context&&<button className="button quiet" disabled={busy} onClick={()=>void open()}>Preparar reserva presencial</button>}
    {context&&<><p>{context.vehicle}. El mismo inventario que la aplicación; grupo junto de 1 a 6 plazas técnicas, sin nombres ni documentos. El chofer acepta la oferta; no se registra abordaje ni pago.</p>
      {context.status==='QUEUED'&&context.operationAllowed?<><fieldset disabled={busy||frozen}><legend>Grupo presencial y recorrido</legend>
        <label>Subida presencial<select aria-label="Subida presencial" value={from} onChange={e=>{changed();setFrom(e.target.value);}}>{context.points.filter(p=>p.boardingAllowed).map(p=><option key={p.id} value={p.id} disabled={p.order>=(context.points.find(x=>x.id===to)?.order??Infinity)}>{p.name}</option>)}</select></label>
        <label>Bajada presencial<select aria-label="Bajada presencial" value={to} onChange={e=>{changed();setTo(e.target.value);}}>{context.points.filter(p=>p.alightingAllowed).map(p=><option key={p.id} value={p.id} disabled={p.order<=(context.points.find(x=>x.id===from)?.order??-1)}>{p.name}</option>)}</select></label>
        <label>Plazas del grupo<input aria-label="Plazas del grupo presencial" type="number" min="1" max="6" value={seats} onChange={e=>{changed();setSeats(Number(e.target.value));}}/></label>
        <button className="button quiet" disabled={!from||!to||!Number.isInteger(seats)||seats<1||seats>6} onClick={()=>void review()}>Revisar importe presencial</button></fieldset>
        {quote&&!receipt&&<><p>Importe pactado: <strong>{money(quote.totalBOB)}</strong> · tarifa versión {quote.fareVersion}. La consulta no retiene plazas.</p><label className="consent-check"><input type="checkbox" checked={agreed} disabled={busy||frozen} onChange={e=>setAgreed(e.target.checked)}/>Confirmo todo el grupo, los puntos y este importe ficticio.</label><button className="button primary" disabled={busy||!agreed} onClick={()=>void save()}>{frozen?'Reintentar la misma reserva presencial':'Registrar grupo presencial'}</button></>}
      </>:<p>Esta unidad no admite nuevas reservas presenciales desde este formulario. Consulta su operación o incidencia.</p>}
      {receipt&&<div role="status" className="message success"><div><strong>Reserva presencial registrada.</strong><p>Recibo inicial: retención pendiente de aceptación. Consulta el manifiesto para el estado actual; no renueva el plazo provisional.</p>{receipt.bookingIds.map(id=><p key={id}>Referencia: <code>{id}</code></p>)}<p>Importe conservado: {money(receipt.totalPriceBOB)}.</p><button className="button quiet" onClick={()=>{setIntent(x=>x+1);setReceipt(null);setFrozen(false);setQuote(null);setAgreed(false);}}>Preparar otro grupo presencial</button></div></div>}
    </>}{loading&&<p role="status">Consultando el servidor…</p>}{(error||command.error)&&<p role="alert" className="message error">{error||command.error}</p>}
  </section>;
}

export function ReturnQueue({tripId,onReturned}:{tripId:string;onReturned:(tripId:string)=>Promise<void>}){
  const [data,setData]=useState<{routes:{id:string;name:string}[];canReturn:boolean;reason:string|null}|null>(null),[route,setRoute]=useState(''),[agreed,setAgreed]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);const command=useCommands(async()=>{},'/api/terminal/command');
  const load=async()=>{const g=++generation.current;setLoading(true);setData(null);setError('');setAgreed(false);try{const r=await read<typeof data>('/api/terminal/return-options',{tripId});if(g===generation.current)setData(r);}catch(e){if(g===generation.current)setError(errorText(e));}finally{if(g===generation.current)setLoading(false);}};
  const send=async()=>{const r=await command.send({kind:'RETURN_QUEUE',tripId,routeId:route});if(r&&typeof r==='object'&&'tripId'in r&&typeof r.tripId==='string')await onReturned(r.tripId);};
  return <section className="return-queue"><h3>Retorno voluntario a la fila de destino</h3><p>No es automático. La nueva entrada irá al final de una fila compatible y autorizada, con cero personas observadas a bordo.</p>
    <button className="button quiet" disabled={loading||command.busy} onClick={()=>void load()}>Consultar fila de destino</button>
    {data&&<>{!data.canReturn?<p role="status">{{ONBOARD_PENDING:'Registra los descensos observados antes de solicitar el retorno.',NOT_COMPLETED:'El viaje todavía no ha finalizado.',ALREADY_ACTIVE:'Ya existe una asignación activa; consulta tus vehículos.',OPERATION_BLOCKED:'La unidad está bloqueada para operar.',NO_DESTINATION_QUEUE:'No hay una fila compatible habilitada en el destino.'}[data.reason??'']??'Requiere revisión de disponibilidad.'}</p>:<fieldset disabled={loading||command.busy}><legend>Solicitud voluntaria de incorporación</legend><label>Fila de destino<select aria-label="Fila de destino" value={route} onChange={e=>{setRoute(e.target.value);setAgreed(false);}}><option value="">Selecciona una ruta autorizada</option>{data.routes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label className="consent-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>Solicito voluntariamente incorporarme al final de esta fila.</label><button className="button primary" disabled={!route||!agreed||!data.routes.some(r=>r.id===route)} onClick={()=>void send()}>Solicitar incorporación a destino</button></fieldset>}</>}
    {(error||command.error)&&<p role="alert" className="message error">{error||command.error}</p>}
  </section>;
}

export function CancelBooking({bookingId,onUpdated}:{bookingId:string;onUpdated:()=>Promise<void>}){
  const [agreed,setAgreed]=useState(false);const command=useCommands(onUpdated,'/api/terminal/command');
  return <fieldset className="cancel-booking" disabled={command.busy}><legend>Cancelación explícita del grupo</legend><p>Solo antes de iniciar el viaje y sin personas abordadas. Se revalida todo el grupo; sin cancelaciones por ausencia ni devoluciones automáticas.</p><label className="consent-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>Solicito cancelar todo mi grupo de esta reserva.</label><button className="button quiet" disabled={!agreed} onClick={()=>void command.send({kind:'CANCEL_BOOKING',bookingId})}>Cancelar mi grupo</button>{command.error&&<p role="alert" className="message error">{command.error}</p>}</fieldset>;
}
export function RejectOffer({bookingId,onUpdated,disabled=false}:{bookingId:string;onUpdated:()=>Promise<void>;disabled?:boolean}){
  const [agreed,setAgreed]=useState(false);const command=useCommands(onUpdated,'/api/terminal/command');
  return <fieldset className="reject-offer" disabled={disabled||command.busy}><legend>Rechazo de oferta</legend><p>Afecta a todo el grupo pendiente según el contrato existente. No lo reasigna automáticamente.</p><label className="consent-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>Confirmo el rechazo de esta oferta y su grupo pendiente.</label><button className="button quiet" disabled={!agreed} onClick={()=>void command.send({kind:'REJECT_OFFER',bookingId})}>Rechazar oferta {bookingId.slice(0,8)}</button>{command.error&&<p role="alert" className="message error">{command.error}</p>}</fieldset>;
}
