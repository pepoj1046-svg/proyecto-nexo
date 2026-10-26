import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReservation,actionKey,page,memberCommand } from '../src/domain/business.mjs';
const routeId='10000000-0000-4000-8000-000000000001',tripId='10000000-0000-4000-8000-000000000002';
const base={routeId,from:0,to:3,seats:2};
test('business reservations validate all six seat counts and preserve explicit money preconditions',()=>{
  for(let seats=1;seats<=6;seats++)assert.equal(validateReservation({...base,seats}).request.seats,seats);
  assert.equal(validateReservation({...base,seats:6,express:true}).request.express,true);
  const quote={fareId:routeId,fareVersion:1,totalBOB:'20.00'};
  assert.deepEqual(validateReservation({...base,quote}).quote,quote);
  for(const bad of [{...base,source:'WALK_IN'},{...base,userId:tripId},{...base,associationId:tripId},{...base,seats:'2'},
    {...base,seats:7},{...base,from:1.5},{...base,to:0},{...base,express:true},
    {...base,quote:{...quote,totalBOB:20}},{...base,quote:{...quote,totalBOB:'20.001'}},
    {...base,quote:{...quote,fareVersion:2147483648}}])assert.throws(()=>validateReservation(bad));
});
test('split requires explicit consent, at least three, declared absence of minors, unique trips and exact totals',()=>{
  const req={...base,seats:3,splitConsent:true,containsMinors:false,parts:[{tripId,seats:1},{tripId:routeId,seats:2}]};
  assert.equal(validateReservation(req).request.parts.length,2);
  for(const bad of [{...req,splitConsent:false},{...req,containsMinors:true},{...req,containsMinors:undefined},
    {...req,express:true,seats:6},{...req,parts:[{tripId,seats:1},{tripId,seats:2}]},
    {...req,parts:[{tripId,seats:2},{tripId:routeId,seats:2}]}])assert.throws(()=>validateReservation(bad));
});
test('business idempotency keys and pagination are bounded',()=>{
  assert.equal(actionKey('reservation:retry-1'),'reservation:retry-1');
  for(const k of ['',null,'a'.repeat(129),'space key'])assert.throws(()=>actionKey(k));
  assert.equal(page({routeId},'routeId').limit,50);
  for(const q of [{routeId,limit:101},{routeId,offset:-1},{routeId,actorId:tripId}])assert.throws(()=>page(q,'routeId'));
});

test('individual commands accept technical IDs and reject personal data, stop overrides and unknown states',()=>{
  for(const kind of ['BOARD','ALIGHT'])assert.equal(memberCommand({memberId:tripId,kind},['BOARD','ALIGHT']).kind,kind);
  for(const extra of [{name:'fictional'},{age:12},{document:'fictional'},{stop:2},{associationId:routeId}])
    assert.throws(()=>memberCommand({memberId:tripId,kind:'BOARD',...extra},['BOARD','ALIGHT']));
  for(const bad of [{memberId:'bad',kind:'BOARD'},{memberId:tripId,kind:'CANCEL'}])
    assert.throws(()=>memberCommand(bad,['BOARD','ALIGHT']));
});

test('terminal arrival and reassignment contracts require explicit confirmation and bounded configuration',async()=>{
 const {terminalInput}=await import('../src/domain/business.mjs');
 assert.equal(terminalInput('command',{bookingId:tripId,command:'DECLARED',confirmed:true}).confirmed,true);
 for(const body of [{bookingId:tripId,command:'DECLARED',confirmed:false},{bookingId:tripId,command:'DECLARED',confirmed:true,name:'FICTICIO'}])assert.throws(()=>terminalInput('command',body));
 for(const n of [0,86401,'120',null])assert.throws(()=>terminalInput('config',{associationId:routeId,declarationSeconds:n}));
 assert.throws(()=>terminalInput('transfer',{bookingId:tripId,targetTripId:routeId,direction:'AUTO'}));
});

test('assignment contracts require bounded episode versions and coded correction reasons',async()=>{
 const {assignmentInput}=await import('../src/domain/business.mjs');
 assert.equal(assignmentInput('transfer',{bookingId:tripId,targetTripId:routeId,direction:'RECOVER',episode:1}).episode,1);
 for(const episode of [-1,9,1.5,'1',undefined])assert.throws(()=>assignmentInput('respond',{bookingId:tripId,episode,accept:true}));
 for(const reason of ['',null,'Name: fictional',undefined])assert.throws(()=>assignmentInput('correction',{bookingId:tripId,episode:0,eventId:routeId,reason}));
 assert.throws(()=>assignmentInput('command',{bookingId:tripId,episode:0,command:'DECLARED',confirmed:false}));
 assert.throws(()=>assignmentInput('history',{bookingId:tripId,limit:101}));
 assert.throws(()=>assignmentInput('queue',{routeId,associationId:tripId}));
});

test('operational commands require explicit checks, versions, consent and simulated-only payment states',async()=>{
 const {operationalInput}=await import('../src/domain/business.mjs');
 assert.equal(operationalInput('arrival',{bookingId:tripId,episode:0,confirmed:true}).confirmed,true);
 assert.equal(operationalInput('fleet',{tripId,version:3,command:'ASSIGN',targetTripId:routeId,confirmed:true}).command,'ASSIGN');
 for(const b of [{tripId,version:0,command:'REPORT',confirmed:true},{tripId,version:1,command:'REPORT',confirmed:false},{tripId,version:1,command:'REPORT',confirmed:true,gps:[0,0]},{tripId,version:1,command:'SAFE_TRANSFER',onboard:7,confirmed:true}])assert.throws(()=>operationalInput('fleet',b));
 assert.throws(()=>operationalInput('payment',{bookingId:tripId,state:'PAID',confirmed:true}));
 assert.throws(()=>operationalInput('observation',{bookingId:tripId,kind:'BOARD',seats:2,destination:3,confirmed:true,name:'FICTIONAL'}));
});
test('operational history, group targets and repair release reject malformed or unconfirmed requests',async()=>{
 const {operationalInput}=await import('../src/domain/business.mjs');
 assert.throws(()=>operationalInput('consent',{bookingId:tripId,episode:0,confirmed:true}));
 assert.throws(()=>operationalInput('restore',{vehicleId:tripId,confirmed:false}));
 assert.throws(()=>operationalInput('history',{tripId,limit:101}));
 assert.throws(()=>operationalInput('correction',{bookingId:tripId,factKey:'x',reason:'INVENT_DESCENT',confirmed:true}));
});
