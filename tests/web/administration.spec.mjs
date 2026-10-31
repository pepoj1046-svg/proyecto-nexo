import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick} from './support/recovery-browser.mjs';
const directory='.local/e2e-incremento-6';
async function allPages(page,selector,name){const ids=[];let n=0;do{
 const cards=page.locator(selector);await expect(cards.first()).toBeVisible();ids.push(...await cards.locator('code').allTextContents());n++;
 const next=page.getByRole('button',{name:'Siguiente página de '+name,exact:true});if(await next.isDisabled())break;
 const path=name==='manifiesto'?'/api/operations/snapshot':'/api/reservations/page';const r=page.waitForResponse(r=>r.url().endsWith(path)&&r.request().method()==='POST');await next.click();expect((await r).status()).toBe(200);await expect(page.getByRole('navigation',{name:'Paginación de '+name})).toContainText('Página '+(n+1));
 }while(n<8);expect(n).toBeGreaterThan(1);expect(new Set(ids).size).toBe(ids.length);return ids;}

test('páginas reales: administración y chofer consultan todo el manifiesto, pasajero consulta sus reservas y viaje fuera de las primeras 50',async({page,browser,baseURL},info)=>{
 test.setTimeout(120000);const audit=await operationEvidence(info.project.name),contexts=[];try{
  await operational(page,'adminH','/administracion','FICTICIO-WEB-0-0');const tripId=await page.getByLabel('Vehículo autorizado').inputValue(),state=await audit.read(tripId);expect(state.bookings.length).toBeGreaterThan(50);expect(state.segments.every(s=>s.reserved===5)).toBe(true);expect(state.trip.departed_at).toBeNull();
  const ids=await allPages(page,'.expected-booking','manifiesto');expect(new Set(ids)).toEqual(new Set(state.bookings.map(b=>b.id)));
  await mkdir(directory,{recursive:true});await page.getByRole('navigation',{name:'Paginación de manifiesto'}).screenshot({path:`${directory}/navegacion-${info.project.name}.png`,scale:'css'});await page.locator('.trip-operations').screenshot({path:`${directory}/manifiesto-${info.project.name}.png`,scale:'css'});
  const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);const p=await c.newPage();await login(p,'terminal0','/pasajero');const newest=state.bookings.find(b=>b.status==='CONFIRMED'&&b.seats===1);const fresh=p.locator('.saved-booking').filter({hasText:newest.id});await fresh.getByRole('button',{name:'Consultar presencia y viaje',exact:true}).click();await expect(fresh.locator('.journey-details')).toContainText('Ya llegué');const own=await allPages(p,'.saved-booking','mis reservas');expect(own).toHaveLength(67);expect(state.bookings.filter(b=>b.source==='APP'&&own.includes(b.id))).toHaveLength(67);
  const reservation=p.locator('.saved-booking').filter({hasText:'4 plazas juntas'});await expect(reservation).toHaveCount(1);await reservation.getByRole('button',{name:'Consultar presencia y viaje',exact:true}).click();await expect(reservation.locator('.journey-details')).toContainText('Ya llegué');
  await p.locator('.private-reservations').screenshot({path:`${directory}/reservas-${info.project.name}.png`,scale:'css'});
  const dc=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(dc);const d=await dc.newPage();await operational(d,'driver0','/chofer','FICTICIO-WEB-0-0');expect(new Set(await allPages(d,'.expected-booking','manifiesto'))).toEqual(new Set(ids));
  await rejected(p,'/api/operations/snapshot',{view:'ADMIN',tripId},'FORBIDDEN');await rejected(p,'/api/management/detail',{bookingId:ids[0]},'FORBIDDEN');
  const legacy=await api(d,'/api/operations/snapshot',{view:'DRIVER',tripId,limit:1});const first=await legacy.json();await rejected(p,'/api/operations/snapshot',{view:'PASSENGER',tripId,limit:1,cursor:first.nextCursor},'INVALID_CURSOR',400);
  const other=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(other);const o=await other.newPage();await login(o,'adminU','/administracion');await rejected(o,'/api/operations/snapshot',{view:'ADMIN',tripId},'FORBIDDEN_SCOPE');
  expect(await audit.read(tripId)).toEqual(state);await writeFile(`${directory}/paginacion-${info.project.name}.json`,JSON.stringify({manifestCount:ids.length,ownCount:own.length,uniqueManifest:new Set(ids).size,state},null,2));
 }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});

