-- Local web projections and explicit route metadata, not a new inventory/dispatch engine.
-- Metadata is provisioned offline; existing stops are never classified heuristically.
CREATE TABLE nexo.web_point_profiles (
 association_id uuid NOT NULL,route_id uuid NOT NULL,stop_index integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('TERMINAL','URBAN','ROAD')),
 main_departure boolean NOT NULL DEFAULT false CHECK(NOT main_departure OR kind='URBAN'),
 PRIMARY KEY(route_id,stop_index),
 FOREIGN KEY(association_id,route_id,stop_index) REFERENCES nexo.stops(association_id,route_id,stop_index)
);
CREATE UNIQUE INDEX web_main_departure ON nexo.web_point_profiles(route_id) WHERE main_departure;
ALTER TABLE nexo.web_point_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexo.web_point_profiles FROM PUBLIC,nexo_app;
ALTER FUNCTION nexo.public_route_points(uuid) RENAME TO public_route_points_023;
REVOKE EXECUTE ON FUNCTION nexo.public_route_points_023(uuid) FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.public_route_points(route uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(jsonb_agg(p.value||jsonb_build_object('kind',coalesce(m.kind,'UNCLASSIFIED'),'boardingAllowed',(p.value->>'boardingAllowed')::boolean AND coalesce(c.state,'NORMAL')<>'SUSPENDIDA'AND NOT((p.value->>'order')::integer=ANY(coalesce(c.affected_stops,'{}'::integer[]))),'alightingAllowed',(p.value->>'alightingAllowed')::boolean AND coalesce(c.state,'NORMAL')<>'SUSPENDIDA'AND NOT((p.value->>'order')::integer=ANY(coalesce(c.affected_stops,'{}'::integer[])))) ORDER BY (p.value->>'order')::integer),'[]')
 FROM jsonb_array_elements(nexo.public_route_points_023(route))p
 LEFT JOIN nexo.web_point_profiles m ON m.route_id=route AND m.stop_index=(p.value->>'order')::integer LEFT JOIN nexo.route_conditions c ON c.route_id=route
$$;
CREATE FUNCTION nexo.web_trip_snapshot(trip uuid,view_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();t nexo.trips;operation jsonb;points jsonb;segments jsonb;reservations jsonb;incident jsonb;
 confirmed integer;held integer;maximum integer;main_point integer;allowed boolean;
BEGIN
 SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF t.id IS NULL OR view_kind IS NULL OR view_kind NOT IN('PASSENGER','ADMIN','DRIVER') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF view_kind='PASSENGER' THEN
  IF NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=trip AND b.passenger_id=u AND b.source='APP') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSE
  PERFORM nexo.check_scope(t.route_id);
  IF view_kind='ADMIN' AND NOT nexo.manage_route(t.route_id) OR view_kind='DRIVER' AND NOT nexo.drives(trip) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END IF;
 operation:=nexo.operational_status(trip);
 SELECT coalesce((operation->>'mainStop')::integer,(SELECT stop_index FROM nexo.web_point_profiles WHERE route_id=t.route_id AND main_departure))INTO main_point;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.route_id::text||':'||s.stop_index,'order',s.stop_index,'name',s.name,'kind',coalesce(p.kind,'UNCLASSIFIED'),'boardingAllowed',s.boarding_allowed,'alightingAllowed',s.alighting_allowed)ORDER BY s.stop_index),'[]')INTO points
 FROM nexo.stops s LEFT JOIN nexo.web_point_profiles p ON p.route_id=s.route_id AND p.stop_index=s.stop_index WHERE s.route_id=t.route_id;
 SELECT coalesce(sum(seats)FILTER(WHERE status='CONFIRMED'),0),coalesce(sum(seats)FILTER(WHERE status='HELD'AND expires_at>clock_timestamp()),0)INTO confirmed,held FROM nexo.bookings WHERE trip_id=trip;
 SELECT coalesce(jsonb_agg(jsonb_build_object('fromName',s.name,'toName',d.name,'reserved',x.used,'confirmed',x.confirmed,'available',6-x.used)ORDER BY s.stop_index),'[]'),coalesce(max(x.confirmed),0)INTO segments,maximum
 FROM nexo.stops s JOIN nexo.stops d ON d.route_id=s.route_id AND d.stop_index=s.stop_index+1
 CROSS JOIN LATERAL(SELECT coalesce(sum(b.seats)FILTER(WHERE nexo.live(b)),0)::integer AS used,coalesce(sum(b.seats)FILTER(WHERE b.status='CONFIRMED'),0)::integer AS confirmed FROM nexo.bookings b WHERE b.trip_id=trip AND b.from_stop<=s.stop_index AND b.to_stop>s.stop_index)x WHERE s.route_id=t.route_id;
 SELECT jsonb_build_object('state',f.state,'context',f.context,'reason',f.reason,'roadVersion',rr.version)INTO incident FROM nexo.fleet_incidents f LEFT JOIN nexo.road_rescues rr ON rr.incident_id=f.id WHERE f.trip_id=trip ORDER BY f.created_at DESC,f.id DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at,id),'[]')INTO reservations FROM(
 SELECT b.id,b.created_at,jsonb_build_object('bookingId',b.id,'source',b.source,'seats',b.seats,'status',b.status,
 'effectiveStatus',CASE WHEN b.status='HELD'AND b.expires_at<=clock_timestamp()THEN'EXPIRED'ELSE b.status END,
 'priceBOB',b.price_bob::text,'boardingPointId',b.route_id::text||':'||b.from_stop,'alightingPointId',b.route_id::text||':'||b.to_stop,
 'boardingName',s.name,'alightingName',d.name,'episode',nexo.assignment_episode(b.id),
 'presence',(SELECT jsonb_build_object('declarationRecorded',(e->>'declarationEventId')IS NOT NULL,'declaredActive',e->'declaredActive','verified',e->'verified','boarded',e->'boarded','pickupRequested',e->'responded','pickupArrived',e->'pickupWaitStartedAt')FROM(SELECT nexo.terminal_evaluation(b.id)e)q),
 'movementMode',CASE WHEN EXISTS(SELECT FROM nexo.movement_facts m WHERE m.booking_id=b.id AND member_id IS NULL)THEN'GROUP'WHEN EXISTS(SELECT FROM nexo.movement_facts m WHERE m.booking_id=b.id AND member_id IS NOT NULL)THEN'INDIVIDUAL'ELSE'NONE'END,
 'movements',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',m.kind,'pointId',b.route_id::text||':'||m.stop_index)ORDER BY m.created_at,m.kind),'[]')FROM nexo.effective_movements m WHERE m.booking_id=b.id AND member_id IS NULL),
 'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('memberId',m.id,'ordinal',m.ordinal,'boarded',EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=m.id AND e.kind='BOARD'),'alighted',EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=m.id AND e.kind='ALIGHT'))ORDER BY m.ordinal),'[]')FROM nexo.booking_members m WHERE m.booking_id=b.id))entry
 FROM nexo.bookings b JOIN nexo.stops s ON s.route_id=b.route_id AND s.stop_index=b.from_stop JOIN nexo.stops d ON d.route_id=b.route_id AND d.stop_index=b.to_stop
 WHERE b.trip_id=trip AND(view_kind<>'PASSENGER'OR(b.passenger_id=u AND b.source='APP'))ORDER BY b.created_at,b.id LIMIT 50)q;
 allowed:=nexo.trip_accepts_operations(trip);
 RETURN jsonb_build_object('tripId',t.id,'routeId',t.route_id,'route',(SELECT name FROM nexo.routes WHERE id=t.route_id),'association',(SELECT name FROM nexo.associations WHERE id=t.association_id),'vehicleLabel',(SELECT label FROM nexo.vehicles WHERE id=t.vehicle_id),
 'status',t.status,'phase',operation->>'phase','version',operation->'version','currentPointId',t.route_id::text||':'||t.current_stop,
 'mainPointId',CASE WHEN main_point IS NOT NULL THEN t.route_id::text||':'||main_point END,'points',points,'segments',segments,'confirmedSeats',maximum,'committedSeats',confirmed,'heldSeats',held,'observedOnboard',nexo.observed_onboard(trip),
 'collectionEligible',t.status='QUEUED'AND confirmed=6 AND main_point>0 AND main_point<(SELECT stop_count-1 FROM nexo.routes WHERE id=t.route_id)AND NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=trip AND b.status='CONFIRMED'AND(b.from_stop>main_point OR b.to_stop<=main_point)),
 'departureEligible',t.status='QUEUED'AND confirmed>=6 AND held=0 AND allowed,'operationAllowed',allowed,'incident',incident,'bookings',reservations,'bookingLimit',50,'snapshotOnly',true,'positionDeclaredNotGPS',true,'automaticCancellation',false,'delivery','DISABLED');
