import{test,expect}from'@playwright/test';
import{nativeLab,trackNative,restoreNative}from'./support/native-bfcache.mjs';
import{prepare,login,intentions}from'./support/reservation-browser.mjs';
import{login as panelLogin}from'./support/operation-browser.mjs';
import{privateGet}from'./support/document-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
for(const receiptKnown of[false,true])test(`native bfcache: APP ${receiptKnown?'known receipt restores with reads only':'uncertain COMMIT preserves exact manual replay'}`,async({baseURL},info)=>{
 const lab=await nativeLab(baseURL,info),page=await lab.context.newPage(),t2=await lab.context.newPage(),audit=await reservationEvidence(),track=await trackNative(page);
 try{
  const form=await prepare(page,receiptKnown?'viajero1':'viajero0'),sent=intentions(page);
  await panelLogin(t2,'operativo1','/pasajero');
  if(receiptKnown)await page.route('**/api/reservations/page',r=>r.fulfill({status:503,headers:{'Cache-Control':'no-store'},json:{error:'SERVICE_UNAVAILABLE'}}),{times:1});
  else await page.route('**/api/reservations',async r=>{const actual=await r.fetch();expect(actual.status()).toBe(200);expect(actual.headers()['cache-control']).toBe('no-store');await r.abort('failed');},{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText(receiptKnown?'Fallo de actualización':'Resultado incierto');
  await page.unrouteAll({behavior:'wait'});const before=await audit.snapshot(sent[0].key);expect(before.actions).toHaveLength(1);expect(before.overCapacity).toEqual([]);
  const back=await restoreNative(page,track,info,receiptKnown?'app-receipt':'app-uncertain'),gate=await back();
  expect((await privateGet(t2,'/api/session')).status()).toBe(200);expect(sent).toHaveLength(1);await expect(form).toBeHidden();
  await login(gate,receiptKnown?'viajero1':'viajero0');await expect(gate).toHaveCount(0);expect(sent).toHaveLength(1);
  await form.getByRole('button',{name:receiptKnown?'Consultar mis reservas sin reenviar':'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');
  expect(sent).toHaveLength(receiptKnown?1:2);if(!receiptKnown)expect(sent[1]).toEqual(sent[0]);expect(await audit.snapshot(sent[0].key)).toEqual(before);
 }finally{await audit.close();await lab.close();}
});
