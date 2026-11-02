import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {driverAdminRequest,createWebDriverAdminService} from '../src/db/web-driver-admin-service.mjs';
const command=()=>({associationId:randomUUID(),userRef:randomUUID(),enabled:false,revision:'a'.repeat(64),reason:'Revisión administrativa ficticia',confirmed:true});
test('existing driver administration validates closed intentions and never accepts provisioning authority',()=>{
 const b=command();assert.equal(driverAdminRequest('command',b),b);
 for(const change of[{confirmed:false},{enabled:'false'},{revision:''},{reason:' '},{reason:'a'.repeat(201)},{actorId:randomUUID()},{role:'ASSOCIATION_ADMIN'},{tripId:randomUUID()},{userRef:'reference'},{associationId:null}])assert.throws(()=>driverAdminRequest('command',{...b,...change}));
 for(const userRef of[undefined,null,b.userRef])driverAdminRequest('context',{associationId:b.associationId,userRef});
 assert.throws(()=>driverAdminRequest('context',{associationId:b.associationId,enabled:true}));
});
test('driver history and contacts remain bounded, synthetic and require an explicit mutation key',async()=>{
 const associationId=randomUUID();driverAdminRequest('history',{associationId,limit:100,cursor:null});
 for(const limit of[0,101,'50'])assert.throws(()=>driverAdminRequest('history',{associationId,limit}));
 driverAdminRequest('contact',{associationId,contactCode:'LAB-TERMINAL_01',confirmed:true});
 for(const contactCode of['+591000000','correo@example.invalid','LAB-','LAB-á','LAB-'+ 'A'.repeat(41)])assert.throws(()=>driverAdminRequest('contact',{associationId,contactCode,confirmed:true}));
 const s=createWebDriverAdminService({connect:()=>{throw Error('DATABASE_MUST_NOT_BE_REACHED');}});
 await assert.rejects(s.command('token',null,command()),/INVALID_ACTION_KEY/);await assert.rejects(s.contact('token',null,{associationId,contactCode:'LAB-1',confirmed:true}),/INVALID_ACTION_KEY/);
});
