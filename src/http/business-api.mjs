import { createBusinessService } from '../db/business-service.mjs';
import { assertRuntime } from '../db/runtime.mjs';
import { object } from '../domain/business.mjs';
import { startLocalTransport } from './local-transport.mjs';

// Business-only listener: no identity, registration, SQL or provisioning pool.
export async function startBusinessRuntime(pool) {
  const c=await pool.connect();
  try {await assertRuntime(c,'nexo_app',{localTest:true});} finally {c.release();}
  const service=createBusinessService(pool);
  const route=(keys,fn)=>async(body,token,key)=>{object(body,keys);return [200,await fn(token,key,body)];};
  return startLocalTransport({localTest:true,allProtected:true,mutations:[
    '/business/reserve','/business/walk-in','/business/respond','/business/cancel',
    '/business/depart','/business/progress','/business/request-queue','/business/movement'
  ],routes:{
    '/business/quote':route(['routeId','from','to','seats','express'],(t,_k,b)=>service.quote(t,b)),
    '/business/reserve':route(['routeId','from','to','seats','express','parts','splitConsent','containsMinors','quote'],(t,k,b)=>service.reserve(t,k,b)),
    '/business/walk-in':route(['routeId','from','to','seats','express','parts','splitConsent','containsMinors','quote'],(t,k,b)=>service.walkIn(t,k,b)),
    '/business/booking':route(['bookingId'],(t,_k,b)=>service.booking(t,b.bookingId)),
    '/business/queue':route(['routeId','limit','offset'],(t,_k,b)=>service.queue(t,b)),
    '/business/manifest':route(['tripId','limit','offset'],(t,_k,b)=>service.manifest(t,b)),
    '/business/respond':route(['bookingId','accept'],(t,k,b)=>service.respond(t,k,b.bookingId,b.accept)),
    '/business/cancel':route(['bookingId'],(t,k,b)=>service.cancel(t,k,b.bookingId)),
    '/business/depart':route(['tripId'],(t,k,b)=>service.depart(t,k,b.tripId)),
    '/business/progress':route(['tripId','stop'],(t,k,b)=>service.progress(t,k,b.tripId,b.stop)),
    '/business/request-queue':route(['previousTripId','routeId'],(t,k,b)=>service.requestQueue(t,k,b.previousTripId,b.routeId)),
    '/business/movement':route(['bookingId','kind'],(t,k,b)=>service.movement(t,k,b.bookingId,b.kind))
  }});
}
