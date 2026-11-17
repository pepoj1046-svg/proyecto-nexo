import{test,expect}from'@playwright/test';
import{nativeLab,trackNative,restoreNative}from'./support/native-bfcache.mjs';
import{login as panelLogin}from'./support/operation-browser.mjs';
import{login}from'./support/reservation-browser.mjs';
import{privateGet}from'./support/document-browser.mjs';
import{operationEvidence}from'./support/operation-evidence.mjs';
test('native bfcache: delayed real HTTP reply remains hidden through A-B-A while the other tab stays authorized',async({baseURL},info)=>{
 const lab=await nativeLab(baseURL,info),page=await lab.context.newPage(),t2=await lab.context.newPage(),track=await trackNative(page),audit=await operationEvidence(info.project.name),writes=[];let release,ready;
 const delivery=new Promise(r=>release=r),started=new Promise(r=>ready=r);
 try{
  await panelLogin(page,'operativo0','/pasajero');await panelLogin(t2,'operativo1','/pasajero');const own=await page.locator('.saved-booking code').first().textContent(),before=await audit.read();
  page.on('request',r=>{if(['/api/reservations','/api/operations/command'].includes(new URL(r.url()).pathname))writes.push(r);});
  await page.route('**/api/reservations/page',async route=>{const actual=await route.fetch();expect(actual.status()).toBe(200);expect(actual.headers()['cache-control']).toBe('no-store');ready(route.request());await delivery;await route.fulfill({response:actual});},{times:1});
  await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();const oldRequest=await started;
  const back=await restoreNative(page,track,info,'late-response'),gate=await back();await expect(page.getByText(own,{exact:true})).toBeHidden();
  await login(gate,'viajero9');await expect(gate).toBeVisible();const oldResponse=page.waitForResponse(r=>r.request()===oldRequest);release();await(await oldResponse).finished();await page.unrouteAll({behavior:'wait'});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await expect(gate).toBeVisible();await expect(page.getByText(own,{exact:true})).toBeHidden();expect((await privateGet(t2,'/api/session')).status()).toBe(200);
  await login(gate,'operativo0');await expect(gate).toHaveCount(0);await expect(page.locator('.saved-booking code').first()).toHaveText(own);expect(writes).toHaveLength(0);expect(await audit.read()).toEqual(before);
 }finally{release?.();await audit.close();await lab.close();}
});
