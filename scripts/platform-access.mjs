// Trusted local installer only. Never imported by an HTTP listener.
import pg from 'pg';
import {randomBytes}from'node:crypto';
import{mkdir,open,unlink}from'node:fs/promises';
import{resolve,dirname}from'node:path';
import{pathToFileURL}from'node:url';
import{hashPassword}from'../src/auth/passwords.mjs';
import{assertRuntime}from'../src/db/runtime.mjs';
export async function initializePlatform(client,{login,reason,confirmed,output}){
 if(confirmed!==true||typeof login!=='string'||!/^lab-[a-z0-9.-]{2,59}$/.test(login)||typeof reason!=='string'||!reason.trim()||reason.length>200||typeof output!=='string'||dirname(resolve(output))!==resolve('.local'))throw new Error('INVALID_PLATFORM_BOOTSTRAP');
 await assertRuntime(client,'nexo_provisioner',{localTest:true});
 const password=randomBytes(32).toString('base64url'),hash=await hashPassword(password);
 await mkdir('.local',{recursive:true});const file=await open(resolve(output),'wx',0o600);let committed=false,commitAttempted=false;
 try{
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');await client.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
  const userRef=(await client.query('SELECT nexo.bootstrap_platform($1,$2,$3,$4)AS id',[login,hash,reason,true])).rows[0].id;
  await file.writeFile(JSON.stringify({warning:'LABORATORIO. Guardar fuera de Git; secreto único de esta instalación.',login,password,userRef},null,2));await file.sync();
  commitAttempted=true;await client.query('COMMIT');committed=true;return{status:'PLATFORM_INITIALIZED',credentialsFile:resolve(output)};
 }finally{try{if(!committed){try{await client.query('ROLLBACK');}finally{if(!commitAttempted)await unlink(resolve(output)).catch(()=>{});}}}finally{await file.close();}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let client;try{
  const args=process.argv.slice(2),valid=['--initialize','--attest','--confirm'];
  if(args.some(a=>!valid.includes(a)&&!/^--(login|reason|output|user-ref|code)=/.test(a))||new Set(args.map(a=>a.split('=')[0])).size!==args.length||!args.includes('--confirm')||args.includes('--initialize')===args.includes('--attest'))throw new Error('INVALID_PLATFORM_REQUEST');
  const get=k=>args.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3);
  const url=new URL(process.env.NEXO_PROVISION_DATABASE_URL??'postgres://invalid');if(url.hostname!=='127.0.0.1'||!/^\/nexo_test_[a-f0-9]+$/.test(url.pathname))throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  client=new pg.Client({connectionString:url.href});await client.connect();
  if(args.includes('--initialize'))console.log(JSON.stringify(await initializePlatform(client,{login:get('login'),reason:get('reason'),confirmed:true,output:get('output')})));
  else{await assertRuntime(client,'nexo_provisioner',{localTest:true});await client.query('SELECT nexo.platform_verify_identity($1,$2,$3,true)',[get('user-ref'),get('code'),get('reason')]);console.log('LAB_ATTESTATION_RECORDED');}
 }catch{console.error('PLATFORM_LOCAL_ACTION_REJECTED. Consultar configuración y estado local; no se muestran secretos.');process.exitCode=1;}finally{await client?.end();}
}
