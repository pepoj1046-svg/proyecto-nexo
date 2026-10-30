import {createService}from'./service.mjs';
import {createBusinessService}from'./business-service.mjs';
import {assertRuntime}from'./runtime.mjs';
import {object,id,actionKey}from'../domain/business.mjs';
import{createHash}from'node:crypto';
import {cursorPage} from './web-management-service.mjs';
export function pointIndex(point,route){if(typeof point!=='string'||!point.startsWith(route+':')||!/^\d{1,5}$/.test(point.slice(route.length+1)))throw new Error('INVALID_AUTHORIZED_POINTS');const index=Number(point.slice(route.length+1));if(index>10000)throw new Error('INVALID_AUTHORIZED_POINTS');return index;}
export function journeyRequest(b,withQuote=false){
 object(b,withQuote?['routeId','tripId','boardingPointId','alightingPointId','seats','flow','quote','confirmed']:['routeId','tripId','boardingPointId','alightingPointId','seats','flow']);id(b.routeId);id(b.tripId);
 const from=pointIndex(b.boardingPointId,b.routeId),to=pointIndex(b.alightingPointId,b.routeId);
 if(from>=to||!Number.isInteger(b.seats)||b.seats<1||b.seats>6||!['QUEUE','ENROUTE'].includes(b.flow)||withQuote&&b.confirmed!==true)throw new Error('INVALID_RESERVATION');
 if(withQuote){object(b.quote,['fareId','fareVersion','totalBOB']);id(b.quote.fareId);if(!Number.isInteger(b.quote.fareVersion)||b.quote.fareVersion<1||typeof b.quote.totalBOB!=='string'||!/^(0|[1-9][0-9]{0,9})\.\d{2}$/.test(b.quote.totalBOB))throw new Error('INVALID_QUOTE');}
 return{from,to};
}
export function createWebReservationService(pool){
 const core=createService(pool),business=createBusinessService(pool);
 async function tx(token,work){const c=await pool.connect();try{await assertRuntime(c,'nexo_app');await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);const actor=(await c.query('SELECT nexo.actor() AS id')).rows[0].id;if(!actor)throw new Error('UNAUTHENTICATED');const result=await work(c,actor);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const me=token=>tx(token,async(c,actor)=>({accountRef:createHash('sha256').update(actor).digest('hex').slice(0,32),operator:(await c.query("SELECT 1 FROM nexo.memberships WHERE user_id=$1 AND role='DRIVER' AND active LIMIT 1",[actor])).rowCount>0}));
 const own=(token,booking)=>tx(token,async(c,actor)=>{if(!(await c.query("SELECT 1 FROM nexo.bookings WHERE id=$1 AND passenger_id=$2 AND source='APP'",[id(booking),actor])).rowCount)throw new Error('NOT_FOUND');return true;});
 return Object.freeze({me,logout:token=>core.logout(token),
  list:(token,request={})=>{object(request,['limit','offset']);const{limit=50,offset=0}=request;if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('INVALID_PAGE');return tx(token,async(c,actor)=>{
   const result=(await c.query('SELECT nexo.passenger_reservations($1,$2)AS result',[limit,offset])).rows[0].result;
   const rows=(await c.query("SELECT b.id,b.driver_accepted,(nexo.group_status(b.id)->>'confirmationAuthority')AS authority FROM nexo.bookings b WHERE b.id=ANY($1::uuid[])AND b.passenger_id=$2 AND b.source='APP'",[result.bookings.map(b=>b.bookingId),actor])).rows;
   const current=new Map(rows.map(r=>[r.id,r]));for(const b of result.bookings){const row=current.get(b.bookingId);b.confirmationAuthority=row?.authority??null;b.driverAccepted=row?.driver_accepted??false;}return result;
  });},
  page:(token,b={})=>{const q=cursorPage(b);return tx(token,async(c,actor)=>{
   const r=(await c.query("SELECT nexo.web_bookings_page(NULL,'OWN',$1,$2)AS r",[q.limit,q.cursor])).rows[0].r;
   const rows=(await c.query("SELECT b.id,b.driver_accepted,(nexo.group_status(b.id)->>'confirmationAuthority')AS authority FROM nexo.bookings b WHERE b.id=ANY($1::uuid[])AND b.passenger_id=$2 AND b.source='APP'",[r.bookings.map(b=>b.bookingId),actor])).rows;
   for(const b of r.bookings){const row=rows.find(x=>x.id===b.bookingId);b.confirmationAuthority=row?.authority??null;b.driverAccepted=row?.driver_accepted??false;}return r;
  });},
  quote:(token,b)=>{const{from,to}=journeyRequest(b);return business.quote(token,{routeId:b.routeId,from,to,seats:b.seats});},
  reserve:async(token,key,b)=>{
   actionKey(key);const{from,to}=journeyRequest(b,true);let receipt;
   if(b.flow==='QUEUE')receipt=await business.reserve(token,key,{routeId:b.routeId,from,to,seats:b.seats,parts:[{tripId:b.tripId,seats:b.seats}],quote:b.quote});
   else receipt=await business.closure(token,key,'reserve-enroute',{routeId:b.routeId,tripId:b.tripId,from,to,seats:b.seats,quote:b.quote});
   const ids=receipt.bookingIds??(receipt.bookings?.map(x=>x.bookingId))??[receipt.bookingId];
   const bookings=[];for(const bookingId of ids){await own(token,bookingId);const row=await business.booking(token,bookingId);bookings.push({bookingId:row.id,status:row.status,effectiveStatus:row.assignment?.state??row.status,tripId:row.trip_id,seats:row.seats,priceBOB:row.price_bob});}
   return{bookings,storage:'EPHEMERAL_LAB',moneyProcessed:false};
  },
  operatorList:token=>tx(token,async(c,actor)=>{if(!(await c.query("SELECT 1 FROM nexo.memberships WHERE user_id=$1 AND role='DRIVER'AND active LIMIT 1",[actor])).rowCount)throw new Error('FORBIDDEN');return{offers:(await c.query(`SELECT b.id AS "bookingId",a.name AS association,b.seats,b.price_bob AS "priceBOB",b.status,b.expires_at AS "expiresAt",s.name AS "boardingName",d.name AS "alightingName" FROM nexo.bookings b JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.associations a ON a.id=b.association_id JOIN nexo.stops s ON s.route_id=b.route_id AND s.stop_index=b.from_stop JOIN nexo.stops d ON d.route_id=b.route_id AND d.stop_index=b.to_stop WHERE t.driver_id=$1 AND nexo.drives(t.id)AND b.status='HELD'AND b.expires_at>clock_timestamp()ORDER BY b.created_at,b.id LIMIT 50`,[actor])).rows};}),
  accept:async(token,key,b)=>{object(b,['bookingId','confirmed']);id(b.bookingId);if(b.confirmed!==true)throw new Error('INVALID_CONFIRMATION');actionKey(key);return business.respond(token,key,b.bookingId,true);}
 });
}
