import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {login,api} from './support/recovery-browser.mjs';
import {directoryEvidence} from './support/directory-evidence.mjs';

test('4A2: a definitively stale attempt can be replaced but a committed POST with failed refresh keeps its original key',async({page})=>{
 const audit=await directoryEvidence();try{
  await login(page,'admin','/administracion');const panel=page.locator('.administrative-directory');await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();await panel.getByRole('button',{name:'Choferes y membresías',exact:true}).click();await expect(panel.getByRole('navigation',{name:'Paginación de Choferes y membresías'}).getByRole('status')).toContainText('Página 1');
  const row=panel.locator('[data-directory-id]').filter({hasText:/FICTICIO-DIRECTORIO-00[135]/}).first(),id=await row.getAttribute('data-directory-id'),associationId=await audit.association();await row.getByRole('button',{name:/Gestionar permiso de /}).click();const form=panel.locator('.driver-administration');await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();
  const confirm=async()=>{await form.getByLabel('Motivo administrativo ficticio').fill('Revisión concurrente ficticia');await form.getByLabel('Confirmo cambiar únicamente este permiso DRIVER existente y registrar el motivo.').check();};
  await expect(form).toContainText('DRIVER activo');const ctx=await(await api(page,'/api/driver-admin/context',{associationId,userRef:id})).json();
  // Another authorized operation commits after the mounted form took its view.
  expect((await api(page,'/api/driver-admin/command',{associationId,userRef:id,enabled:false,revision:ctx.member.revision,reason:'Otra actuación administrativa ficticia',confirmed:true},randomUUID())).status()).toBe(200);
  const keys=[];page.on('request',r=>{if(r.url().endsWith('/api/driver-admin/command'))keys.push(r.headers()['idempotency-key']);});
  await confirm();await form.getByRole('button',{name:'Revocar permiso DRIVER existente',exact:true}).click();await expect(form.getByRole('alert')).toContainText('La membresía cambió');await expect(form.getByRole('button',{name:'Reintentar el mismo cambio de permiso',exact:true})).toHaveCount(0);
  await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();await expect(form).toContainText('DRIVER inactivo');
  // This POST commits, but the subsequent read fails. A read error is not a
  // rejected mutation; its key/body must survive even after a manual reload.
  await page.route('**/api/driver-admin/context',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"FORBIDDEN"}'}),{times:1});
  await confirm();await form.getByRole('button',{name:'Restaurar permiso DRIVER existente',exact:true}).click();await expect(form.getByRole('alert')).toBeVisible();expect((await audit.access(id)).active).toBe(true);expect((await audit.access(id)).events).toHaveLength(2);
  await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();await expect(form).toContainText('DRIVER activo');await form.getByRole('button',{name:'Reintentar el mismo cambio de permiso',exact:true}).click();await expect(form).toContainText('Actuación confirmada y auditada');expect(keys).toHaveLength(3);expect(keys[0]).not.toBe(keys[1]);expect(keys[1]).toBe(keys[2]);expect((await audit.access(id)).events).toHaveLength(2);
  await confirm();await form.getByRole('button',{name:'Revocar permiso DRIVER existente',exact:true}).click();await expect(form).toContainText('DRIVER inactivo');expect(keys).toHaveLength(4);expect(keys[3]).not.toBe(keys[2]);expect((await audit.access(id)).events).toHaveLength(3);
 }finally{await audit.close();}
});
