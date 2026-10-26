import { createService } from './service.mjs';
import { assertRuntime } from './runtime.mjs';
import { object,id,actionKey,segment,validateReservation,page,memberCommand } from '../domain/business.mjs';

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
  async function members(c,bookingId) {
    return (await c.query(`SELECT m.id,m.ordinal,
      coalesce((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'stop',e.stop_index,'createdAt',e.created_at) ORDER BY e.created_at,e.kind)
        FROM nexo.member_movements e WHERE e.member_id=m.id),'[]') AS movements,
      CASE WHEN EXISTS(SELECT FROM nexo.member_movements e WHERE e.member_id=m.id AND kind='ALIGHT') THEN 'ALIGHTED'
        WHEN EXISTS(SELECT FROM nexo.member_movements e WHERE e.member_id=m.id AND kind='BOARD') THEN 'BOARDED' ELSE 'UNRECORDED' END AS state,
      EXISTS(SELECT FROM nexo.booking_movements e WHERE e.booking_id=m.booking_id) AS legacy_aggregate,
      coalesce((SELECT jsonb_agg(jsonb_build_object('kind',d.kind,'createdAt',d.created_at,'delivery',d.delivery) ORDER BY d.created_at,d.kind)
        FROM nexo.absence_drafts d WHERE d.member_id=m.id),'[]') AS absence_drafts
      FROM nexo.booking_members m WHERE m.booking_id=$1 ORDER BY m.ordinal`,[bookingId])).rows;
  }
  const memberMutation=(fn,kinds)=>(token,key,memberId,kind)=>{
    actionKey(key);memberCommand({memberId,kind},kinds);
    return transaction(token,async c=>(await c.query(`SELECT nexo.${fn}($1,$2,$3) AS result`,[key,memberId,kind])).rows[0].result);
  };
  const terminalCall=(fn,args)=>(token,...values)=>transaction(token,async c=>(await c.query(`SELECT nexo.${fn}(${args}) AS result`,values)).rows[0].result);
  return Object.freeze({
    advancementCandidates:(token,trip)=>transaction(token,async c=>(await c.query('SELECT * FROM nexo.advancement_candidates($1) AS proposal',[trip])).rows.map(r=>r.proposal)),
    configureTerminal:terminalCall('configure_terminal','$1,$2,$3'),
    terminalCommand:terminalCall('terminal_command','$1,$2,$3,$4'),
    terminalEvaluation:terminalCall('terminal_evaluation','$1'),
    transferCandidates:(token,booking,direction)=>transaction(token,async c=>(await c.query('SELECT * FROM nexo.transfer_candidates($1,$2) AS trip_id',[booking,direction])).rows),
    transferBooking:terminalCall('transfer_booking','$1,$2,$3,$4'),
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
        return {...b,members:await members(c,bookingId),movements,movementState:movements.some(m=>m.kind==='ALIGHT')?'ALIGHTED':movements.some(m=>m.kind==='BOARD')?'BOARDED':'UNRECORDED'};
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
        for(const b of bookings)b.members=await members(c,b.id);
        const segments=(await c.query(`SELECT s.stop_index AS segment,
          coalesce(sum(b.seats) FILTER(WHERE b.status='CONFIRMED' OR (b.status='HELD' AND b.expires_at>clock_timestamp())),0)::integer AS reserved
          FROM nexo.stops s LEFT JOIN nexo.bookings b ON b.trip_id=$1 AND b.from_stop<=s.stop_index AND b.to_stop>s.stop_index
          WHERE s.route_id=$2 AND s.stop_index<(SELECT max(stop_index) FROM nexo.stops WHERE route_id=$2)
          GROUP BY s.stop_index ORDER BY s.stop_index`,[q.tripId,t.route_id])).rows;
        const observed=(await c.query(`SELECT
          (SELECT count(*) FROM nexo.member_movements m JOIN nexo.bookings b ON b.id=m.booking_id WHERE b.trip_id=$1 AND m.kind='BOARD'
            AND NOT EXISTS(SELECT FROM nexo.member_movements a WHERE a.member_id=m.member_id AND a.kind='ALIGHT'))::integer
          +coalesce((SELECT sum(b.seats) FROM nexo.booking_movements m JOIN nexo.bookings b ON b.id=m.booking_id WHERE b.trip_id=$1 AND m.kind='BOARD'
            AND NOT EXISTS(SELECT FROM nexo.booking_movements a WHERE a.booking_id=m.booking_id AND a.kind='ALIGHT')),0)::integer AS onboard`,[q.tripId])).rows[0].onboard;
        return {trip:t,bookings,segments,observedOnboard:observed,departurePolicy:'EXISTING_CONFIRMED_INVENTORY',limit:q.limit,offset:q.offset};
      });
    },
    roster:(token,bookingId)=>{
      id(bookingId);return transaction(token,async c=>{
        if(!(await c.query('SELECT id FROM nexo.bookings WHERE id=$1',[bookingId])).rowCount)throw new Error('NOT_FOUND');
        return {bookingId,members:await members(c,bookingId),identifiers:'TECHNICAL_RESERVED_SLOTS'};
      });
    },
    memberMovement:memberMutation('record_member_movement',['BOARD','ALIGHT']),
    absenceDraft:memberMutation('record_absence_draft',['WAITING','WARNING_DRAFT','GRACE_DRAFT','RESOLVED']),
    absencePreview:(token,memberId)=>{
      id(memberId);return transaction(token,async c=>{
        const row=(await c.query(`SELECT m.id,
          EXISTS(SELECT FROM nexo.member_movements e WHERE e.member_id=m.id AND e.kind='BOARD') OR
          EXISTS(SELECT FROM nexo.booking_movements e WHERE e.booking_id=m.booking_id AND e.kind='BOARD') OR
          EXISTS(SELECT FROM nexo.absence_drafts d WHERE d.member_id=m.id AND d.kind='RESOLVED') AS resolved,
          (SELECT greatest(0,extract(epoch FROM clock_timestamp()-d.created_at))::integer FROM nexo.absence_drafts d
            WHERE d.member_id=m.id AND d.kind='WAITING') AS elapsed
          FROM nexo.booking_members m WHERE m.id=$1`,[memberId])).rows[0];
        if(!row)throw new Error('NOT_FOUND');
        return {memberId,policyActive:false,delivery:'DISABLED',referenceMinutes:{warning:10,graceEnds:15},
          suggestedDraft:row.resolved?'RESOLVED':row.elapsed===null?'NOT_STARTED':row.elapsed>=900?'GRACE_DRAFT':row.elapsed>=600?'WARNING_DRAFT':'WAITING'};
      });
    },
    offers:(token,request)=>{
      const q=page(request,'tripId');return transaction(token,async c=>{
        if(!(await c.query('SELECT id FROM nexo.trips WHERE id=$1',[q.tripId])).rowCount)throw new Error('NOT_FOUND');
        const offers=(await c.query(`SELECT id,group_id,driver_accepted,expires_at,status,
          CASE WHEN status='HELD' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END AS effective_status
          FROM nexo.bookings WHERE trip_id=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3`,[q.tripId,q.limit,q.offset])).rows;
        return {tripId:q.tripId,offers,provisionalTtlSeconds:120,commercialPolicyApproved:false};
      });
    },
    refreshOffers:(token,key,tripId)=>{
      actionKey(key);id(tripId);return transaction(token,async c=>(await c.query('SELECT nexo.refresh_offers($1,$2) AS result',[key,tripId])).rows[0].result);
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
