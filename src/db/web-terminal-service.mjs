import {createBusinessService} from './business-service.mjs';
import {assertRuntime} from './runtime.mjs';
import {object,id,actionKey} from '../domain/business.mjs';
import {journeyRequest} from './web-reservation-service.mjs';

const commands={REJECT_OFFER:['bookingId'],CANCEL_BOOKING:['bookingId'],RETURN_QUEUE:['tripId','routeId']};
export function validateTerminalCommand(b){
  if(!b||!Object.hasOwn(commands,b.kind))throw new Error('INVALID_OPERATION');
  object(b,['kind','confirmed',...commands[b.kind]]);
  if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');
  for(const field of commands[b.kind])id(b[field]);
  return b;
}
export function directoryPage(b){
  object(b,['limit','offset','routeId','status']);
  const {limit=20,offset=0,status='ALL'}=b;
  if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000||!['ALL','QUEUED','IN_TRANSIT','COMPLETED','WITHDRAWN'].includes(status))throw new Error('INVALID_PAGE');
  if(b.routeId!==undefined)id(b.routeId);
  return {limit,offset,status,routeId:b.routeId??null};
}
export function createWebTerminalService(pool){
  const business=createBusinessService(pool);
  async function tx(token,work){
    const c=await pool.connect();
    try{
      await assertRuntime(c,'nexo_app');await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
      await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
      const actor=(await c.query('SELECT nexo.actor() AS id')).rows[0].id;
      if(!actor)throw new Error('UNAUTHENTICATED');
      const result=await work(c,actor);await c.query('COMMIT');return result;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  const snapshot=async(c,trip,view)=>(await c.query('SELECT nexo.web_trip_snapshot($1,$2)AS r',[id(trip),view])).rows[0].r;
  async function sale(token,b,quoted){
    object(b,['tripId','boardingPointId','alightingPointId','seats',...(quoted?['quote','confirmed']:[])]);
    const s=await tx(token,c=>snapshot(c,b.tripId,'ADMIN'));
    // A new sale is checked by the native mutation under locks; a receipt replay
    // must remain possible after departure or a later incident.
    if(!quoted&&(s.status!=='QUEUED'||!s.operationAllowed))throw new Error('OPERATION_BLOCKED');
    const journey={...b,routeId:s.routeId,flow:'QUEUE'};
    const {from,to}=journeyRequest(journey,quoted);
    return {journey,s,request:{routeId:s.routeId,from,to,seats:b.seats,parts:[{tripId:s.tripId,seats:b.seats}],...(quoted?{quote:b.quote}:{})}};
  }
  return Object.freeze({
    directory:(token,b)=>{const q=directoryPage(b);return tx(token,async(c,actor)=>{
      if(!(await c.query("SELECT 1 FROM nexo.memberships WHERE user_id=$1 AND role='ASSOCIATION_ADMIN'AND active LIMIT 1",[actor])).rowCount)throw new Error('FORBIDDEN');
      const routes=(await c.query(`SELECT r.id,r.name,a.name AS association FROM nexo.routes r JOIN nexo.associations a ON a.id=r.association_id
        WHERE nexo.manage_route(r.id) ORDER BY a.name,r.id LIMIT 100`)).rows;
      const rows=(await c.query(`WITH page AS MATERIALIZED(SELECT t.id AS "tripId",t.route_id AS "routeId",r.name AS route,a.name AS association,v.label AS vehicle,t.status,
        t.position_no AS position,EXISTS(SELECT FROM nexo.vehicle_blocks x WHERE x.vehicle_id=t.vehicle_id AND x.blocked) AS blocked
        FROM nexo.trips t JOIN nexo.routes r ON r.id=t.route_id JOIN nexo.associations a ON a.id=t.association_id JOIN nexo.vehicles v ON v.id=t.vehicle_id
        WHERE nexo.manage_route(t.route_id) AND ($1::uuid IS NULL OR t.route_id=$1)AND($2='ALL'OR t.status=$2)
        ORDER BY a.name,r.id,t.position_no,t.id LIMIT $3 OFFSET $4),
        snapshots AS MATERIALIZED(SELECT page.*,nexo.web_trip_snapshot("tripId",'ADMIN')AS detail FROM page)
        SELECT "tripId","routeId",route,association,vehicle,status,position,blocked,
        (detail->>'observedOnboard')::integer AS onboard,(detail->>'confirmedSeats')::integer AS confirmed,
        detail->>'phase'AS phase,(detail->>'departureEligible')::boolean AS "departureEligible",(detail->>'operationAllowed')::boolean AS "operationAllowed",
        (SELECT coalesce(max((s->>'reserved')::integer),0) FROM jsonb_array_elements(detail->'segments')s)AS reserved
        FROM snapshots ORDER BY association,"routeId",position,"tripId"`,[q.routeId,q.status,q.limit+1,q.offset])).rows;
      return {trips:rows.slice(0,q.limit),routes,limit:q.limit,offset:q.offset,hasMore:rows.length>q.limit,snapshotOnly:true,routeLimit:100};
    });},
    saleContext:(token,b)=>{object(b,['tripId']);return tx(token,async c=>{
      const s=await snapshot(c,b.tripId,'ADMIN');
      return {tripId:s.tripId,routeId:s.routeId,status:s.status,operationAllowed:s.operationAllowed,vehicle:s.vehicleLabel,points:s.points};
    });},
    quote:async(token,b)=>{const q=await sale(token,b,false);return business.quote(token,{routeId:q.s.routeId,from:q.request.from,to:q.request.to,seats:b.seats});},
    walkIn:async(token,key,b)=>{actionKey(key);const q=await sale(token,b,true);const r=await business.walkIn(token,key,q.request);
      return {bookingIds:r.bookingIds,initialStatus:r.initialStatus,totalPriceBOB:r.totalPriceBOB,currency:r.currency,moneyProcessed:false};
    },
    returnOptions:(token,b)=>{object(b,['tripId']);return tx(token,async c=>{
      const s=await snapshot(c,b.tripId,'DRIVER');
      const routes=(await c.query(`SELECT r.id,r.name FROM nexo.trips t JOIN nexo.routes src ON src.id=t.route_id JOIN nexo.routes r
        ON r.association_id=t.association_id AND r.catalog_id=src.catalog_id AND r.origin_locality_id=src.destination_locality_id
        WHERE t.id=$1 AND nexo.can_search_route(r.id) ORDER BY r.name,r.id LIMIT 20`,[s.tripId])).rows;
      const active=(await c.query("SELECT 1 FROM nexo.trips t WHERE (t.vehicle_id=(SELECT vehicle_id FROM nexo.trips WHERE id=$1)OR t.driver_id=nexo.actor())AND t.status IN('QUEUED','IN_TRANSIT')LIMIT 1",[s.tripId])).rowCount>0;
      return {tripId:s.tripId,routes,canReturn:s.status==='COMPLETED'&&s.observedOnboard===0&&s.operationAllowed&&!active&&routes.length>0,
        reason:s.status!=='COMPLETED'?'NOT_COMPLETED':s.observedOnboard>0?'ONBOARD_PENDING':!s.operationAllowed?'OPERATION_BLOCKED':active?'ALREADY_ACTIVE':routes.length===0?'NO_DESTINATION_QUEUE':null,snapshotOnly:true,limit:20};
    });},
    command:async(token,key,request)=>{
      const b=validateTerminalCommand(request);actionKey(key);
      if(b.kind==='REJECT_OFFER')return business.respond(token,key,b.bookingId,false);
      if(b.kind==='CANCEL_BOOKING'){
        await tx(token,async(c,actor)=>{if(!(await c.query("SELECT 1 FROM nexo.bookings WHERE id=$1 AND passenger_id=$2 AND source='APP'",[b.bookingId,actor])).rowCount)throw new Error('FORBIDDEN');});
        return business.cancel(token,key,b.bookingId);
      }
      return tx(token,async c=>(await c.query('SELECT nexo.web_request_queue($1,$2,$3)AS r',[key,b.tripId,b.routeId])).rows[0].r);
    }
  });
}
