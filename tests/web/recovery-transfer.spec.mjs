import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick,bookingContract,recordEvidence} from './support/recovery-browser.mjs';
test('traslado anterior a salida: consentimiento del responsable, aprobación real y reintentos concurrentes sin duplicar',async({page,browser,baseURL},info)=>{
 test.setTimeout(90000);const audit=await operationEvidence(info.project.name),admin=await browser.newContext(deviceContext(page,baseURL,info)),driver=await browser.newContext(deviceContext(page,baseURL,info));
 try{
  await login(page,'terminal0','/pasajero');const booking=page.locator('.saved-booking');await expect(booking).toHaveCount(1);const id=(await booking.locator('code').first().textContent()).trim();
  const a=await admin.newPage(),d=await driver.newPage();await operational(a,'adminH','/administracion','FICTICIO-WEB-0-0');const source=await a.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(source);
  await operational(d,'driver6','/chofer','FICTICIO-RESCATE-ORIGEN');const target=await d.getByLabel('Vehículo autorizado').inputValue();
  await booking.getByRole('button',{name:'Consultar incidencia y traslado',exact:true}).click();await expect(page.locator('.passenger-recovery')).toContainText('Vehículo actual: FICTICIO-WEB-0-0');
  await page.getByLabel('Vehículo propuesto',{exact:true}).selectOption(target);await page.getByLabel('Autorizo el traslado de todo mi grupo').check();const consent=await commandClick(page,page.getByRole('button',{name:'Registrar mi consentimiento',exact:true}));
  await rejected(page,'/api/recovery/command',{kind:'APPROVE_TRANSFER',consentId:consent.result.consentId,confirmed:true},'FORBIDDEN');
  await a.getByRole('button',{name:'Consultar traslados del grupo',exact:true}).click();await a.getByLabel('Consentimiento recibido',{exact:true}).selectOption(consent.result.consentId);await a.getByLabel('Confirmo la reasignación de todo el grupo').check();
  const approval=await commandClick(a,a.getByRole('button',{name:'Aprobar traslado del grupo',exact:true}));
  const retries=await Promise.all([api(a,'/api/recovery/command',approval.body,approval.key),api(a,'/api/recovery/command',approval.body,approval.key)]);expect(retries.map(r=>r.status())).toEqual([200,200]);
  await rejected(a,'/api/recovery/command',approval.body,'CONSENT_USED',409);
  const after=await audit.read(target);expect(bookingContract(after)).toEqual(bookingContract(before));expect(after.bookings[0].status).toBe('CONFIRMED');expect(after.trip.departed_at).toBeNull();expect(after.movements).toHaveLength(0);expect((await audit.read(source)).trip.status).toBe('QUEUED');expect((await audit.read(source)).bookings.filter(b=>b.status==='CONFIRMED')).toHaveLength(0);
  await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(d.locator('.trip-operations')).toContainText('Reserva confirmada');await expect(d.locator('.trip-facts')).toContainText('4/6');
  await booking.getByRole('button',{name:'Actualizar incidencia y traslado',exact:true}).click();await expect(booking).toContainText('Vehículo asignado: FICTICIO-RESCATE-ORIGEN');await expect(booking).toContainText('utilizado');await expect(booking.locator('strong').first()).toContainText('Confirmada por administración');await expect(booking).toContainText(id);
  await recordEvidence('traslado',info.project.name,'confirmado',after,page);
 }finally{await audit.close();await admin.close();await driver.close();}
});
