import {test}from'node:test';
import assert from'node:assert/strict';
import {EventEmitter}from'node:events';
import {trackLocalPool}from'../scripts/drain-local-pool.mjs';
test('laboratory pool shutdown waits for physical connection ends even if upstream end resolves first',async()=>{
 const pool=new EventEmitter(),client=new EventEmitter();let ending=false;pool.end=async()=>{ending=true;};
 const close=trackLocalPool(pool);pool.emit('connect',client);let stopped=false;const completion=close().then(()=>{stopped=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ending,true);assert.equal(stopped,false,'PostgreSQL must remain up while a pool client is still connected');
 client.emit('end');await completion;assert.equal(stopped,true);await close();
});
test('unexpected idle-connection failure remains a failure without exposing connection internals',async()=>{
 const pool=new EventEmitter();pool.end=async()=>{};const close=trackLocalPool(pool);
 pool.emit('error',Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'),{client:{password:'SYNTHETIC_PRIVATE_PASSWORD'}}));
 await assert.rejects(close(),error=>{assert.equal(error.message,'LOCAL_POOL_CONNECTION_FAILED');assert.ok(!('client'in error));assert.ok(!JSON.stringify(error).includes('PRIVATE'));return true;});
});
