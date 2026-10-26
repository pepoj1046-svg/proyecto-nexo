import { randomUUID } from 'node:crypto';
export async function seedGeography(db) {
  const g = {catalog:randomUUID(),departments:[randomUUID(),randomUUID()],
    provinces:[randomUUID(),randomUUID(),randomUUID()],municipalities:Array.from({length:4},randomUUID),
    localities:Array.from({length:5},randomUUID)};
  await db.query("INSERT INTO nexo.geo_catalogs VALUES($1,'Catálogo ficticio','test','fixture sintética, no oficial','SYNTHETIC','ACTIVE')",[g.catalog]);
  for(let i=0;i<2;i++) await db.query('INSERT INTO nexo.departments VALUES($1,$2,$3,$4)',[g.departments[i],g.catalog,'D'+i,'Departamento ficticio '+i]);
  for(let i=0;i<3;i++) await db.query('INSERT INTO nexo.provinces VALUES($1,$2,$3,$4,$5)',[g.provinces[i],g.catalog,g.departments[i===2?1:0],'P'+i,'Provincia ficticia '+i]);
  for(let i=0;i<4;i++) await db.query('INSERT INTO nexo.municipalities VALUES($1,$2,$3,$4,$5)',[g.municipalities[i],g.catalog,g.provinces[[0,0,1,2][i]],'M'+i,'Municipio ficticio '+i]);
  for(let i=0;i<5;i++) await db.query('INSERT INTO nexo.localities VALUES($1,$2,$3,$4,$5)',[g.localities[i],g.catalog,g.municipalities[i===4?0:i],'L'+i,'Localidad ficticia '+i]);
  return g;
}
export async function mapRoute(db,route,association,g,origin=g.localities[0],destination=g.localities[1],count=4) {
  await db.query('UPDATE nexo.routes SET catalog_id=$2,origin_locality_id=$3,destination_locality_id=$4 WHERE id=$1',[route,g.catalog,origin,destination]);
  for(let i=0;i<count;i++) await db.query(
    'INSERT INTO nexo.stops(association_id,route_id,stop_index,name,catalog_id,locality_id) VALUES($1,$2,$3,$4,$5,$6)',
    [association,route,i,'Parada ficticia '+i,g.catalog,i===count-1?destination:i===0?origin:g.localities[4]]);
}
export async function permit(db,route,association,actor,reviewer,extra={}) {
  const {rows:[a]}=await db.query(
    "INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,status,valid_from,valid_until,requested_by,reviewed_by,review_reason) VALUES($1,$2,'Emisor ficticio',$3,$4,now()-interval '1 day',now()+interval '1 day',$5,$6,'Revisión ficticia') RETURNING id",
    [association,route,randomUUID(),extra.status??'VERIFIED',actor,reviewer]);
  return a.id;
}
