import{useState}from'react';
import{privateApi}from'./private-api';
import type{WebSession}from'./private-api';
const err=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
export function Login({onSession}:{onSession:(s:WebSession)=>void}){
 const[login,setLogin]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="lab-login" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const context=await privateApi<WebSession>('/api/session');const s=await privateApi<WebSession>('/api/login',{login,password},context.csrf);setPassword('');onSession(s);}catch(e){setPassword('');setError(err(e));}finally{setBusy(false);}}}><h3>Acceso de laboratorio</h3><p>Utiliza exclusivamente los accesos ficticios del archivo local que indica la terminal. Los datos desaparecen al detener el laboratorio.</p><label>Usuario ficticio<input autoComplete="username" value={login} onChange={e=>setLogin(e.target.value)} required maxLength={64}/></label><label>Contraseña de prueba<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={128}/></label><button type="submit" className="button primary" disabled={busy}>{busy?'Verificando…':'Iniciar sesión'}</button>{error&&<p role="alert" className="message error">{error}</p>}</form>;
}
