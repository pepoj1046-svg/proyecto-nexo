import{test,expect}from'@playwright/test';
import AxeBuilder from'@axe-core/playwright';
import{mkdir}from'node:fs/promises';
import{operationEvidence}from'./support/operation-evidence.mjs';
import{operational,api,rejected,deviceContext,commandClick}from'./support/recovery-browser.mjs';

test('8B: administrador con alcance completo revoca y restaura un permiso existente; la sesión abierta del chofer pierde operaciones',async({page,browser,baseURL},info)=>{
 const audit=await operationEvidence(info.project.name),context=await browser.newContext(deviceContext(page,baseURL,info));
 try{
  await operational(page,'admin','/administracion');const d=await context.newPage();await operational(d,'driver5','/chofer');const tripId=await page.getByLabel('Vehículo autorizado',{exact:true}).inputValue(),before=await audit.read(tripId),own=before.bookings[0].id;
  const accounts=page.locator('.care-accounts'),open=()=>accounts.getByRole('button',{name:'Consultar accesos del chofer',exact:true}).click();await open();await expect(accounts.getByRole('button',{name:'Revocar acceso del chofer',exact:true})).toBeDisabled();await accounts.getByLabel('Confirmo el cambio sensible de acceso del chofer').check();const revoke=await commandClick(page,accounts.getByRole('button',{name:'Revocar acceso del chofer',exact:true}),'/api/care/command');expect(revoke.result.active).toBe(false);expect((await api(page,'/api/care/command',revoke.body,revoke.key)).status()).toBe(200);
  await rejected(d,'/api/care/context',{bookingId:own},'FORBIDDEN');await rejected(d,'/api/operations/snapshot',{view:'DRIVER',tripId},'FORBIDDEN');const updated=d.waitForResponse(r=>r.url().endsWith('/api/operations/overview'));await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();expect((await updated).status()).toBe(403);await expect(d.locator('.trip-operations')).toHaveCount(0);await expect(d.getByRole('alert')).toContainText('permiso');
  const revoked=await audit.read(tripId);expect(revoked.care.access.find(m=>m.role==='DRIVER').active).toBe(false);expect(revoked.care.accessEvents.filter(e=>e.action==='CARE_DRIVER_ACCESS_CHANGED')).toHaveLength(1);await open();await expect(accounts).toContainText('Acceso revocado');await mkdir('.local/e2e-incremento-8b',{recursive:true});await accounts.screenshot({path:`.local/e2e-incremento-8b/cuentas-revocacion-${info.project.name}.png`,scale:'css'});await accounts.getByLabel('Confirmo el cambio sensible de acceso del chofer').check();const restore=await commandClick(page,accounts.getByRole('button',{name:'Restaurar acceso existente del chofer',exact:true}),'/api/care/command');expect(restore.result.active).toBe(true);expect((await api(d,'/api/care/context',{bookingId:own})).status()).toBe(200);
  const after=await audit.read(tripId);for(const field of['trip','bookings','segments','movements','events','custody'])expect(after[field]).toEqual(before[field]);expect(after.care.access.find(m=>m.role==='DRIVER').active).toBe(true);expect(after.care.accessEvents.filter(e=>e.action==='CARE_DRIVER_ACCESS_CHANGED')).toHaveLength(2);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await audit.close();await context.close();}
});
