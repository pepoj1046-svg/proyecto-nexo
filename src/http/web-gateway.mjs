import{createWebConditionService}from'../db/web-condition-service.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWebCatalogService } from '../db/web-catalog-service.mjs';
import {createIdentity}from'../auth/identity.mjs';
import {createWebReservationService}from'../db/web-reservation-service.mjs';
import {createWebOperationsService}from'../db/web-operations-service.mjs';
import {createWebRecoveryService}from'../db/web-recovery-service.mjs';
import {createWebManagementService}from'../db/web-management-service.mjs';
import {createWebTerminalService}from'../db/web-terminal-service.mjs';
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
  const terminal=identityPool?createWebTerminalService(pool):null;
  const conditions=identityPool?createWebConditionService(pool):null;
  const management=identityPool?createWebManagementService(pool):null;
  const sessions=identityPool?createWebSessions({identity:createIdentity(identityPool),business}):null;
  // Fixed handler tables: every private POST is constructed with the CSRF gate.
  // Request paths select a handler, never whether its security check is executed.
  const secured=handler=>async(context,req,b,setCookie)=>{
    sessions.csrf(context,req.headers['x-csrf-token']);
    return handler(context,req,b,setCookie);
  };
  const authenticated=handler=>secured(async(context,req,b)=>{
    await sessions.actor(context);
    return handler(context.entry.token,req.headers['idempotency-key'],b);
  });
  const publicHandlers=new Map([
    ['/api/localities',(_context,_req,b)=>service.localities(b)],
    ['/api/availability',(_context,_req,b)=>service.availability(b)],
    ['/api/points',(_context,_req,b)=>service.points(b)],
    ['/api/segment',(_context,_req,b)=>service.segment(b)]
  ]);
  const privateHandlers=sessions?new Map([
    ['/api/login',secured(async(context,_req,b,cookie)=>{const r=await sessions.login(context,b);cookie(r.handle);return r.body;})],
    ['/api/logout',secured(async(context,_req,b,cookie)=>{if(Object.keys(b).length)throw denial(400,'INVALID_REQUEST');const r=await sessions.logout(context);cookie(null);return r;})],
    ['/api/conditions/context',authenticated((token,_key,b)=>conditions.context(token,b))],
    ['/api/conditions/route',authenticated((token,_key,b)=>conditions.route(token,b))],
    ['/api/conditions/declare',authenticated((token,key,b)=>conditions.declare(token,key,b))],
    ['/api/conditions/command',authenticated((token,key,b)=>conditions.command(token,key,b))],
    ['/api/reservations/page',authenticated((token,_key,b)=>business.page(token,b))],
    ['/api/management/detail',authenticated((token,_key,b)=>management.detail(token,b))],
    ['/api/management/command',authenticated((token,key,b)=>management.command(token,key,b))],
    ['/api/reservations/quote',authenticated((token,_key,b)=>business.quote(token,b))],
    ['/api/reservations',authenticated((token,key,b)=>business.reserve(token,key,b))],
    ['/api/operator/accept',authenticated((token,key,b)=>business.accept(token,key,b))],
    ['/api/operations/overview',authenticated((token,_key,b)=>operations.overview(token,b))],
    ['/api/operations/snapshot',authenticated((token,_key,b)=>operations.snapshot(token,b))],
    ['/api/operations/command',authenticated((token,key,b)=>operations.command(token,key,b))],
    ['/api/recovery/overview',authenticated((token,_key,b)=>recovery.overview(token,b))],
    ['/api/recovery/detail',authenticated((token,_key,b)=>recovery.detail(token,b))],
    ['/api/recovery/passenger',authenticated((token,_key,b)=>recovery.passenger(token,b))],
    ['/api/recovery/transfer',authenticated((token,_key,b)=>recovery.transfer(token,b))],
    ['/api/recovery/command',authenticated((token,key,b)=>recovery.command(token,key,b))],
    ['/api/terminal/directory',authenticated((token,_key,b)=>terminal.directory(token,b))],
    ['/api/terminal/sale-context',authenticated((token,_key,b)=>terminal.saleContext(token,b))],
    ['/api/terminal/quote',authenticated((token,_key,b)=>terminal.quote(token,b))],
    ['/api/terminal/walk-in',authenticated((token,key,b)=>terminal.walkIn(token,key,b))],
    ['/api/terminal/return-options',authenticated((token,_key,b)=>terminal.returnOptions(token,b))],
    ['/api/terminal/command',authenticated((token,key,b)=>terminal.command(token,key,b))]
  ]):new Map();
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
        if(req.method==='GET'&&sessions&&['/api/passenger/bookings','/api/operator/offers'].includes(req.url)){
          await sessions.actor(context);return send(200,await business[req.url.includes('passenger')?'page':'operatorList'](context.entry.token));
        }
        if(/^\/api\/(admin|driver|passenger)(\/|$)/.test(req.url))throw denial(401,'AUTHENTICATION_REQUIRED');
        const handler=publicHandlers.get(req.url)??privateHandlers.get(req.url);
        if(!handler)throw denial(404,'NOT_FOUND');
        if(req.method!=='POST')throw denial(405,'METHOD_NOT_ALLOWED');
        if(req.headers.origin!==origin)throw denial(403,'SAME_ORIGIN_REQUIRED');
        if(req.headers['content-type']!=='application/json'||req.headers['content-encoding'])throw denial(415,'JSON_REQUIRED');
        if(req.headers['content-length']&&Number(req.headers['content-length'])>2048)throw denial(413,'BODY_TOO_LARGE');
        const b=await jsonBody(req);
        return send(200,await handler(context,req,b,setCookie));
      }
      if(req.method!=='GET')throw denial(405,'METHOD_NOT_ALLOWED');
      if(pages.has(req.url))return send(200,html,'text/html; charset=utf-8');
      const asset=/^\/(app-[A-Z0-9]+\.(js|css))$/.exec(req.url);
      if(asset){let data;try{data=await readFile(resolve(root,asset[1]));}catch{throw denial(404,'NOT_FOUND');}return send(200,data,asset[2]==='js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8');}
      throw denial(404,'NOT_FOUND');
    }catch(e){const known=/^(INVALID_[A-Z_]+|UNAUTHENTICATED|FORBIDDEN|NOT_FOUND|NO_CAPACITY|CAPACITY_EXCEEDED|FARE_CHANGED|FARE_UNRESOLVED|ROUTE_NOT_ELIGIBLE|TRIP_NOT_QUEUED|TRIP_NOT_IN_TRANSIT|PICKUP_PASSED|PICKUP_PASSED_OR_INCOMPATIBLE|QUOTE_CHANGED|OPERATION_BLOCKED|IDEMPOTENCY_CONFLICT|OFFER_EXPIRED|NOT_DRIVER|FORBIDDEN_SCOPE|STALE_ASSIGNMENT|STALE_OPERATION|NOT_FULL|UNACCEPTED_OFFERS|PICKUPS_PENDING|QUEUE_ORDER|INCOMPATIBLE_TRIP|INDIVIDUAL_HISTORY_ONLY|AGGREGATE_HISTORY_ONLY|OBSERVED_CAPACITY_EXCEEDED|UNSUPPORTED_URBAN_MANIFEST|OUTSIDE_URBAN_SCOPE|OUTSIDE_ROAD_SCOPE|ROUTE_CONDITION_BLOCKED|CONDITION_ACCEPTANCE_REQUIRED|MINOR_REVIEW_REQUIRED|COMPANION_REQUIRED|NO_COMPATIBLE_TRANSFER|NO_FREE_REPLACEMENT|ADMIN_TERMINAL_CHOICE_REQUIRED|REPLACEMENT_AVAILABLE|ADMIN_REVIEW_REQUIRED|SAFE_TRANSFER_REQUIRED|STALE_CONSENT|CONSENT_USED|PRESENCE_REQUIRED|TERMINAL_RESERVATION_BINDING|TRANSFER_CONDITIONS_CHANGED|VEHICLE_OUT_OF_SERVICE|PASSENGERS_ONBOARD|TRIP_ALREADY_STARTED|NOT_AVAILABLE|ALREADY_ACTIVE|STALE_PREVIOUS_TRIP|PAGE_CHANGED|DECISION_CONFLICT|CONDITION_REJECTED|STALE_CONDITION)$/;const message=known.test(e.message)?e.message:null;const status=e.status??(message==='INVALID_CREDENTIALS'||message==='UNAUTHENTICATED'?401:message==='FORBIDDEN'||message==='FORBIDDEN_SCOPE'||message==='NOT_DRIVER'?403:message==='NOT_FOUND'?404:message?.startsWith('INVALID_')?400:message?409:503);send(status,{error:e.status?e.code??'REQUEST_REJECTED':message??(req.url.startsWith('/api/local')||req.url==='/api/availability'?'CATALOG_UNAVAILABLE':'SERVICE_UNAVAILABLE')});req.resume();}
    finally{if(entered)inflight--;}
  });
  server.maxConnections=32;server.maxHeadersCount=32;server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>{sessions?.clear();return new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});}};
}
