import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWebCatalogService } from '../db/web-catalog-service.mjs';
import {createIdentity}from'../auth/identity.mjs';
import {createWebReservationService}from'../db/web-reservation-service.mjs';
import {createWebOperationsService}from'../db/web-operations-service.mjs';
import {createWebRecoveryService}from'../db/web-recovery-service.mjs';
import {createWebSessions}from'./web-sessions.mjs';
import { assertRuntime } from '../db/runtime.mjs';

const pages=new Set(['/','/reservar','/pasajero','/administracion','/chofer','/operador']);
const denial=(status,code)=>Object.assign(new Error(code),{status,code});
async function jsonBody(req) {
  let size=0,parts=[];
  for await(const part of req){size+=part.length;if(size>2048)throw denial(413,'BODY_TOO_LARGE');parts.push(part);}
  try{const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();return b;}catch{throw denial(400,'INVALID_REQUEST');}
}
export async function startWebGateway({pool,catalogToken,localTest,service,identityPool}={}) {
  if(localTest!==true)throw new Error('LOCAL_TEST_ONLY');
  if(!service){const c=await pool.connect();try{await assertRuntime(c,'nexo_app',{localTest:true});}finally{c.release();}service=createWebCatalogService(pool,catalogToken);}
  if(identityPool){const c=await identityPool.connect();try{await assertRuntime(c,'nexo_identity',{localTest:true});}finally{c.release();}}
  const business=identityPool?createWebReservationService(pool):null;
  const operations=identityPool?createWebOperationsService(pool):null;
  const recovery=identityPool?createWebRecoveryService(pool):null;
  const sessions=identityPool?createWebSessions({identity:createIdentity(identityPool),business}):null;
  const root=resolve('apps/web/dist');const html=await readFile(resolve(root,'index.html'));
  // Host, same-origin and JSON checks are enforced here, independently of React.
  // Existing CLI-only listeners retain all their original transport restrictions.
  let total=0,windowStart=Date.now(),inflight=0;
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000,keepAliveTimeout:1000,connectionsCheckingInterval:1000},async(req,res)=>{
    let entered=false;let cookie;
    const cookieName=()=>`trufis_lab_${server.address().port}`;
    const setCookie=(handle)=>{cookie=`${cookieName()}=${handle??''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${handle?3600:0}`;};
    const send=(status,body,type='application/json; charset=utf-8')=>{
      if(res.destroyed||res.writableEnded)return;
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'Referrer-Policy':'no-referrer','Permissions-Policy':'geolocation=(), camera=(), microphone=()',
        ...(cookie?{'Set-Cookie':cookie}:{}),'X-Request-Id':randomUUID(),'Connection':'close',...(status===429?{'Retry-After':'60'}:{})});
      res.end(type.startsWith('application/json')?JSON.stringify(body):body);
    };
    req.on('error',()=>{});res.on('error',()=>{});req.setTimeout(5000,()=>{send(408,{error:'REQUEST_TIMEOUT'});req.destroy();});
    try {
      const expected=`127.0.0.1:${server.address().port}`,origin=`http://${expected}`;
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==expected||req.headers['x-forwarded-host']!==undefined||req.headers['x-forwarded-for']!==undefined)throw denial(403,'LOCAL_REQUEST_REQUIRED');
      if(req.rawHeaders.length>64)throw denial(431,'TOO_MANY_HEADERS');
      const names=new Set();for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();if(names.has(n))throw denial(400,'DUPLICATE_HEADER');names.add(n);}
      if(req.headers.origin!==undefined&&req.headers.origin!==origin||req.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw denial(403,'SAME_ORIGIN_REQUIRED');
      if(req.headers.authorization||(!sessions&&req.headers.cookie))throw denial(400,'UNEXPECTED_CREDENTIALS');
      const context=sessions?sessions.get(req,cookieName()):null;
      if(req.url.startsWith('/api/')) {
        if(Date.now()-windowStart>=60000){windowStart=Date.now();total=0;}
        if(++total>120||inflight>=6)throw denial(429,'RATE_LIMITED');inflight++;entered=true;
        if(req.url==='/api/session'&&req.method==='GET'){
          if(!sessions)return send(200,{authenticated:false,mode:'LOCAL_LAB',reservationWritesEnabled:false});
          const result=await sessions.session(context);if(result.handle)setCookie(result.handle);return send(200,result.body);
        }
        const publicRoutes={'/api/localities':'localities','/api/availability':'availability','/api/points':'points','/api/segment':'segment'};
        if(req.method==='GET'&&sessions&&['/api/passenger/bookings','/api/operator/offers'].includes(req.url)){
          await sessions.actor(context);return send(200,await business[req.url.includes('passenger')?'list':'operatorList'](context.entry.token));
        }
        if(/^\/api\/(admin|driver|passenger)(\/|$)/.test(req.url))throw denial(401,'AUTHENTICATION_REQUIRED');
        const privateRoutes=['/api/login','/api/logout','/api/reservations/quote','/api/reservations','/api/operator/accept','/api/operations/overview','/api/operations/snapshot','/api/operations/command','/api/recovery/overview','/api/recovery/detail','/api/recovery/passenger','/api/recovery/transfer','/api/recovery/command'];
        if(!publicRoutes[req.url]&&!(sessions&&privateRoutes.includes(req.url)))throw denial(404,'NOT_FOUND');
        if(req.method!=='POST')throw denial(405,'METHOD_NOT_ALLOWED');
        if(req.headers.origin!==origin)throw denial(403,'SAME_ORIGIN_REQUIRED');
        if(req.headers['content-type']!=='application/json'||req.headers['content-encoding'])throw denial(415,'JSON_REQUIRED');
        if(req.headers['content-length']&&Number(req.headers['content-length'])>2048)throw denial(413,'BODY_TOO_LARGE');
        const b=await jsonBody(req);
        if(publicRoutes[req.url])return send(200,await service[publicRoutes[req.url]](b));
        sessions.csrf(context,req.headers['x-csrf-token']);
        if(req.url==='/api/login'){const r=await sessions.login(context,b);setCookie(r.handle);return send(200,r.body);}
        if(req.url==='/api/logout'){if(Object.keys(b).length)throw denial(400,'INVALID_REQUEST');const r=await sessions.logout(context);setCookie(null);return send(200,r);}
        await sessions.actor(context);
        if(req.url==='/api/reservations/quote')return send(200,await business.quote(context.entry.token,b));
        const key=req.headers['idempotency-key'];
        if(req.url.startsWith('/api/recovery/'))return send(200,await recovery[req.url.slice('/api/recovery/'.length)](context.entry.token,...(req.url.endsWith('/command')?[key,b]:[b])));
        if(req.url.startsWith('/api/operations/'))return send(200,await operations[req.url.slice('/api/operations/'.length)](context.entry.token,...(req.url.endsWith('/command')?[key,b]:[b])));
        return send(200,await business[req.url==='/api/reservations'?'reserve':'accept'](context.entry.token,key,b));
      }
      if(req.method!=='GET')throw denial(405,'METHOD_NOT_ALLOWED');
      if(pages.has(req.url))return send(200,html,'text/html; charset=utf-8');
      const asset=/^\/(app-[A-Z0-9]+\.(js|css))$/.exec(req.url);
      if(asset){let data;try{data=await readFile(resolve(root,asset[1]));}catch{throw denial(404,'NOT_FOUND');}return send(200,data,asset[2]==='js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8');}
      throw denial(404,'NOT_FOUND');
    }catch(e){const known=/^(INVALID_[A-Z_]+|UNAUTHENTICATED|FORBIDDEN|NOT_FOUND|NO_CAPACITY|CAPACITY_EXCEEDED|FARE_CHANGED|FARE_UNRESOLVED|ROUTE_NOT_ELIGIBLE|TRIP_NOT_QUEUED|TRIP_NOT_IN_TRANSIT|PICKUP_PASSED|PICKUP_PASSED_OR_INCOMPATIBLE|QUOTE_CHANGED|OPERATION_BLOCKED|IDEMPOTENCY_CONFLICT|OFFER_EXPIRED|NOT_DRIVER|FORBIDDEN_SCOPE|STALE_ASSIGNMENT|STALE_OPERATION|NOT_FULL|UNACCEPTED_OFFERS|PICKUPS_PENDING|QUEUE_ORDER|INCOMPATIBLE_TRIP|INDIVIDUAL_HISTORY_ONLY|AGGREGATE_HISTORY_ONLY|OBSERVED_CAPACITY_EXCEEDED|UNSUPPORTED_URBAN_MANIFEST|OUTSIDE_URBAN_SCOPE|OUTSIDE_ROAD_SCOPE|ROUTE_CONDITION_BLOCKED|CONDITION_ACCEPTANCE_REQUIRED|MINOR_REVIEW_REQUIRED|COMPANION_REQUIRED|NO_COMPATIBLE_TRANSFER|NO_FREE_REPLACEMENT|ADMIN_TERMINAL_CHOICE_REQUIRED|REPLACEMENT_AVAILABLE|ADMIN_REVIEW_REQUIRED|SAFE_TRANSFER_REQUIRED|STALE_CONSENT|CONSENT_USED|PRESENCE_REQUIRED|TERMINAL_RESERVATION_BINDING|TRANSFER_CONDITIONS_CHANGED|VEHICLE_OUT_OF_SERVICE)$/;const message=known.test(e.message)?e.message:null;const status=e.status??(message==='INVALID_CREDENTIALS'||message==='UNAUTHENTICATED'?401:message==='FORBIDDEN'||message==='FORBIDDEN_SCOPE'||message==='NOT_DRIVER'?403:message==='NOT_FOUND'?404:message?.startsWith('INVALID_')?400:message?409:503);send(status,{error:e.status?e.code??'REQUEST_REJECTED':message??(req.url.startsWith('/api/local')||req.url==='/api/availability'?'CATALOG_UNAVAILABLE':'SERVICE_UNAVAILABLE')});req.resume();}
    finally{if(entered)inflight--;}
  });
  server.maxConnections=32;server.maxHeadersCount=32;server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>{sessions?.clear();return new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});}};
}
