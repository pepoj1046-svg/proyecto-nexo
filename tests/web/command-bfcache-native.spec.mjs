import{test,expect}from'@playwright/test';
import{nativeLab,trackNative,restoreNative}from'./support/native-bfcache.mjs';
import{operational}from'./support/operation-browser.mjs';
import{prepare,login,intentions}from'./support/reservation-browser.mjs';
import{privateGet}from'./support/document-browser.mjs';
import{operationEvidence}from'./support/operation-evidence.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
test('native bfcache: administrative receipt and another tab APP intent survive without automatic commands',async({baseURL},info)=>{
 const lab=await nativeLab(baseURL,info),page=await lab.context.newPage(),t2=await lab.context.newPage(),audit=await operationEvidence(info.project.name),reservations=await reservationEvidence(),track=await trackNative(page),sent=[];
 try{
  await operational(page,'adminH','/administracion');const tripId=await page.getByLabel('Vehículo autorizado',{exact:true}).inputValue();
  const form=await prepare(t2,'viajero0'),appSent=intentions(t2);await t2.route('**/api/reservations',async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort('failed');},{times:1});await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');const appBefore=await reservations.snapshot(appSent[0].key);
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/operations/command')sent.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()});});
  await page.route('**/api/operations/snapshot',r=>r.fulfill({status:503,headers:{'Cache-Control':'no-store'},json:{error:'SERVICE_UNAVAILABLE'}}),{times:1});
  await page.locator('.expected-booking').filter({hasText:'Terminal de Yacuiba (ficticia)'}).getByRole('button',{name:'Verificar llegada presencial',exact:true}).click();const recovery=page.getByRole('region',{name:'Recuperar actuación pendiente',exact:true});await expect(recovery).toContainText('Recibo recibido; consulta pendiente');await page.unrouteAll({behavior:'wait'});
  const before=await audit.read(tripId);expect(before.events.filter(e=>e.kind==='VERIFIED')).toHaveLength(1);expect(before.onboard).toBe(0);
  const back=await restoreNative(page,track,info,'admin-receipt'),gate=await back();expect(sent).toHaveLength(1);expect(appSent).toHaveLength(1);expect((await privateGet(t2,'/api/session')).status()).toBe(200);
  await login(gate,'adminH');await expect(gate).toHaveCount(0);expect(sent).toHaveLength(1);await recovery.getByRole('button',{name:'Actualizar consulta sin repetir actuación',exact:true}).click();await expect(recovery).toHaveCount(0);expect(sent).toHaveLength(1);expect(await audit.read(tripId)).toEqual(before);
  await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(appSent).toHaveLength(2);expect(appSent[1]).toEqual(appSent[0]);expect(await reservations.snapshot(appSent[0].key)).toEqual(appBefore);
 }finally{await reservations.close();await audit.close();await lab.close();}
});
