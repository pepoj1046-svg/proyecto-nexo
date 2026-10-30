import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick,consoleIncident,confirmIncident} from './support/recovery-browser.mjs';

test('terminal: reserva presencial comparte las seis plazas, chofer rechaza, pasajero cancela y administrador rehabilita sin movimientos ficticios',async({page,browser,baseURL},info)=>{
  test.setTimeout(120000);
  const audit=await operationEvidence(info.project.name),contexts=[];
  const context=async()=>{const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);return c;};
  try{
    await login(page,'terminal0','/pasajero');const booking=page.locator('.saved-booking'),own=(await booking.locator('code').first().textContent()).trim();
    await booking.getByRole('button',{name:'Consultar presencia y viaje',exact:true}).click();await expect(booking.getByRole('button',{name:'Ya llegué',exact:true})).toBeVisible();
    const a=await(await context()).newPage(),d=await(await context()).newPage();
    await operational(a,'adminH','/administracion','FICTICIO-WEB-0-0');await operational(d,'driver0','/chofer','FICTICIO-WEB-0-0');
    const tripId=await a.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(tripId);
    await a.getByRole('button',{name:'Consultar vehículos y filas',exact:true}).click();await expect(a.locator('.fleet-directory')).toContainText('FICTICIO-WEB-0-0');await expect(a.locator('.fleet-directory')).not.toContainText('Unión del Sur');
    await a.getByLabel('Filtrar estado del servicio').selectOption('QUEUED');await expect(a.locator('.fleet-card')).toHaveCount(4);
    await a.getByRole('button',{name:'Preparar reserva presencial',exact:true}).click();await a.getByLabel('Plazas del grupo presencial',{exact:true}).fill('2');await commandClick(a,a.getByRole('button',{name:'Revisar importe presencial',exact:true}),'/api/terminal/quote');
    await expect(a.locator('.walk-in-sale')).toContainText('Bs 70');await a.getByLabel('Confirmo todo el grupo, los puntos').check();
    // The first actual server response is lost; the same frozen payload/key is retried.
    let first=true;const attempts=[];await a.route('**/api/terminal/walk-in',async route=>{
      attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
      if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();
    });
    await a.getByRole('button',{name:'Registrar grupo presencial',exact:true}).click();await expect(a.locator('.walk-in-sale [role=alert]')).toContainText('conserva su clave');
    await expect(a.getByLabel('Plazas del grupo presencial')).toBeDisabled();await commandClick(a,a.getByRole('button',{name:'Reintentar la misma reserva presencial',exact:true}),'/api/terminal/walk-in');await a.unroute('**/api/terminal/walk-in');
    expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);await expect(a.locator('.walk-in-sale [role=status]')).toContainText('Reserva presencial registrada');
    const walkIn=(await a.locator('.walk-in-sale code').textContent()).trim();let state=await audit.read(tripId);
    expect(state.bookings.find(b=>b.id===walkIn)).toMatchObject({source:'WALK_IN',seats:2,status:'HELD',price_bob:'70.00'});expect(state.segments.every(s=>s.reserved===6)).toBe(true);expect(state.onboard).toBe(0);expect(state.trip.departed_at).toBeNull();
    await rejected(page,'/api/terminal/command',{kind:'REJECT_OFFER',bookingId:walkIn,confirmed:true},'FORBIDDEN');await rejected(page,'/api/terminal/directory',{},'FORBIDDEN');
    const invalid={...attempts[0].body,seats:1,quote:{...attempts[0].body.quote,totalBOB:'35.00'}};const overflow=await api(a,'/api/terminal/walk-in',invalid,crypto.randomUUID());expect(overflow.status()).toBe(409);expect((await overflow.json()).error).toMatch(/NO_CAPACITY|QUEUE_ORDER/);expect((await audit.read(tripId)).bookings).toEqual(state.bookings);
    await mkdir('.local/e2e-incremento-5',{recursive:true});await a.locator('.walk-in-sale').screenshot({scale:'css',path:`.local/e2e-incremento-5/presencial-${info.project.name}.png`});
    await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();const offered=d.locator('.expected-booking').filter({hasText:walkIn});await expect(offered).toContainText('Presencial');await offered.getByLabel('Confirmo el rechazo de esta oferta').check();const rejection=await commandClick(d,offered.getByRole('button',{name:'Rechazar oferta '+walkIn.slice(0,8),exact:true}),'/api/terminal/command');expect((await api(d,'/api/terminal/command',rejection.body,rejection.key)).status()).toBe(200);
    await booking.getByLabel('Solicito cancelar todo mi grupo').check();const cancellation=await commandClick(page,booking.getByRole('button',{name:'Cancelar mi grupo',exact:true}),'/api/terminal/command');expect((await api(page,'/api/terminal/command',cancellation.body,cancellation.key)).status()).toBe(200);
    await expect(booking.locator('strong').first()).toContainText('Cancelada');await expect(booking.getByRole('button',{name:'Ya llegué',exact:true})).toHaveCount(0);await expect(booking).toContainText('Bs 140');
    state=await audit.read(tripId);expect(state.bookings.find(b=>b.id===walkIn).status).toBe('REJECTED');expect(state.bookings.find(b=>b.id===own).status).toBe('CANCELLED');expect(state.segments.every(s=>s.reserved===0)).toBe(true);expect(state.movements).toHaveLength(0);expect(state.trip.departed_at).toBeNull();
    expect(state.bookings.find(b=>b.id===own).member_ids).toEqual(before.bookings.find(b=>b.id===own).member_ids);
    await page.locator('.private-reservations').screenshot({scale:'css',path:`.local/e2e-incremento-5/cancelacion-${info.project.name}.png`});
    await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await commandClick(d,d.getByRole('button',{name:'Reportar avería ficticia observada',exact:true}),'/api/operations/command');
    await a.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(a.getByRole('button',{name:'Confirmar incidencia reportada',exact:true})).toBeVisible();await confirmIncident(a);await consoleIncident(a,'FICTICIO-WEB-0-0');
    await a.getByLabel('Confirmo la verificación ficticia de reparación').check();const restore=await commandClick(a,a.getByRole('button',{name:'Registrar rehabilitación simulada',exact:true}));expect((await api(a,'/api/recovery/command',restore.body,restore.key)).status()).toBe(200);
    await expect(a.locator('.recovery-detail')).toContainText('Incidencia resuelta');await expect(a.locator('.recovery-detail')).toContainText('no tiene un bloqueo activo');
    state=await audit.read(tripId);expect(state.trip.status).toBe('QUEUED');expect(state.trip.departed_at).toBeNull();expect(state.fleet.filter(e=>e.kind==='VEHICLE_RESTORED')).toHaveLength(1);expect(state.movements).toHaveLength(0);
    expect((await new AxeBuilder({page:a}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await a.locator('.recovery-console').screenshot({scale:'css',path:`.local/e2e-incremento-5/rehabilitacion-${info.project.name}.png`});await writeFile(`.local/e2e-incremento-5/terminal-${info.project.name}.json`,JSON.stringify(state,null,2));
  }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
