import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateTerminalCommand,directoryPage} from '../src/db/web-terminal-service.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('terminal web commands require explicit consent and cannot receive actor, source or arbitrary operations',()=>{
  for(const body of [{kind:'constructor'},{kind:'PAYMENT'},{kind:'REJECT_OFFER',bookingId:id,confirmed:false},{kind:'CANCEL_BOOKING',bookingId:id,confirmed:true,actorId:id},{kind:'RETURN_QUEUE',tripId:id,confirmed:true},{kind:'RETURN_QUEUE',tripId:id,routeId:id,confirmed:true,source:'APP'}])assert.throws(()=>validateTerminalCommand(body),/INVALID_/);
  assert.equal(validateTerminalCommand({kind:'RETURN_QUEUE',tripId:id,routeId:id,confirmed:true}).routeId,id);
});
test('administrative directory has bounded pages and closed route/status filters',()=>{
  for(const body of [{limit:51},{offset:-1},{offset:10001},{limit:'20'},{status:'AVAILABLE_FOR_RESCUE'},{routeId:'forged'},{role:'ADMIN'}])assert.throws(()=>directoryPage(body),/INVALID_/);
  assert.deepEqual(directoryPage({}),{limit:20,offset:0,status:'ALL',routeId:null});
});
