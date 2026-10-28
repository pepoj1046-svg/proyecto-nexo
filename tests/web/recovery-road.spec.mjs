import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {operationEvidence} from './support/operation-evidence.mjs';
import {login,operational,api,rejected,deviceContext,commandClick,consoleIncident,confirmIncident,updateConsole,bookingContract,recordEvidence} from './support/recovery-browser.mjs';
test('rescate en carretera: tres roles, terminal autorizada, dos asignaciones concurrentes y traslado seguro antes de continuar',async({page,browser,baseURL},info)=>{
 test.setTimeout(120000);const audit=await operationEvidence(info.project.name),contexts=[];const context=async()=>{const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);return c;};
 try{
  await login(page,'operativo0','/pasajero');const booking=page.locator('.saved-booking');await expect(booking).toHaveCount(1);
  const a=await(await context()).newPage(),d=await(await context()).newPage();await operational(a,'adminR','/administracion');const tripId=await a.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(tripId);expect(before.trip.phase).toBe('MAIN_TRIP');expect(before.trip.current_stop).toBe(2);expect(before.onboard).toBe(6);
  await operational(d,'driver5','/chofer');await commandClick(d,d.getByRole('button',{name:'Reportar avería ficticia observada',exact:true}),'/api/operations/command');await expect(d.getByRole('button',{name:'Registrar llegada final Terminal Villa Montes (ficticia)',exact:true})).toBeDisabled();
  await a.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(a.getByRole('button',{name:'Confirmar incidencia reportada',exact:true})).toBeVisible();await confirmIncident(a);const incidentId=await consoleIncident(a,'FICTICIO-OPERATIVO');
  await a.getByLabel('Terminal prioritaria',{exact:true}).selectOption('DESTINATION');await expect(a.locator('.recovery-detail')).toContainText('Primera opción autorizada: FICTICIO-RESCATE-DESTINO');
  const detailResponse=await api(a,'/api/recovery/detail',{incidentId,priority:'DESTINATION'}),detail=await detailResponse.json(),target=detail.candidates[0].tripId;
  expect(detail.candidates.every(c=>!['FICTICIO-WEB-0-0','FICTICIO-WEB-0-1'].includes(c.vehicle))).toBe(true);
  const assign={kind:'ASSIGN_ROAD',tripId,version:detail.incident.roadVersion,targetTripId:target,priority:'DESTINATION',confirmed:true};
  await rejected(d,'/api/recovery/command',assign,'FORBIDDEN');await rejected(page,'/api/recovery/command',assign,'FORBIDDEN');
  const occupied=await a.getByLabel('Vehículo autorizado').locator('option').filter({hasText:'FICTICIO-WEB-0-0'}).getAttribute('value');await rejected(a,'/api/recovery/command',{...assign,targetTripId:occupied},'ADMIN_TERMINAL_CHOICE_REQUIRED',409);
  const foreign=await(await context()).newPage();await login(foreign,'adminU','/administracion');await rejected(foreign,'/api/recovery/detail',{incidentId},'FORBIDDEN');expect(bookingContract(await audit.read(tripId))).toEqual(bookingContract(before));
  await booking.getByRole('button',{name:'Consultar incidencia y traslado',exact:true}).click();await expect(booking).toContainText('Rescate pendiente de gestión');
  // Forward the actual UI request and a competing request to the real HTTP server.
  // Neither response is fabricated: fulfill only forwards the original server response.
  let finish;const raced=new Promise(resolve=>{finish=resolve;});let once=true;
  await a.route('**/api/recovery/command',async route=>{
   if(once&&route.request().postDataJSON().kind==='ASSIGN_ROAD'){
    once=false;const [original,competitor]=await Promise.all([route.fetch(),api(a,'/api/recovery/command',route.request().postDataJSON(),randomUUID())]);
    const result={statuses:[original.status(),competitor.status()],errors:[await original.json(),await competitor.json()]};await route.fulfill({response:original});finish(result);
   }else await route.continue();
  });
  await a.getByLabel('Confirmo la asignación autorizada').check();await a.getByRole('button',{name:'Asignar vehículo de rescate',exact:true}).click();const race=await raced;expect([...race.statuses].sort()).toEqual([200,409]);expect(race.errors.some(x=>x.error==='STALE_OPERATION')).toBe(true);await a.unroute('**/api/recovery/command');
  await updateConsole(a);await expect(a.locator('.recovery-detail')).toContainText('traslado seguro pendiente');
  let s=await audit.read(tripId);expect(s.trip.vehicle).toBe('FICTICIO-RESCATE-DESTINO');expect(s.incidents[0].road_phase).toBe('ASSIGNED');expect(s.journey.filter(e=>e.kind==='ROAD_ASSIGN')).toHaveLength(1);expect(bookingContract(s)).toEqual(bookingContract(before));expect((await audit.read(target)).trip.status).toBe('WITHDRAWN');
  await recordEvidence('carretera',info.project.name,'asignado',{state:s,race},a);
  await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await d.getByRole('button',{name:'Consultar incidencias',exact:true}).click();await expect(d.locator('.driver-incident')).toContainText('Ya no conduces este servicio');await expect(d.getByRole('button',{name:'Asignar vehículo de rescate',exact:true})).toHaveCount(0);
  const newDriver=await(await context()).newPage();await operational(newDriver,'driver7','/chofer','FICTICIO-RESCATE-DESTINO');await expect(newDriver.getByRole('button',{name:'Registrar llegada final Terminal Villa Montes (ficticia)',exact:true})).toBeDisabled();await newDriver.getByRole('button',{name:'Consultar incidencias',exact:true}).click();
  await newDriver.getByLabel('Personas trasladadas',{exact:true}).fill('5');await newDriver.getByLabel('Declaro un punto seguro ficticio').check();await expect(newDriver.getByRole('button',{name:'Registrar traslado seguro',exact:true})).toBeDisabled();
  await rejected(newDriver,'/api/recovery/command',{kind:'SAFE_ROAD',tripId,version:s.incidents[0].road_version,onboard:5,confirmed:true},'INVALID_SAFE_TRANSFER',400);
  await newDriver.getByLabel('Personas trasladadas',{exact:true}).fill('6');await newDriver.getByLabel('Declaro un punto seguro ficticio').check();await commandClick(newDriver,newDriver.getByRole('button',{name:'Registrar traslado seguro',exact:true}));
  await expect(newDriver.getByRole('button',{name:'Registrar llegada final Terminal Villa Montes (ficticia)',exact:true})).toBeEnabled();s=await audit.read(tripId);expect(s.onboard).toBe(6);expect(s.movements).toEqual(before.movements);expect(s.incidents[0].state).toBe('TRANSFERRED');
  await booking.getByRole('button',{name:'Actualizar incidencia y traslado',exact:true}).click();await expect(booking).toContainText('Vehículo asignado: FICTICIO-RESCATE-DESTINO');await expect(booking).toContainText('Traslado registrado');
  expect((await new AxeBuilder({page:newDriver}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await commandClick(newDriver,newDriver.getByRole('button',{name:'Registrar llegada final Terminal Villa Montes (ficticia)',exact:true}),'/api/operations/command');await expect(newDriver.locator('.trip-operations h2').first()).toContainText('Viaje finalizado');
  for(const name of ['Terminal de Yacuiba (ficticia)','Parada Palmar (ficticia)'])await commandClick(newDriver,newDriver.locator('.expected-booking').filter({hasText:name}).getByRole('button',{name:'Registrar descenso del grupo',exact:true}),'/api/operations/command');
  s=await audit.read(tripId);expect(s.onboard).toBe(0);expect(s.trip.status).toBe('COMPLETED');expect(bookingContract(s)).toEqual(bookingContract(before));await expect(newDriver.locator('.trip-facts')).toContainText('0 abordados observados');
  await newDriver.getByRole('button',{name:'Actualizar incidencias',exact:true}).click();await expect(newDriver.locator('.driver-incident')).toContainText('Viaje finalizado');
  await recordEvidence('carretera',info.project.name,'finalizado',s,newDriver);
 }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
