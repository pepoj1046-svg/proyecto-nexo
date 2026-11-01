import{spawn}from'node:child_process';import{createConnection}from'node:net';import assert from'node:assert/strict';
const child=spawn(process.execPath,['scripts/test-postgres.mjs','--serve-web'],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
let output='';child.stdout.on('data',data=>{output=(output+data).slice(-16000);});child.stderr.on('data',()=>{});
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;if(child.connected)child.send('stop-local-test');},30000);let failure;
try{
 const ready=await Promise.race([new Promise(resolve=>child.on('message',m=>{if(m?.type==='web-ready')resolve(m);})),done.then(()=>{throw new Error('WEB_STOP_LAUNCHER_FAILED');})]);
 if(process.platform==='win32')child.send('stop-local-test');else child.kill('SIGINT');
 const result=await done;assert.equal(timedOut,false,'SHUTDOWN_TIMEOUT');assert.equal(result.code,0);assert.equal(result.signal,null);assert.match(output,/Local test API stopped; PostgreSQL stopped\./);
 for(const port of [Number(new URL(ready.url).port),ready.postgresPort]){
  await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port});socket.setTimeout(1000,()=>{socket.destroy();reject(new Error('STOP_CHECK_TIMEOUT'));});socket.once('connect',()=>{socket.destroy();reject(new Error('LOCAL_LISTENER_STILL_OPEN'));});socket.once('error',()=>resolve());});
 }
 console.log(`Web shutdown: ${process.platform==='win32'?'IPC Windows':'SIGINT real'}; HTTP y PostgreSQL cerrados, puertos verificados.`);
}catch(e){failure=e;}finally{clearTimeout(timeout);if(child.connected)child.send('stop-local-test');}
if(failure){console.error(failure.message);process.exit(1);}
