import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const ticketSource=(await transform(await readFile('apps/web/src/recovery-ticket.ts','utf8'),{loader:'ts',format:'esm'})).code;
const source=(await transform(await readFile('apps/web/src/private-api.ts','utf8'),{loader:'ts',format:'esm'})).code.replace('./recovery-ticket','data:text/javascript;base64,'+Buffer.from(ticketSource).toString('base64'));
let sequence=0;
const client=async()=> (await import('data:text/javascript;base64,'+Buffer.from(source+'\n//isolated-'+sequence++).toString('base64'))).privateApi;
const session=(authenticated=false)=>({authenticated,documentId:'11111111-1111-4111-8111-111111111111',generation:authenticated?1:0,csrf:(authenticated?'b':'a').repeat(43),environmentId:'lab'});
const response=data=>({ok:true,json:async()=>data});
test('an anonymous session response already in flight cannot overwrite a later login cookie',async()=>{
 const original=globalThis.fetch,api=await client();let release,cookie='anonymous',writes=0;const gate=new Promise(r=>{release=r;});
 globalThis.fetch=async(path)=>{if(path==='/api/session'){await gate;cookie='anonymous';return response(session());}if(path==='/api/login'){writes++;cookie='authenticated';return response(session(true));}throw new Error('UNEXPECTED_REQUEST');};
 let read,login;try{read=api('/api/session');login=api('/api/login',{},'csrf');await Promise.resolve();release();await Promise.all([read,login]);assert.equal(cookie,'authenticated');assert.equal(writes,1);}finally{release();await Promise.allSettled([read,login]);globalThis.fetch=original;}
});
test('a session read during logout observes the completed revocation, without cached credentials or retries',async()=>{
 const original=globalThis.fetch,api=await client();let release,active=true,reads=0,writes=0;const gate=new Promise(r=>{release=r;});
 globalThis.fetch=async path=>{if(path==='/api/logout'){writes++;await gate;active=false;return response(session());}if(path==='/api/session'){reads++;return response(session(active));}throw new Error('UNEXPECTED_REQUEST');};
 let logout,read;try{logout=api('/api/logout',{},'csrf');read=api('/api/session');await Promise.resolve();release();await logout;assert.equal((await read).authenticated,false);assert.equal(reads,1);assert.equal(writes,1);}finally{release();await Promise.allSettled([logout,read]);globalThis.fetch=original;}
});
const moduleClient=async()=>import('data:text/javascript;base64,'+Buffer.from(source+'\n//module-'+sequence++).toString('base64'));
test('every private GET and POST carries the RAM document proof; explicit invalid CSRF is never repaired',async()=>{
 const original=globalThis.fetch,m=await moduleClient(),calls=[];
 globalThis.fetch=async(path,options)=>{calls.push({path,options});return response(path==='/api/session'?session():{ok:true});};
 try{await m.privateApi('/api/session');await m.privateApi('/api/passenger/bookings');await m.privateApi('/api/operations/overview',{},'wrong-proof');assert.equal(calls[1].options.headers['X-Nexo-Document'],session().documentId);assert.equal(calls[1].options.headers['X-CSRF-Token'],session().csrf);assert.equal(calls[2].options.headers['X-CSRF-Token'],'wrong-proof');}finally{globalThis.fetch=original;}
});
test('pagehide invalidates pending private data without executing logout or any business retry',async()=>{
 const original=globalThis.fetch,m=await moduleClient(),paths=[];let release;
 globalThis.fetch=async path=>{paths.push(path);if(path==='/api/session')return response(session(true));await new Promise(r=>release=r);return response({private:'old'});};
 try{await m.privateApi('/api/session');const read=m.privateApi('/api/passenger/bookings');m.suspendDocument();release();await assert.rejects(read,/contexto cambió/);assert.equal(m.documentLock().account,null);assert.deepEqual(paths,['/api/session','/api/passenger/bookings']);}finally{release?.();globalThis.fetch=original;}
});
test('a late response from before a login generation change is discarded',async()=>{
 const original=globalThis.fetch,m=await moduleClient();let release;
 globalThis.fetch=async path=>{if(path==='/api/session')return response(session());if(path==='/api/login')return response(session(true));await new Promise(r=>release=r);return response({old:'private'});};
 try{await m.privateApi('/api/session');const read=m.privateApi('/api/passenger/bookings');await m.privateApi('/api/login',{},session().csrf);release();await assert.rejects(read,/contexto cambió/);}finally{release?.();globalThis.fetch=original;}
});
test('a queued password write cannot dispatch after document suspension',async()=>{
 const original=globalThis.fetch,m=await moduleClient();let release,writes=0;
 globalThis.fetch=async path=>{if(path==='/api/login'){writes++;return response(session(true));}await new Promise(r=>release=r);return response(session());};
 try{const read=m.privateApi('/api/session');await Promise.resolve();await Promise.resolve();const login=m.privateApi('/api/login',{},session().csrf);m.suspendDocument();release();await assert.rejects(read,/contexto cambió/);await assert.rejects(login,/contexto cambió/);assert.equal(writes,0);}finally{release?.();globalThis.fetch=original;}
});
