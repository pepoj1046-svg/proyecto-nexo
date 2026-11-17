-- Read projections for exact authorized stops and own passenger history.
-- No inventory, identity or historical data is rewritten. Existing write RPCs remain authoritative.
CREATE FUNCTION nexo.public_route_points(route uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT nexo.route_eligible_017(route) THEN RETURN '[]';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.route_id::text||':'||s.stop_index,'order',s.stop_index,'name',s.name,'localityId',s.locality_id,'boardingAllowed',s.boarding_allowed,'alightingAllowed',s.alighting_allowed)ORDER BY s.stop_index),'[]')INTO result FROM nexo.stops s WHERE s.route_id=route;
 RETURN result;
END $$;
CREATE FUNCTION nexo.public_segment_availability(route uuid,boarding integer,alighting integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r nexo.routes;source nexo.stops;destination nexo.stops;result jsonb;
BEGIN
 SELECT * INTO r FROM nexo.routes WHERE id=route;
 SELECT * INTO source FROM nexo.stops WHERE route_id=route AND stop_index=boarding AND boarding_allowed;
 SELECT * INTO destination FROM nexo.stops WHERE route_id=route AND stop_index=alighting AND alighting_allowed;
 IF r.id IS NULL OR NOT nexo.route_eligible_017(route) OR source.route_id IS NULL OR destination.route_id IS NULL OR boarding IS NULL OR alighting IS NULL OR boarding>=alighting THEN RAISE EXCEPTION 'INVALID_AUTHORIZED_POINTS';END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY position_no,id),'[]')INTO result FROM(
 SELECT t.id,t.position_no,jsonb_build_object('associationId',r.association_id,'association',a.name,'routeId',r.id,'route',r.name,
 'state',coalesce(c.state,'NORMAL'),'reason',coalesce(c.reason,'NORMAL'),'alternateDescription',coalesce(c.alternate_description,''),'affectedStops',coalesce(c.affected_stops,'{}'::integer[]),'updatedAt',c.updated_at,'conditionRevision',coalesce(c.revision,0),
 'contactCode',ct.contact_code,'contactIsSynthetic',true,'from',boarding,'to',alighting,'boardingName',source.name,'alightingName',destination.name,'terminalReference',NULL,
 'tripId',t.id,'position',t.position_no,'tripState',t.status,'newReservationsAllowed',ok.allowed,'confirmedSeats',coalesce(occ.confirmed,0),'availableSeats',CASE WHEN ok.allowed THEN coalesce(occ.free,0)ELSE 0 END,'missingToSix',6-coalesce(occ.confirmed,0),'segments',coalesce(occ.segments,'[]'::jsonb),
 'fareBOB',f.amount_bob::text,'fareVersion',f.version,'currency','BOB','departureTimePromised',false)AS entry
 FROM nexo.associations a LEFT JOIN nexo.route_conditions c ON c.route_id=r.id LEFT JOIN nexo.association_contacts ct ON ct.association_id=a.id
 LEFT JOIN LATERAL(SELECT tr.*FROM nexo.trips tr WHERE tr.route_id=r.id AND tr.status IN('QUEUED','IN_TRANSIT')AND tr.current_stop<=boarding ORDER BY tr.position_no,tr.id LIMIT 20)t ON true
 LEFT JOIN LATERAL(SELECT fa.*FROM nexo.fares fa WHERE fa.route_id=r.id AND fa.from_stop=boarding AND fa.to_stop=alighting AND NOT fa.express AND fa.valid_from<=clock_timestamp()AND(fa.valid_until IS NULL OR fa.valid_until>clock_timestamp())
 AND 1=(SELECT count(*)FROM nexo.fares same WHERE same.route_id=r.id AND same.from_stop=boarding AND same.to_stop=alighting AND NOT same.express AND same.valid_from<=clock_timestamp()AND(same.valid_until IS NULL OR same.valid_until>clock_timestamp()))LIMIT 1)f ON true
 CROSS JOIN LATERAL(SELECT coalesce(c.state,'NORMAL')<>'SUSPENDIDA'AND t.id IS NOT NULL AND f.id IS NOT NULL AND NOT(boarding=ANY(coalesce(c.affected_stops,'{}'::integer[]))OR alighting=ANY(coalesce(c.affected_stops,'{}'::integer[])))AND EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=a.id AND m.user_id=t.driver_id AND m.role='DRIVER'AND m.active)AND nexo.capacity_accepts_operations(t.id,1)AS allowed)ok
 LEFT JOIN LATERAL(SELECT min(6-used)::integer AS free,max(confirmed)::integer AS confirmed,jsonb_agg(jsonb_build_object('segment',seg,'reserved',used,'confirmed',confirmed,'available',CASE WHEN ok.allowed THEN 6-used ELSE 0 END,'fromName',(SELECT name FROM nexo.stops WHERE route_id=r.id AND stop_index=seg),'toName',(SELECT name FROM nexo.stops WHERE route_id=r.id AND stop_index=seg+1))ORDER BY seg)AS segments
 FROM(SELECT seg,coalesce(sum(b.seats)FILTER(WHERE nexo.live(b)),0)::integer AS used,coalesce(sum(b.seats)FILTER(WHERE b.status='CONFIRMED'),0)::integer AS confirmed FROM generate_series(boarding,alighting-1)seg LEFT JOIN nexo.bookings b ON b.trip_id=t.id AND b.from_stop<=seg AND b.to_stop>seg GROUP BY seg)x)occ ON true
 WHERE a.id=r.association_id)q;
 RETURN jsonb_build_object('services',result,'asOf',clock_timestamp(),'mode','LOCAL_LAB','snapshotOnly',true,'reservationWritesEnabled',false);
