import{test}from'node:test';import assert from'node:assert/strict';
import{validateClosing,validateDayQuery}from'../src/db/web-reconciliation-service.mjs';
// Etapa 7A: amounts are decimal strings with at most two decimals; days are ISO dates.
const a='11111111-1111-4111-8111-111111111111';
test('7A-U1: closing input is closed and money never travels as a float',()=>{
 assert.deepEqual(validateClosing({associationId:a,day:'2026-11-21',declaredBOB:'12.50',note:'  ok nota  '}),{associationId:a,day:'2026-11-21',declaredBOB:'12.50',note:'ok nota'});
 assert.equal(validateClosing({associationId:a,day:'2026-11-21',declaredBOB:'0',note:''}).note,null);
 for(const amount of[12.5,'-1','1.234','01','1e3','',' 1'])assert.throws(()=>validateClosing({associationId:a,day:'2026-11-21',declaredBOB:amount,note:null}),/INVALID_AMOUNT/);
 assert.throws(()=>validateClosing({associationId:a,day:'2026-11-21',declaredBOB:'1',note:'x'.repeat(201)}),/INVALID_NOTE/);
 assert.throws(()=>validateClosing({associationId:a,day:'2026-11-21',declaredBOB:'1',note:null,expectedBOB:'1'}),/INVALID_REQUEST/);
});
test('7A-U2: days must be real ISO dates',()=>{
 assert.equal(validateDayQuery({associationId:a,day:'2026-02-28'}).day,'2026-02-28');
 for(const d of['2026-13-01','21/11/2026','2026-11-21T00:00','',null])assert.throws(()=>validateDayQuery({associationId:a,day:d}),/INVALID_DAY/);
});
