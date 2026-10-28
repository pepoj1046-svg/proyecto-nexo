import { randomUUID,randomBytes,createHash } from 'node:crypto';
import {hashPassword}from'../src/auth/passwords.mjs';
import { createService } from '../src/db/service.mjs';
import { createBusinessService } from '../src/db/business-service.mjs';

// Only called before listening, in the existing fresh local-cluster lifecycle.
// These names are examples; no passenger/association/permit/position is real.
export async function seedWebDemo(db,pool) {
  const users={};
  for(const label of ['catalog','passenger','admin','reviewer','adminH','adminU','adminR','terminal0','operativo0','operativo1',...Array.from({length:8},(_,i)=>'driver'+i)]) {
    const id=randomUUID(),token=randomBytes(32).toString('hex');users[label]={id,token};
    await db.query('INSERT INTO nexo.users VALUES($1,$2)',[id,'FICTICIO-WEB-'+label]);
    await db.query("INSERT INTO nexo.sessions VALUES($1,$2,clock_timestamp()+interval '1 hour',NULL)",[createHash('sha256').update(token).digest('hex'),id]);
  }
  await db.query('INSERT INTO nexo.operation_reviewers VALUES($1)',[users.reviewer.id]);
  const catalog=randomUUID(),department=randomUUID(),province=randomUUID(),municipalities=Array.from({length:3},randomUUID);
  await db.query("INSERT INTO nexo.geo_catalogs VALUES($1,'LABORATORIO FICTICIO — no oficial','web-1','Fixture sintética para ejercitar el contrato de consulta; no fuente oficial','VERIFIED','ACTIVE')",[catalog]);
  await db.query("INSERT INTO nexo.departments VALUES($1,$2,'LAB-TJ','Tarija (ejemplo)')",[department,catalog]);
  await db.query("INSERT INTO nexo.provinces VALUES($1,$2,$3,'LAB-GC','Gran Chaco (ejemplo)')",[province,catalog,department]);
  for(const [i,name]of ['Yacuiba','Villa Montes','Tarija'].entries())await db.query('INSERT INTO nexo.municipalities VALUES($1,$2,$3,$4,$5)',[municipalities[i],catalog,province,'LAB-M'+i,name+' (ejemplo)']);
  const localities={};
  for(const [code,name,municipality]of [['yacuiba','Yacuiba',0],['villa','Villa Montes',1],['palmar','Palmar de prueba',0],['paso','Paso del Chaco de prueba',0],['tarija','Tarija',2],['jose1','San José',0],['jose2','San José',1]]) {
    localities[code]=randomUUID();await db.query('INSERT INTO nexo.localities VALUES($1,$2,$3,$4,$5)',[localities[code],catalog,municipalities[municipality],'LAB-'+code,name]);
  }
  const core=createService(pool),business=createBusinessService(pool),runs=[];
  const names=['Horizonte del Chaco','Unión del Sur','Camino del Valle'];
  for(let n=0;n<3;n++) {
    const association=randomUUID(),route=randomUUID();
    await db.query("INSERT INTO nexo.associations(id,name,adherence_status,operating_status)VALUES($1,$2,'ADHERED','OPERATING')",[association,names[n]+' · ficticia']);
    await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true)",[association,users.admin.id]);
    await db.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code,catalog_id,origin_locality_id,destination_locality_id)VALUES($1,$2,'Yacuiba → Villa Montes','OUT',1,4,'LAB-Y','LAB-V',$3,$4,$5)",[route,association,catalog,localities.yacuiba,localities.villa]);
    for(const [index,[name,locality]]of [['Terminal de Yacuiba (ficticia)',localities.yacuiba],['Parada Palmar (ficticia)',localities.palmar],['Parada Paso del Chaco (ficticia)',localities.paso],['Terminal Villa Montes (ficticia)',localities.villa]].entries())await db.query('INSERT INTO nexo.stops(association_id,route_id,stop_index,name,catalog_id,locality_id)VALUES($1,$2,$3,$4,$5,$6)',[association,route,index,name,catalog,locality]);
    await db.query("INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,status,valid_from,valid_until,requested_by,reviewed_by,review_reason)VALUES($1,$2,'Emisor ficticio','SIMULACIÓN SIN VALIDEZ LEGAL','VERIFIED',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',$3,$4,'Permiso ficticio de laboratorio')",[association,route,users.admin.id,users.reviewer.id]);
    for(let from=0;from<3;from++)for(let to=from+1;to<4;to++)await db.query("INSERT INTO nexo.fares(association_id,route_id,from_stop,to_stop,express,version,amount_bob,valid_from)VALUES($1,$2,$3,$4,false,1,$5,clock_timestamp()-interval '1 hour')",[association,route,from,to,(to-from)*10+5+n*5]);
    const trips=[];
    for(let j=0;j<(n===0?3:1);j++){
      const driver=users['driver'+(n===0?j:n+2)],vehicle=randomUUID(),trip=randomUUID();
      await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[association,driver.id]);
      await db.query('INSERT INTO nexo.vehicles(id,association_id,label)VALUES($1,$2,$3)',[vehicle,association,'FICTICIO-WEB-'+n+'-'+j]);
      await db.query('INSERT INTO nexo.trips(id,association_id,route_id,vehicle_id,driver_id,position_no)VALUES($1,$2,$3,$4,$5,$6)',[trip,association,route,vehicle,driver.id,j+1]);trips.push({id:trip,driver});
    }
    runs.push({association,route,trips});
    await business.closure(users.admin.token,randomUUID(),'association-contact',{associationId:association,contactCode:'LAB-TERMINAL-'+n,confirmed:true});
  }
  const reserve=async(run,trip,seats,from=0,to=3,actor=users.passenger)=>{
    const g=await core.reserve(actor.token,randomUUID(),{routeId:run.route,from,to,seats,parts:[{tripId:trip.id,seats}]});
    for(const id of g.bookingIds)await core.respond(trip.driver.token,randomUUID(),id,true);return g;
  };
  const a=runs[0];await reserve(a,a.trips[0],4,0,3,users.terminal0);const filler=await reserve(a,a.trips[0],2);
  await reserve(a,a.trips[1],2,0,1);await reserve(a,a.trips[1],4,1,3);
  await core.cancel(users.passenger.token,randomUUID(),filler.bookingIds[0]);
  const moving=await reserve(a,a.trips[2],6,0,1);await core.depart(a.trips[2].driver.token,randomUUID(),a.trips[2].id);
  await business.movement(a.trips[2].driver.token,randomUUID(),moving.bookingIds[0],'BOARD');
  await core.progress(a.trips[2].driver.token,randomUUID(),a.trips[2].id,1);
  await business.movement(a.trips[2].driver.token,randomUUID(),moving.bookingIds[0],'ALIGHT');
  const pickup=await business.closure(users.passenger.token,randomUUID(),'reserve-enroute',{tripId:a.trips[2].id,routeId:a.route,from:1,to:3,seats:2});
  await core.respond(a.trips[2].driver.token,randomUUID(),pickup.bookingId,true);
  await reserve(runs[1],runs[1].trips[0],2);
  await business.closure(users.admin.token,randomUUID(),'route-condition',{routeId:runs[1].route,state:'DESVIO',reason:'BLOCKADE',description:'Desvío de prueba declarado por la asociación. Confirmar las condiciones antes de viajar.',affectedStops:[],confirmed:true});
  await business.closure(users.admin.token,randomUUID(),'route-condition',{routeId:runs[2].route,state:'SUSPENDIDA',reason:'LANDSLIDE',description:'Salida suspendida en esta simulación. La asociación mantiene atención administrativa.',affectedStops:[],confirmed:true});
  // A second route in the same association deliberately has different conditions.
  const extra=randomUUID();await db.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code,catalog_id,origin_locality_id,destination_locality_id)VALUES($1,$2,'Alternativa de prueba','OUT',1,2,'LAB-Y2','LAB-V2',$3,$4,$5)",[extra,a.association,catalog,localities.yacuiba,localities.villa]);
  for(const[index,name]of ['Terminal alternativa (ficticia)','Destino alternativo (ficticio)'].entries())await db.query('INSERT INTO nexo.stops(association_id,route_id,stop_index,name,catalog_id,locality_id)VALUES($1,$2,$3,$4,$5,$6)',[a.association,extra,index,name,catalog,index?localities.villa:localities.yacuiba]);
  await db.query("INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,status,valid_from,valid_until,requested_by,reviewed_by,review_reason)VALUES($1,$2,'Emisor ficticio','ALTERNATIVA FICTICIA','VERIFIED',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',$3,$4,'Ejemplo')",[a.association,extra,users.admin.id,users.reviewer.id]);
  await business.closure(users.admin.token,randomUUID(),'route-condition',{routeId:extra,state:'SUSPENDIDA',reason:'LANDSLIDE',description:'Solo la ruta alternativa está suspendida en esta simulación.',affectedStops:[],confirmed:true});
  // Explicit synthetic point types, never inferred from a name or GPS.
  for(const run of runs)for(let index=0;index<4;index++)await db.query('INSERT INTO nexo.web_point_profiles VALUES($1,$2,$3,$4,$5)',[run.association,run.route,index,['TERMINAL','URBAN','ROAD','TERMINAL'][index],index===1]);
  for(const[label,run]of [['adminH',runs[0]],['adminU',runs[1]]]){
    await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true)",[run.association,users[label].id]);
    await db.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[users[label].id,run.association,[run.route]]);
  }
  const vehicle=randomUUID(),operationalTrip={id:randomUUID(),driver:users.driver5};
  await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[a.association,users.driver5.id]);
  await db.query('INSERT INTO nexo.vehicles(id,association_id,label)VALUES($1,$2,$3)',[vehicle,a.association,'FICTICIO-OPERATIVO']);
  await db.query('INSERT INTO nexo.trips(id,association_id,route_id,vehicle_id,driver_id,position_no)VALUES($1,$2,$3,$4,$5,4)',[operationalTrip.id,a.association,a.route,vehicle,users.driver5.id]);
  // Temporarily fill earlier compatible units through native RPCs, then restore them.
  const blockers=[await reserve(a,a.trips[0],2),await reserve(a,a.trips[1],2,1,3)];
  const terminalGroup=await reserve(a,operationalTrip,4,0,3,users.operativo0),urbanGroup=await reserve(a,operationalTrip,2,1,3,users.operativo1);
  for(const g of blockers)await core.cancel(users.passenger.token,randomUUID(),g.bookingIds[0]);
  // Available replacement units at the two authorized endpoints. Existing queue
  // entries, reservations and public Yacuiba→Tarija empty result remain unchanged.
  const reverse=randomUUID();
  await db.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code,catalog_id,origin_locality_id,destination_locality_id)VALUES($1,$2,'Villa Montes → Yacuiba','IN',1,4,'LAB-V','LAB-Y',$3,$4,$5)",[reverse,a.association,catalog,localities.villa,localities.yacuiba]);
  for(const[index,[name,locality]]of [['Terminal Villa Montes (ficticia)',localities.villa],['Parada Paso del Chaco (ficticia)',localities.paso],['Parada Palmar (ficticia)',localities.palmar],['Terminal de Yacuiba (ficticia)',localities.yacuiba]].entries()){
   await db.query('INSERT INTO nexo.stops(association_id,route_id,stop_index,name,catalog_id,locality_id)VALUES($1,$2,$3,$4,$5,$6)',[a.association,reverse,index,name,catalog,locality]);
   await db.query('INSERT INTO nexo.web_point_profiles VALUES($1,$2,$3,$4,$5)',[a.association,reverse,index,['TERMINAL','ROAD','URBAN','TERMINAL'][index],index===2]);
  }
  await db.query("INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,status,valid_from,valid_until,requested_by,reviewed_by,review_reason)VALUES($1,$2,'Emisor ficticio','RETORNO SOLO LABORATORIO','VERIFIED',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',$3,$4,'Permiso ficticio de retorno')",[a.association,reverse,users.admin.id,users.reviewer.id]);
  for(const[index,[route,label,position]]of [[a.route,'FICTICIO-RESCATE-ORIGEN',5],[reverse,'FICTICIO-RESCATE-DESTINO',1]].entries()){
   const driver=users['driver'+(6+index)],v=randomUUID();await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',true)",[a.association,driver.id]);
   await db.query('INSERT INTO nexo.vehicles(id,association_id,label)VALUES($1,$2,$3)',[v,a.association,label]);
   await db.query('INSERT INTO nexo.trips(id,association_id,route_id,vehicle_id,driver_id,position_no)VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),a.association,route,v,driver.id,position]);
  }
  await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'ASSOCIATION_ADMIN',true)",[a.association,users.adminR.id]);
  await db.query('SELECT nexo.configure_admin_scope($1,$2,$3,true)',[users.adminR.id,a.association,[a.route,reverse]]);
  const scenario=process.env.NEXO_WEB_RECOVERY_SCENARIO??'DEFAULT';
  if(!['DEFAULT','URBAN','ROAD','ROAD_NO_FREE'].includes(scenario))throw new Error('INVALID_LOCAL_RECOVERY_FIXTURE');
  if(scenario!=='DEFAULT'){
   await business.terminalObservation(users.admin.token,randomUUID(),terminalGroup.bookingIds[0],null,'BOARD',4,3,true);
   await business.beginUrban(users.driver5.token,randomUUID(),operationalTrip.id,1,true);
   if(scenario==='ROAD'||scenario==='ROAD_NO_FREE'){
    await core.progress(users.driver5.token,randomUUID(),operationalTrip.id,1);
    await business.terminalObservation(users.driver5.token,randomUUID(),urbanGroup.bookingIds[0],null,'BOARD',2,3,true);
    const op=await business.operationalStatus(users.driver5.token,operationalTrip.id);
    await business.fleetCommand(users.driver5.token,randomUUID(),operationalTrip.id,op.version,'MAIN_START',null,null,true);
    await core.progress(users.driver5.token,randomUUID(),operationalTrip.id,2);
    if(scenario==='ROAD_NO_FREE')for(const label of ['driver6','driver7']){
     const trip=(await db.query('SELECT id FROM nexo.trips WHERE driver_id=$1',[users[label].id])).rows[0];
     await business.terminalImpediment(users[label].token,randomUUID(),trip.id,'REPORT','MECHANICAL_FAILURE',true);
    }
   }
  }
  const accounts={};
  for(const label of [...Array.from({length:10},(_,i)=>'viajero'+i),...Array.from({length:8},(_,i)=>'driver'+i),'adminH','adminU','adminR','terminal0','operativo0','operativo1']){
    const password=randomBytes(24).toString('base64url'),login='lab-'+label.toLowerCase();
    const user=users[label]?.id??randomUUID();if(!users[label])await db.query('INSERT INTO nexo.users VALUES($1,$2)',[user,'FICTICIO-WEB-'+label]);
    await db.query('INSERT INTO nexo.identity_accounts(user_id,login_key,password_hash)VALUES($1,$2,$3)',[user,login,await hashPassword(password)]);
    accounts[label]={login,password};
  }
  return {catalogToken:users.catalog.token,accounts};
}
