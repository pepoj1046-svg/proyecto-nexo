import{test}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{routeConfigRequest,configSpec,createWebRouteConfigService}from'../src/db/web-route-config-service.mjs';
const base=()=>({associationId:randomUUID(),revision:'a'.repeat(64),reason:'Prueba ficticia',confirmed:true});
const fare=()=>({from:0,to:3,express:false,amountBOB:'0.00',validFrom:null,validUntil:null,replaceFareId:null});
const route=()=>({name:'LAB-RUTA',direction:'OUT',originId:null,destinationId:null,points:[]});
test('route configuration validates closed draft shapes without inventing reversed paths or terminal profiles',()=>{
 configSpec(route());const p={index:0,name:'LAB-TERMINAL',localityId:randomUUID(),kind:'TERMINAL',boardingAllowed:true,alightingAllowed:false,mainDeparture:false};configSpec({...route(),points:[p]});
 for(const change of[{direction:'BACK'},{actorId:randomUUID()},{points:[{...p,kind:null}]},{points:[{...p,mainDeparture:'true'}]},{points:[{...p,gps:[0,0]}]}])assert.throws(()=>configSpec({...route(),...change}));
});
test('fare drafts accept zero but reject NULL, negative, rounding, invented money and malformed vigencies',()=>{
 configSpec(fare());for(const change of[{amountBOB:null},{amountBOB:'-1.00'},{amountBOB:'12.001'},{amountBOB:10},{amountBOB:'10000000000.00'},{validFrom:'mañana'},{express:'true'},{refund:true},{from:-1}])assert.throws(()=>configSpec({...fare(),...change}));
});
test('configuration actions and pages reject authority injection and inherited command names before PostgreSQL',async()=>{
 routeConfigRequest('command',{...base(),kind:'CREATE_ROUTE',spec:route()});routeConfigRequest('command',{...base(),kind:'CREATE_FARE',routeId:randomUUID(),spec:fare()});
 for(const kind of['constructor','toString','__proto__',null,{}])assert.throws(()=>routeConfigRequest('command',{...base(),kind,spec:route()}),/INVALID_CONFIG_COMMAND/);
 for(const change of[{role:'GENERAL_ADMIN'},{confirmed:false},{reason:' '},{revision:null}])assert.throws(()=>routeConfigRequest('command',{...base(),kind:'VALIDATE',draftId:randomUUID(),...change}));
 for(const section of['ROUTE_DRAFTS','FARE_DRAFTS','FARES','HISTORY'])routeConfigRequest('page',{associationId:randomUUID(),section,limit:100});assert.throws(()=>routeConfigRequest('page',{associationId:randomUUID(),section:'HISTORY',limit:101}));
 await assert.rejects(createWebRouteConfigService({connect(){throw Error('MUST_NOT_CONNECT');}}).command('token',null,{...base(),kind:'CREATE_ROUTE',spec:route()}),/INVALID_ACTION_KEY/);
});
