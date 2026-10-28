import {useRef,useState} from 'react';
import {privateApi} from './private-api';
import type {WebSession} from './private-api';
type Command=Record<string,unknown>;
const errorText=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
export function useCommands(refresh:()=>Promise<void>,path='/api/operations/command'){
 const[busy,setBusy]=useState(false),[error,setError]=useState('');const running=useRef(false),attempts=useRef(new Map<string,{key:string;account:string}>());
 const send=async(body:Command)=>{if(running.current)return;running.current=true;setBusy(true);setError('');try{const session=await privateApi<WebSession>('/api/session');if(!session.authenticated||!session.accountRef)throw new Error('Sesión requerida. Inicia sesión nuevamente.');const payload={...body,confirmed:true},fingerprint=JSON.stringify(payload);const attempt=attempts.current.get(fingerprint)??{key:crypto.randomUUID(),account:session.accountRef};if(attempt.account!==session.accountRef)throw new Error('Reintenta con la cuenta original.');attempts.current.set(fingerprint,attempt);const result=await privateApi(path,payload,session.csrf,attempt.key);await refresh();return result;}catch(e){setError(errorText(e)+' Consulta el estado antes de otra operación. Si se perdió la respuesta, reintenta el mismo botón: conserva su clave.');}finally{setBusy(false);running.current=false;}};
 return{busy,error,send};
}
