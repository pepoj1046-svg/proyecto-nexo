import {test,expect} from '@playwright/test';
import {operational} from './support/operation-browser.mjs';
import {operationEvidence} from './support/operation-evidence.mjs';
import {revoke,loginApi} from './support/reservation-browser.mjs';

test('5A3: verified arrival receipt survives failed manifest refresh, which recovers with reads only',async({page},info)=>{
 const audit=await operationEvidence(info.project.name),sent=[];
 try{
  await operational(page,'adminH','/administracion');const tripId=await page.getByLabel('Vehículo autorizado',{exact:true}).inputValue();
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/operations/command')sent.push(r.postDataJSON());});
  await page.route('**/api/operations/snapshot',r=>r.fulfill({status:503,json:{error:'SERVICE_UNAVAILABLE'}}),{times:1});
  await page.locator('.expected-booking').filter({hasText:'Terminal de Yacuiba (ficticia)'}).getByRole('button',{name:'Verificar llegada presencial',exact:true}).click();
  const recovery=page.getByRole('region',{name:'Recuperar actuación pendiente',exact:true});await expect(recovery).toContainText('Recibo recibido; consulta pendiente');
  const committed=await audit.read(tripId);expect(committed.events.filter(e=>e.kind==='VERIFIED')).toHaveLength(1);expect(committed.onboard).toBe(0);
  await recovery.getByRole('button',{name:'Actualizar consulta sin repetir actuación',exact:true}).click();await expect(recovery).toHaveCount(0);
  expect(sent).toHaveLength(1);expect(await audit.read(tripId)).toEqual(committed);await expect(page.locator('.trip-operations')).toContainText('Llegada verificada presencialmente');
 }finally{await audit.close();}
});
test('5A3: A-B-A during manifest refresh is rejected by original CSRF, then recovers by read only',async({page},info)=>{
 const audit=await operationEvidence(info.project.name),sent=[];let status,foreign=[];
 try{
  await operational(page,'adminH','/administracion');const tripId=await page.getByLabel('Vehículo autorizado',{exact:true}).inputValue();
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/operations/command')sent.push(r.postDataJSON());});
  await page.route('**/api/operations/snapshot',async route=>{
   await revoke(page);await loginApi(page,'adminU');
   const s=await(await page.request.get('/api/session')).json();
   const headers={Origin:new URL(page.url()).origin,'X-CSRF-Token':s.csrf};
   const overview=await page.request.post('/api/operations/overview',{headers,data:{view:'ADMIN'}});expect(overview.status()).toBe(200);
   const trips=(await overview.json()).trips;expect(trips.length).toBeGreaterThan(0);
   const control=await page.request.post('/api/operations/snapshot',{headers,data:{view:'ADMIN',tripId:trips[0].tripId}});expect(control.status()).toBe(200);foreign=(await control.json()).bookings.map(b=>b.bookingId);
   const cookie=(await page.context().cookies()).filter(c=>c.name.startsWith('trufis_lab_')).map(c=>c.name+'='+c.value).join('; ');
   const actual=await route.fetch({headers:{...route.request().headers(),cookie}});status=actual.status();expect(await actual.json()).toEqual({error:'CSRF_REQUIRED'});
   await revoke(page);await loginApi(page,'adminH');await route.fulfill({response:actual});
  },{times:1});
  await page.locator('.expected-booking').filter({hasText:'Terminal de Yacuiba (ficticia)'}).getByRole('button',{name:'Registrar abordaje del grupo',exact:true}).click();
  const recovery=page.getByRole('region',{name:'Recuperar actuación pendiente',exact:true});await expect(recovery).toContainText('Recibo recibido; consulta pendiente');expect(status).toBe(403);
  const committed=await audit.read(tripId);await recovery.getByRole('button',{name:'Actualizar consulta sin repetir actuación',exact:true}).click();await expect(recovery).toHaveCount(0);
  expect(sent).toHaveLength(1);expect(await audit.read(tripId)).toEqual(committed);for(const id of foreign)await expect(page.locator('.trip-operations').getByText(id,{exact:true})).toHaveCount(0);
 }finally{await audit.close();}
});
