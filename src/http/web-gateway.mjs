import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWebCatalogService } from '../db/web-catalog-service.mjs';
import { assertRuntime } from '../db/runtime.mjs';

const pages=new Set(['/','/reservar','/pasajero','/administracion','/chofer']);
const denial=(status,code)=>Object.assign(new Error(code),{status,code});
async function jsonBody(req) {
  let size=0,parts=[];
  for await(const part of req){size+=part.length;if(size>2048)throw denial(413,'BODY_TOO_LARGE');parts.push(part);}
  try{const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();return b;}catch{throw denial(400,'INVALID_REQUEST');}
}
export async function startWebGateway({pool,catalogToken,localTest,service}={}) {
  if(localTest!==true)throw new Error('LOCAL_TEST_ONLY');
  if(!service){const c=await pool.connect();try{await assertRuntime(c,'nexo_app',{localTest:true});}finally{c.release();}service=createWebCatalogService(pool,catalogToken);}
  const root=resolve('apps/web/dist');const html=await readFile(resolve(root,'index.html'));
  // Host, same-origin and JSON checks are enforced here, independently of React.
  // Existing CLI-only listeners retain all their original transport restrictions.
  let total=0,windowStart=Date.now(),inflight=0;
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000,keepAliveTimeout:1000,connectionsCheckingInterval:1000},async(req,res)=>{
    let entered=false;
    const send=(status,body,type='application/json; charset=utf-8')=>{
      if(res.destroyed||res.writableEnded)return;
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'Referrer-Policy':'no-referrer','Permissions-Policy':'geolocation=(), camera=(), microphone=()',
        'X-Request-Id':randomUUID(),'Connection':'close',...(status===429?{'Retry-After':'60'}:{})});
      res.end(type.startsWith('application/json')?JSON.stringify(body):body);
    };
    req.on('error',()=>{});res.on('error',()=>{});req.setTimeout(5000,()=>{send(408,{error:'REQUEST_TIMEOUT'});req.destroy();});
    try {
      const expected=`127.0.0.1:${server.address().port}`,origin=`http://${expected}`;
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==expected||req.headers['x-forwarded-host']!==undefined||req.headers['x-forwarded-for']!==undefined)throw denial(403,'LOCAL_REQUEST_REQUIRED');
      if(req.rawHeaders.length>64)throw denial(431,'TOO_MANY_HEADERS');
      const names=new Set();for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();if(names.has(n))throw denial(400,'DUPLICATE_HEADER');names.add(n);}
      if(req.headers.origin!==undefined&&req.headers.origin!==origin||req.headers['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw denial(403,'SAME_ORIGIN_REQUIRED');
      if(req.headers.authorization||req.headers.cookie)throw denial(400,'UNEXPECTED_CREDENTIALS');
      if(req.url.startsWith('/api/')) {
        if(Date.now()-windowStart>=60000){windowStart=Date.now();total=0;}
        if(++total>120||inflight>=6)throw denial(429,'RATE_LIMITED');inflight++;entered=true;
        if(req.url==='/api/session'&&req.method==='GET')return send(200,{authenticated:false,mode:'LOCAL_LAB',reservationWritesEnabled:false});
        if(/^\/api\/(admin|driver|passenger)(\/|$)/.test(req.url))throw denial(401,'AUTHENTICATION_REQUIRED');
        if(!['/api/localities','/api/availability'].includes(req.url))throw denial(404,'NOT_FOUND');
        if(req.method!=='POST')throw denial(405,'METHOD_NOT_ALLOWED');
        if(req.headers.origin!==origin)throw denial(403,'SAME_ORIGIN_REQUIRED');
        if(req.headers['content-type']!=='application/json'||req.headers['content-encoding'])throw denial(415,'JSON_REQUIRED');
        if(req.headers['content-length']&&Number(req.headers['content-length'])>2048)throw denial(413,'BODY_TOO_LARGE');
        const b=await jsonBody(req);
        return send(200,await(req.url==='/api/localities'?service.localities(b):service.availability(b)));
      }
      if(req.method!=='GET')throw denial(405,'METHOD_NOT_ALLOWED');
      if(pages.has(req.url))return send(200,html,'text/html; charset=utf-8');
      const asset=/^\/(app-[A-Z0-9]+\.(js|css))$/.exec(req.url);
      if(asset){let data;try{data=await readFile(resolve(root,asset[1]));}catch{throw denial(404,'NOT_FOUND');}return send(200,data,asset[2]==='js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8');}
      throw denial(404,'NOT_FOUND');
    }catch(e){const status=e.status??(/^INVALID_|^SPLIT_/.test(e.message)?400:503);send(status,{error:e.code??(status===400?'INVALID_REQUEST':'CATALOG_UNAVAILABLE')});req.resume();}
    finally{if(entered)inflight--;}
  });
  server.maxConnections=32;server.maxHeadersCount=32;server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();})};
}
