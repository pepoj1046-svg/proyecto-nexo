import{test,expect,chromium}from'@playwright/test';
import{mkdir,writeFile,readFile}from'node:fs/promises';
import{login as panelLogin}from'./support/operation-browser.mjs';
import{prepare,login,intentions}from'./support/reservation-browser.mjs';
import{documentProof,proofHeaders,privateGet,watchDocument}from'./support/document-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
async function sameJar(page){const other=await page.context().newPage();watchDocument(other);return other;}
const cookie=async page=>(await page.context().cookies()).find(c=>c.name.startsWith('trufis_lab_'))?.value;
async function evidence(page,info,name,summary){await mkdir('.local/5a4-b1-evidence',{recursive:true});await page.screenshot({path:`.local/5a4-b1-evidence/${info.project.name}-${name}.png`,fullPage:true});await writeFile(`.local/5a4-b1-evidence/${info.project.name}-${name}.json`,JSON.stringify(summary,null,2));}
test('B1: post-COMMIT response loss survives another tab reload/login/logout; exact manual replay',async({page},info)=>{
 const audit=await reservationEvidence(),t2=await sameJar(page);try{
  const form=await prepare(page,'viajero0'),sent=intentions(page);let committed;
  await page.route('**/api/reservations',async route=>{
   const actual=await route.fetch();expect(actual.status()).toBe(200);committed=await audit.snapshot(sent[0].key);expect(committed.actions).toHaveLength(1);expect(committed.bookings).toHaveLength(1);expect(committed.overCapacity).toEqual([]);
   await panelLogin(t2,'operativo1','/pasajero');await t2.reload();await login(t2,'operativo0');await expect(t2.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();await t2.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(t2.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();await route.abort('failed');
  },{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});const auth=page.getByRole('region',{name:'Reautenticación tras restaurar la página'});await expect(auth).toBeVisible();await login(auth,'viajero0');await expect(auth).toHaveCount(0);
  await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);expect(await audit.snapshot(sent[0].key)).toEqual(committed);
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
