import {test,expect} from '@playwright/test';
import {login,operational,rejected} from './support/operation-browser.mjs';
import {operationEvidence} from './support/operation-evidence.mjs';
test('pasajero no obtiene panel administrativo ni datos de otras asociaciones y chofer declara una incidencia básica',async({page,browser,baseURL},info)=>{
 await login(page,'viajero6','/administracion');await expect(page.getByRole('alert')).toContainText('no tiene permiso');await expect(page.getByLabel('Vehículo autorizado').locator('option')).toHaveCount(1);await page.getByRole('button',{name:'Cerrar sesión'}).click();await expect(page.getByLabel('Usuario ficticio',{exact:true})).toBeVisible();await operational(page,'driver0','/chofer','FICTICIO-WEB-0-0');const group=page.locator('.expected-booking').filter({hasText:'Reserva confirmada'}).first();await group.getByText('Integrantes técnicos y movimientos individuales',{exact:true}).click();await group.getByRole('button',{name:'Abordó integrante 1',exact:true}).click();await expect(page.locator('.trip-facts')).toContainText('1 abordados observados');await expect(page.locator('.expected-booking').filter({hasText:'Reserva confirmada'}).first().getByRole('button',{name:'Registrar abordaje del grupo',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Reportar avería ficticia observada'}).click();await expect(page.locator('.trip-operations h2').first()).toContainText('Incidencia operativa');await expect(page.getByRole('button',{name:'Registrar salida',exact:true})).toBeDisabled();
 const evidence=await operationEvidence(info.project.name),other=await browser.newContext({baseURL});
 try{
  const before=await evidence.read(),tripId=before.trip.id;
  await rejected(page,'/api/operations/snapshot',{view:'DRIVER',tripId},'FORBIDDEN');
  await rejected(page,'/api/operations/command',{kind:'DEPART',tripId,confirmed:true},'FORBIDDEN');
  const p=await other.newPage();await login(p,'adminU','/administracion');
  await expect(p.getByLabel('Vehículo autorizado').locator('option')).toHaveCount(2);await expect(p.getByLabel('Vehículo autorizado')).not.toContainText('FICTICIO-OPERATIVO');
  await rejected(p,'/api/operations/snapshot',{view:'ADMIN',tripId},'FORBIDDEN_SCOPE');
  const b=before.bookings[0];
  await rejected(p,'/api/operations/command',{kind:'BOARD',bookingId:b.id,tripId,episode:0,seats:b.seats,alightingPointId:b.route_id+':'+b.to_stop,confirmed:true},'FORBIDDEN');
  expect(await evidence.read(tripId)).toEqual(before);
 }finally{await evidence.close();await other.close();}
});
