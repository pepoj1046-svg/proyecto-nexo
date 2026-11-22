import{useRef,useState}from'react';
import{Icon}from'./icons';
import{privateApi}from'./private-api';
import type{WebSession}from'./private-api';
import{readForAccount,assertSameAccount}from'./private-read';

// Etapa 7A: conciliación diaria SIMULADA. No hay dinero real: el esperado sale de las
// marcas de pago simulado; un administrador sin ámbito limitado declara lo contado una vez.
type Assoc={associationId:string;name:string};
type Day={day:string;groups:number;expectedBOB:string;byRoute:{route:string;groups:number;amountBOB:string}[];closing:null|{groups:number;expectedBOB:string;declaredBOB:string;differenceBOB:string;status:string;note:string|null;closedAt:string}};
const message=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';

export function ReconciliationPanel(){
 const[assocs,setAssocs]=useState<Assoc[]|null>(null),[assoc,setAssoc]=useState(''),[day,setDay]=useState(''),[today,setToday]=useState('');
 const[data,setData]=useState<Day|null>(null),[declared,setDeclared]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const key=useRef<string>(crypto.randomUUID());
 const start=async()=>{setBusy(true);setError('');
  try{const r=await readForAccount<{items:Assoc[];today:string}>('/api/reconciliation/associations',{});setAssocs(r.items);setToday(r.today);setDay(r.today);if(r.items[0])setAssoc(r.items[0].associationId);}
  catch(e){setError(message(e));}finally{setBusy(false);}};
 const view=async()=>{if(!assoc||!day)return;setBusy(true);setError('');setData(null);
  try{setData(await readForAccount<Day>('/api/reconciliation/day',{associationId:assoc,day}));key.current=crypto.randomUUID();}
  catch(e){setError(message(e));}finally{setBusy(false);}};
 const close=async()=>{if(!data)return;setBusy(true);setError('');
  try{const s=await privateApi<WebSession>('/api/session');await privateApi('/api/reconciliation/close',{associationId:assoc,day,declaredBOB:declared.trim(),note:note.trim()||null},s.csrf,key.current);await assertSameAccount(s);await view();}
  catch(e){setError(message(e));}finally{setBusy(false);}};
 return <section className="ratings-panel reconciliation-panel" aria-labelledby="reconciliation-title">
  <h2 id="reconciliation-title"><Icon name="shield" size={22}/>Conciliación diaria (simulada)</h2>
  <p><strong>Sin dinero real.</strong> El importe esperado es la suma de los pagos marcados como verificados en la simulación ese día. Solo un administrador sin ámbito limitado puede cerrar el día, una sola vez.</p>
  {!assocs&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void start()}>Abrir conciliación</button>}
  {assocs&&(assocs.length===0?<p>No administras ninguna asociación sin ámbito limitado.</p>:<div className="reconciliation-form">
   <label>Asociación<select value={assoc} onChange={e=>{setAssoc(e.target.value);setData(null);}}>{assocs.map(a=><option key={a.associationId} value={a.associationId}>{a.name.replace(' · ficticia','')}</option>)}</select></label>
   <label>Día<input type="date" value={day} max={today} onChange={e=>{setDay(e.target.value);setData(null);}}/></label>
   <button type="button" className="button quiet" disabled={busy||!day} onClick={()=>void view()}>Consultar día</button>
  </div>)}
  {error&&<p role="alert" className="message error">{error}</p>}
  {data&&<div className="reconciliation-result">
   <p><strong>Esperado: Bs {data.expectedBOB}</strong> · {data.groups} {data.groups===1?'grupo':'grupos'} con pago verificado (simulado)</p>
   {data.byRoute.length>0&&<ul>{data.byRoute.map(r=><li key={r.route}>{r.route}: Bs {r.amountBOB} ({r.groups})</li>)}</ul>}
   {data.closing?<p role="status" className={`closing-${data.closing.status.toLowerCase()}`}>Día cerrado: <strong>{data.closing.status==='CUADRA'?'cuadra':'con discrepancia'}</strong>. Declarado Bs {data.closing.declaredBOB}, diferencia Bs {data.closing.differenceBOB}.{data.closing.note?` Nota: ${data.closing.note}`:''}</p>
    :<div className="reconciliation-form">
     <label>Importe contado (Bs)<input inputMode="decimal" value={declared} onChange={e=>setDeclared(e.target.value)} placeholder="0.00" maxLength={13}/></label>
     <label>Nota (obligatoria si no cuadra)<input value={note} onChange={e=>setNote(e.target.value)} maxLength={200}/></label>
     <button type="button" className="button primary" disabled={busy||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(declared.trim())} onClick={()=>void close()}>Cerrar el día</button>
    </div>}
  </div>}
 </section>;
}
