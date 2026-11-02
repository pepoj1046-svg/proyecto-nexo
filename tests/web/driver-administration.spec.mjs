import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {directoryEvidence} from './support/directory-evidence.mjs';
import {login,api,rejected,deviceContext} from './support/recovery-browser.mjs';
async function open(page,label='admin'){
 await login(page,label,'/administracion');const panel=page.locator('.administrative-directory');
 await expect(page.getByLabel('Vehículo autorizado')).toHaveValue('');
 await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();
 await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();return panel;
}

async function driverRow(panel,identity){
 await panel.getByRole('button',{name:'Choferes y membresías',exact:true}).click();
 await expect(panel.getByRole('navigation',{name:'Paginación de Choferes y membresías'}).getByRole('status')).toContainText('Página 1');
 const row=identity.startsWith('FICTICIO-')?panel.locator('[data-directory-id]').filter({hasText:identity}):panel.locator(`[data-directory-id="${identity}"]`);
 for(let i=0;i<3&&await row.count()===0;i++){
  const next=panel.getByRole('button',{name:'Siguiente página de Choferes y membresías',exact:true});expect(await next.isEnabled()).toBe(true);await next.click();await expect(panel.getByRole('navigation',{name:'Paginación de Choferes y membresías'}).getByRole('status')).toContainText('Página '+(i+2));
 }
 await expect(row).toHaveCount(1);return row;
}
async function manage(panel,identity){const row=await driverRow(panel,identity),id=await row.getAttribute('data-directory-id');await row.getByRole('button',{name:/^Gestionar permiso de /}).click();const form=panel.locator('.driver-administration');await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();await expect(form.getByLabel('Motivo administrativo ficticio')).toBeVisible();return{form,id};}
async function confirmation(form){await form.getByLabel('Motivo administrativo ficticio').fill('Revisión administrativa exclusivamente ficticia');await form.getByLabel('Confirmo cambiar únicamente este permiso DRIVER existente y registrar el motivo.').check();}

test('4A2: revoke and restore without a trip, double click, lost committed response and fresh intent preserve real inventory',async({page},info)=>{
 const audit=await directoryEvidence();try{
  const before=await audit.snapshot(true),panel=await open(page),{form,id}=await manage(panel,'FICTICIO-DIRECTORIO-001');
  const button=()=>form.getByRole('button',{name:'Revocar permiso DRIVER existente',exact:true});await expect(button()).toBeDisabled();await confirmation(form);
  const keys=[];page.on('request',r=>{if(r.url().endsWith('/api/driver-admin/command'))keys.push(r.headers()['idempotency-key']);});
  await page.route('**/api/driver-admin/command',async route=>{const r=await route.fetch();expect(r.status()).toBe(200);await route.abort('failed');},{times:1});
  await button().dblclick();await expect(form.getByRole('alert')).toBeVisible();expect((await audit.access(id)).active).toBe(false);expect((await audit.access(id)).events).toHaveLength(1);
  await form.getByRole('button',{name:'Reintentar el mismo cambio de permiso',exact:true}).click();await expect(form).toContainText('Actuación confirmada y auditada');expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect((await audit.access(id)).events).toHaveLength(1);
  for(const name of['Restaurar permiso DRIVER existente','Revocar permiso DRIVER existente','Restaurar permiso DRIVER existente']){await confirmation(form);await form.getByRole('button',{name,exact:true}).click();await expect(form.getByLabel('Motivo administrativo ficticio')).toHaveValue('');await expect(form.getByRole('button',{name:name.startsWith('Restaurar')?'Revocar permiso DRIVER existente':'Restaurar permiso DRIVER existente',exact:true})).toBeVisible();}
  expect(keys).toHaveLength(5);expect(new Set(keys).size).toBe(4);expect((await audit.access(id)).events).toHaveLength(4);expect((await audit.access(id)).active).toBe(true);expect(await audit.snapshot(true)).toEqual(before);await expect(page.getByLabel('Vehículo autorizado')).toHaveValue('');
  await mkdir('.local/e2e-4a2',{recursive:true});await form.screenshot({path:`.local/e2e-4a2/membresia-${info.project.name}.png`,scale:'css'});
  const active=await manage(panel,await audit.driverForVehicle());await expect(active.form).toContainText('Revisión administrativa necesaria');await confirmation(active.form);await expect(active.form.getByRole('button',{name:'Revocar permiso DRIVER existente',exact:true})).toBeDisabled();
  const association=await audit.association(),ctx=await(await api(page,'/api/driver-admin/context',{associationId:association,userRef:active.id})).json(),r=await api(page,'/api/driver-admin/command',{associationId:association,userRef:active.id,enabled:false,revision:ctx.member.revision,reason:'Revisión de servicio ficticio',confirmed:true},randomUUID());expect(r.status()).toBe(200);expect((await r.json()).applied).toBe(false);expect((await audit.access(active.id)).active).toBe(true);expect(await audit.snapshot(true)).toEqual(before);
  await active.form.screenshot({path:`.local/e2e-4a2/revision-${info.project.name}.png`,scale:'css'});expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await audit.close();}
});

