import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRecovery} from '../src/db/web-recovery-service.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('web recovery admits only explicit business commands, not arbitrary RPCs or client authority',()=>{
 for(const b of [{kind:'constructor'},{kind:'toString'},{kind:'PAYMENT'},{kind:'ASSIGN_ROAD',tripId:id,version:2,targetTripId:id,priority:'DESTINATION',confirmed:true,role:'ADMIN'},{kind:'GROUP_CONSENT',bookingId:id,targetTripId:id,episode:0,confirmed:false},{kind:'APPROVE_TRANSFER',consentId:id,confirmed:true,associationId:id}])assert.throws(()=>validateRecovery(b),/INVALID_/);
 assert.equal(validateRecovery({kind:'GROUP_CONSENT',bookingId:id,targetTripId:id,episode:0,confirmed:true}).bookingId,id);
});
test('web rescue requires versions, bounded observed counts and whole-group consent references',()=>{
 for(const b of [{kind:'SAFE_ROAD',tripId:id,confirmed:true,onboard:4},{kind:'SAFE_ROAD',tripId:id,version:2,confirmed:true},{kind:'SAFE_URBAN',tripId:id,version:2,onboard:7,confirmed:true},{kind:'ASSIGN_ROAD',tripId:id,version:2,targetTripId:id,confirmed:true},{kind:'TERMINAL_REASSIGN',incidentId:id,targetTripId:id,consentIds:[id,id],safeTransfer:false,confirmed:true}])assert.throws(()=>validateRecovery(b),/INVALID_/);
 for(const onboard of [0,6])assert.equal(validateRecovery({kind:'SAFE_ROAD',tripId:id,version:2,onboard,confirmed:true}).onboard,onboard);
});