END $$;
-- Keep a web observation tied to the displayed assignment; native SQL records the fact.
-- Claim both action keys before route locks to preserve the existing global lock order.
CREATE FUNCTION nexo.web_observation(k text,booking uuid,expected_trip uuid,expected_episode integer,member uuid,movement text,seats integer,destination integer)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;inner_key text;native_payload jsonb;result jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(nexo.drives(b.trip_id)OR nexo.manage_route(b.route_id))THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.check_scope(b.route_id);
 p:=jsonb_build_object('op','web_observation','booking',booking,'trip',expected_trip,'episode',expected_episode,'member',member,'movement',movement,'seats',seats,'destination',destination);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 inner_key:='web-observe:'||encode(sha256(convert_to(k,'UTF8')),'hex');
 native_payload:=CASE WHEN member IS NULL THEN jsonb_build_object('op','record_movement','booking',booking,'kind',movement)ELSE jsonb_build_object('op','member_movement','member',member,'kind',movement)END;
 PERFORM nexo.action_start(inner_key,native_payload);
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF expected_trip IS DISTINCT FROM b.trip_id OR expected_episode IS DISTINCT FROM nexo.assignment_episode(b.id)THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 result:=nexo.terminal_observation(inner_key,booking,member,movement,seats,destination,true);
 RETURN nexo.action_finish(k,p,result);
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.public_route_points(uuid),nexo.web_trip_snapshot(uuid,text),nexo.web_observation(text,uuid,uuid,integer,uuid,text,integer,integer)TO nexo_app;
