import {test,expect} from '@playwright/test';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick,consoleIncident,confirmIncident,updateConsole,bookingContract,recordEvidence} from './support/recovery-browser.mjs';
test('avería terminal: capacidad conjunta, consentimiento, traslado seguro y sustitución preservan el grupo',async({page,browser,baseURL},info)=>{
 test.setTimeout(90000);const audit=await operationEvidence(info.project.name),admin=await browser.newContext(deviceContext(page,baseURL,info)),driver=await browser.newContext(deviceContext(page,baseURL,info));
 try{
  await login(page,'terminal0','/pasajero');const booking=page.locator('.saved-booking');const id=(await booking.locator('code').first().textContent()).trim();
  const a=await admin.newPage(),d=await driver.newPage();await operational(a,'adminH','/administracion','FICTICIO-WEB-0-0');const source=await a.getByLabel('Vehículo autorizado').inputValue();
  await commandClick(a,a.locator('.expected-booking').filter({hasText:'Reserva confirmada'}).getByRole('button',{name:'Registrar abordaje del grupo',exact:true}),'/api/operations/command');await expect(a.locator('.trip-facts')).toContainText('4 abordados observados');const before=await audit.read(source);
  await operational(d,'driver0','/chofer','FICTICIO-WEB-0-0');await commandClick(d,d.getByRole('button',{name:'Reportar avería ficticia observada',exact:true}),'/api/operations/command');await expect(d.getByRole('button',{name:'Registrar salida',exact:true})).toBeDisabled();
  await a.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(a.getByRole('button',{name:'Confirmar incidencia reportada',exact:true})).toBeVisible();await confirmIncident(a);const incidentId=await consoleIncident(a,'FICTICIO-WEB-0-0');
  await expect(a.locator('.recovery-detail')).toContainText('Primera opción autorizada: FICTICIO-RESCATE-ORIGEN');const candidates=await api(a,'/api/recovery/detail',{incidentId});const detail=await candidates.json(),target=detail.candidates[0].tripId;
  // B has incompatible reserved segments; choosing it must not move any group.
  const badOption=await a.getByLabel('Vehículo autorizado').locator('option').filter({hasText:'FICTICIO-WEB-0-1'}).getAttribute('value');
  await booking.getByRole('button',{name:'Consultar incidencia y traslado',exact:true}).click();await expect(page.locator('.passenger-recovery')).toContainText('Terminal: Confirmada');
  await page.getByLabel('Vehículo propuesto',{exact:true}).selectOption(target);await page.getByLabel('Autorizo el traslado de todo mi grupo').check();const c=await commandClick(page,page.getByRole('button',{name:'Registrar mi consentimiento',exact:true}));
  const body={kind:'TERMINAL_REASSIGN',incidentId,targetTripId:target,consentIds:[c.result.consentId],safeTransfer:true,confirmed:true};
  await rejected(a,'/api/recovery/command',{...body,targetTripId:badOption},'NO_COMPATIBLE_TRANSFER',409);await rejected(a,'/api/recovery/command',{...body,safeTransfer:false},'SAFE_TRANSFER_REQUIRED',409);
  expect((await audit.read(source)).bookings).toEqual(before.bookings);expect((await audit.read(target)).bookings).toHaveLength(0);
  await updateConsole(a);await a.locator('.recovery-detail').getByLabel('Grupo de la reserva').check();await a.getByLabel('Declaro el traslado seguro ficticio').check();await a.getByLabel('Confirmo la asignación autorizada').check();const approval=await commandClick(a,a.getByRole('button',{name:'Reasignar reservas de la incidencia',exact:true}));
  expect((await api(a,'/api/recovery/command',approval.body,approval.key)).status()).toBe(200);
  await expect(a.locator('.recovery-detail')).toContainText('4 plazas · FICTICIO-RESCATE-ORIGEN');const after=await audit.read(target),old=await audit.read(source);expect(bookingContract(after)).toEqual(bookingContract(before));expect(after.onboard).toBe(4);expect(after.movements).toEqual(before.movements);expect(old.trip.status).toBe('WITHDRAWN');expect(old.bookings.filter(b=>b.status==='CONFIRMED')).toHaveLength(0);expect(old.journey.filter(e=>e.kind==='TERMINAL_REASSIGNED')).toHaveLength(1);
  await booking.getByRole('button',{name:'Actualizar incidencia y traslado',exact:true}).click();await expect(booking).toContainText('FICTICIO-RESCATE-ORIGEN');await expect(booking).toContainText('Traslado registrado');await expect(booking).toContainText(id);
  await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await d.getByRole('button',{name:'Consultar incidencias',exact:true}).click();await expect(d.locator('.driver-incident')).toContainText('Ya no conduces este servicio');
  await recordEvidence('terminal',info.project.name,'sustituido',{source:old,target:after},a);await recordEvidence('terminal',info.project.name,'pasajero',after,page);
 }finally{await audit.close();await admin.close();await driver.close();}
});