END $$;
CREATE FUNCTION nexo.passenger_reservations(page_size integer DEFAULT 50,page_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();result jsonb;
BEGIN
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at DESC,id),'[]')INTO result FROM(
 SELECT b.id,b.created_at,jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'routeId',b.route_id,'association',a.name,'boardingName',s.name,'alightingName',d.name,'boardingPointId',b.route_id::text||':'||b.from_stop,'alightingPointId',b.route_id::text||':'||b.to_stop,
 'seats',b.seats,'priceBOB',b.price_bob::text,'fareVersion',b.fare_version,'currency','BOB','status',b.status,'effectiveStatus',CASE WHEN b.status='HELD'AND b.expires_at<=clock_timestamp()THEN'EXPIRED'ELSE b.status END,'createdAt',b.created_at,'expiresAt',b.expires_at,
 'vehicleLabel',v.label,'operation',nexo.operational_status(b.trip_id),'assignmentState',nexo.assignment_status(b.id)->>'state',
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',h.kind,'createdAt',h.created_at)ORDER BY h.created_at,h.kind),'[]')FROM(SELECT 'REQUEST_RECEIVED'::text AS kind,b.created_at UNION ALL SELECT o.kind,o.created_at FROM nexo.assignment_outcomes o WHERE o.booking_id=b.id)h))AS entry
 FROM nexo.bookings b JOIN nexo.associations a ON a.id=b.association_id JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id
 JOIN nexo.stops s ON s.route_id=b.route_id AND s.stop_index=b.from_stop JOIN nexo.stops d ON d.route_id=b.route_id AND d.stop_index=b.to_stop
 WHERE b.passenger_id=u AND b.source='APP' ORDER BY b.created_at DESC,b.id LIMIT page_size OFFSET page_offset)q;
 RETURN jsonb_build_object('bookings',result,'limit',page_size,'offset',page_offset,'storage','EPHEMERAL_LAB');
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.public_route_points(uuid),nexo.public_segment_availability(uuid,integer,integer),nexo.passenger_reservations(integer,integer) TO nexo_app;
