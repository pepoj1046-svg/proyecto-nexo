import{test}from'node:test';import assert from'node:assert/strict';
import{safetyCommand,discrepancyReport,discrepancyKinds}from'../src/db/web-safety-service.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('handoff commands have closed shapes, current versions and explicit human confirmation',()=>{
 const base={incidentId:id,version:0,command:'RECEIVE_MEMBER',bookingId:id,memberId:id,confirmed:true};
 assert.deepEqual(safetyCommand(base),base);
 for(const extra of[{confirmed:false},{version:-1},{version:8},{command:'BOARD'},{memberId:null},{actorId:id},{associationId:id},{command:'RECEIVE_GROUP'},{command:'CONFIRM_SAFE'}])assert.throws(()=>safetyCommand({...base,...extra}),/INVALID_/);
 assert.equal(safetyCommand({incidentId:id,version:6,command:'CONFIRM_SAFE',confirmed:true}).command,'CONFIRM_SAFE');
 assert.equal(safetyCommand({incidentId:id,version:0,command:'RECEIVE_GROUP',bookingId:id,confirmed:true}).command,'RECEIVE_GROUP');
});
test('discrepancies accept only the four review kinds and never client evidence, authority or inventory changes',()=>{
 const base={bookingId:id,episode:0,kind:'NOT_BOARDED',confirmed:true};
 for(const kind of discrepancyKinds)assert.equal(discrepancyReport({...base,kind}).kind,kind);
 for(const extra of[{confirmed:false},{episode:9},{episode:0.5},{kind:'CANCEL'},{evidence:{}},{priceBOB:'0.00'},{role:'ADMIN'},{memberId:id}])assert.throws(()=>discrepancyReport({...base,...extra}),/INVALID_/);
});
