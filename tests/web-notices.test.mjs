import{test}from'node:test';import assert from'node:assert/strict';
import{CHANNELS,channel}from'../src/notify/channels.mjs';
import{validateMark}from'../src/db/web-notices-service.mjs';
// Etapa 6A: only the in-app simulated channel delivers; every external channel refuses.
test('6A-U1: external channels are declared but refuse; in-app stores and respects expiry',async()=>{
 for(const name of['SMS','EMAIL','PUSH','VOICE']){assert.equal(CHANNELS[name].enabled,false);await assert.rejects(channel(name).deliver({id:'n',expiresAt:new Date(Date.now()+60000).toISOString()}),/CHANNEL_NOT_ENABLED/);}
 const inApp=channel('IN_APP_SIMULATED');
 assert.deepEqual(await inApp.deliver({id:'n1',expiresAt:new Date(Date.now()+60000).toISOString()}),{id:'n1',status:'STORED_IN_APP'});
 assert.deepEqual(await inApp.deliver({id:'n2',expiresAt:new Date(Date.now()-1).toISOString()}),{id:'n2',status:'EXPIRED'});
 await assert.rejects(inApp.deliver({}),/INVALID_NOTICE/);assert.throws(()=>channel('FAX'),/UNKNOWN_CHANNEL/);
 assert.ok(Object.values(CHANNELS).filter(c=>c.enabled).every(c=>!c.external),'no enabled channel leaves the system');
});
test('6A-U2: marking accepts 1-50 distinct notice ids and nothing else',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.deepEqual(validateMark({ids:[id]}),[id]);
 for(const bad of[{ids:[]},{ids:[id,id]},{ids:'x'},{ids:Array.from({length:51},(_,i)=>`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`)}])assert.throws(()=>validateMark(bad),/INVALID_NOTICES/);
 assert.throws(()=>validateMark({ids:[id],all:true}),/INVALID_REQUEST/);
});
