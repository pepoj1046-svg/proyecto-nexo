import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {directoryEvidence} from './support/directory-evidence.mjs';
import {login,api,rejected,deviceContext} from './support/recovery-browser.mjs';
const labels={DRIVERS:'Choferes y membresías',VEHICLES:'Vehículos registrados',ROUTES:'Rutas y sentidos',POINTS:'Terminales y puntos',FARES:'Tarifas por segmentos'};
async function open(page,label='admin'){
 await login(page,label,'/administracion');const panel=page.locator('.administrative-directory');
 await expect(page.getByLabel('Vehículo autorizado')).toHaveValue('');
 await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();
 await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();return panel;
}
async function traverse(panel,section,expected){
 await panel.getByRole('button',{name:labels[section],exact:true}).click();const nav=panel.getByRole('navigation',{name:'Paginación de '+labels[section]});
 await expect(nav.getByRole('status')).toContainText('Página 1');
 const ids=()=>panel.locator('[data-directory-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-directory-id')));
 const first=await ids();expect(first).toHaveLength(50);const all=[...first],next=nav.getByRole('button',{name:'Siguiente página de '+labels[section],exact:true}),prev=nav.getByRole('button',{name:'Anterior página de '+labels[section],exact:true});
 await next.click();await expect(nav.getByRole('status')).toContainText('Página 2');const second=await ids();
 await prev.click();await expect(nav.getByRole('status')).toContainText('Página 1');expect(await ids()).toEqual(first);
 await next.click();await expect(nav.getByRole('status')).toContainText('Página 2');expect(await ids()).toEqual(second);all.push(...second);let page=2;
 while(await next.isEnabled()){await next.click();await expect(nav.getByRole('status')).toContainText('Página '+ ++page);all.push(...await ids());}
 expect(new Set(all).size).toBe(all.length);expect([...all].sort()).toEqual(expected);
}
test('4A1: member and vehicle directories include entities without trips and paginate safely',async({page},info)=>{
 const audit=await directoryEvidence();try{const before=await audit.snapshot(),association=await audit.association(),panel=await open(page);
  for(const section of['DRIVERS','VEHICLES'])await traverse(panel,section,await audit.expected(association,section));
  await expect(panel).toContainText('Sin viaje activo; aptitud para asignación no comprobada');await expect(page.getByLabel('Vehículo autorizado')).toHaveValue('');
  expect(await audit.snapshot()).toEqual(before);await mkdir('.local/e2e-4a1',{recursive:true});await panel.screenshot({path:`.local/e2e-4a1/vehiculos-${info.project.name}.png`,scale:'css'});
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await audit.close();}
});
test('4A1: routes, actual point profiles and existing fares match PostgreSQL including empty results',async({page},info)=>{
 const audit=await directoryEvidence();try{const before=await audit.snapshot(),association=await audit.association(),panel=await open(page);
  for(const section of['ROUTES','POINTS','FARES'])await traverse(panel,section,await audit.expected(association,section));
  await panel.getByRole('button',{name:'Elegir asociación',exact:true}).click();await panel.getByRole('button',{name:/^Consultar asociación FICTICIO-DIRECTORIO-SIN-REGISTROS/}).click();await expect(panel).toContainText('No hay registros autorizados');
  expect(await audit.snapshot()).toEqual(before);await mkdir('.local/e2e-4a1',{recursive:true});await panel.screenshot({path:`.local/e2e-4a1/vacio-${info.project.name}.png`,scale:'css'});
  await writeFile(`.local/e2e-4a1/consistencia-${info.project.name}.json`,JSON.stringify({businessTablesUnchanged:true,hashes:before,collections:['DRIVERS','VEHICLES','ROUTES','POINTS','FARES'],source:'PostgreSQL READ ONLY witness'},null,2));
 }finally{await audit.close();}
});
test('4A1: restricted roles, loading, failures and revoked sessions never retain stale directory rows',async({page,browser,baseURL},info)=>{
 const contexts=[];try{const panel=await open(page,'adminH');
  await expect(panel).toContainText('Alcance limitado');await rejected(page,'/api/directory/page',{section:'VEHICLES',associationId:await(await api(page,'/api/directory/page',{section:'ASSOCIATIONS'})).json().then(r=>r.items[0].id)},'FORBIDDEN_SCOPE');
  for(const label of['operativo0','driver5','reviewer']){const context=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(context);const p=await context.newPage();await login(p,label,'/administracion');await rejected(p,'/api/directory/page',{section:'ASSOCIATIONS'},'FORBIDDEN');await p.close();}
  let release;const gate=new Promise(resolve=>{release=resolve;});await page.route('**/api/directory/page',async route=>{await gate;await route.continue();});
  await panel.getByRole('button',{name:'Actualizar directorio',exact:true}).click();await expect(panel.getByRole('status')).toContainText('Consultando registros autorizados');await expect(panel.getByRole('button',{name:'Actualizar directorio',exact:true})).toBeDisabled();release();await expect(panel.locator('[data-directory-id]')).toHaveCount(1);await page.unroute('**/api/directory/page');
  await page.route('**/api/directory/page',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SERVICE_UNAVAILABLE'})}),{times:1});
  await panel.getByRole('button',{name:'Actualizar directorio',exact:true}).click();await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.locator('[data-directory-id]')).toHaveCount(0);
  await panel.getByRole('button',{name:'Actualizar directorio',exact:true}).click();await expect(panel.locator('[data-directory-id]')).toHaveCount(1);
  expect((await api(page,'/api/logout',{})).status()).toBe(200);await panel.getByRole('button',{name:'Actualizar directorio',exact:true}).click();await expect(panel.locator('[data-directory-id]')).toHaveCount(0);await expect(panel.getByRole('alert')).toContainText('sesión');
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
