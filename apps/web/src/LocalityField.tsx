import {useEffect,useId,useRef,useState} from 'react';
import {post} from './api';
import {Icon} from './icons';
import type {Locality} from './model';
export function LocalityField({label,placeholder,selected,onSelect,kind}:{label:string;placeholder:string;selected:Locality|null;onSelect:(value:Locality|null)=>void;kind:'origin'|'destination'}) {
 const [query,setQuery]=useState(selected?.name??''),[items,setItems]=useState<Locality[]>([]),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[active,setActive]=useState(-1);
 const uid=useId(),inputRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(selected){setQuery(selected.name);setOpen(false);setItems([]);setError('');}},[selected]);
 useEffect(()=>{
  if(selected||query.trim().length<2){setItems([]);setLoading(false);return;}
  const controller=new AbortController();setLoading(true);setError('');setActive(-1);
  const timer=setTimeout(()=>{post<Locality[]>('/api/localities',{query,limit:8},controller.signal).then(values=>{if(!controller.signal.aborted){setItems(values);setLoading(false);}}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setItems([]);setLoading(false);}});},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,selected]);
 const choose=(value:Locality)=>{onSelect(value);setQuery(value.name);setOpen(false);setActive(-1);inputRef.current?.focus();};
 return <div className={`locality-field ${kind}`} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setActive(-1);}}}>
  <label htmlFor={uid}>{label}</label><div className="input-shell"><span className="field-symbol"><Icon name="pin" size={21}/></span>
  <input ref={inputRef} id={uid} value={query} placeholder={placeholder} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open&&query.trim().length>=2&&!selected} aria-controls={open&&!selected&&query.trim().length>=2?uid+'-list':undefined} aria-describedby={uid+'-hint'} aria-activedescendant={active>=0?`${uid}-option-${active}`:undefined}
   onFocus={()=>setOpen(true)} onChange={e=>{onSelect(null);setQuery(e.target.value);setOpen(true);}}
   onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setActive(-1);}else if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(i=>Math.min(i+1,items.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(i-1,0));}else if(e.key==='Enter'&&open&&active>=0){e.preventDefault();choose(items[active]);}}}/>
  {selected&&<span className="chosen-check"><Icon name="check" size={16}/></span>}</div>
  <span id={uid+'-hint'} className="field-hint">{selected?`${selected.municipality} · ${selected.department}`:'Escribe al menos 2 letras y elige una localidad'}</span>
  {open&&!selected&&query.trim().length>=2&&<div className="suggestions"><ul id={uid+'-list'} role="listbox" aria-label={`Sugerencias de ${label.toLowerCase()}`}>
   {items.map((item,index)=><li key={item.localityId} id={`${uid}-option-${index}`} role="option" aria-selected={index===active} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(item)} className={index===active?'active':''}><Icon name="pin" size={18}/><span><strong>{item.name}</strong><small>{item.municipality} · {item.province} · {item.department}</small></span></li>)}
  </ul>{loading&&<p role="status">Buscando localidades…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!items.length&&<p role="status">Sin coincidencias. Prueba con otro nombre.</p>}</div>}
 </div>;
}
