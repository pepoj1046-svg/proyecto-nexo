import {randomUUID} from 'node:crypto';
// Trusted setup for fresh local tests only, before listening. No runtime endpoint.
export async function seedDirectoryFixture(db,association,templateRoute,count=51){
 const src=(await db.query('SELECT * FROM nexo.routes WHERE id=$1 AND association_id=$2',[templateRoute,association])).rows[0];
 const permit=(await db.query('SELECT requested_by,reviewed_by FROM nexo.route_authorizations WHERE route_id=$1 LIMIT 1',[templateRoute])).rows[0];
 if(!src||!permit||!Number.isInteger(count)||count<1||count>60)throw new Error('INVALID_DIRECTORY_FIXTURE');
 const ids={drivers:[],vehicles:[],routes:[],points:[],fares:[]};
 for(let i=0;i<count;i++){
  const driver=randomUUID(),vehicle=randomUUID(),route=randomUUID(),label='FICTICIO-DIRECTORIO-'+String(i).padStart(3,'0');
  await db.query('INSERT INTO nexo.users VALUES($1,$2)',[driver,label]);
  await db.query("INSERT INTO nexo.memberships VALUES($1,$2,'DRIVER',$3)",[association,driver,i!==0]);
  await db.query('INSERT INTO nexo.vehicles(id,association_id,label)VALUES($1,$2,$3)',[vehicle,association,label]);
  const origin=i%2?src.destination_locality_id:src.origin_locality_id,destination=i%2?src.origin_locality_id:src.destination_locality_id;
  await db.query("INSERT INTO nexo.routes(id,association_id,name,direction,version,stop_count,origin_code,destination_code,catalog_id,origin_locality_id,destination_locality_id)VALUES($1,$2,$3,$4,1,2,'LAB-D0','LAB-D1',$5,$6,$7)",[route,association,label,i%2?'IN':'OUT',src.catalog_id,origin,destination]);
  for(let n=0;n<2;n++){
   await db.query('INSERT INTO nexo.stops(association_id,route_id,stop_index,name,catalog_id,locality_id)VALUES($1,$2,$3,$4,$5,$6)',[association,route,n,label+' punto '+n,src.catalog_id,n?destination:origin]);
   await db.query('INSERT INTO nexo.web_point_profiles VALUES($1,$2,$3,$4,false)',[association,route,n,n?'TERMINAL':['TERMINAL','URBAN','ROAD'][i%3]]);ids.points.push(route+':'+n);
  }
  await db.query("INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,status,valid_from,valid_until,requested_by,reviewed_by,review_reason)VALUES($1,$2,'Emisor ficticio','DIRECTORIO SOLO LABORATORIO','VERIFIED',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',$3,$4,'Fixture ficticia')",[association,route,permit.requested_by,permit.reviewed_by]);
  for(const express of[false,true]){const id=randomUUID();await db.query("INSERT INTO nexo.fares(id,association_id,route_id,from_stop,to_stop,express,version,amount_bob,valid_from,valid_until)VALUES($1,$2,$3,0,1,$4,1,$5,clock_timestamp()+($6*interval '1 day'),CASE WHEN $6=-2 THEN clock_timestamp()-interval '1 day'ELSE NULL END)",[id,association,route,express,express?60:10,i===0?1:i===1?-2:-1]);ids.fares.push(id);}
  ids.drivers.push(driver);ids.vehicles.push(vehicle);ids.routes.push(route);
 }
 return ids;
}
