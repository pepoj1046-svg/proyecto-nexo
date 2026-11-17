import{test}from'node:test';import assert from'node:assert/strict';
import{declaration,conditionCommand}from'../src/db/web-condition-service.mjs';
const id='11111111-1111-4111-8111-111111111111';
const b={routeId:id,expectedRevision:0,state:'DESVIO',reason:'BLOCKADE',description:'Desvío ficticio',affectedStops:[1],additionalMinutes:30,confirmed:true};
test('web condition declaration validates estimates, versions, native reasons and authority fields',()=>{
 assert.equal(declaration(b),b);assert.equal(declaration({...b,additionalMinutes:null}).additionalMinutes,null);
 for(const c of [{additionalMinutes:-1},{additionalMinutes:1.5},{additionalMinutes:10081},{additionalMinutes:'30'},{expectedRevision:-1},{reason:'PLATFORM_CERTIFIED'},{actorId:id},{confirmed:false},{affectedStops:[1,1]}])assert.throws(()=>declaration({...b,...c}),/INVALID_/);
});
test('web decisions require explicit confirmation and exact version without client actor or automatic cancellation',()=>{
 const c={bookingId:id,revision:1,decision:'REJECT',confirmed:true};assert.equal(conditionCommand(c),c);
 for(const d of [{revision:0},{confirmed:false},{decision:'CANCEL_AUTOMATICALLY'},{actorId:id}])assert.throws(()=>conditionCommand({...c,...d}),/INVALID_/);
});
