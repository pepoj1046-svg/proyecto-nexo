import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{transform}from'esbuild';
const {code}=await transform(await readFile('apps/web/src/model.ts','utf8'),{loader:'ts',format:'esm'});
const {groupServices,eligibleSeats,seatStates,totalFare}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const service={associationId:'A',association:'Asociación ficticia A',tripId:'T',state:'NORMAL',newReservationsAllowed:true,availableSeats:4,fareBOB:'35.00',segments:[{confirmed:2,reserved:2,available:4},{confirmed:3,reserved:4,available:2}]};
test('web groups association results without mixing queues or making client-side reservations',()=>{
 const input=[service,{...service,tripId:'T2'},{...service,associationId:'B',association:'B',tripId:'T3'}];assert.deepEqual(groupServices(input).map(g=>[g.id,g.services.length]),[['A',2],['B',1]]);assert.equal(input[0],service);
});
test('web eligibility is the bottleneck across all segments and respects server prohibitions',()=>{
 assert.equal(eligibleSeats(service),2);for(const change of [{newReservationsAllowed:false},{state:'SUSPENDIDA'},{tripId:null},{fareBOB:null},{segments:[]}])assert.equal(eligibleSeats({...service,...change}),0);
 assert.deepEqual(seatStates({confirmed:0,reserved:0,available:0}),Array(6).fill('blocked'));
 assert.deepEqual(seatStates(service.segments[1]),['confirmed','confirmed','confirmed','held','free','free']);
});
test('web fare display uses integer cents, bounded seats and no invented payment or confirmation',()=>{
 assert.equal(totalFare('35.15',6),'210.90');assert.equal(totalFare('0.01',3),'0.03');for(const [p,n]of [[null,1],['10.001',2],['10.00',0],['10.00',7],['10.00',1.5]])assert.equal(totalFare(p,n),null);
});
