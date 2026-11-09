import{test,expect}from'@playwright/test';
import{mkdir,writeFile}from'node:fs/promises';
import{login as panelLogin}from'./support/operation-browser.mjs';
import{prepare,login,intentions}from'./support/reservation-browser.mjs';
import{documentProof,proofHeaders,privateGet,watchDocument}from'./support/document-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
async function sameJar(page){const other=await page.context().newPage();watchDocument(other);return other;}
const cookie=async page=>(await page.context().cookies()).find(c=>c.name.startsWith('trufis_lab_'))?.value;
async function evidence(page,info,name,summary){await mkdir('.local/5a4-b1-evidence',{recursive:true});await page.screenshot({path:`.local/5a4-b1-evidence/${info.project.name}-${name}.png`,fullPage:true});await writeFile(`.local/5a4-b1-evidence/${info.project.name}-${name}.json`,JSON.stringify(summary,null,2));}
test('B1: same cookie jar, separate accounts; reload, login and logout in T2 preserve T1',async({page},info)=>{
 await panelLogin(page,'operativo0','/pasajero');const own=await page.locator('.saved-booking code').first().textContent(),proof1={...documentProof(page)},handle=await cookie(page),t2=await sameJar(page);
 try{
  await panelLogin(t2,'operativo1','/pasajero');await expect(t2.locator('.saved-booking')).toHaveCount(1);expect(documentProof(t2).accountRef).not.toBe(proof1.accountRef);expect(documentProof(t2).documentId).not.toBe(proof1.documentId);expect(await cookie(t2)).toBe(handle);
  await expect(t2.getByText(own,{exact:true})).toHaveCount(0);await t2.reload();await expect(t2.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();await expect(t2.locator('.saved-booking')).toHaveCount(0);
  expect((await(await privateGet(page,'/api/session')).json()).accountRef).toBe(proof1.accountRef);await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await expect(page.locator('.saved-booking code').first()).toHaveText(own);
  await login(t2,'operativo0');await expect(t2.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();await t2.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(t2.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();expect(await cookie(t2)).toBe(handle);
  expect((await(await privateGet(page,'/api/session')).json()).accountRef).toBe(proof1.accountRef);expect(documentProof(page).csrf).toBe(proof1.csrf);
  await evidence(page,info,'independent-documents',{sameBrowserContext:page.context()===t2.context(),stableContainer:true,t1AuthorizedAfterT2ReloadLoginLogout:true});
 }finally{await t2.close();}
});
test('B1: cookie and selector alone cannot obtain authenticated proof or use legacy private GET',async({page})=>{
 await panelLogin(page,'operativo0','/pasajero');const original={...documentProof(page)},headers=proofHeaders(page),t2=await sameJar(page);
 try{
  const anon=await(await page.request.get('/api/session')).json();expect(anon.authenticated).toBe(false);expect(anon.documentId).not.toBe(original.documentId);expect(anon.csrf).not.toBe(original.csrf);expect(anon.accountRef).toBeUndefined();
  for(const path of['/api/session','/api/passenger/bookings','/api/operator/offers']){
   const r=await t2.request.get(path,{headers:{...headers,'X-CSRF-Token':''}});expect(r.status()).toBe(403);expect(await r.json()).toEqual({error:'CSRF_REQUIRED'});
  }
  expect((await t2.request.get('/api/passenger/bookings')).status()).toBe(401);
  expect((await t2.request.get('/api/session',{headers:{...headers,'X-Nexo-Generation':'999'}})).status()).toBe(401);
  expect((await t2.request.post('/api/login',{headers:{Origin:new URL(page.url()).origin,...headers,'X-CSRF-Token':anon.csrf},data:{login:'no-real-user',password:'not-a-real-password'}})).status()).toBe(403);
  expect((await(await privateGet(page,'/api/session')).json()).accountRef).toBe(original.accountRef);
 }finally{await t2.close();}
});
test('B1: post-COMMIT response loss survives another tab reload/login/logout; exact manual replay',async({page},info)=>{
 const audit=await reservationEvidence(),t2=await sameJar(page);try{
  const form=await prepare(page,'viajero0'),sent=intentions(page);let committed;
  await page.route('**/api/reservations',async route=>{
   const actual=await route.fetch();expect(actual.status()).toBe(200);committed=await audit.snapshot(sent[0].key);expect(committed.actions).toHaveLength(1);expect(committed.bookings).toHaveLength(1);expect(committed.overCapacity).toEqual([]);
   await panelLogin(t2,'operativo1','/pasajero');await t2.reload();await login(t2,'operativo0');await expect(t2.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();await t2.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(t2.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();await route.abort('failed');
  },{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);expect(await audit.snapshot(sent[0].key)).toEqual(committed);
  await evidence(page,info,'post-commit-loss',{sameBrowserContext:page.context()===t2.context(),identicalKeyAndBody:true,unchangedDatabase:committed});
 }finally{await t2.close();await audit.close();}
});
test('B1: known receipt retains read-only recovery while T2 changes authentication',async({page},info)=>{
 const audit=await reservationEvidence(),t2=await sameJar(page);try{
  const form=await prepare(page,'viajero1'),sent=intentions(page);
  await page.route('**/api/reservations/page',r=>r.fulfill({status:503,json:{error:'SERVICE_UNAVAILABLE'}}),{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Fallo de actualización');const before=await audit.snapshot(sent[0].key);
  await panelLogin(t2,'operativo1','/pasajero');await t2.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(t2.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
  await form.getByRole('button',{name:'Consultar mis reservas sin reenviar',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(1);expect(await audit.snapshot(sent[0].key)).toEqual(before);
  await evidence(page,info,'receipt-read-only',{businessPosts:sent.length,unchangedDatabase:before});
 }finally{await t2.close();await audit.close();}
});
test('B1: pagehide masks retained DOM and rejects an in-flight private response; fresh password unlocks',async({page},info)=>{
 await panelLogin(page,'operativo0','/pasajero');const t2=await sameJar(page);let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 try{
  await panelLogin(t2,'operativo1','/pasajero');const original=await page.locator('.saved-booking code').first().textContent();
  await page.route('**/api/reservations/page',async route=>{const actual=await route.fetch();started();await gate;await route.fulfill({response:actual});},{times:1});
  await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await ready;
  // Deterministic lifecycle contract. A separate test records actual Chromium
  // bfcache availability rather than claiming this synthetic event proves it.
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await expect(page.getByRole('region',{name:'Reautenticación tras restaurar la página'})).toBeVisible();await expect(page.getByText(original,{exact:true})).toBeHidden();const done=page.waitForResponse(r=>r.url().endsWith('/api/reservations/page'));release();await done;await page.unroute('**/api/reservations/page');
  expect((await privateGet(t2,'/api/session')).status()).toBe(200);const auth=page.getByRole('region',{name:'Reautenticación tras restaurar la página'});await login(auth,'operativo1');await expect(auth).toBeVisible();await expect(page.getByText(original,{exact:true})).toBeHidden();await login(auth,'operativo0');await expect(auth).toHaveCount(0);
  await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await expect(page.locator('.saved-booking code').first()).toHaveText(original);await evidence(page,info,'document-restoration',{syntheticLifecycle:true,actualBfcache:'separate test',lateResponseDiscarded:true});
 }finally{release?.();await t2.close();}
});
