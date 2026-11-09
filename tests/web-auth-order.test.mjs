import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const source=(await transform(await readFile('apps/web/src/private-api.ts','utf8'),{loader:'ts',format:'esm'})).code;
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
