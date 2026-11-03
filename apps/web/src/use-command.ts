import {useRef,useState} from 'react';
import {privateApi,PrivateApiError} from './private-api';
import type {WebSession} from './private-api';
type Command=Record<string,unknown>;
// Retry uncertain attempts with their original key. A confirmed POST plus
// completed refresh ends that attempt; a later explicit action gets a new key.
const errorText=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
export function useCommands(refresh:(result?:unknown)=>Promise<void>,path='/api/operations/command',intent=0,retireRejected=false){
 const[rejected,setRejected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const running=useRef(false),attempts=useRef(new Map<string,{key:string;account:string}>());
 const send=async(body:Command)=>{if(running.current)return;running.current=true;setBusy(true);setError('');setRejected(false);let fingerprint:string|undefined,postCompleted=false;try{const session=await privateApi<WebSession>('/api/session');if(!session.authenticated||!session.accountRef)throw new Error('Sesión requerida. Inicia sesión nuevamente.');const payload={...body,confirmed:true};fingerprint=JSON.stringify([intent,payload]);const attempt=attempts.current.get(fingerprint)??{key:crypto.randomUUID(),account:session.accountRef};if(attempt.account!==session.accountRef)throw new Error('Reintenta con la cuenta original.');attempts.current.set(fingerprint,attempt);const result=await privateApi(path,payload,session.csrf,attempt.key);postCompleted=true;await refresh(result);attempts.current.delete(fingerprint);return result;}catch(e){const definite=retireRejected&&!postCompleted&&e instanceof PrivateApiError&&[400,401,403,404,409,413,429].includes(e.status);if(definite){if(fingerprint)attempts.current.delete(fingerprint);setRejected(true);}setError(errorText(e)+(definite?' El intento fue rechazado. Consulta el estado y confirma una nueva actuación.':' Consulta el estado antes de otra operación. Si se perdió la respuesta, reintenta el mismo botón: conserva su clave.'));}finally{setBusy(false);running.current=false;}};
 return{busy,error,send,rejected};
}
