import {privateApi,PrivateApiError} from './private-api';
import type {WebSession} from './private-api';

// Bind each reviewed read to the original session's CSRF. The server rejects
// cookie B + CSRF A even if before/after account checks both observe A.
export async function readForAccount<T>(path:string,body:unknown,original?:WebSession):Promise<T>{
 const s=original??await privateApi<WebSession>('/api/session');
 if(!s.authenticated||!s.accountRef)throw new PrivateApiError('Inicia sesión con la cuenta original.',401,'AUTHENTICATION_REQUIRED');
 const result=await privateApi<T>(path,body,s.csrf);
 await assertSameAccount(s);
 return result;
}
export async function assertSameAccount(original:WebSession){
 const current=await privateApi<WebSession>('/api/session');
 if(!current.authenticated||current.accountRef!==original.accountRef)throw new PrivateApiError('La cuenta cambió. Inicia sesión con la cuenta original.',401,'AUTHENTICATION_REQUIRED');
}