test('administración: revisión explícita, cancelación al final del manifiesto, reintentos concurrentes y estado privado consistente en tres roles',async({page,browser,baseURL},info)=>{
 test.setTimeout(120000);const audit=await operationEvidence(info.project.name),contexts=[];try{
  await operational(page,'adminH','/administracion','FICTICIO-WEB-0-0');const tripId=await page.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(tripId);const target=before.bookings.find(b=>b.status==='CONFIRMED'&&b.seats===1);expect(target).toBeTruthy();
  const next=page.getByRole('button',{name:'Siguiente página de manifiesto',exact:true});await next.click();const booking=page.locator('.expected-booking').filter({hasText:target.id});await expect(booking).toBeVisible();await booking.getByRole('button',{name:'Revisar reserva y grupo',exact:true}).click();const review=booking.locator('.admin-booking-review');
  await expect(review).toContainText('Condiciones declaradas');const cancel=review.getByRole('button',{name:'Cancelar grupo administrativamente',exact:true});await expect(cancel).toBeDisabled();await review.getByLabel('Motivo de cancelación',{exact:true}).selectOption('WRONG_RESERVATION');await expect(cancel).toBeDisabled();
  await review.getByLabel('Confirmo que revisé esta versión').check();const decision=await commandClick(page,review.getByRole('button',{name:'Registrar revisión administrativa',exact:true}),'/api/management/command');expect(decision.result.decision).toBe('ADMIN_REVIEW');
  // A successful mutation refreshes the inventory and starts a fresh, coherent manifest.
  await page.getByRole('button',{name:'Siguiente página de manifiesto',exact:true}).click();await booking.getByRole('button',{name:'Revisar reserva y grupo',exact:true}).click();await expect(review).toContainText('Revisión administrativa registrada');
  const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);const p=await c.newPage();await login(p,'terminal0','/pasajero');const own=p.locator('.saved-booking').filter({hasText:target.id});await expect(own).toContainText('Confirmada');
  const dc=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(dc);const d=await dc.newPage();await operational(d,'driver0','/chofer','FICTICIO-WEB-0-0');
  const forged={kind:'ADMIN_CANCEL',bookingId:target.id,tripId,episode:0,reason:'WRONG_RESERVATION',confirmed:true};await rejected(p,'/api/management/command',forged,'FORBIDDEN');await rejected(d,'/api/management/command',forged,'FORBIDDEN');
  const csrf=await page.request.post('/api/management/command',{headers:{Origin:baseURL,'Content-Type':'application/json','Idempotency-Key':randomUUID()},data:forged});expect(csrf.status()).toBe(403);
  await review.getByLabel('Motivo de cancelación',{exact:true}).selectOption('WRONG_RESERVATION');await review.getByLabel('Confirmo cancelar todas las partes').check();const cancelled=await commandClick(page,review.getByRole('button',{name:'Cancelar grupo administrativamente',exact:true}),'/api/management/command');expect(cancelled.result).toMatchObject({status:'CANCELLED',reason:'WRONG_RESERVATION',reasonRecorded:true,moneyProcessed:false});
  const repeated=await Promise.all([api(page,'/api/management/command',cancelled.body,cancelled.key),api(page,'/api/management/command',cancelled.body,cancelled.key)]);expect(repeated.map(r=>r.status())).toEqual([200,200]);
  const after=await audit.read(tripId);expect(after.bookings.find(b=>b.id===target.id)).toEqual({...target,status:'CANCELLED'});expect(after.segments.every(s=>s.reserved===4)).toBe(true);expect(after.movements).toHaveLength(0);expect(after.trip.departed_at).toBeNull();
  await p.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await expect(own).toContainText('Cancelada');await expect(own).toContainText('Bs 35');await d.getByRole('button',{name:'Siguiente página de manifiesto',exact:true}).click();await expect(d.getByRole('alert')).toContainText('El listado cambió');await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(d.locator('.trip-facts')).toContainText('4/6');
  await page.getByRole('button',{name:'Siguiente página de manifiesto',exact:true}).click();await booking.getByRole('button',{name:'Revisar reserva y grupo',exact:true}).click();await expect(review).toContainText('Reserva equivocada');await expect(review.getByRole('button',{name:'Cancelar grupo administrativamente',exact:true})).toHaveCount(0);
  const details=await api(page,'/api/management/detail',{bookingId:target.id}),detail=await details.json();expect(detail.cancellations).toHaveLength(1);expect(detail.parts[0].priceBOB).toBe('35.00');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await mkdir(directory,{recursive:true});await review.screenshot({path:`${directory}/cancelacion-${info.project.name}.png`,scale:'css'});await writeFile(`${directory}/cancelacion-${info.project.name}.json`,JSON.stringify({detail,state:after},null,2));
 }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
