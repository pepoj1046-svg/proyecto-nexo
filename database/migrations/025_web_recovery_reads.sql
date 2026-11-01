-- Minimal web reads only. All relocation/rescue mutations remain the existing RPCs.
-- No raw group snapshots, passenger identities, other groups' prices or manifests.
CREATE FUNCTION nexo.web_driver_incidents() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();result jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM nexo.memberships WHERE user_id=u AND role='DRIVER' AND active)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at DESC,id),'[]')INTO result FROM(
 SELECT i.id,i.created_at,jsonb_build_object('incidentId',i.id,'tripId',t.id,'context',i.context,'state',i.state,'reason',i.reason,
 'route',r.name,'originalVehicle',v.label,'currentVehicle',CASE WHEN t.driver_id=u THEN c.label ELSE coalesce(replacement.label,v.label)END,'currentDriver',t.driver_id=u AND t.status<>'WITHDRAWN',
 'status',t.status,'operation',CASE WHEN t.driver_id=u AND t.status<>'WITHDRAWN'THEN nexo.operational_status(t.id)
 ELSE jsonb_build_object('phase',CASE WHEN t.status='WITHDRAWN'THEN'WITHDRAWN'ELSE'ASSIGNMENT_CHANGED'END)END,'createdAt',i.created_at)AS entry
 FROM nexo.fleet_incidents i JOIN nexo.trips t ON t.id=i.trip_id JOIN nexo.routes r ON r.id=t.route_id
 JOIN nexo.vehicles v ON v.id=i.original_vehicle JOIN nexo.vehicles c ON c.id=t.vehicle_id LEFT JOIN nexo.vehicles replacement ON replacement.id=i.replacement_vehicle
 WHERE(i.reported_by=u OR t.driver_id=u)AND nexo.scope_allows(t.route_id)
 AND EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=t.association_id AND m.user_id=u AND m.role='DRIVER'AND m.active)
 ORDER BY i.created_at DESC,i.id LIMIT 50)q;
 RETURN jsonb_build_object('incidents',result,'limit',50,'delivery','DISABLED');
END $$;
CREATE FUNCTION nexo.web_booking_recovery(booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();b nexo.bookings;options jsonb;history jsonb;consents jsonb;availability jsonb;operation jsonb;group_seats integer;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking AND passenger_id=u AND source='APP';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.check_scope(b.route_id);
 operation:=nexo.operational_status(b.trip_id);
 SELECT sum(seats)INTO group_seats FROM nexo.bookings WHERE group_id=b.group_id;
 -- The existing public projection supplies eligibility/capacity. This is consent,
 -- not a reservation or an administrative guarantee of candidate order/capacity.
 IF b.status='CONFIRMED'AND EXISTS(SELECT FROM nexo.trips WHERE id=b.trip_id AND status='QUEUED')THEN
  availability:=nexo.public_segment_availability(b.route_id,b.from_stop,b.to_stop);
  SELECT coalesce(jsonb_agg(jsonb_build_object('tripId',t.id,'vehicle',v.label,'position',t.position_no,'availableSeats',p.value->'availableSeats')ORDER BY t.position_no,t.id),'[]')INTO options
  FROM jsonb_array_elements(availability->'services')p JOIN nexo.trips t ON t.id=(p.value->>'tripId')::uuid JOIN nexo.vehicles v ON v.id=t.vehicle_id
  WHERE t.id<>b.trip_id AND t.status='QUEUED'AND(p.value->>'newReservationsAllowed')::boolean;
 END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at DESC,id),'[]')INTO consents FROM(
 SELECT c.id,c.created_at,jsonb_build_object('consentId',c.id,'targetTripId',c.target_trip,'vehicle',v.label,'createdAt',c.created_at,
 'used',EXISTS(SELECT FROM nexo.consent_uses x WHERE x.consent_id=c.id),'matchesCurrentGroup',c.snapshot=nexo.group_snapshot(b.id))AS entry
 FROM nexo.group_consents c JOIN nexo.trips t ON t.id=c.target_trip JOIN nexo.vehicles v ON v.id=t.vehicle_id
 WHERE c.group_id=b.group_id AND c.responsible_id=u ORDER BY c.created_at DESC,c.id LIMIT 10)q;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at DESC,id),'[]')INTO history FROM(
 SELECT f.id,f.created_at,jsonb_build_object('context',f.context,'state',f.state,'reason',f.reason,'originalVehicle',v.label,'replacementVehicle',c.label,'createdAt',f.created_at)AS entry
 FROM nexo.fleet_incidents f JOIN nexo.vehicles v ON v.id=f.original_vehicle LEFT JOIN nexo.vehicles c ON c.id=f.replacement_vehicle
 WHERE EXISTS(SELECT FROM nexo.assignment_episodes e WHERE e.booking_id=b.id AND e.trip_id=f.trip_id
 AND f.created_at>=e.created_at AND NOT EXISTS(SELECT FROM nexo.assignment_episodes later WHERE later.booking_id=e.booking_id AND later.episode>e.episode AND later.created_at<=f.created_at))
 ORDER BY f.created_at DESC,f.id LIMIT 20)q;
 RETURN jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'status',b.status,'episode',nexo.assignment_episode(b.id),'groupSeats',group_seats,
 'vehicle',(SELECT v.label FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE t.id=b.trip_id),'operation',operation,
 'targets',coalesce(options,'[]'),'consents',consents,'incidents',history,'snapshotOnly',true,'delivery','DISABLED','automaticCancellation',false);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.web_driver_incidents(),nexo.web_booking_recovery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.web_driver_incidents(),nexo.web_booking_recovery(uuid)TO nexo_app;
