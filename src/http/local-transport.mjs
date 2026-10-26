import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const failure = (status, code) => Object.assign(new Error(code), { status, code });
function readJson(req) {
  return new Promise((resolve,reject)=> {
    let size=0; const chunks=[];
    const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
    const error=e=>{cleanup();reject(e);};
    const aborted=()=>error(failure(400,'INVALID_REQUEST'));
    const data=chunk=>{
      size+=chunk.length;
      if(size>4096) {cleanup();req.resume();reject(failure(413,'BODY_TOO_LARGE'));}
      else chunks.push(chunk);
    };
    const end=()=>{
      cleanup();
      try {
        // Fatal UTF-8 decoding rejects replacement of invalid bytes in secrets.
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
        if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch {reject(failure(400,'INVALID_JSON'));}
    };
    req.on('data',data);req.on('end',end);req.on('error',error);req.on('aborted',aborted);
  });
}
function statusFor(error) {
  if(error.status) return [error.status,error.code];
  if(error.rateLimited) return [429,'RATE_LIMITED'];
  if(['UNAUTHENTICATED','INVALID_CREDENTIALS'].includes(error.message)) return [401,'UNAUTHENTICATED'];
  if(error.message==='IDENTITY_BUSY') return [429,'RATE_LIMITED'];
  if(error.message==='NOT_FOUND')return [404,'NOT_FOUND'];
  if(['TERMINAL_CONFIG_REQUIRED','NO_COMPATIBLE_TRANSFER','INVALID_TERMINAL_STATE','AGGREGATE_HISTORY_ONLY','INDIVIDUAL_HISTORY_ONLY','OBSERVED_CAPACITY_EXCEEDED','INVALID_ABSENCE_STATE','NO_CAPACITY','QUOTE_CHANGED','FARE_UNRESOLVED','ROUTE_NOT_ELIGIBLE','ASSOCIATION_SUSPENDED','QUEUE_ORDER','INCOMPATIBLE_TRIP','TRIP_ALREADY_STARTED','NOT_FULL','UNACCEPTED_OFFERS','INVALID_TRIP_STATE','INVALID_MOVEMENT_STATE','IDEMPOTENCY_CONFLICT','ALREADY_ACTIVE','STALE_PREVIOUS_TRIP'].includes(error.message))return [409,error.message];
  if(error.message==='SPLIT_NOT_ALLOWED')return [400,'SPLIT_NOT_ALLOWED'];
  if(/^INVALID_|^FORBIDDEN/.test(error.message)) return [error.message.startsWith('FORBIDDEN')?403:400,'INVALID_REQUEST'];
  return [503,'SERVICE_UNAVAILABLE']; // No SQL, stack, identity or credential in responses.
}

// No configurable host, port, proxy or privileged route. Tests inject adapters;
// the executable launcher always creates a fresh isolated local database.
export async function startLocalTransport({localTest,routes,allProtected=false,mutations=[],rateLimit=60,maxInflight=4,now=Date.now}={}) {
  if(localTest!==true || !routes || !Number.isInteger(rateLimit) || rateLimit<1 || rateLimit>60 ||
    !Number.isInteger(maxInflight) || maxInflight<1 || maxInflight>4) throw new Error('LOCAL_TEST_ONLY');
  let inflight=0, windowStart=now(), requests=0;
  const responded=new WeakSet();
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000,keepAliveTimeout:1000,connectionsCheckingInterval:1000},async(req,res)=>{
    req.on('error',()=>{});res.on('error',()=>{});
    const requestId=randomUUID();
    const send=(status,body)=>{
      if(res.destroyed || res.writableEnded) return;
      responded.add(req.socket);
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy':'no-referrer','X-Request-Id':requestId,'Connection':'close',
        ...(status===429?{'Retry-After':'60'}:{})});
      res.end(JSON.stringify(body));
    };
    let entered=false;
    req.setTimeout(5000,()=>{send(408,{error:'REQUEST_TIMEOUT'});req.destroy();});
    try {
      if(now()-windowStart>=60000) {windowStart=now();requests=0;}
      if(++requests>rateLimit || inflight>=maxInflight) throw failure(429,'RATE_LIMITED');
      const expectedHost=`127.0.0.1:${server.address().port}`;
      if(req.rawHeaders.length>64) throw failure(431,'TOO_MANY_HEADERS');
      const seen=new Set();
      for(let i=0;i<req.rawHeaders.length;i+=2) {
        const name=req.rawHeaders[i].toLowerCase();
        if(seen.has(name)) throw failure(400,'DUPLICATE_HEADER');
        seen.add(name);
      }
      if(req.socket.remoteAddress!=='127.0.0.1' || req.headers.host!==expectedHost || req.headers.origin!==undefined ||
        (req.headers['sec-fetch-site']!==undefined && req.headers['sec-fetch-site']!=='none') || req.headers['x-nexo-local-test']!=='1')
        throw failure(403,'LOCAL_REQUEST_REQUIRED');
      if(req.method!=='POST') throw failure(405,'METHOD_NOT_ALLOWED');
      // Exact path matching also excludes query-string tokens and unlisted administrative operations.
      const route=Object.hasOwn(routes,req.url)?routes[req.url]:null;
      if(!route) throw failure(404,'NOT_FOUND');
      if(req.headers['content-type']!=='application/json' || req.headers['content-encoding']) throw failure(415,'JSON_REQUIRED');
      if(req.headers['content-length'] && Number(req.headers['content-length'])>4096) throw failure(413,'BODY_TOO_LARGE');
      let token;
      if(allProtected || !['/v1/register','/v1/login','/v1/recover'].includes(req.url)) {
        const match=/^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization ?? '');
        if(!match) throw failure(401,'UNAUTHENTICATED');
        token=match[1];
      } else if(req.headers.authorization) throw failure(400,'UNEXPECTED_AUTHORIZATION');
      const key=req.headers['idempotency-key'];
      if(mutations.includes(req.url) && (typeof key!=='string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))) throw failure(400,'INVALID_ACTION_KEY');
      inflight++;entered=true;
      const [status,result]=await route(await readJson(req),token,key);
      send(status,result);
    } catch(e) {
      const [status,code]=statusFor(e);send(status,{error:code});req.resume();
    } finally {if(entered) inflight--;}
  });
  server.maxConnections=32;
  server.maxHeadersCount=32;
  server.on('clientError',(_error,socket)=>{
    if(socket.writable) socket.end(responded.has(socket)?undefined:'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return Object.freeze({url:`http://127.0.0.1:${server.address().port}`,
    close:()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();})});
}
