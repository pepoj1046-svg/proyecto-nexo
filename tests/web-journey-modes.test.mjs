import{test}from'node:test';import assert from'node:assert/strict';
import{journeyRequest}from'../src/db/web-reservation-service.mjs';
import{validateReservation}from'../src/domain/business.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const b={routeId:id,tripId:id,boardingPointId:id+':0',alightingPointId:id+':3',seats:6,flow:'QUEUE',express:true};
test('web express requires six technical seats, queued service and closed fields',()=>{
 assert.deepEqual(journeyRequest(b),{from:0,to:3});for(const change of [{seats:5},{flow:'ENROUTE'},{express:'true'},{actorId:id}])assert.throws(()=>journeyRequest({...b,...change}),/INVALID_/);
});
test('split consent never permits express or minors and all parts must sum to group seats',()=>{
 const r={routeId:id,from:0,to:3,seats:3,parts:[{tripId:id,seats:2},{tripId:other,seats:1}],splitConsent:true,containsMinors:false};assert.equal(validateReservation(r).request.parts.length,2);
 for(const change of [{splitConsent:false},{containsMinors:true},{containsMinors:undefined},{express:true,seats:6},{parts:[{tripId:id,seats:1},{tripId:other,seats:1}]}])assert.throws(()=>validateReservation({...r,...change}),/SPLIT_NOT_ALLOWED|INVALID_/);
});