test('4A2: synthetic contact, history beyond fifty and association changes never expose stale administration',async({page},info)=>{
 const audit=await directoryEvidence();try{const before=await audit.snapshot(true),panel=await open(page);await panel.getByRole('button',{name:'Gestionar contacto e historial de asociación',exact:true}).click();const form=panel.locator('.driver-administration');await form.getByRole('button',{name:'Consultar estado e historial administrativo',exact:true}).click();
  await form.getByLabel('Código de contacto ficticio').fill('+591000000');await form.getByLabel('Confirmo registrar únicamente un código LAB ficticio.').check();await expect(form.getByRole('button',{name:'Guardar contacto ficticio',exact:true})).toBeDisabled();
  for(const code of['LAB-TERMINAL-4A2','LAB-TERMINAL-4A2-NUEVO']){await form.getByLabel('Código de contacto ficticio').fill(code);await form.getByLabel('Confirmo registrar únicamente un código LAB ficticio.').check();await form.getByRole('button',{name:'Guardar contacto ficticio',exact:true}).click();await expect(form).toContainText('Contacto actual: '+code);await expect(form.getByRole('button',{name:'Guardar contacto ficticio',exact:true})).toBeDisabled();}
  const expected=await audit.historyIds(await audit.association()),seen=[];const nav=form.getByRole('navigation',{name:'Paginación de historial de permisos'});let n=1;
  do{await expect(nav.getByRole('status')).toContainText('Página '+n);seen.push(...await form.locator('[data-admin-event]').evaluateAll(nodes=>nodes.map(x=>x.getAttribute('data-admin-event'))));if(!await nav.getByRole('button',{name:'Siguiente página de historial de permisos',exact:true}).isEnabled())break;await nav.getByRole('button',{name:'Siguiente página de historial de permisos',exact:true}).click();n++;}while(n<4);
  expect(expected.length).toBeGreaterThan(50);expect(seen).toEqual(expected);expect(new Set(seen).size).toBe(seen.length);expect(await audit.snapshot(true)).toEqual(before);
  await mkdir('.local/e2e-4a2',{recursive:true});await form.screenshot({path:`.local/e2e-4a2/historial-${info.project.name}.png`,scale:'css'});
  await panel.getByRole('button',{name:'Elegir asociación',exact:true}).click();await expect(panel.locator('.driver-administration')).toHaveCount(0);await expect(panel).not.toContainText('LAB-TERMINAL-4A2-NUEVO');await panel.getByRole('button',{name:/^Consultar asociación FICTICIO-DIRECTORIO-SIN-REGISTROS/}).click();await expect(panel).not.toContainText('LAB-TERMINAL-4A2-NUEVO');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await audit.close();}
});

test('4A2: scoped and foreign roles cannot use the driver mutation or contact endpoints',async({page,browser,baseURL},info)=>{
 const audit=await directoryEvidence(),contexts=[];try{const panel=await open(page,'adminH'),association=await audit.association(),userRef=await audit.driverForVehicle();await expect(panel.getByRole('button',{name:'Gestionar contacto e historial de asociación',exact:true})).toHaveCount(0);
  await rejected(page,'/api/driver-admin/context',{associationId:association,userRef},'FORBIDDEN_SCOPE');
  for(const label of['operativo0','driver5','reviewer']){const context=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(context);const p=await context.newPage();await login(p,label,'/administracion');await rejected(p,'/api/driver-admin/context',{associationId:association,userRef},'FORBIDDEN');await rejected(p,'/api/driver-admin/contact',{associationId:association,contactCode:'LAB-NO',confirmed:true},'FORBIDDEN');}
 }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
