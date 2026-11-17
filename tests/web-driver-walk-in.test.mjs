import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSchedule,validateDriverSale} from '../src/db/web-driver-walk-in-service.mjs';

const A='00000000-0000-4000-8000-000000000001',T='00000000-0000-4000-8000-000000000002';
test('4B1-U1: schedule input is closed, bounded and keeps windows that cross midnight',()=>{
  const ok=validateSchedule({associationId:A,expectedRevision:0,windows:[{weekday:1,start:'18:00',end:'06:00'},{weekday:7,start:'00:00',end:'23:59'}]});
  assert.deepEqual(ok.windows,[{weekday:1,start:'18:00',end:'06:00'},{weekday:7,start:'00:00',end:'23:59'}]);
  assert.deepEqual(validateSchedule({associationId:A,expectedRevision:3,windows:[]}).windows,[]);
  for(const windows of[[{weekday:0,start:'18:00',end:'06:00'}],[{weekday:8,start:'18:00',end:'06:00'}],[{weekday:1.5,start:'18:00',end:'06:00'}],
    [{weekday:1,start:'18:00',end:'18:00'}],[{weekday:1,start:'24:00',end:'06:00'}],[{weekday:1,start:'6:00',end:'07:00'}],[{weekday:1,start:'06:00',end:'07:60'}],
    [{weekday:1,start:'18:00',end:'06:00'},{weekday:1,start:'18:00',end:'05:00'}],Array.from({length:22},(_,i)=>({weekday:1,start:String(i).padStart(2,'0')+':00',end:'23:30'})),'x',null])
    assert.throws(()=>validateSchedule({associationId:A,expectedRevision:0,windows}),/INVALID_SCHEDULE|INVALID_REQUEST/);
  assert.throws(()=>validateSchedule({associationId:A,expectedRevision:0,windows:[{weekday:1,start:'18:00',end:'06:00',driver:'x'}]}),/INVALID_REQUEST/);
  assert.throws(()=>validateSchedule({associationId:A,expectedRevision:-1,windows:[]}),/INVALID_SCHEDULE/);
  assert.throws(()=>validateSchedule({associationId:'A',expectedRevision:0,windows:[]}),/INVALID_ID/);
  assert.throws(()=>validateSchedule({associationId:A,expectedRevision:0,windows:[],role:'ADMIN'}),/INVALID_REQUEST/);
});
test('4B1-U2: a driver sale is closed and requires the explicit no-minors attestation before registering',()=>{
  const sale={tripId:T,boardingPointId:A+':0',alightingPointId:A+':3',seats:2};
  assert.equal(validateDriverSale(sale,false),sale);
  assert.throws(()=>validateDriverSale({...sale,quote:{},confirmed:true},false),/INVALID_REQUEST/,'a quote request carries no confirmation');
  for(const noMinors of[undefined,false,'true',1])assert.throws(()=>validateDriverSale({...sale,quote:{},confirmed:true,...(noMinors===undefined?{}:{noMinors})},true),/MINOR_REVIEW_REQUIRED/);
  assert.ok(validateDriverSale({...sale,quote:{},confirmed:true,noMinors:true},true));
  for(const extra of[{associationId:A},{source:'APP'},{containsMinors:false},{express:true},{parts:[]}])assert.throws(()=>validateDriverSale({...sale,...extra},false),/INVALID_REQUEST/);
  assert.throws(()=>validateDriverSale({...sale,tripId:'x'},false),/INVALID_ID/);
});
