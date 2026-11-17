import{test}from'node:test';import assert from'node:assert/strict';import{careCommand}from'../src/db/web-care-service.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('care commands reject authority injection, missing versions, false verification and arbitrary legal or monetary operations',()=>{
 const b={kind:'RESPONSIBILITY',bookingId:id,version:0,command:'CREATE_OFFLINE',reason:'IN_PERSON_SIMULATED',confirmed:true};assert.deepEqual(careCommand(b),b);
 for(const extra of[{confirmed:false},{version:-1},{version:null},{command:'CLAIM_BY_REFERENCE'},{associationId:id},{userId:id},{role:'ADMIN'},{legalApproved:true},{code:'0'.repeat(64)},{reason:'PASSPORT_VERIFIED'}])assert.throws(()=>careCommand({...b,...extra}),/INVALID_/);
 assert.throws(()=>careCommand({...b,command:'LINK_ACCOUNT'}),/INVALID_/);assert.equal(careCommand({...b,command:'LINK_ACCOUNT',code:'a'.repeat(64)}).command,'LINK_ACCOUNT');
});
test('absence, minor and review commands require closed explicit physical facts and independent confirmations',()=>{
 const absence={kind:'ABSENCE',bookingId:id,episode:0,reason:'NOT_PRESENT_AT_BOARDING',confirmed:true};assert.equal(careCommand(absence).kind,'ABSENCE');
 for(const extra of[{episode:9},{automaticCancellation:true},{seats:0},{waitMinutes:10},{memberId:null}])assert.throws(()=>careCommand({...absence,...extra}),/INVALID_/);
 const minor={kind:'MINOR',bookingId:id,episode:0,memberId:id,scenario:'UNACCOMPANIED',result:'PENDING',confirmed:true};assert.equal(careCommand(minor).result,'PENDING');assert.throws(()=>careCommand({...minor,companionId:id}),/INVALID_/);assert.throws(()=>careCommand({...minor,age:8}),/INVALID_/);
 const review={kind:'REVIEW',reportId:id,version:0,result:'DOCUMENTED',reason:'EVIDENCE_REVIEWED',confirmed:true};assert.equal(careCommand(review).result,'DOCUMENTED');assert.throws(()=>careCommand({...review,evidence:{}}),/INVALID_/);assert.throws(()=>careCommand({...review,factKey:'fake'}),/INVALID_/);assert.throws(()=>careCommand({...review,result:'NATIVE_CORRECTION'}),/INVALID_/);
});
test('account management cannot create administrators, provision users or accept unbounded targets',()=>{
 const b={kind:'ACCOUNT',tripId:id,userRef:id,enabled:false,reason:'ACCESS_REVOKED',confirmed:true};assert.deepEqual(careCommand(b),b);
 for(const extra of[{enabled:'true'},{role:'ASSOCIATION_ADMIN'},{associationId:id},{newAccount:true},{reason:'FREE_TEXT'}])assert.throws(()=>careCommand({...b,...extra}),/INVALID_/);
 const request={kind:'EXCEPTION',bookingId:id,episode:0,command:'REQUEST_ALTERNATIVE',confirmed:true};assert.deepEqual(careCommand(request),request);assert.throws(()=>careCommand({...request,targetTripId:id}),/INVALID_/);assert.throws(()=>careCommand({...request,command:'LATE_REPLACE'}),/INVALID_/);
});
