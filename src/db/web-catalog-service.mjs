import { createService } from './service.mjs';
import { createBusinessService } from './business-service.mjs';
import { assertRuntime } from './runtime.mjs';
import { object,id } from '../domain/business.mjs';
import { pointIndex } from './web-reservation-service.mjs';
import { validateSearch } from '../domain/search.mjs';

// A read-only facade over the same PostgreSQL contracts. The synthetic catalogue
// session stays on the server and is never used for private panels or mutations.
export function createWebCatalogService(pool,catalogToken) {
  const catalog=createService(pool),business=createBusinessService(pool);
  const read=async(fn,values)=>{const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");const r=(await c.query(`SELECT nexo.${fn}(${values.map((_,i)=>'$'+(i+1)).join(',')})AS result`,values)).rows[0].result;await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  return Object.freeze({
    points:request=>{object(request,['routeId']);id(request.routeId);return read('public_route_points',[request.routeId]);},
    segment:request=>{object(request,['routeId','boardingPointId','alightingPointId']);id(request.routeId);return read('public_segment_availability',[request.routeId,pointIndex(request.boardingPointId,request.routeId),pointIndex(request.alightingPointId,request.routeId)]);},
    localities:request=>catalog.suggestLocalities(catalogToken,request),
    availability:async request=>{
      const q=validateSearch(request);
      if(q.express || q.seats!==1)throw new Error('INVALID_SEARCH');
      const snapshot=await business.publicAvailability({originLocalityId:q.originLocalityId,destinationLocalityId:q.destinationLocalityId});
      const routes=[...new Set(snapshot.services.map(s=>s.routeId))];
      const stops=[];for(const route of routes){for(const stop of await read('public_route_points',[route]))stops.push({route_id:route,stop_index:stop.order,name:stop.name});}
      const name=(route,index)=>stops.find(s=>s.route_id===route&&s.stop_index===index)?.name??`Punto autorizado ${index+1}`;
      return {...snapshot,mode:'LOCAL_LAB',reservationWritesEnabled:false,services:snapshot.services.map(s=>({
        ...s,boardingName:name(s.routeId,s.from),alightingName:name(s.routeId,s.to),terminalReference:null,
        segments:s.segments.map(segment=>({...segment,fromName:name(s.routeId,segment.segment),toName:name(s.routeId,segment.segment+1)}))
      }))};
    }
  });
}
