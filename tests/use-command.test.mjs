import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

// Exercise the real hook's command logic without a DOM or a second implementation.
// Refs persist across send calls; setters record state and no effect fires a write.
let moduleId=0;
async function harness(refresh=async()=>{},path='/api/operations/command',recovery=false,retireRejected=false,scopedRefresh=false){
 const writes=[],state=[],recoveries=[],locks=[];let actor='A';
 class PrivateApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
 const env={useRef:value=>({current:value}),useState:value=>{const i=state.length;state.push(value);return[value,v=>{state[i]=v;}];},useEffect:()=>{},
  protectAdminIntent:(_,p)=>locks.push(p),requestAdminAuthentication:(_,a)=>recoveries.push(a),PrivateApiError,
  request:async(path,body,csrf,key)=>{if(path==='/api/session')return{authenticated:!!actor,accountRef:actor,csrf:'csrf-'+actor};writes.push({path,body:structuredClone(body),csrf,key});return{recorded:true};}};
 env.privateApi=(...args)=>env.request(...args);
 globalThis.__nexoCommandHarness=env;
 const raw=(await readFile('apps/web/src/use-command.ts','utf8')).replace(/^import[^\n]*\n/gm,'');
 const prefix='const {useRef,useState,useEffect,protectAdminIntent,requestAdminAuthentication,PrivateApiError,privateApi}=globalThis.__nexoCommandHarness;\n';
 const source=(await transform(prefix+raw,{loader:'ts',format:'esm'})).code;
 const {useCommands}=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+moduleId++).toString('base64'));
 delete globalThis.__nexoCommandHarness;
 return{command:useCommands(refresh,path,0,retireRejected,recovery,scopedRefresh),env,writes,state,recoveries,locks,set actor(a){actor=a;}};
}
test('5A3: command freezes nested original body before awaiting session',async()=>{
 const f=await harness();
 // Hold the first await by queuing the mutation in the same turn as send.
 const body={kind:'BOARD',parts:[{seats:2}]};const pending=f.command.send(body);body.parts[0].seats=6;await pending;
 assert.equal(f.writes[0].body.parts[0].seats,2);
});
test('5A3: a received command receipt plus failed refresh retries only refresh',async()=>{
 let reads=0;const f=await harness(async()=>{if(!reads++)throw Error('READ_FAILED');},'/api/operations/command',true,false,true);
 await f.command.send({kind:'BOARD',bookingId:'fictional'});await f.command.consult();
 assert.equal(f.writes.length,1);assert.equal(reads,2);
});
test('5A3: late command reply cannot refresh or return private result for a different account',async()=>{
 let refreshed=0;const f=await harness(async()=>{refreshed++;});
 // The refresh is reached after POST's await; change the session before that continuation.
 const pending=f.command.send({kind:'BOARD'});queueMicrotask(()=>{f.actor='B';});
 assert.equal(await pending,undefined);assert.equal(refreshed,0);
});
test('5A3: reviewed commands reject a changed intent and manual recovery preserves original key/body',async()=>{
 const f=await harness(async()=>{},'/api/operations/command',true,false,true);const base=f.env.request;let lost=true;
 f.env.request=async(...args)=>{const r=await base(...args);if(args[0]!=='/api/session'&&lost){lost=false;throw Error('LOST_COMMITTED_REPLY');}return r;};
 await f.command.send({kind:'BOARD',parts:[{seats:2}]});
 await f.command.send({kind:'ALIGHT',parts:[{seats:6}]});assert.equal(f.writes.length,1);await f.command.consult();assert.equal(f.writes.length,1);assert.equal(f.locks.at(-1),true);
 await f.command.retry();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(f.locks.at(-1),false);
});
test('5A3: wrong-account replay cannot send; original account with renewed CSRF keeps intent',async()=>{
 const f=await harness(async()=>{},'/api/care/command',true);const base=f.env.request;let lost=true;
 f.env.request=async(...args)=>{const r=await base(...args);if(args[0]!=='/api/session'&&lost){lost=false;throw Error('NETWORK');}return r;};
 await f.command.send({kind:'ABSENCE',episode:2});f.actor='B';await f.command.retry();assert.equal(f.writes.length,1);assert.deepEqual(f.recoveries,['A']);
 f.actor='A';await f.command.retry();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0]);
});
test('5A3: double-click and read recovery do not launch simultaneous writes',async()=>{
 const f=await harness();let release;const gate=new Promise(r=>{release=r;}),base=f.env.request;
 f.env.request=async(...args)=>{if(args[0]!=='/api/session')await gate;return base(...args);};
 const pending=f.command.send({kind:'BOARD'});await f.command.send({kind:'BOARD'});release();await pending;assert.equal(f.writes.length,1);
});
test('5A3: a known receipt stays private through expiry and returns after original reauthentication without POST',async()=>{
 let refreshes=0;const f=await harness(async()=>{refreshes++;},'/api/care/code',true),base=f.env.request;
 f.env.request=async(...args)=>{const result=await base(...args);if(args[0]!=='/api/session')f.actor=null;return result;};
 assert.equal(await f.command.send({}),undefined);assert.equal(refreshes,0);assert.equal(f.writes.length,1);assert.deepEqual(f.recoveries,['A']);
 f.actor='A';assert.deepEqual(await f.command.retry(),{recorded:true});assert.equal(refreshes,1);assert.equal(f.writes.length,1);
});
test('5A3: definite rejection policy is opt-in and a received receipt is never retired by refresh 401',async()=>{
 const f=await harness(async()=>{throw new f.env.PrivateApiError('EXPIRED',401,'AUTHENTICATION_REQUIRED');},'/api/driver-admin/contact',false,true);
 await f.command.send({contact:'LAB-FICTICIO'});await f.command.retry();assert.equal(f.writes.length,1);assert.equal(f.locks.at(-1),true);
});
