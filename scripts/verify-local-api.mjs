import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { postJson } from '../tests/helpers/http.mjs';
const child=spawn(process.execPath,['scripts/test-postgres.mjs','--serve-http'],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,
  env:{...process.env,DATABASE_URL:'postgresql://invalid@external.invalid/production',HOST:'0.0.0.0',PORT:'80'}});
let output='';
child.stderr.on('data',()=>{}); // Never forward potential connection diagnostics.
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
const timeout=setTimeout(()=>child.kill(),30000);
let failed;
try {
  const url=await Promise.race([
    new Promise(resolve=>child.stdout.on('data',chunk=>{
      output=(output+chunk).slice(-16000);
      const match=/Local test API: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match)resolve(match[1]);
    })),
    done.then(()=>{throw new Error('LOCAL_LAUNCHER_EXITED_BEFORE_READY');})
  ]);
  const credentials={login:'pasajero.demo.ficticio',password:'Clave de prueba ficticia 42'};
  assert.equal((await postJson(url,'/v1/register',credentials)).status,202);
  const session=await postJson(url,'/v1/login',credentials);assert.equal(session.status,200);
  assert.equal((await postJson(url,'/v1/logout',{}, {Authorization:'Bearer '+session.body.token})).status,200);
} catch(e) {failed=e;} finally {if(child.connected)child.send('stop-local-test');}
try {
  assert.equal((await done).code,0);
  assert.match(output,/Local test API stopped; PostgreSQL stopped\./);
  if(failed)throw failed;
  console.log('Local HTTP launcher: register/login/logout passed; HTTP and PostgreSQL stopped.');
} finally {clearTimeout(timeout);}
