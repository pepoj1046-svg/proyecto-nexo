import{useMemo,useState}from'react';
import{Icon}from'./icons';
import{HELP_VERSION,filterTopics,helpTopics,kindLabels,roleLabels}from'./help-content';
import type{HelpRole}from'./help-content';

// 5A.6 Ayuda: local, versioned content shipped with the page. No request, no write.
const order:(HelpRole|'TODOS')[]=['TODOS','PASAJERO','CHOFER','ADMINISTRACION','GENERAL'];
export function initialHelpRole(search:string):HelpRole|'TODOS'{
 const v=new URLSearchParams(search).get('para')?.toUpperCase();
 return v==='PASAJERO'||v==='CHOFER'||v==='ADMINISTRACION'||v==='GENERAL'?v:'TODOS';
}
export function HelpPage({go}:{go:(href:string)=>void}){
 const[role,setRole]=useState<HelpRole|'TODOS'>(()=>initialHelpRole(location.search)),[query,setQuery]=useState('');
 const topics=useMemo(()=>filterTopics(helpTopics,role,query),[role,query]);
 return <section className="container panel-page help-page">
  <p className="eyebrow">AYUDA</p><h1>¿Cómo podemos ayudarte?</h1>
  <p>Guía del laboratorio por rol. Se lee sin conexión una vez cargada la página y no envía nada.</p>
  <div className="help-controls">
   <fieldset className="help-roles"><legend>Ver ayuda para</legend>
    {order.map(r=><label key={r} className={role===r?'selected':''}><input type="radio" name="help-role" value={r} checked={role===r} onChange={()=>setRole(r)}/>{r==='TODOS'?'Todos':roleLabels[r]}</label>)}
   </fieldset>
   <label className="help-search">Buscar en la ayuda<input type="search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={80}/></label>
  </div>
  <p role="status" className="help-count">{topics.length===1?'1 tema':`${topics.length} temas`}</p>
  {topics.length?<div className="help-list">{topics.map(t=><article key={t.id} id={t.id} className="help-topic" aria-labelledby={`help-${t.id}`}>
   <div className="help-tags"><span className="pending-tag">{roleLabels[t.role]}</span><span className={`help-kind kind-${t.kind.toLowerCase()}`}>{kindLabels[t.kind]}</span></div>
   <h2 id={`help-${t.id}`}>{t.title}</h2>
   <ol>{t.steps.map((s,i)=><li key={i}>{s}</li>)}</ol>
   {t.note&&<p className="help-note"><Icon name="info" size={16}/>{t.note}</p>}
   {t.link&&<a className="button quiet" href={t.link.href} onClick={e=>{e.preventDefault();go(t.link!.href);}}>{t.link.label}</a>}
  </article>)}</div>:<p className="welcome-state">No hay temas que coincidan. Prueba con otra palabra o elige «Todos».</p>}
  <p className="help-version">Versión de la ayuda: {HELP_VERSION}</p>
 </section>;
}
