import {createBusinessService} from './business-service.mjs';
import {assertRuntime} from './runtime.mjs';
import {object,id,actionKey} from '../domain/business.mjs';
import {journeyRequest} from './web-reservation-service.mjs';

// 4B.1. A driver registers a terminal walk-in on his own trip in turn while his
// association is unstaffed. Every rule is re-checked by PostgreSQL inside the native
// inventory transaction; this module only shapes requests and responses.
const time=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export function validateSchedule(b){
  object(b,['associationId','expectedRevision','windows','confirmed']);id(b.associationId);
  if(!Number.isInteger(b.expectedRevision)||b.expectedRevision<0||b.expectedRevision>2147483647||!Array.isArray(b.windows)||b.windows.length>21)throw new Error('INVALID_SCHEDULE');
  const seen=new Set();
  const windows=b.windows.map(w=>{
    object(w,['weekday','start','end']);
    if(!Number.isInteger(w.weekday)||w.weekday<1||w.weekday>7||typeof w.start!=='string'||!time.test(w.start)||typeof w.end!=='string'||!time.test(w.end)||w.start===w.end)throw new Error('INVALID_SCHEDULE');
    const k=w.weekday+':'+w.start;if(seen.has(k))throw new Error('INVALID_SCHEDULE');seen.add(k);
    return {weekday:w.weekday,start:w.start,end:w.end};
  });
  if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
  return {associationId:b.associationId,expectedRevision:b.expectedRevision,windows};
}
export function validateDriverSale(b,quoted){
  object(b,['tripId','boardingPointId','alightingPointId','seats',...(quoted?['quote','confirmed','noMinors']:[])]);id(b.tripId);
  // M1: the driver attests that no minor travels in this group. Minors are referred to
  // the association; the server rejects any other value.
  if(quoted&&b.noMinors!==true)throw new Error('MINOR_REVIEW_REQUIRED');
  return b;
}
export function createWebDriverWalkInService(pool){
  const business=createBusinessService(pool);
  async function tx(token,work){
    const c=await pool.connect();
    try{
      await assertRuntime(c,'nexo_app');await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
      await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
      if(!(await c.query('SELECT nexo.actor() AS id')).rows[0].id)throw new Error('UNAUTHENTICATED');
      const result=await work(c);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  const one=async(c,query,values)=>(await c.query(query,values)).rows[0].r;
  async function sale(token,b,quoted){
    validateDriverSale(b,quoted);
    const s=await tx(token,c=>one(c,"SELECT nexo.web_trip_snapshot($1,'DRIVER')AS r",[b.tripId]));
    if(!quoted&&s.status!=='QUEUED')throw new Error('OPERATION_BLOCKED');
    const {from,to}=journeyRequest({tripId:b.tripId,boardingPointId:b.boardingPointId,alightingPointId:b.alightingPointId,seats:b.seats,routeId:s.routeId,flow:'QUEUE',...(quoted?{quote:b.quote,confirmed:b.confirmed}:{})},quoted);
    return {s,request:{routeId:s.routeId,from,to,seats:b.seats,parts:[{tripId:s.tripId,seats:b.seats}],containsMinors:false,...(quoted?{quote:b.quote}:{})}};
  }
  return Object.freeze({
    context:async(token,b)=>{object(b,['tripId']);id(b.tripId);return tx(token,async c=>{
      const x=await one(c,'SELECT nexo.web_driver_walk_in_context($1)AS r',[b.tripId]),s=await one(c,"SELECT nexo.web_trip_snapshot($1,'DRIVER')AS r",[b.tripId]);
      return {...x,vehicle:s.vehicleLabel,points:s.points.map(p=>({id:p.id,order:p.order,name:p.name,kind:p.kind,boardingAllowed:p.boardingAllowed&&p.kind==='TERMINAL',alightingAllowed:p.alightingAllowed}))};
    });},
    quote:async(token,b)=>{const q=await sale(token,b,false);return business.quote(token,{routeId:q.s.routeId,from:q.request.from,to:q.request.to,seats:b.seats});},
    register:async(token,key,b)=>{actionKey(key);const q=await sale(token,b,true);const r=await business.walkIn(token,key,q.request);
      return {bookingIds:r.bookingIds,groupId:r.groupId,initialStatus:r.initialStatus,totalPriceBOB:r.totalPriceBOB,currency:r.currency,moneyProcessed:false};
    },
    schedule:async(token,b)=>{object(b,['associationId']);id(b.associationId);return tx(token,c=>one(c,'SELECT nexo.web_unstaffed_schedule($1)AS r',[b.associationId]));},
    setSchedule:async(token,key,b)=>{actionKey(key);const q=validateSchedule(b);return tx(token,c=>one(c,'SELECT nexo.web_set_unstaffed_schedule($1,$2,$3,$4)AS r',[key,q.associationId,q.expectedRevision,JSON.stringify(q.windows)]));},
    registrations:async(token,b)=>{object(b,['associationId','limit','offset']);id(b.associationId);const {limit=20,offset=0}=b;
      if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('INVALID_PAGE');
      return tx(token,c=>one(c,'SELECT nexo.web_driver_walk_ins($1,$2,$3)AS r',[b.associationId,limit,offset]));}
  });
}
