import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{fleetAdminRequest,createWebFleetAdminService}from'../src/db/web-fleet-admin-service.mjs';
const base=()=>({associationId:randomUUID(),revision:'b'.repeat(64),reason:'Ficticio',confirmed:true});
test('fleet requests normalize only synthetic codes and reject alternate authority, capacity or intent fields',()=>{
 const b={...base(),kind:'REQUEST_DRIVER',identityCode:' lab-demo '};assert.equal(fleetAdminRequest('command',b).identityCode,'LAB-DEMO');assert.equal(b.identityCode,' lab-demo ');
 for(const change of[{role:'DRIVER'},{actorId:randomUUID()},{identityCode:'real@example.invalid'},{revision:null},{reason:' '},{confirmed:false},{vehicleId:randomUUID()}])assert.throws(()=>fleetAdminRequest('command',{...b,...change}));
 for(const capacity of[0,5,7,'6',null])assert.throws(()=>fleetAdminRequest('command',{...base(),kind:'REQUEST_VEHICLE',vehicleCode:'LAB-V',vehicleType:'VAGONETA_6',capacity}));
 fleetAdminRequest('command',{...base(),kind:'REQUEST_VEHICLE',vehicleCode:'LAB-V',vehicleType:'VAGONETA_6',capacity:6});
});
test('fleet approvals and base assignments have disjoint closed contracts and require explicit confirmation',()=>{
 for(const kind of['APPROVE','REJECT'])fleetAdminRequest('command',{...base(),kind,requestId:randomUUID()});
 const b={...base(),kind:'ASSIGN',vehicleId:randomUUID(),driverRef:randomUUID()};fleetAdminRequest('command',b);
 for(const change of[{driverRef:null},{requestId:randomUUID()},{tripId:randomUUID()},{capacity:6},{kind:'MOVE'},{kind:'constructor'},{kind:'toString'},{kind:'__proto__'}])assert.throws(()=>fleetAdminRequest('command',{...b,...change}));
 for(const kind of['constructor','toString','__proto__',null,[],{}])assert.throws(()=>fleetAdminRequest('command',{...b,kind}),/INVALID_FLEET_COMMAND/);
 assert.throws(()=>fleetAdminRequest('command',{...b,kind:'UNASSIGN'}));fleetAdminRequest('command',{...base(),kind:'UNASSIGN',vehicleId:b.vehicleId});
});
test('fleet pagination is bounded and command rejects missing keys before accessing PostgreSQL',async()=>{
 for(const section of['DRIVERS','VEHICLES','ASSIGNMENTS','HISTORY'])fleetAdminRequest('page',{associationId:randomUUID(),section,limit:100});
 for(const limit of[0,101,'50'])assert.throws(()=>fleetAdminRequest('page',{associationId:randomUUID(),section:'HISTORY',limit}));
 assert.throws(()=>fleetAdminRequest('context',{associationId:randomUUID(),role:'GENERAL_ADMIN'}));
 await assert.rejects(createWebFleetAdminService({connect(){throw Error('MUST_NOT_CONNECT');}}).command('token',null,{...base(),kind:'APPROVE',requestId:randomUUID()}),/INVALID_ACTION_KEY/);
});
