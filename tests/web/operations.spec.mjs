import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {login,operational,api,rejected} from './support/operation-browser.mjs';
import {operationEvidence} from './support/operation-evidence.mjs';
test('ciclo real de terminal, cuatro abordajes y dos recogidas urbanas hasta llegada y descenso',async({page,browser,baseURL},info)=>{
 test.setTimeout(90000);
 const contextOptions={baseURL,viewport:page.viewportSize(),isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,userAgent:info.project.use.userAgent};
 const evidence=await operationEvidence(info.project.name),admin=await browser.newContext(contextOptions),driver=await browser.newContext(contextOptions);
 let initial;
 try{
  await login(page,'operativo0','/pasajero');
  const booking=page.locator('.saved-booking');await expect(booking).toHaveCount(1);
  const ownId=(await booking.locator('code').first().textContent()).trim();
  await booking.getByRole('button',{name:'Consultar presencia y viaje'}).click();
  await expect(booking).toContainText('Completo, listo para salir');
  const a=await admin.newPage(),d=await driver.newPage();
  expect(a.viewportSize()).toEqual(page.viewportSize());expect(d.viewportSize()).toEqual(page.viewportSize());
  await operational(a,'adminH','/administracion');
  const tripId=await a.getByLabel('Vehículo autorizado',{exact:true}).inputValue();
  initial=await evidence.read(tripId);
  const contractual=state=>state.bookings.map(({status,...rest})=>rest);
  const checkpoint=async(label,{status='QUEUED',phase=null,stop=0,onboard=0,boards=0,alights=0}={})=>{
   const s=await evidence.read(tripId);
   expect(s.trip).toMatchObject({status,phase,current_stop:stop});expect(s.onboard).toBe(onboard);
   expect(s.bookings).toHaveLength(2);expect(s.bookings.map(b=>b.seats)).toEqual([4,2]);
   expect(s.bookings.map(b=>b.members)).toEqual([4,2]);expect(contractual(s)).toEqual(contractual(initial));
   expect(s.bookings.map(b=>b.status)).toEqual(status==='COMPLETED'?['COMPLETED','COMPLETED']:['CONFIRMED','CONFIRMED']);
   expect(s.segments.map(x=>x.confirmed)).toEqual(status==='COMPLETED'?[0,0,0]:[4,6,6]);
   expect(s.movements.filter(m=>m.kind==='BOARD')).toHaveLength(boards);expect(s.movements.filter(m=>m.kind==='ALIGHT')).toHaveLength(alights);
   const departures=s.audits.filter(e=>e.action==='DEPARTED');expect(departures).toHaveLength(status==='QUEUED'?0:1);
   if(status==='QUEUED'){expect(s.trip.departed_at).toBeNull();expect(s.trip.completed_at).toBeNull();expect(s.trip.main_started_at).toBeNull();expect(s.fleet).toEqual([]);}
   else{expect(s.trip.departed_at).not.toBeNull();expect(departures[0].actor).toBe('FICTICIO-WEB-driver5');}
   if(phase==='URBAN_COLLECTION')expect(s.trip.main_started_at).toBeNull();
   if(phase==='MAIN_TRIP'||phase==='COMPLETED')expect(s.trip.main_started_at).not.toBeNull();
   if(status==='COMPLETED')expect(s.trip.completed_at).not.toBeNull();
   await evidence.record(label,s);return s;
  };
  const capture=async(label)=>{await mkdir('.local/e2e-incremento-3',{recursive:true});await d.screenshot({path:`.local/e2e-incremento-3/${label}-${info.project.name}.png`,fullPage:true,scale:'css'});};
  await checkpoint('01-reservas-confirmadas-sin-salida');
  await booking.getByRole('button',{name:'Ya llegué',exact:true}).click();await expect(booking).toContainText('Ya llegué: declaración vigente');
  let s=await checkpoint('02-llegada-declarada');expect(s.events).toEqual([{kind:'DECLARED',booking_id:ownId,actor:'FICTICIO-WEB-operativo0'}]);
  // The passenger's snapshot contains only their own group, not the pickup group.
  const own=await api(page,'/api/operations/snapshot',{view:'PASSENGER',tripId});expect(own.status()).toBe(200);
  expect((await own.json()).bookings.map(b=>b.bookingId)).toEqual([ownId]);
  await rejected(page,'/api/operations/snapshot',{view:'ADMIN',tripId},'FORBIDDEN');
  const terminal=a.locator('.expected-booking').filter({hasText:'Terminal de Yacuiba (ficticia)'});
  await terminal.getByRole('button',{name:'Verificar llegada presencial'}).click();
  await expect(a.locator('.trip-operations')).toContainText('Llegada verificada presencialmente');
  s=await checkpoint('03-presencia-verificada');expect(s.events.filter(e=>e.kind==='VERIFIED')).toEqual([{kind:'VERIFIED',booking_id:ownId,actor:'FICTICIO-WEB-adminH'}]);
  const sent=a.waitForRequest(r=>r.url().endsWith('/api/operations/command')&&r.postDataJSON().kind==='BOARD');
  await a.locator('.expected-booking').filter({hasText:'Terminal de Yacuiba (ficticia)'}).getByRole('button',{name:'Registrar abordaje del grupo'}).click();
  const boardRequest=await sent,boardBody=boardRequest.postDataJSON();
  await expect(a.locator('.trip-facts')).toContainText('4 abordados observados');
  s=await checkpoint('04-cuatro-abordados-sin-salida',{onboard:4,boards:1});expect(s.movements[0]).toMatchObject({booking_id:ownId,kind:'BOARD',stop_index:0,actor:'FICTICIO-WEB-adminH'});
  // Duplicate submissions are successful idempotent receipts, never extra passengers.
  for(const key of [boardRequest.headers()['idempotency-key'],randomUUID()]){const r=await api(a,'/api/operations/command',boardBody,key);expect(r.status()).toBe(200);expect((await r.json()).recorded).toBe(true);}
  await rejected(page,'/api/operations/command',boardBody,'FORBIDDEN');
  await checkpoint('05-duplicados-y-pasajero-no-alteran-abordaje',{onboard:4,boards:1});
  await operational(d,'driver5','/chofer');
  await expect(d.locator('.trip-operations h2').first()).toContainText('Completo, listo para salir');
  await expect(d.locator('.trip-facts')).toContainText('6/6');await expect(d.locator('.trip-facts')).toContainText('4 abordados observados');
  await expect(d.getByRole('button',{name:'Registrar llegada a Parada Palmar (ficticia)',exact:true})).toHaveCount(0);
  await expect(d.getByRole('button',{name:'Iniciar salida para recogidas',exact:true})).toBeEnabled();
  await capture('01-listo-sin-salida');
  const departure={kind:'BEGIN_COLLECTION',tripId,pointId:initial.trip.route_id+':1',confirmed:true};
  await rejected(a,'/api/operations/command',departure,'FORBIDDEN');
  await checkpoint('06-lecturas-y-admin-no-provocan-salida',{onboard:4,boards:1});
  await d.getByRole('button',{name:'Iniciar salida para recogidas',exact:true}).click();
  await expect(d.locator('.trip-operations h2').first()).toContainText('Recogiendo pasajeros');
  await expect(d.locator('.trip-facts')).toContainText('4 abordados observados');await expect(d.locator('.trip-facts')).toContainText('6/6');
  s=await checkpoint('07-salida-explicita-cuatro-mas-dos',{status:'IN_TRANSIT',phase:'URBAN_COLLECTION',onboard:4,boards:1});
  await capture('02-salida-recogidas');
  // A seventh reserved seat must fail even though only four people have boarded.
  const extra={routeId:s.trip.route_id,tripId,boardingPointId:s.trip.route_id+':1',alightingPointId:s.trip.route_id+':3',seats:1,flow:'ENROUTE'};
  const q=await api(page,'/api/reservations/quote',extra);expect(q.status()).toBe(200);const{fareId,fareVersion,totalBOB}=await q.json();
  await rejected(page,'/api/reservations',{...extra,quote:{fareId,fareVersion,totalBOB},confirmed:true},'NO_CAPACITY',409);
  await checkpoint('08-septima-plaza-rechazada-sin-retencion',{status:'IN_TRANSIT',phase:'URBAN_COLLECTION',onboard:4,boards:1});
  await d.getByRole('button',{name:'Registrar llegada a Parada Palmar (ficticia)',exact:true}).click();
  await expect(d.getByRole('button',{name:'Recogidas completadas: iniciar viaje al destino'})).toBeDisabled();
  s=await checkpoint('09-llegada-palmar-faltan-dos',{status:'IN_TRANSIT',phase:'URBAN_COLLECTION',stop:1,onboard:4,boards:1});
  await rejected(d,'/api/operations/command',{kind:'MAIN_START',tripId,version:s.trip.version,confirmed:true},'PICKUPS_PENDING',409);
  const pickup=d.locator('.expected-booking').filter({hasText:'Parada Palmar (ficticia)'});
  await pickup.getByRole('button',{name:'Registrar abordaje del grupo'}).click();await expect(d.locator('.trip-facts')).toContainText('6 abordados observados');
  s=await checkpoint('10-palmar-seis-abordados',{status:'IN_TRANSIT',phase:'URBAN_COLLECTION',stop:1,onboard:6,boards:2});
  expect(s.movements.filter(m=>m.kind==='BOARD').map(m=>[m.stop_index,m.actor])).toEqual([[0,'FICTICIO-WEB-adminH'],[1,'FICTICIO-WEB-driver5']]);
  await capture('03-palmar-seis-abordados');
  await d.getByRole('button',{name:'Recogidas completadas: iniciar viaje al destino',exact:true}).click();
  await expect(d.locator('.trip-operations h2').first()).toContainText('En viaje hacia el destino');
  await checkpoint('11-inicio-principal-explicito',{status:'IN_TRANSIT',phase:'MAIN_TRIP',stop:1,onboard:6,boards:2});
  await booking.getByRole('button',{name:'Actualizar presencia y viaje'}).click();await expect(booking).toContainText('En viaje hacia el destino');
  expect((await new AxeBuilder({page:d}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await capture('04-viaje-principal');
  // Preserve the original screenshot paths used by the increment report.
  await mkdir('.local/screenshots',{recursive:true});await d.screenshot({path:`.local/screenshots/operacion-${info.project.name}.png`,fullPage:true,scale:'css'});
  await d.getByRole('button',{name:'Registrar llegada a Parada Paso del Chaco (ficticia)',exact:true}).click();
  await expect(d.locator('.stop-progress [aria-current="step"]')).toContainText('Parada Paso del Chaco (ficticia)');
  await checkpoint('12-paso-del-chaco',{status:'IN_TRANSIT',phase:'MAIN_TRIP',stop:2,onboard:6,boards:2});
  await d.getByRole('button',{name:'Registrar llegada final Terminal Villa Montes (ficticia)',exact:true}).click();
  await expect(d.locator('.trip-operations h2').first()).toContainText('Viaje finalizado');
  await checkpoint('13-llegada-final-no-fabrica-descensos',{status:'COMPLETED',phase:'COMPLETED',stop:3,onboard:6,boards:2});
  await capture('05-llegada-final');
  for(const[i,name]of ['Terminal de Yacuiba (ficticia)','Parada Palmar (ficticia)'].entries()){
   await d.locator('.expected-booking').filter({hasText:name}).getByRole('button',{name:'Registrar descenso del grupo',exact:true}).click();
   await expect(d.locator('.trip-facts')).toContainText(`${i===0?2:0} abordados observados`);
   s=await checkpoint('14-descenso-grupo-'+(i+1),{status:'COMPLETED',phase:'COMPLETED',stop:3,onboard:i===0?2:0,boards:2,alights:i+1});
  }
  expect(s.movements.filter(m=>m.kind==='ALIGHT').every(m=>m.stop_index===3&&m.actor==='FICTICIO-WEB-driver5')).toBe(true);
  expect(s.fleet.filter(e=>e.kind==='URBAN_STARTED')).toHaveLength(1);expect(s.fleet.filter(e=>e.kind==='MAIN_TRIP_STARTED')).toHaveLength(1);
  await capture('06-descensos-finalizados');
  await booking.getByRole('button',{name:'Actualizar presencia y viaje'}).click();await expect(booking).toContainText('Viaje finalizado');
  await info.attach('estados-postgresql',{body:JSON.stringify(evidence.steps,null,2),contentType:'application/json'});
 }finally{await evidence.close();await admin.close();await driver.close();}
});
