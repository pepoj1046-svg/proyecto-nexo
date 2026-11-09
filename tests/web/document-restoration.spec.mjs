import{test,expect,chromium}from'@playwright/test';
import{mkdir,writeFile,readFile}from'node:fs/promises';
import{login as panelLogin}from'./support/operation-browser.mjs';
import{prepare,login,intentions}from'./support/reservation-browser.mjs';
import{documentProof,proofHeaders,privateGet,watchDocument}from'./support/document-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
async function sameJar(page){const other=await page.context().newPage();watchDocument(other);return other;}
const cookie=async page=>(await page.context().cookies()).find(c=>c.name.startsWith('trufis_lab_'))?.value;
async function evidence(page,info,name,summary){await mkdir('.local/5a4-b1-evidence',{recursive:true});await page.screenshot({path:`.local/5a4-b1-evidence/${info.project.name}-${name}.png`,fullPage:true});await writeFile(`.local/5a4-b1-evidence/${info.project.name}-${name}.json`,JSON.stringify(summary,null,2));}
test('B1: pagehide masks retained DOM and rejects an in-flight private response; fresh password unlocks',async({page},info)=>{
 await panelLogin(page,'terminal0','/pasajero');const t2=await sameJar(page);let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 try{
  await panelLogin(t2,'viajero9','/pasajero');const original=await page.locator('.saved-booking code').first().textContent();
  await page.route('**/api/reservations/page',async route=>{const actual=await route.fetch();started();await gate;await route.fulfill({response:actual});},{times:1});
  await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await ready;
  // Deterministic lifecycle contract. A separate test records actual Chromium
  // bfcache availability rather than claiming this synthetic event proves it.
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await expect(page.getByRole('region',{name:'Reautenticación tras restaurar la página'})).toBeVisible();await expect(page.getByText(original,{exact:true})).toBeHidden();const done=page.waitForResponse(r=>r.url().endsWith('/api/reservations/page'));release();await done;await page.unroute('**/api/reservations/page');
  expect((await privateGet(t2,'/api/session')).status()).toBe(200);const auth=page.getByRole('region',{name:'Reautenticación tras restaurar la página'});await login(auth,'viajero9');await expect(auth).toBeVisible();await expect(page.getByText(original,{exact:true})).toBeHidden();await login(auth,'terminal0');await expect(auth).toHaveCount(0);
  await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await expect(page.locator('.saved-booking code').first()).toHaveText(original);await evidence(page,info,'document-restoration',{syntheticLifecycle:true,actualBfcache:'separate test',lateResponseDiscarded:true});
 }finally{release?.();await t2.close();}
});

test('B1: real history restoration requires a password; record actual bfcache availability',async({baseURL},info)=>{
 const browser=await chromium.launch({...(process.env.NEXO_BROWSER_EXECUTABLE?{executablePath:process.env.NEXO_BROWSER_EXECUTABLE}:{}),ignoreDefaultArgs:['--disable-back-forward-cache']});
 const context=await browser.newContext({baseURL,viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,userAgent:info.project.use.userAgent});
 try{
  const page=await context.newPage();await page.addInitScript(()=>{window.addEventListener('pageshow',e=>{window.__nexoTestHistoryPersisted=e.persisted;});});
  await panelLogin(page,'terminal0','/pasajero');const own=await page.locator('.saved-booking code').first().textContent();
  await page.goto('/');await page.goBack({waitUntil:'commit'});await expect(page.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();await expect(page.getByText(own,{exact:true})).toBeHidden();
  const persisted=await page.evaluate(()=>window.__nexoTestHistoryPersisted===true);
  const reasons=await page.evaluate(()=>performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.reasons?.map(r=>r.reason)??[]);
  const auth=page.getByRole('region',{name:'Reautenticación tras restaurar la página'});await login(await auth.count()?auth:page,'terminal0');
  if(persisted)await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();
  await expect(page.locator('.saved-booking code').first()).toHaveText(own);
  await evidence(page,info,'actual-history',{actualBfcache:persisted,notRestoredReasons:reasons,passwordRequired:true,backForwardCacheDefaultDisableRemoved:true});
  test.info().annotations.push({type:'bfcache',description:persisted?'Real Chromium bfcache restored and gated':'Chromium reloaded the document; real bfcache restoration not reproduced'});
 }finally{await context.close();await browser.close();}
});

