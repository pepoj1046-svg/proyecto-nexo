import {navigate} from './support/navigation.mjs';
import {mkdir,readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {login,api} from './support/recovery-browser.mjs';
import {directoryEvidence} from './support/directory-evidence.mjs';

test('4A2/5A3: stale rejection allows a new intent but a known receipt recovers with reads only',async({page},info)=>{
 const audit=await directoryEvidence();try{
  await login(page,'admin','/administracion');await navigate(page,'Buscar viaje');await navigate(page,'Administración');const panel=page.locator('.administrative-directory');await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();await panel.getByRole('button',{name:'Choferes y membresías',exact:true}).click();await expect(panel.getByRole('navigation',{name:'Paginación de Choferes y membresías'}).getByRole('status')).toContainText('Página 1');
  const row=panel.locator('[data-directory-id]').filter({hasText:/FICTICIO-DIRECTORIO-00[135]/}).first(),id=await row.getAttribute('data-directory-id'),associationId=await audit.association();await row.getByRole('button',{name:/Gestionar permiso de /}).click();const form=panel.locator('.driver-administration');await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();
  const confirm=async()=>{await form.getByLabel('Motivo administrativo ficticio').fill('Revisión concurrente ficticia');await form.getByLabel('Confirmo cambiar únicamente este permiso DRIVER existente y registrar el motivo.').check();};
  await expect(form).toContainText('DRIVER activo');const ctx=await(await api(page,'/api/driver-admin/context',{associationId,userRef:id})).json();
  // Another authorized operation commits after the mounted form took its view.
  expect((await api(page,'/api/driver-admin/command',{associationId,userRef:id,enabled:false,revision:ctx.member.revision,reason:'Otra actuación administrativa ficticia',confirmed:true},randomUUID())).status()).toBe(200);
  const keys=[];page.on('request',r=>{if(r.url().endsWith('/api/driver-admin/command'))keys.push(r.headers()['idempotency-key']);});
  await confirm();await form.getByRole('button',{name:'Revocar permiso DRIVER existente',exact:true}).click();await expect(form.getByRole('alert')).toContainText('La membresía cambió');await expect(form.getByRole('button',{name:'Reintentar el mismo cambio de permiso',exact:true})).toHaveCount(0);
  await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();await expect(form).toContainText('DRIVER inactivo');
  // This POST commits, but the subsequent read fails. A read error is not a
  // rejected mutation; its key/body/receipt survive a manual query. 5A.3
  // strengthens recovery: no second POST is needed once its receipt was received.
  await page.route('**/api/driver-admin/context',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"FORBIDDEN"}'}),{times:1});
  await confirm();await form.getByRole('button',{name:'Restaurar permiso DRIVER existente',exact:true}).click();await expect(form.getByRole('alert')).toBeVisible();expect((await audit.access(id)).active).toBe(true);expect((await audit.access(id)).events).toHaveLength(2);
  await expect(panel.getByRole('button',{name:'Actualizar directorio',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeDisabled();
  await navigate(page,'Plataforma');await expect(form).toBeVisible();await expect(page).toHaveURL(/\/administracion$/);
  await page.evaluate(()=>new Promise(resolve=>{window.addEventListener('popstate',()=>resolve(null),{once:true});history.back();}));await expect(page).toHaveURL(/\/administracion$/);await expect(form).toBeVisible();
  await mkdir('.local/e2e-4a6',{recursive:true});await page.screenshot({path:`.local/e2e-4a6/intento-protegido-${info.project.name}.png`,fullPage:true});
  await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();await expect(form).toContainText('DRIVER activo');await form.getByRole('button',{name:'Reintentar el mismo cambio de permiso',exact:true}).click();await expect(form).toContainText('Actuación confirmada y auditada');expect(keys).toHaveLength(2);expect(keys[0]).not.toBe(keys[1]);expect((await audit.access(id)).events).toHaveLength(2);
  await confirm();await form.getByRole('button',{name:'Revocar permiso DRIVER existente',exact:true}).click();await expect(form).toContainText('DRIVER inactivo');expect(keys).toHaveLength(3);expect(keys[2]).not.toBe(keys[1]);expect((await audit.access(id)).events).toHaveLength(3);
 }finally{await audit.close();}
});

test('4A6: uncertain contact keeps its form across directory, global navigation and logout until exact retry',async({page})=>{
 const audit=await directoryEvidence();let releaseLogout=()=>{};try{
  await login(page,'admin','/administracion');const panel=page.locator('.administrative-directory');await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();await panel.getByRole('button',{name:'Gestionar contacto e historial de asociación',exact:true}).click();const form=panel.locator('.driver-administration');await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();
  const before=await audit.historyIds(await audit.association()),requests=[];page.on('request',r=>{if(r.url().endsWith('/api/driver-admin/contact'))requests.push({key:r.headers()['idempotency-key'],body:r.postData()});});
  await form.getByLabel('Código de contacto ficticio').fill('LAB-AUDIT-RETRY');await form.getByLabel('Confirmo registrar únicamente un código LAB ficticio.').check();await page.route('**/api/driver-admin/contact',async route=>{const result=await route.fetch();expect(result.status()).toBe(200);await route.abort();},{times:1});await form.getByRole('button',{name:'Guardar contacto ficticio',exact:true}).click();await expect(form.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('button',{name:'Elegir asociación',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Actualizar operación',exact:true})).toBeDisabled();
  await page.getByRole('link',{name:'Trufis Bolivia, inicio',exact:true}).click();await expect(form).toBeVisible();await expect(page).toHaveURL(/\/administracion$/);
  expect((await api(page,'/api/logout',{})).status()).toBe(200);await form.getByRole('button',{name:'Reintentar el mismo contacto',exact:true}).click();
  const recovery=page.getByRole('region',{name:'Recuperar intento administrativo'});await expect(recovery).toBeVisible();await expect(form).toBeHidden();const accounts=JSON.parse(await readFile(process.env.NEXO_WEB_CREDENTIALS_FILE,'utf8')).accounts;
  for(const label of['operativo0','admin']){await recovery.getByLabel('Usuario ficticio',{exact:true}).fill(accounts[label].login);await recovery.getByLabel('Contraseña de prueba',{exact:true}).fill(accounts[label].password);await recovery.getByRole('button',{name:'Iniciar sesión',exact:true}).click();if(label==='operativo0'){await expect(page.getByRole('alert').filter({hasText:'Esta cuenta no corresponde'})).toBeVisible();await expect(form).toBeHidden();}}
  await expect(recovery).toHaveCount(0);await expect(form).toBeVisible();
  await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();await expect(form).toContainText('Contacto actual: LAB-AUDIT-RETRY');await form.getByRole('button',{name:'Reintentar el mismo contacto',exact:true}).click();await expect(form).toContainText('Actuación confirmada y auditada');expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect((await audit.historyIds(await audit.association())).length).toBe(before.length+1);await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeEnabled();
  const held=new Promise(resolve=>{releaseLogout=resolve;});await page.route('**/api/logout',async route=>{await held;await route.continue();},{times:1});await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(form.getByRole('button',{name:'Guardar contacto ficticio',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Elegir asociación',exact:true})).toBeDisabled();releaseLogout();await expect(page.locator('.lab-login')).toBeVisible();
 }finally{releaseLogout();await audit.close();}
});
