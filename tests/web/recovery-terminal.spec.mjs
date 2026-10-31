import {test,expect} from '@playwright/test';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick,consoleIncident,confirmIncident,updateConsole,bookingContract,recordEvidence} from './support/recovery-browser.mjs';
test('avería terminal: capacidad conjunta, consentimiento, traslado seguro y sustitución preservan el grupo',async({page,browser,baseURL},info)=>{
 test.setTimeout(90000);const audit=await operationEvidence(info.project.name),admin=await browser.newContext(deviceContext(page,baseURL,info)),driver=await browser.newContext(deviceContext(page,baseURL,info));
 try{
  await login(page,'terminal0','/pasajero');const booking=page.locator('.saved-booking');const id=(await booking.locator('code').first().textContent()).trim();
  const a=await admin.newPage(),d=await driver.newPage();await operational(a,'adminH','/administracion','FICTICIO-WEB-0-0');const source=await a.getByLabel('Vehículo autorizado').inputValue();
  await commandClick(a,a.locator('.expected-booking').filter({hasText:'Reserva confirmada'}).getByRole('button',{name:'Registrar abordaje del grupo',exact:true}),'/api/operations/command');await expect(a.locator('.trip-facts')).toContainText('4 abordados observados');const before=await audit.read(source);
  await operational(d,'driver0','/chofer','FICTICIO-WEB-0-0');
  // A successful write starts a separate read. Hold that real read to prove the
  // loading boundary, then assert the disabled control only after its response.
  let release,readStarted;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{readStarted=r;});let delayed=true;
  await d.route('**/api/operations/snapshot',async route=>{if(delayed){const real=await route.fetch();readStarted();await gate;await route.fulfill({response:real});}else await route.continue();});
  try{
   const refreshed=d.waitForResponse(r=>r.url().endsWith('/api/operations/snapshot')&&r.request().method()==='POST');
   await commandClick(d,d.getByRole('button',{name:'Reportar falla mecánica',exact:true}),'/api/operations/command');await started;
   await expect(d.locator('.trip-operations button:enabled')).toHaveCount(0);
   delayed=false;release();const response=await refreshed;expect(response.status(),JSON.stringify({error:(await response.json()).error})).toBe(200);
   await expect(d.getByRole('button',{name:'Registrar salida',exact:true})).toBeDisabled();
  }finally{delayed=false;release();await d.unroute('**/api/operations/snapshot');}
  await a.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(a.getByRole('button',{name:'Confirmar incidencia reportada',exact:true})).toBeVisible();await confirmIncident(a);const incidentId=await consoleIncident(a,'FICTICIO-WEB-0-0');
  await expect(a.locator('.recovery-detail')).toContainText('Primera opción autorizada: FICTICIO-RESCATE-ORIGEN');const candidates=await api(a,'/api/recovery/detail',{incidentId});const detail=await candidates.json(),target=detail.candidates[0].tripId;
  // B has incompatible reserved segments; choosing it must not move any group.
  const badOption=await a.getByLabel('Vehículo autorizado').locator('option').filter({hasText:'FICTICIO-WEB-0-1'}).getAttribute('value');
  await booking.getByRole('button',{name:'Consultar incidencia y traslado',exact:true}).click();await expect(page.locator('.passenger-recovery')).toContainText('Terminal: Confirmada');
  await page.getByLabel('Vehículo propuesto',{exact:true}).selectOption(target);await page.getByLabel('Autorizo el traslado de todo mi grupo').check();const c=await commandClick(page,page.getByRole('button',{name:'Registrar mi consentimiento',exact:true}));
  const body={kind:'TERMINAL_REASSIGN',incidentId,targetTripId:target,consentIds:[c.result.consentId],safeTransfer:true,confirmed:true};
  await rejected(a,'/api/recovery/command',{...body,targetTripId:badOption},'NO_COMPATIBLE_TRANSFER',409);await rejected(a,'/api/recovery/command',{...body,safeTransfer:false},'SAFE_TRANSFER_REQUIRED',409);
  expect((await audit.read(source)).bookings).toEqual(before.bookings);expect((await audit.read(target)).bookings).toHaveLength(0);
  await updateConsole(a);await a.locator('.recovery-detail').getByLabel('Grupo de la reserva').check();await a.getByLabel('Confirmo la coordinación humana para trasladar').check();await a.getByLabel('Confirmo la asignación autorizada').check();const approval=await commandClick(a,a.getByRole('button',{name:'Reasignar reservas de la incidencia',exact:true}));
  expect((await api(a,'/api/recovery/command',approval.body,approval.key)).status()).toBe(200);
  await expect(a.locator('.recovery-detail')).toContainText('4 plazas · FICTICIO-RESCATE-ORIGEN');let after=await audit.read(target),old=await audit.read(source);expect(bookingContract(after)).toEqual(bookingContract(before));expect(after.onboard).toBe(0);expect(old.onboard).toBe(4);expect(after.movements).toEqual(before.movements);expect(old.trip.status).toBe('WITHDRAWN');expect(old.bookings.filter(b=>b.status==='CONFIRMED')).toHaveLength(0);expect(old.journey.filter(e=>e.kind==='TERMINAL_REASSIGNED')).toHaveLength(1);
  const receiverContext=await browser.newContext(deviceContext(page,baseURL,info));
  try{
   const receiver=await receiverContext.newPage();await operational(receiver,'driver6','/chofer','FICTICIO-RESCATE-ORIGEN');
   await expect(receiver.getByRole('button',{name:'Registrar salida',exact:true})).toBeDisabled();
   const panel=receiver.locator('.handoff-panel');await panel.getByRole('button',{name:'Consultar recepción de sustitución',exact:true}).click();await expect(panel).toContainText('0/4 personas recibidas');expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(await panel.locator('fieldset').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
   const h=(await(await api(receiver,'/api/safety/handoffs',{tripId:target})).json()).handoffs[0];expect(h.members).toHaveLength(4);
   await rejected(a,'/api/safety/command',{incidentId,version:0,command:'CONFIRM_SAFE',confirmed:true},'RECEIVER_DRIVER_REQUIRED');
   await rejected(receiver,'/api/safety/command',{incidentId,version:0,command:'CONFIRM_SAFE',confirmed:true},'RECEPTION_INCOMPLETE',409);
   await panel.getByLabel('Confirmo que registraré únicamente').check();const first=await commandClick(receiver,panel.getByRole('button',{name:'Recibí integrante 1',exact:true}),'/api/safety/command');
   expect((await api(receiver,'/api/safety/command',first.body,first.key)).status()).toBe(200);
   await expect(panel).toContainText('1/4 personas recibidas');expect((await audit.read(target)).onboard).toBe(1);expect((await audit.read(source)).onboard).toBe(3);
   await rejected(receiver,'/api/safety/command',{...first.body,version:1},'ALREADY_RECEIVED',409);
   await expect(receiver.getByRole('button',{name:'Registrar salida',exact:true})).toBeDisabled();
   await panel.getByLabel('Confirmo que registraré únicamente').check();await commandClick(receiver,panel.getByRole('button',{name:'Registrar recepción de este grupo',exact:true}),'/api/safety/command');
   await expect(panel).toContainText('4/4 personas recibidas');await expect(receiver.getByRole('button',{name:'Registrar salida',exact:true})).toBeDisabled();
   await panel.getByLabel('Confirmo que registraré únicamente').check();await commandClick(receiver,panel.getByRole('button',{name:'Confirmar traslado seguro completado',exact:true}),'/api/safety/command');
   after=await audit.read(target);old=await audit.read(source);expect(after.onboard).toBe(4);expect(old.onboard).toBe(0);expect(after.movements).toEqual(before.movements);expect(after.custody.every(m=>m.received&&m.complete&&m.receiver==='FICTICIO-WEB-driver6')).toBe(true);
   await expect(panel).toContainText('Traslado seguro confirmado por el chofer receptor.');
   await recordEvidence('terminal',info.project.name,'recepcion-confirmada',after,receiver);
  }finally{await receiverContext.close();}
  await booking.getByRole('button',{name:'Actualizar incidencia y traslado',exact:true}).click();await expect(booking).toContainText('FICTICIO-RESCATE-ORIGEN');await expect(booking).toContainText('Traslado registrado');await expect(booking).toContainText(id);
  await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await d.getByRole('button',{name:'Consultar incidencias',exact:true}).click();await expect(d.locator('.driver-incident')).toContainText('Ya no conduces este servicio');
  await recordEvidence('terminal',info.project.name,'sustituido',{source:old,target:after},a);await recordEvidence('terminal',info.project.name,'pasajero',after,page);
 }finally{await audit.close();await admin.close();await driver.close();}
});
