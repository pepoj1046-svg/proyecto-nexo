import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword,verifyPassword,validatePassword } from '../src/auth/passwords.mjs';
import { createIdentity,validateLogin } from '../src/auth/identity.mjs';
import { withPasswordWork } from '../src/auth/work-limit.mjs';
test('scrypt hashes use unique salts, constant parameters and verify exact Unicode passwords',async()=>{
  const password='Clave ficticia ñ 42';
  const a=await hashPassword(password), b=await hashPassword(password);
  assert.notEqual(a,b); assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password,a),true);
  assert.equal(await verifyPassword(password+'x',a),false);
  assert.equal(await verifyPassword(password,'scrypt:999999999:8:1:bad:bad'),false);
  for(const p of ['',null,'short','a'.repeat(129),'\ud800'.repeat(12)]) assert.throws(()=>validatePassword(p),/INVALID_PASSWORD/);
  assert.equal(await verifyPassword('\ud800'.repeat(12),a),false);
});
test('identity rejects client-controlled roles, memberships and invalid identifiers before database access',async()=>{
  const api=createIdentity({connect:()=>{throw new Error('UNEXPECTED_DATABASE_ACCESS');}});
  assert.equal(validateLogin('  TEST.usuario '),'test.usuario');
  for(const login of ['a','a@b.com','ábc','ab_c','Kkk','a'.repeat(65)]) assert.throws(()=>validateLogin(login),/INVALID_IDENTITY/);
  for(const extra of [{role:'REVIEWER'},{associationId:'forged'},{userId:'forged'}])
    await assert.rejects(api.register({login:'ficticio',password:'Clave ficticia 42',...extra}),/INVALID_IDENTITY/);
});
test('password work is bounded across adapters and releases slots after failed work',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=Array.from({length:6},(_,i)=>withPasswordWork(async()=>{await gate;if(i===0)throw new Error('EXPECTED');return i;}));
  try {await assert.rejects(withPasswordWork(async()=>7),/IDENTITY_BUSY/);}
  finally {release();}
  const results=await Promise.allSettled(pending);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(await withPasswordWork(async()=>8),8);
});
