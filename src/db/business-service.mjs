import { createService } from './service.mjs';
import { assertRuntime } from './runtime.mjs';
import { object,id,actionKey,segment,validateReservation,page } from '../domain/business.mjs';

export function createBusinessService(pool) {
  const core=createService(pool);
  async function transaction(token,work) {
    if(typeof token!=='string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new Error('UNAUTHENTICATED');
    const c=await pool.connect();
    try {
      await assertRuntime(c,'nexo_app');
      await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
      await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
      if(!(await c.query('SELECT nexo.actor() AS actor')).rows[0].actor)throw new Error('UNAUTHENTICATED');
      const result=await work(c);await c.query('COMMIT');return result;
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  const reserve=(source)=>(token,key,request)=>{
    actionKey(key);const q=validateReservation(request);
    return transaction(token,async c=>(await c.query('SELECT nexo.reserve_business($1,$2,$3) AS result',[
      key,{...q.request,source},q.quote])).rows[0].result);
  };
  const bookingFields='id,association_id,trip_id,route_id,group_id,source,seats,express,from_stop,to_stop,fare_id,price_bob,fare_version,status,expires_at,driver_accepted';
  return Object.freeze({
    reserve:reserve('APP'),walkIn:reserve('WALK_IN'),
    quote:(token,request)=>{
      object(request,['routeId','from','to','seats','express']);const q=segment(request);
      return transaction(token,async c=>{
        if(!(await c.query('SELECT nexo.can_search_route($1) AS allowed',[q.routeId])).rows[0].allowed)
          throw new Error('ROUTE_NOT_ELIGIBLE');
        const {rows}=await c.query(`SELECT id,version,amount_bob FROM nexo.fares WHERE route_id=$1 AND from_stop=$2 AND to_stop=$3
          AND express=$4 AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())`,[q.routeId,q.from,q.to,q.express]);
        if(rows.length!==1)throw new Error('FARE_UNRESOLVED');
        const f=rows[0];
        const total=(await c.query('SELECT ($1::numeric*$2::integer)::numeric(12,2)::text AS total',[f.amount_bob,q.express?1:q.seats])).rows[0].total;
        return {fareId:f.id,fareVersion:f.version,totalBOB:total,currency:'BOB'};
      });
    },
    booking:(token,bookingId)=>{
      id(bookingId);return transaction(token,async c=>{
        const b=(await c.query('SELECT '+bookingFields+' FROM nexo.bookings WHERE id=$1',[bookingId])).rows[0];
        if(!b)throw new Error('NOT_FOUND');
        const movements=(await c.query('SELECT kind,stop_index,created_at FROM nexo.booking_movements WHERE booking_id=$1 ORDER BY created_at,kind',[bookingId])).rows;
        return {...b,movements,movementState:movements.some(m=>m.kind==='ALIGHT')?'ALIGHTED':movements.some(m=>m.kind==='BOARD')?'BOARDED':'UNRECORDED'};
      });
    },
    queue:(token,request)=>{
      const q=page(request,'routeId');return transaction(token,async c=>(await c.query(`SELECT id,association_id,route_id,vehicle_id,status,position_no,current_stop
        FROM nexo.trips WHERE route_id=$1 AND status='QUEUED' ORDER BY position_no,id LIMIT $2 OFFSET $3`,[q.routeId,q.limit,q.offset])).rows);
    },
    manifest:(token,request)=>{
      const q=page(request,'tripId');return transaction(token,async c=>{
        const t=(await c.query('SELECT id,association_id,route_id,status,current_stop FROM nexo.trips WHERE id=$1',[q.tripId])).rows[0];
        if(!t)throw new Error('NOT_FOUND');
        const bookings=(await c.query('SELECT '+bookingFields+' FROM nexo.bookings WHERE trip_id=$1 ORDER BY from_stop,created_at,id LIMIT $2 OFFSET $3',[q.tripId,q.limit,q.offset])).rows;
        return {trip:t,bookings,limit:q.limit,offset:q.offset};
      });
    },
    respond:(token,key,bookingId,accept)=>{
      actionKey(key);id(bookingId);if(typeof accept!=='boolean')throw new Error('INVALID_RESPONSE');
      return core.respond(token,key,bookingId,accept);
    },
    cancel:(token,key,bookingId)=>core.cancel(token,actionKey(key),id(bookingId)),
    depart:(token,key,tripId)=>core.depart(token,actionKey(key),id(tripId)),
    progress:(token,key,tripId,stop)=>{
      actionKey(key);id(tripId);if(!Number.isInteger(stop)||stop<0||stop>10000)throw new Error('INVALID_PROGRESS');
      return core.progress(token,key,tripId,stop);
    },
    requestQueue:(token,key,previousTripId,routeId)=>core.requestQueue(token,actionKey(key),id(previousTripId),id(routeId)),
    movement:(token,key,bookingId,kind)=>{
      actionKey(key);id(bookingId);if(!['BOARD','ALIGHT'].includes(kind))throw new Error('INVALID_MOVEMENT');
      return transaction(token,async c=>(await c.query('SELECT nexo.record_movement($1,$2,$3) AS result',[key,bookingId,kind])).rows[0].result);
    }
  });
}
