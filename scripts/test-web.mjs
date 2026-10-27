import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import assert from 'node:assert/strict';
const run=(args,env=process.env)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:'inherit',env,windowsHide:true});p.once('error',reject);p.once('exit',code=>resolve(code??1));});
let failed=await run(['node_modules/typescript/bin/tsc','--noEmit','-p','apps/web/tsconfig.json']);
if(!failed)failed=await run(['scripts/build-web.mjs']);
if(!failed) {
 for(const project of ['desktop','mobile']) {
  const child=spawn(process.execPath,['scripts/test-postgres.mjs','--serve-web'],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,
    env:{...process.env,DATABASE_URL:'postgres://invalid@external.invalid/production',HOST:'0.0.0.0',PORT:'80'}});
  let output='';child.stdout.on('data',data=>{output=(output+data).slice(-16000);});child.stderr.on('data',()=>{});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  const timeout=setTimeout(()=>child.kill(),180000);let code=1;
  try{
   const url=await Promise.race([new Promise(resolve=>child.on('message',m=>{if(m?.type==='web-ready')resolve(m.url);})),done.then(()=>{throw new Error('WEB_LAUNCHER_EXITED_BEFORE_READY');})]);
   if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw new Error('LOCAL_BROWSER_TEST_REQUIRED');
   const env={...process.env,NEXO_WEB_TEST_LOCAL:'1',NEXO_WEB_TEST_URL:url};
   if(process.platform==='linux'){try{await access('/usr/bin/chromium');env.NEXO_BROWSER_EXECUTABLE='/usr/bin/chromium';}catch{}}
   code=await run(['node_modules/@playwright/test/cli.js','test','--project='+project],env);
  }catch(e){console.error(e.message);code=1;}
  finally{if(child.connected)child.send('stop-local-test');}
  try{assert.equal(await done,0);assert.match(output,/Local test API stopped; PostgreSQL stopped\./);console.log(`Web ${project}: listener y PostgreSQL detenidos correctamente.`);}catch{code=1;}
  clearTimeout(timeout);if(code){failed=code;break;}
 }
}
if(!failed)failed=await run(['scripts/verify-web-stop.mjs']);
process.exit(failed??0);
