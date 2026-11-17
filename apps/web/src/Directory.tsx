import{RouteConfiguration}from'./RouteConfiguration';
import{FleetAdministration}from'./FleetAdministration';
import {DriverAdministration} from './DriverAdministration';
import {useEffect,useRef,useState} from 'react';
import {privateApi} from './private-api';
import type {WebSession} from './private-api';
import {PageControls} from './Management';
import type {PageCursor} from './Management';
import {money} from './model';
type Section='ASSOCIATIONS'|'DRIVERS'|'VEHICLES'|'ROUTES'|'POINTS'|'FARES';
type Item={id:string;name?:string;label?:string;commercialStatus?:string;adherenceStatus?:string;operatingStatus?:string;membershipActive?:boolean;capacity?:number;availability?:string;blocked?:boolean;direction?:string;version?:number;origin?:string|null;destination?:string|null;authorization?:string;eligibleForNewBookings?:boolean;route?:string;index?:number;kind?:string;locality?:string|null;boardingAllowed?:boolean;alightingAllowed?:boolean;from?:number;to?:number;boarding?:string;alighting?:string;express?:boolean;amountBOB?:string;validFrom?:string;validUntil?:string|null;originalValidUntil?:string|null;validity?:string};
type Data={association:Item|null;section:Section;scope:'FULL_ASSOCIATION'|'AUTHORIZED_ROUTES';items:Item[];total:number;limit:number;nextCursor:PageCursor;readOnly:true};
const names:Record<Section,string>={ASSOCIATIONS:'Asociaciones autorizadas',DRIVERS:'Choferes y membresías',VEHICLES:'Vehículos registrados',ROUTES:'Rutas y sentidos',POINTS:'Terminales y puntos',FARES:'Tarifas por segmentos'};
const states:Record<string,string>={BLOCKED:'Bloqueado por incidencia',IN_SERVICE:'En servicio',QUEUED:'En fila',NO_ACTIVE_TRIP:'Sin viaje activo; aptitud para asignación no comprobada',TERMINAL:'Terminal',URBAN:'Punto urbano',ROAD:'Parada de carretera',UNCLASSIFIED:'Perfil no registrado',CURRENT:'Vigente',FUTURE:'Vigencia futura',EXPIRED:'Vencida',VERIFIED_CURRENT:'Permiso vigente registrado',NOT_CURRENT:'Sin permiso vigente registrado'};
const date=(s?:string|null)=>s?new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short',timeZone:'America/La_Paz'}).format(new Date(s)):'Sin fecha final registrada';
export function AdministrativeDirectory(){
 const[configRoute,setConfigRoute]=useState<string|null|undefined>(undefined);
 const[fleetOpen,setFleetOpen]=useState(false);
 const[adminUser,setAdminUser]=useState<string|null|undefined>(undefined),[adminBusy,setAdminBusy]=useState(false);
 const[active,setActive]=useState(false),[section,setSection]=useState<Section>('ASSOCIATIONS'),[association,setAssociation]=useState<string|null>(null),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[index,setIndex]=useState(0);
 const generation=useRef(0),cursors=useRef<PageCursor[]>([null]),result=useRef<HTMLHeadingElement>(null);
 useEffect(()=>()=>{generation.current++;},[]);
 const load=async(nextSection=section,nextAssociation=association,page=0)=>{
  const g=++generation.current,cursor=page===0?null:cursors.current[page];if(page===0)cursors.current=[null];
  setConfigRoute(undefined);setFleetOpen(false);setAdminUser(undefined);setActive(true);setSection(nextSection);setAssociation(nextAssociation);setData(null);setError('');setLoading(true);setIndex(page);
  try{const s=await privateApi<WebSession>('/api/session');if(!s.authenticated)throw new Error('La sesión ya no está activa. Inicia sesión nuevamente.');
   const r=await privateApi<Data>('/api/directory/page',{associationId:nextAssociation,section:nextSection,limit:50,cursor},s.csrf);
   if(g===generation.current){setData(r);if(r.nextCursor)cursors.current[page+1]=r.nextCursor;else cursors.current.length=page+1;}
  }catch(e){if(g===generation.current){setData(null);cursors.current=[null];setIndex(0);setError((e instanceof Error?e.message:'No se pudo consultar el directorio.')+' Actualiza el directorio para consultar permisos y datos de nuevo.');}}
  finally{if(g===generation.current){setLoading(false);result.current?.focus();}}
 };
 return <section id="directorio-administrativo" className="administrative-directory" aria-label="Directorio administrativo" aria-busy={loading||adminBusy}>
  <h2>Directorio administrativo</h2><p>Directorio de consulta. Consulta registros aunque todavía no tengan viajes. Los controles autorizados gestionan permisos, contactos, solicitudes de altas y asignaciones base ficticias. No crean cuentas ni habilitaciones legales. Rutas y tarifas tienen borradores y publicación separada.</p><p>Choferes y vehículos requieren alcance completo de asociación. Rutas, puntos y tarifas respetan las rutas autorizadas de tu cuenta.</p>
  <button className="button quiet" disabled={loading||adminBusy} onClick={()=>void load(active?section:'ASSOCIATIONS',active?association:null)}>{active?'Actualizar directorio':'Consultar directorio administrativo'}</button>
  {active&&<><div className="directory-tabs" aria-label="Apartados del directorio"><button className="button quiet" disabled={loading||adminBusy} onClick={()=>void load('ASSOCIATIONS',null)}>Elegir asociación</button>{association&&(Object.keys(names)as Section[]).filter(s=>s!=='ASSOCIATIONS').map(s=><button key={s} className="button quiet" aria-pressed={section===s} disabled={loading||adminBusy} onClick={()=>void load(s,association)}>{names[s]}</button>)}</div>
   <h3 ref={result} tabIndex={-1}>{names[section]}</h3>{loading&&<p role="status">Consultando registros autorizados…</p>}
   {error&&<p className="message error" role="alert">{error}</p>}
   {data&&<>{association&&<button className="button quiet" disabled={loading||adminBusy} onClick={()=>{setFleetOpen(false);setAdminUser(undefined);setConfigRoute(null);}}>Gestionar rutas y tarifas</button>}{association&&data.scope==='FULL_ASSOCIATION'&&<div><button className="button quiet" disabled={loading||adminBusy} onClick={()=>{setConfigRoute(undefined);setFleetOpen(false);setAdminUser(null);}}>Gestionar contacto e historial de asociación</button><button className="button quiet" disabled={loading||adminBusy} onClick={()=>{setConfigRoute(undefined);setAdminUser(undefined);setFleetOpen(true);}}>Gestionar altas y asignaciones</button></div>}<p className="directory-scope">{data.association?<>Asociación: <strong>{data.association.name}</strong> · Estado comercial: {data.association.commercialStatus} · Adhesión: {data.association.adherenceStatus} · Operación: {data.association.operatingStatus}.</>:'Selecciona una asociación que administras.'} {data.scope==='FULL_ASSOCIATION'?'Alcance de asociación completo.':'Alcance limitado a rutas autorizadas. Los padrones completos de choferes y vehículos requieren alcance completo.'}</p>
    {data.items.length===0?<p role="status">No hay registros autorizados para esta consulta.</p>:<ul className="directory-items">{data.items.map(i=><li key={i.id} data-directory-id={i.id}>
     <h4>{i.name??i.label??'Registro técnico'}</h4><p className="directory-id">Referencia técnica: {i.id}</p>
     {section==='ASSOCIATIONS'&&<><p>Comercial: {i.commercialStatus} · Adhesión: {i.adherenceStatus} · Operación: {i.operatingStatus}.</p><button className="button quiet" disabled={loading||adminBusy} onClick={()=>void load('ROUTES',i.id)}>Consultar asociación {i.name}</button></>}
     {section==='DRIVERS'&&<><p>Membresía DRIVER: {i.membershipActive?'activa':'inactiva'}. Es un permiso técnico; no acredita identidad ni habilitación legal.</p><button className="button quiet" disabled={loading||adminBusy} onClick={()=>{setConfigRoute(undefined);setFleetOpen(false);setAdminUser(i.id);}}>Gestionar permiso de {i.label}</button></>}
     {section==='VEHICLES'&&<p>Capacidad técnica: {i.capacity} plazas. {states[i.availability??'']??'Estado no determinado'}. No garantiza capacidad disponible en un recorrido.</p>}
     {section==='ROUTES'&&<><p>{i.origin??'Origen no registrado'} → {i.destination??'Destino no registrado'} · Sentido {i.direction} · Versión {i.version}.</p><button className="button quiet" disabled={loading||adminBusy} onClick={()=>{setFleetOpen(false);setAdminUser(undefined);setConfigRoute(i.id);}}>Configurar ruta {i.name}</button><p>{states[i.authorization??'']??'Permiso no determinado'} · {i.eligibleForNewBookings?'Habilitada para nuevas solicitudes':'No habilitada para nuevas solicitudes'}.</p></>}
     {section==='POINTS'&&<><p>{i.route} · Sentido {i.direction} · Punto {i.index} · {states[i.kind??'']??'Perfil no registrado'}.</p><p>Localidad: {i.locality??'No registrada'}. Subida {i.boardingAllowed?'habilitada':'no habilitada'}; descenso {i.alightingAllowed?'habilitado':'no habilitado'}.</p></>}
     {section==='FARES'&&<><p>{i.route} · Sentido {i.direction} · {i.boarding} → {i.alighting} (segmento {i.from}–{i.to}).</p><p>{i.express?'Expreso':'Ordinaria'} · {i.amountBOB?money(i.amountBOB):'Importe no registrado'} · Versión {i.version} · {states[i.validity??'']??'Vigencia no determinada'}.</p><p>Selección nueva: desde {date(i.validFrom)} · hasta {date(i.validUntil)}. Vigencia original hasta {date(i.originalValidUntil)}. Consulta de configuración; no cambia importes pactados ni confirma reservas.</p></>}
    </li>)}</ul>}
    {association&&configRoute!==undefined&&<RouteConfiguration key={association+':'+(configRoute??'ALL')} associationId={association} initialRouteId={configRoute} onBusy={setAdminBusy}/>}
    {association&&fleetOpen&&<FleetAdministration key={association} associationId={association} onBusy={setAdminBusy}/>}
    {association&&adminUser!==undefined&&<DriverAdministration key={association+':'+(adminUser??'CONTACT')} associationId={association} userRef={adminUser} onBusy={setAdminBusy} onMember={(id,active)=>setData(d=>d?{...d,items:d.items.map(i=>i.id===id?{...i,membershipActive:active}:i)}:d)}/>}
    <PageControls name={names[section]} index={index} count={data.items.length} total={data.total} next={data.nextCursor} busy={loading||adminBusy} change={n=>void load(section,association,n)}/>
   </>}
  </>}
 </section>;
}
