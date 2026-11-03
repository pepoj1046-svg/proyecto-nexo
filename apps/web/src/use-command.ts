import {protectAdminIntent,requestAdminAuthentication} from './admin-intent';
import {useEffect,useRef,useState} from 'react';
import {privateApi,PrivateApiError} from './private-api';
import type {WebSession} from './private-api';
type Command=Record<string,unknown>;
type Attempt={key:string;account:string;body:Command;received:boolean;result?:unknown};
const errorText=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
// Mounted-form protection is opt-in per reviewed panel. Only 4A.6 contracts may
// retire definite rejections. A receipt and a successful refresh are distinct.
export function useCommands(refresh:(result?:unknown,session?:WebSession)=>Promise<void>,path='/api/operations/command',intent=0,retireRejected=false,recovery=false,scopedRefresh=false){
 const[rejected,setRejected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(false),[received,setReceived]=useState(false);
 const running=useRef(false),mounted=useRef(true),attempts=useRef(new Map<string,Attempt>()),token=useRef(Symbol('command-intent'));
 const protect=recovery||/^\/api\/(driver-admin\/(command|contact)|fleet-admin\/command|platform\/command|route-config\/command)$/.test(path);
 useEffect(()=>{mounted.current=true;const current=token.current;return()=>{mounted.current=false;protectAdminIntent(current,false);};},[]);
 const run=async(body:Command,originalFingerprint?:string)=>{
  if(running.current||!mounted.current)return;
  const payload=freeze(structuredClone({...body,confirmed:true}));
  const fingerprint=originalFingerprint??JSON.stringify([intent,payload]);
  const hadUncertain=attempts.current.size>0;
  running.current=true;if(protect)protectAdminIntent(token.current,true);
  setBusy(true);setError('');setRejected(false);
  let attempt:Attempt|undefined=attempts.current.get(fingerprint),accountMismatch=false;
  const actor=async()=>{
   const session=await privateApi<WebSession>('/api/session');
   if(!mounted.current)throw Error('La vista ya no está activa.');
   if(!session.authenticated||!session.accountRef)throw new PrivateApiError('Sesión requerida. Inicia sesión nuevamente.',401,'AUTHENTICATION_REQUIRED');
   const original=attempt??attempts.current.values().next().value;
   if(original&&original.account!==session.accountRef){accountMismatch=true;throw Error('Reintenta con la cuenta original.');}
   return session;
  };
  try{
   const session=await actor();
   if(recovery&&hadUncertain&&!attempt)throw Error('Hay una actuación pendiente. Recupera primero la actuación original; no se envió otra operación.');
   attempt??={key:crypto.randomUUID(),account:session.accountRef!,body:payload,received:false};
   attempts.current.set(fingerprint,attempt);setPending(true);
   if(!attempt.received){
    attempt.result=freeze(structuredClone(await privateApi(path,attempt.body,session.csrf,attempt.key)));
    attempt.received=true;setReceived(true);
   }
   // Only reviewed refreshes bind every POST-read to this CSRF and validate
   // identity before publishing. Other callbacks retain both identity checks.
   const current=scopedRefresh?session:await actor();
   await refresh(attempt.result,current);
   if(!scopedRefresh)await actor();
   attempts.current.delete(fingerprint);setReceived(false);return attempt.result;
  }catch(e){
   let authenticationLost=e instanceof PrivateApiError&&e.status===401;
   if(attempts.current.size&&mounted.current){try{await actor();}catch(auth){authenticationLost||=auth instanceof PrivateApiError&&auth.status===401;}}
   const recover=protect&&attempts.current.size>0&&(accountMismatch||authenticationLost);
   if(recover){const original=attempts.current.values().next().value;if(original)requestAdminAuthentication(token.current,original.account);}
   const definite=!recover&&retireRejected&&!attempt?.received&&e instanceof PrivateApiError&&[400,401,403,404,409,413,429].includes(e.status);
   if(definite){attempts.current.delete(fingerprint);setRejected(true);}
   setError(errorText(e)+(definite?' El intento fue rechazado. Consulta el estado y confirma una nueva actuación.':attempt?.received?' Recibo recibido; falló la actualización. Recupera solo la consulta, sin volver a registrar la actuación.':' Consulta el estado antes de otra operación. Si se perdió la respuesta, reintenta el mismo botón: conserva su clave.'));
  }finally{
   if(protect&&mounted.current)protectAdminIntent(token.current,attempts.current.size>0);
   if(mounted.current){setPending(attempts.current.size>0);setBusy(false);}running.current=false;
  }
 };
 const send=(body:Command)=>run(body);
 const retry=()=>{const first=attempts.current.entries().next().value;return first?run(first[1].body,first[0]):Promise.resolve(undefined);};
 return{busy,error,send,rejected,pending,received,retry};
}
