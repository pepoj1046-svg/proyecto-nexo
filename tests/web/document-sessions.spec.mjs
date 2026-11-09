import{test,expect,chromium}from'@playwright/test';
import{mkdir,writeFile,readFile}from'node:fs/promises';
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
test('B1: two cold openings fail closed if bootstrap cookies race; manual login establishes distinct contexts',async({page})=>{
 const t2=await sameJar(page),accounts=JSON.parse(await readFile(process.env.NEXO_WEB_CREDENTIALS_FILE,'utf8')).accounts;
 try{
  const boots=await Promise.all([page.request.get('/api/session'),t2.request.get('/api/session')]);const contexts=await Promise.all(boots.map(r=>r.json()));expect(contexts[0].documentId).not.toBe(contexts[1].documentId);
  const results=await Promise.all(contexts.map((s,i)=>(i?t2:page).request.post('/api/login',{headers:{Origin:process.env.NEXO_WEB_TEST_URL,'X-Nexo-Document':s.documentId,'X-Nexo-Generation':String(s.generation),'X-CSRF-Token':s.csrf},data:accounts[i?'viajero7':'viajero6']})));
  expect(results.map(r=>r.status()).sort()).toEqual([200,401]);const denied=results.find(r=>r.status()===401);expect(await denied.json()).toEqual({error:'AUTHENTICATION_REQUIRED'});
  await panelLogin(page,'viajero6','/pasajero');await panelLogin(t2,'viajero7','/pasajero');expect(documentProof(page).accountRef).not.toBe(documentProof(t2).accountRef);expect((await privateGet(page,'/api/session')).status()).toBe(200);expect((await privateGet(t2,'/api/session')).status()).toBe(200);
 }finally{await t2.close();}
});
