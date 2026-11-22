import{useEffect,useRef,useState}from'react';
import{Icon}from'./icons';
import{Login}from'./Login';
import{privateApi}from'./private-api';
import type{WebSession}from'./private-api';
import{readForAccount}from'./private-read';
import{adminIntentPending}from'./admin-intent';
import{loadPreferences,savePreferences}from'./preferences';
import type{Preferences}from'./preferences';

// 5A.5 "Mi cuenta": who is signed in and with which roles (read-only), plus interface
// preferences kept in this browser. Identity, roles and associations are managed by
// administration; nothing here can change them.
type Account={label:string;roles:{association:string;role:string;restricted:boolean}[];editableFields:string[]};
const roleNames:Record<string,string>={ASSOCIATION_ADMIN:'Administración de la asociación',DRIVER:'Chofer',OTHER:'Otro rol'};
const prefLabels:[keyof Preferences,string,string][]=[
 ['largeText','Texto más grande','Aumenta el tamaño de letra en todas las páginas.'],
 ['highContrast','Contraste alto','Refuerza bordes y colores para leer con más facilidad.'],
 ['reduceMotion','Reducir animaciones','Evita desplazamientos y transiciones animadas.']];
const message=(e:unknown)=>e instanceof Error?e.message:'No se pudo consultar la cuenta.';

export function AccountPage(){
 const[session,setSession]=useState<WebSession|null>(null),[account,setAccount]=useState<Account|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const[prefs,setPrefs]=useState<Preferences>(loadPreferences),[prefNote,setPrefNote]=useState('');
 const generation=useRef(0);
 const load=async(s?:WebSession)=>{
  const g=++generation.current;setBusy(true);setError('');
  try{
   const current=s??await privateApi<WebSession>('/api/session');
   if(g!==generation.current)return;
   if(!current.authenticated){setSession(null);setAccount(null);return;}
   const a=await readForAccount<Account>('/api/account',{},current);
   if(g!==generation.current)return;
   setSession(current);setAccount(a);
  }catch(e){if(g===generation.current){setAccount(null);setError(message(e));}}
  finally{if(g===generation.current)setBusy(false);}
 };
 useEffect(()=>{void load();return()=>{generation.current++;};},[]);
 const logout=async()=>{
  if(adminIntentPending()){setError('Resuelve primero la operación pendiente.');return;}
  generation.current++;setBusy(true);
  try{const s=await privateApi<WebSession>('/api/session');await privateApi('/api/logout',{},s.csrf);setSession(null);setAccount(null);}
  catch(e){setError(message(e));}finally{setBusy(false);}
 };
 const toggle=(k:keyof Preferences)=>{const next={...prefs,[k]:!prefs[k]};setPrefs(next);setPrefNote(savePreferences(next)?'Preferencia guardada en este navegador.':'Se aplicó, pero este navegador no permite guardarla para la próxima visita.');};

 return <section className="container panel-page account-page">
  <p className="eyebrow">MI CUENTA</p><h1>Tu cuenta y tus preferencias</h1>
  <div className="account-grid">
   <article className="account-card" aria-labelledby="account-identity">
    <h2 id="account-identity"><Icon name="users" size={22}/>Datos de la cuenta</h2>
    {busy&&!account&&<p role="status">Consultando la cuenta…</p>}
    {!busy&&!session&&<Login onSession={s=>void load(s)}/>}
    {account&&<>
     <dl className="account-facts"><dt>Nombre visible</dt><dd>{account.label}</dd></dl>
     <h3>Roles activos</h3>
     {account.roles.length?<ul className="account-roles">{account.roles.map((r,i)=><li key={i}><strong>{roleNames[r.role]??r.role}</strong><span>{r.association.replace(' · ficticia','')}</span>{r.restricted&&<span className="pending-tag">Ámbito limitado</span>}</li>)}</ul>
      :<p>Esta cuenta viaja como pasajero y no tiene roles en ninguna asociación.</p>}
     <p className="account-note"><Icon name="lock" size={16}/>El nombre y los roles los gestiona la administración. Desde aquí no se pueden modificar.</p>
     <button type="button" className="button quiet" onClick={()=>void logout()} disabled={busy}>Cerrar sesión</button>
    </>}
    {error&&<p role="alert" className="message error">{error}</p>}
   </article>
   <article className="account-card" aria-labelledby="account-preferences">
    <h2 id="account-preferences"><Icon name="info" size={22}/>Preferencias de interfaz</h2>
    <p>Se guardan solo en este navegador y no requieren iniciar sesión.</p>
    <fieldset className="account-preferences"><legend className="visually-hidden">Preferencias</legend>
     {prefLabels.map(([k,label,help])=><label key={k} className="preference-row"><input type="checkbox" checked={prefs[k]} onChange={()=>toggle(k)}/><span><strong>{label}</strong><small>{help}</small></span></label>)}
    </fieldset>
    <p role="status" className="account-pref-status">{prefNote}</p>
   </article>
  </div>
 </section>;
}
