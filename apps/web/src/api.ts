export async function post<T>(path:string,body:unknown,signal?:AbortSignal):Promise<T> {
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error(response.status===429?'Muchas consultas seguidas. Espera un momento y vuelve a intentar.':'No pudimos consultar los viajes. Revisa tu conexión y vuelve a intentar.');
    return await response.json() as T;
  }catch(e){if(signal?.aborted)throw e;if(controller.signal.aborted)throw new Error('La consulta tardó demasiado. Puedes volver a intentarlo.');throw e;}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
