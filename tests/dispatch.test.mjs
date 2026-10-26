import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentAvailability, fitsVehicle, chooseVehicle, canDepart, compatibleVehicle } from '../src/domain/dispatch.mjs';

const b=(seats,from=0,to=2,status='CONFIRMED',express=false)=>({seats,from,to,status,express});
const v=(id,position,inventory=[],opts={})=>({
  id,position,inventory,associationId:'A',routeId:'R',direction:'OUT',
  shiftActive:true,queueActive:true,status:'QUEUED',capacity:6,...opts
});
const req=(seats,express=false)=>({...b(seats,0,2,'PENDING',express),associationId:'A',routeId:'R',direction:'OUT'});

test('presenciales y digitales comparten cupos',()=>{
  assert.deepEqual(segmentAvailability([b(3),b(2,0,2,'HELD')],3),[1,1]);
  assert.equal(fitsVehicle(b(2),[b(3),b(2,0,2,'HELD')],3),false);
});
test('grupo de cinco pasa a siguiente compatible sin dividirse',()=>{
  const first=v('A',1,[b(3)]),second=v('B',2,[b(1)]),third=v('C',3,[]);
  assert.equal(chooseVehicle(req(5),[first,second,third],3)?.id,'B');
});
test('expreso sólo en trufi totalmente libre',()=>{
  assert.equal(chooseVehicle(req(6,true),[v('A',1,[b(1)]),v('B',2,[])],3)?.id,'B');
  assert.equal(fitsVehicle(b(6,0,2,'PENDING',true),[b(1)],3),false);
});
test('no compartir asientos si reservas se superponen parcialmente',()=>{
  assert.deepEqual(segmentAvailability([b(6,0,1),b(2,1,3)],4),[0,4,4]);
  assert.equal(fitsVehicle(b(1,0,2),[b(6,0,1)],4),false);
  assert.equal(fitsVehicle(b(4,1,3),[b(6,0,1),b(2,1,3)],4),true);
});
test('no cruzar asociación, ruta o sentido',()=>{
  assert.equal(chooseVehicle(req(1),[v('X',1,[],{associationId:'B'}),v('Y',2)],3)?.id,'Y');
  assert.equal(compatibleVehicle(v('X',1,[],{direction:'IN'}),req(1)),false);
  assert.equal(compatibleVehicle(v('X',1,[],{routeId:'OTHER'}),req(1)),false);
});
test('trufi completo puede salir antes que otro incompleto',()=>{
  assert.equal(canDepart(v('B',2,[b(6)]),3),true);
  assert.equal(canDepart(v('A',1,[b(4)]),3),false);
});
test('no contar reservas pendientes, canceladas o expiradas',()=>{
  assert.deepEqual(segmentAvailability([b(6,0,2,'PENDING'),b(6,0,2,'CANCELLED'),b(2)],3),[4,4]);
});
test('rechazar seis asientos como expreso mal declarado',()=>{
  assert.throws(()=>fitsVehicle(b(5,0,2,'PENDING',true),[],3),/EXPRESS_REQUIRES_SIX/);
});
test('salida incluye recogidas confirmadas posteriores, pero no ofertas sin aceptar',()=>{
  assert.equal(canDepart(v('A',1,[b(6,1,2)]),3),true);
  assert.equal(canDepart(v('A',1,[b(6,0,2,'HELD')]),3),false);
  assert.equal(canDepart(v('A',1,[b(6),b(1)]),3),false);
});
test('retenciones vencidas no consumen capacidad; ruta y vencimiento inválidos se rechazan',()=>{
  assert.deepEqual(segmentAvailability([{...b(6,0,2,'HELD'),expiresAt:'2000-01-01T00:00:00Z'}],3),[6,6]);
  assert.throws(()=>segmentAvailability([],1),/INVALID_ROUTE/);
  assert.throws(()=>segmentAvailability([{...b(6,0,2,'HELD'),expiresAt:'bad'}],3),/INVALID_EXPIRATION/);
});
