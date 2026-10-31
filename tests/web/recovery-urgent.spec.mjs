import {test,expect} from '@playwright/test';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick,consoleIncident,confirmIncident,bookingContract,recordEvidence} from './support/recovery-browser.mjs';
test('sin unidad libre la revisión urgente es explícita y conserva pasajeros, reservas y capacidad',async({page,browser,baseURL},info)=>{
 test.setTimeout(90000);const audit=await operationEvidence(info.project.name),admin=await browser.newContext(deviceContext(page,baseURL,info)),driver=await browser.newContext(deviceContext(page,baseURL,info));
 try{
  await login(page,'operativo0','/pasajero');const booking=page.locator('.saved-booking'),a=await admin.newPage(),d=await driver.newPage();await operational(a,'adminR','/administracion');const tripId=await a.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(tripId);
  await operational(d,'driver5','/chofer');await commandClick(d,d.getByRole('button',{name:'Reportar avería ficticia observada',exact:true}),'/api/operations/command');await a.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(a.getByRole('button',{name:'Confirmar incidencia reportada',exact:true})).toBeVisible();await confirmIncident(a);const incidentId=await consoleIncident(a,'FICTICIO-OPERATIVO');
  await expect(a.locator('.recovery-detail')).toContainText('No hay una unidad compatible');const detail=await(await api(a,'/api/recovery/detail',{incidentId})).json();expect(detail.candidates).toHaveLength(0);
  const blocked=await a.getByLabel('Vehículo autorizado').locator('option').filter({hasText:'FICTICIO-RESCATE-ORIGEN'}).getAttribute('value');await rejected(a,'/api/recovery/command',{kind:'ASSIGN_ROAD',tripId,version:detail.incident.roadVersion,targetTripId:blocked,priority:'ORIGIN',confirmed:true},'NO_FREE_REPLACEMENT',409);
  await a.getByLabel('Solicito revisión humana urgente sin prometer una unidad').check();const receipt=await commandClick(a,a.getByRole('button',{name:'Registrar revisión urgente',exact:true}));expect((await api(a,'/api/recovery/command',receipt.body,receipt.key)).status()).toBe(200);
  const after=await audit.read(tripId);expect(bookingContract(after)).toEqual(bookingContract(before));expect(after.movements).toEqual(before.movements);expect(after.onboard).toBe(6);expect(after.trip.vehicle_id).toBe(before.trip.vehicle_id);expect(after.incidents[0].road_phase).toBe('URGENT_REVIEW');expect(after.journey.filter(e=>e.kind==='ROAD_ESCALATE')).toHaveLength(1);
  await booking.getByRole('button',{name:'Consultar incidencia y traslado',exact:true}).click();await expect(booking).toContainText('Revisión humana urgente. No hay un rescate garantizado');await expect(booking).toContainText('sin cobros ni rescate automático');await recordEvidence('urgente',info.project.name,'sin-unidad',after,page);
 }finally{await audit.close();await admin.close();await driver.close();}
});
