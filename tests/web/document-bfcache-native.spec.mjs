import{test,expect}from'@playwright/test';
import{nativeLab,trackNative,restoreNative}from'./support/native-bfcache.mjs';
import{login as panelLogin}from'./support/operation-browser.mjs';
import{prepare,login,intentions}from'./support/reservation-browser.mjs';
import{proofHeaders,privateGet}from'./support/document-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
test('native audit: original document restored, old data hidden, other tab retains committed RAM attempt',async({baseURL},info)=>{
 const lab=await nativeLab(baseURL,info),{context}=lab,page=await context.newPage(),t2=await context.newPage(),audit=await reservationEvidence(),track=await trackNative(page);let originalHeaders;
 try{
  await panelLogin(page,'operativo0','/pasajero');const own=await page.locator('.saved-booking code').first().textContent();originalHeaders=proofHeaders(page);
  const form=await prepare(t2,'viajero0'),sent=intentions(t2);await t2.route('**/api/reservations',async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort('failed');},{times:1});await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');const before=await audit.snapshot(sent[0].key);
  const back=await restoreNative(page,track,info,'isolation');expect((await page.request.post('/api/logout',{headers:{Origin:baseURL,...originalHeaders},data:{}})).status()).toBe(200);
  const gate=await back();await expect(page.getByText(own,{exact:true})).toBeHidden();
  expect((await page.request.get('/api/session',{headers:originalHeaders})).status()).toBe(401);expect((await privateGet(t2,'/api/session')).status()).toBe(200);expect(sent).toHaveLength(1);
  await login(gate,'viajero9');await expect(gate).toBeVisible();await expect(page.getByText(own,{exact:true})).toBeHidden();await login(gate,'operativo0');await expect(gate).toHaveCount(0);await expect(page.locator('.saved-booking code').first()).toHaveText(own);
  expect(sent).toHaveLength(1);await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);expect(await audit.snapshot(sent[0].key)).toEqual(before);

 }finally{await audit.close();await lab.close();}
});
