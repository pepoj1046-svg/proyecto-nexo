import { createService } from './service.mjs';
import { createBusinessService } from './business-service.mjs';
import { assertRuntime } from './runtime.mjs';
import { validateSearch } from '../domain/search.mjs';

// A read-only facade over the same PostgreSQL contracts. The synthetic catalogue
// session stays on the server and is never used for private panels or mutations.
export function createWebCatalogService(pool,catalogToken) {
  const catalog=createService(pool),business=createBusinessService(pool);
  return Object.freeze({
    localities:request=>catalog.suggestLocalities(catalogToken,request),
    availability:async request=>{
      const q=validateSearch(request);
      if(q.express || q.seats!==1)throw new Error('INVALID_SEARCH');
      const snapshot=await business.publicAvailability({originLocalityId:q.originLocalityId,destinationLocalityId:q.destinationLocalityId});
      const routes=[...new Set(snapshot.services.map(s=>s.routeId))];
      const c=await pool.connect();let stops=[];
      try {
        await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");
        await c.query("SELECT set_config('nexo.session_token',$1,true)",[catalogToken]);
        stops=(await c.query('SELECT route_id,stop_index,name FROM nexo.stops WHERE route_id=ANY($1::uuid[]) ORDER BY route_id,stop_index',[routes])).rows;
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
      const name=(route,index)=>stops.find(s=>s.route_id===route&&s.stop_index===index)?.name??`Punto autorizado ${index+1}`;
      return {...snapshot,mode:'LOCAL_LAB',reservationWritesEnabled:false,services:snapshot.services.map(s=>({
        ...s,boardingName:name(s.routeId,s.from),alightingName:name(s.routeId,s.to),terminalReference:null,
        segments:s.segments.map(segment=>({...segment,fromName:name(s.routeId,segment.segment),toName:name(s.routeId,segment.segment+1)}))
      }))};
    }
  });
}
