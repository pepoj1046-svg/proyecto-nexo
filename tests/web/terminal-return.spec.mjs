import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick} from './support/recovery-browser.mjs';

test('retorno: tres roles, descensos explícitos, decisión voluntaria, dos solicitudes concurrentes y una nueva entrada al final',async({page,browser,baseURL},info)=>{
  test.setTimeout(120000);const audit=await operationEvidence(info.project.name),contexts=[];
  const context=async()=>{const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);return c;};
  try{
    await operational(page,'driver5','/chofer');const source=await page.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(source);expect(before.onboard).toBe(6);
    const a=await(await context()).newPage(),p=await(await context()).newPage();await operational(a,'adminR','/administracion');await login(p,'operativo0','/pasajero');
    await commandClick(page,page.getByRole('button',{name:'Registrar llegada final Terminal Villa Montes (ficticia)',exact:true}),'/api/operations/command');await expect(page.locator('.trip-operations h2').first()).toContainText('Viaje finalizado');
    await page.getByRole('button',{name:'Consultar fila de destino',exact:true}).click();await expect(page.locator('.return-queue')).toContainText('Registra los descensos observados');await expect(page.getByRole('button',{name:'Solicitar incorporación a destino',exact:true})).toHaveCount(0);
    const options=await api(page,'/api/terminal/return-options',{tripId:source}),body=await options.json(),routeId=body.routes[0].id;
    await rejected(page,'/api/terminal/command',{kind:'RETURN_QUEUE',tripId:source,routeId,confirmed:true},'PASSENGERS_ONBOARD',409);await rejected(p,'/api/terminal/command',{kind:'RETURN_QUEUE',tripId:source,routeId,confirmed:true},'FORBIDDEN');await rejected(a,'/api/terminal/command',{kind:'RETURN_QUEUE',tripId:source,routeId,confirmed:true},'FORBIDDEN');
    for(const name of ['Terminal de Yacuiba (ficticia)','Parada Palmar (ficticia)'])await commandClick(page,page.locator('.expected-booking').filter({hasText:name}).getByRole('button',{name:'Registrar descenso del grupo',exact:true}),'/api/operations/command');
    await page.getByRole('button',{name:'Consultar fila de destino',exact:true}).click();await expect(page.getByLabel('Fila de destino',{exact:true})).toBeVisible();await page.getByLabel('Fila de destino',{exact:true}).selectOption(routeId);await page.getByLabel('Solicito voluntariamente incorporarme').check();
    let finish;const raced=new Promise(resolve=>{finish=resolve;});let once=true;
    await page.route('**/api/terminal/command',async route=>{
      if(once&&route.request().postDataJSON().kind==='RETURN_QUEUE'){once=false;const [original,competitor]=await Promise.all([route.fetch(),api(page,'/api/terminal/command',route.request().postDataJSON(),randomUUID())]);
        const result={statuses:[original.status(),competitor.status()],responses:[await original.json(),await competitor.json()],originalKey:route.request().headers()['idempotency-key']};await route.fulfill({response:original});finish(result);
      }else await route.continue();
    });
    await page.getByRole('button',{name:'Solicitar incorporación a destino',exact:true}).click();const race=await raced;expect([...race.statuses].sort()).toEqual([200,409]);expect(race.responses.some(r=>r.error==='ALREADY_ACTIVE')).toBe(true);await page.unroute('**/api/terminal/command');const receipt=race.responses.find(r=>r.tripId),newTrip=receipt.tripId;
    // If the competing request won, consult the committed assignment explicitly.
    if(race.statuses[0]===409){await page.getByRole('button',{name:'Actualizar operación',exact:true}).click();await page.getByLabel('Vehículo autorizado').selectOption(newTrip);}
    await expect(page.locator('.trip-operations h2').first()).toContainText('En fila');expect(Number(receipt.position)).toBe(2);
    const after=await audit.read(newTrip),old=await audit.read(source);expect(after.trip.status).toBe('QUEUED');expect(after.trip.departed_at).toBeNull();expect(after.onboard).toBe(0);expect(after.bookings).toHaveLength(0);expect(after.trip.vehicle_id).toBe(before.trip.vehicle_id);expect(old.trip.status).toBe('COMPLETED');expect(old.onboard).toBe(0);expect(old.bookings.map(b=>b.price_bob)).toEqual(before.bookings.map(b=>b.price_bob));expect(after.audits.filter(e=>e.action==='QUEUE_REQUESTED')).toHaveLength(1);
    await p.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await expect(p.locator('.saved-booking')).toContainText('Viaje finalizado');await expect(p.locator('.saved-booking')).toContainText('Bs 140');
    await a.getByRole('button',{name:'Consultar vehículos y filas',exact:true}).click();await a.getByLabel('Filtrar ruta y asociación').selectOption(routeId);await expect(a.locator('.fleet-card')).toHaveCount(2);await expect(a.locator('.fleet-card').filter({hasText:'FICTICIO-OPERATIVO'})).toContainText('posición registrada 2');
    await a.getByLabel('Filtrar ruta y asociación').selectOption('');await expect(a.getByRole('button',{name:'Página siguiente',exact:true})).toBeEnabled();await a.getByRole('button',{name:'Página siguiente',exact:true}).click();await expect(a.locator('.fleet-directory')).toContainText('Página 2');
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await mkdir('.local/e2e-incremento-5',{recursive:true});await page.locator('.trip-operations').screenshot({scale:'css',path:`.local/e2e-incremento-5/retorno-${info.project.name}.png`});await writeFile(`.local/e2e-incremento-5/retorno-${info.project.name}.json`,JSON.stringify({source:old,target:after,statuses:race.statuses},null,2));
  }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
