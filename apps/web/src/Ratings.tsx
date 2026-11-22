import{useEffect,useRef,useState,useSyncExternalStore}from'react';
import{Icon}from'./icons';
import{privateApi,subscribeSession,currentSession}from'./private-api';
import type{WebSession}from'./private-api';
import{readForAccount,assertSameAccount}from'./private-read';

// 5A.7 Valoraciones de laboratorio (decisiones provisionales P-5A7-1 a P-5A7-6).
// Passenger: rate once a completed APP trip, 1-5 plus optional tags, no free text.
// Administration: ratings of the managed routes, without passenger identity.
export const tagLabels:Record<string,string>={PUNTUALIDAD:'Puntualidad',TRATO:'Buen trato',LIMPIEZA:'Limpieza',CONDUCCION_SEGURA:'Conducción segura'};
const scoreLabels=['','Muy malo','Malo','Regular','Bueno','Muy bueno'];
type Ratable={bookingId:string;route:string;createdAt:string;seats:number;rated:boolean;score:number|null;tags:string[]};
const message=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
const date=(s:string)=>new Intl.DateTimeFormat('es-BO',{dateStyle:'medium',timeZone:'America/La_Paz'}).format(new Date(s));

export function PassengerRatings(){
 const[items,setItems]=useState<Ratable[]|null>(null),[error,setError]=useState(''),[session,setSession]=useState<WebSession|null>(null);
 const generation=useRef(0);
 const load=async()=>{const g=++generation.current;setError('');
  try{const s=await privateApi<WebSession>('/api/session');if(g!==generation.current)return;
   if(!s.authenticated){setSession(null);setItems(null);return;}
   const r=await readForAccount<{items:Ratable[]}>('/api/ratings/mine',{},s);if(g!==generation.current)return;setSession(s);setItems(r.items);}
  catch(e){if(g===generation.current)setError(message(e));}};
 const live=useSyncExternalStore(subscribeSession,currentSession,()=>null);
 useEffect(()=>{void load();return()=>{generation.current++;};},[live?.accountRef]);
 if(!session&&!error)return null;
 return <section className="ratings-panel" aria-labelledby="ratings-title">
  <h2 id="ratings-title"><Icon name="check" size={22}/>Valora tus viajes terminados</h2>
  <p>Tu valoración llega a la asociación sin tu nombre. No cambia tu reserva ni la de nadie, y no se puede editar después.</p>
  <button type="button" className="button quiet" onClick={()=>void load()}>Actualizar viajes para valorar</button>
  {error&&<p role="alert" className="message error">{error}</p>}
  {items&&(items.length?<ul className="ratings-list">{items.map(i=><li key={i.bookingId}><RatingForm item={i} session={session!} onDone={()=>void load()}/></li>)}</ul>
   :<p>No tienes viajes terminados en los últimos 30 días.</p>)}
 </section>;
}

function RatingForm({item,session,onDone}:{item:Ratable;session:WebSession;onDone:()=>void}){
 const[score,setScore]=useState(0),[tags,setTags]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // One idempotency key per booking and attempt: a retry after a lost answer reuses it.
 const key=useRef(crypto.randomUUID());
 const title=`Viaje en ${item.route} del ${date(item.createdAt)}`;
 if(item.rated)return <article className="rating-card rated" aria-label={title}><h3>{title}</h3><p><strong>Tu valoración: {item.score} de 5</strong>{item.tags.length?` · ${item.tags.map(t=>tagLabels[t]??t).join(', ')}`:''}</p></article>;
 const send=async()=>{if(busy||!score)return;setBusy(true);setError('');
  try{await assertSameAccount(session);await privateApi('/api/ratings/rate',{bookingId:item.bookingId,score,tags},session.csrf,key.current);onDone();}
  catch(e){setError(message(e));}finally{setBusy(false);}};
 return <article className="rating-card" aria-label={title}>
  <h3>{title}</h3>
  <fieldset className="rating-scores"><legend>¿Cómo fue el servicio?</legend>
   {[1,2,3,4,5].map(n=><label key={n} className={score===n?'selected':''}><input type="radio" name={`score-${item.bookingId}`} value={n} checked={score===n} onChange={()=>setScore(n)}/>{n} · {scoreLabels[n]}</label>)}
  </fieldset>
  <fieldset className="rating-tags"><legend>Lo que destacas (opcional)</legend>
   {Object.entries(tagLabels).map(([t,label])=><label key={t}><input type="checkbox" checked={tags.includes(t)} onChange={()=>setTags(x=>x.includes(t)?x.filter(y=>y!==t):[...x,t])}/>{label}</label>)}
  </fieldset>
  <button type="button" className="button primary" disabled={!score||busy} onClick={()=>void send()}>{busy?'Enviando…':'Enviar valoración'}</button>
  {error&&<p role="alert" className="message error">{error}</p>}
 </article>;
}

type AdminRatings={items:{association:string;route:string;vehicle:string;day:string;score:number;tags:string[]}[];summary:{association:string;route:string;count:number;average:string}[];hasMore:boolean;offset:number};
export function AdminRatingsPanel(){
 const[data,setData]=useState<AdminRatings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async(offset=0)=>{setBusy(true);setError('');
  try{setData(await readForAccount<AdminRatings>('/api/ratings/admin',{limit:20,offset}));}
  catch(e){setData(null);setError(message(e));}finally{setBusy(false);}};
 return <section className="ratings-panel" aria-labelledby="admin-ratings-title">
  <h2 id="admin-ratings-title"><Icon name="check" size={22}/>Valoraciones de pasajeros</h2>
  <p>Solo de las rutas que administras y sin datos de los pasajeros. No afectan a la fila, las tarifas ni a los choferes.</p>
  <button type="button" className="button quiet" disabled={busy} onClick={()=>void load(0)}>Consultar valoraciones</button>
  {error&&<p role="alert" className="message error">{error}</p>}
  {data&&<>
   {data.summary.length?<table className="ratings-summary"><caption>Resumen por ruta</caption><thead><tr><th scope="col">Asociación</th><th scope="col">Ruta</th><th scope="col">Valoraciones</th><th scope="col">Promedio</th></tr></thead>
    <tbody>{data.summary.map((s,i)=><tr key={i}><td>{s.association.replace(' · ficticia','')}</td><td>{s.route}</td><td>{s.count}</td><td>{s.average} de 5</td></tr>)}</tbody></table>
    :<p>Todavía no hay valoraciones en tus rutas.</p>}
   {data.items.length>0&&<ul className="ratings-list">{data.items.map((r,i)=><li key={i} className="rating-card rated"><strong>{r.score} de 5</strong> · {r.route} · {r.vehicle} · {r.day}{r.tags.length?` · ${r.tags.map(t=>tagLabels[t]??t).join(', ')}`:''}</li>)}</ul>}
   <div className="ratings-pager">{data.offset>0&&<button type="button" className="button quiet" onClick={()=>void load(Math.max(0,data.offset-20))}>Anteriores</button>}{data.hasMore&&<button type="button" className="button quiet" onClick={()=>void load(data.offset+20)}>Siguientes</button>}</div>
  </>}
 </section>;
}
