-- Explicit terminal relocation and road rescue are separate protocols.
ALTER TABLE nexo.fleet_incidents DROP CONSTRAINT fleet_incidents_context_check;
ALTER TABLE nexo.fleet_incidents ADD CONSTRAINT fleet_incidents_context_check CHECK(context IN ('URBAN','TERMINAL','ROAD'));
CREATE TABLE nexo.road_rescues (
 association_id uuid NOT NULL, incident_id uuid PRIMARY KEY REFERENCES nexo.fleet_incidents,
 trip_id uuid NOT NULL, version integer NOT NULL DEFAULT 1, terminal_priority text CHECK(terminal_priority IN ('ORIGIN','DESTINATION')),
 phase text NOT NULL CHECK(phase IN ('REPORTED','CONFIRMED','URGENT_REVIEW','ASSIGNED','TRANSFERRED')),
 prior_phase text, snapshot jsonb NOT NULL, reported_stop integer NOT NULL,
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id)
);
CREATE TABLE nexo.journey_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, association_id uuid NOT NULL, trip_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES nexo.users, kind text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['road_rescues','journey_events'] LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY operational_read ON nexo.%I FOR SELECT USING(nexo.manage_route((SELECT route_id FROM nexo.trips WHERE id=trip_id)) OR nexo.drives(trip_id) OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=%I.trip_id AND (b.passenger_id=nexo.actor() OR b.created_by=nexo.actor() OR nexo.is_responsible(b.id))))',t,t);
  EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
 END LOOP;
END $$;
CREATE TRIGGER immutable_journey_events BEFORE UPDATE OR DELETE ON nexo.journey_events FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
CREATE OR REPLACE FUNCTION nexo.trip_accepts_operations(trip uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.trips t WHERE t.id=trip AND t.status<>'WITHDRAWN'
 AND NOT EXISTS(SELECT FROM nexo.vehicle_blocks v WHERE v.vehicle_id=t.vehicle_id AND v.blocked)
 AND NOT EXISTS(SELECT FROM nexo.urban_runs r WHERE r.trip_id=t.id AND r.phase IN ('BREAKDOWN_REPORTED','AWAITING_REPLACEMENT','RESCUE'))
 AND NOT EXISTS(SELECT FROM nexo.road_rescues r WHERE r.trip_id=t.id AND r.phase<>'TRANSFERRED'))
$$;
CREATE OR REPLACE FUNCTION nexo.capacity_accepts_operations(trip uuid,n integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.trip_accepts_operations(trip) AND (n=0 OR (NOT EXISTS(SELECT FROM nexo.urban_runs WHERE trip_id=trip AND exclusive) AND NOT EXISTS(SELECT FROM nexo.road_rescues WHERE trip_id=trip)))
 AND NOT EXISTS(SELECT FROM nexo.trips h WHERE h.id<>trip AND h.vehicle_id=(SELECT vehicle_id FROM nexo.trips WHERE id=trip) AND nexo.observed_onboard(h.id)>0)
$$;
CREATE OR REPLACE FUNCTION nexo.operational_revision(trip uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce((SELECT version FROM nexo.urban_runs WHERE trip_id=trip),0)+coalesce((SELECT sum(version)::integer FROM nexo.road_rescues WHERE trip_id=trip),0)
$$;
CREATE FUNCTION nexo.run_snapshot(trip uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',b.id,'groupId',b.group_id,'seats',b.seats,'from',b.from_stop,'to',b.to_stop,'priceBOB',b.price_bob,'fareId',b.fare_id,'fareVersion',b.fare_version,'members',(SELECT jsonb_agg(m.id ORDER BY m.ordinal) FROM nexo.booking_members m WHERE m.booking_id=b.id),'onboard',nexo.booking_onboard(b.id)) ORDER BY b.id),'[]') FROM nexo.bookings b WHERE b.trip_id=trip AND b.status='CONFIRMED'
$$;
CREATE FUNCTION nexo.terminal_replacement_candidate(incident uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE i nexo.fleet_incidents;t nexo.trips;c uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO i FROM nexo.fleet_incidents WHERE id=incident;SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id;
 IF NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF i.context<>'TERMINAL' OR i.state<>'CONFIRMED' OR t.status<>'QUEUED' THEN RETURN NULL;END IF;
 SELECT tr.id INTO c FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
 WHERE tr.route_id=t.route_id AND tr.status='QUEUED' AND tr.position_no>t.position_no AND tr.current_stop=0
 AND nexo.capacity_accepts_operations(tr.id,1)
 AND NOT EXISTS(SELECT FROM generate_series(0,(SELECT stop_count-2 FROM nexo.routes WHERE id=t.route_id))s WHERE
 coalesce((SELECT sum(b.seats) FROM nexo.bookings b WHERE b.trip_id IN(t.id,tr.id) AND nexo.live(b) AND b.from_stop<=s AND b.to_stop>s),0)>6)
 ORDER BY tr.position_no,tr.id LIMIT 1;RETURN c;
END $$;
CREATE FUNCTION nexo.reassign_terminal_incident(k text,incident uuid,target uuid,consents uuid[],safe_transfer boolean,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE i nexo.fleet_incidents;t nexo.trips;c nexo.trips;b nexo.bookings;a nexo.assignment_episodes;gc nexo.group_consents;p jsonb;cached jsonb;snapshot jsonb;gid uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO i FROM nexo.fleet_incidents WHERE id=incident;SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id;
 IF NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR consents IS NULL OR cardinality(consents)>50 OR safe_transfer IS NULL THEN RAISE EXCEPTION 'INVALID_REASSIGNMENT';END IF;
 p:=jsonb_build_object('op','terminal_incident_reassign','incident',incident,'target',target,'consents',consents,'safeTransfer',safe_transfer);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
 SELECT * INTO i FROM nexo.fleet_incidents WHERE id=incident FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id FOR UPDATE;
 IF NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF i.context<>'TERMINAL' OR i.state<>'CONFIRMED' OR t.status<>'QUEUED' OR t.current_stop<>0 THEN RAISE EXCEPTION 'INVALID_FLEET_STATE';END IF;
 PERFORM nexo.require_eligible_route(t.route_id);PERFORM nexo.expire_holds(t.route_id);
 IF EXISTS(SELECT FROM nexo.bookings WHERE trip_id=t.id AND status='HELD') OR NOT EXISTS(SELECT FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED') THEN RAISE EXCEPTION 'UNACCEPTED_OFFERS';END IF;
 IF target IS DISTINCT FROM nexo.terminal_replacement_candidate(i.id) OR target IS NULL THEN RAISE EXCEPTION 'NO_COMPATIBLE_TRANSFER';END IF;
 SELECT * INTO c FROM nexo.trips WHERE id=target FOR UPDATE;
 PERFORM 1 FROM nexo.memberships WHERE association_id=c.association_id AND user_id=c.driver_id AND role='DRIVER' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF nexo.observed_onboard(t.id)>0 AND NOT safe_transfer THEN RAISE EXCEPTION 'SAFE_TRANSFER_REQUIRED';END IF;
 IF nexo.physical_onboard(c.id)+nexo.observed_onboard(t.id)>6 THEN RAISE EXCEPTION 'OBSERVED_CAPACITY_EXCEEDED';END IF;
 snapshot:=nexo.run_snapshot(t.id);
 FOR gid IN SELECT DISTINCT group_id FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED' LOOP
  IF EXISTS(SELECT FROM nexo.bookings WHERE group_id=gid AND (trip_id<>t.id OR status<>'CONFIRMED')) THEN RAISE EXCEPTION 'ADMIN_REVIEW_REQUIRED';END IF;
  SELECT x.* INTO gc FROM nexo.group_consents x WHERE x.id=ANY(consents) AND x.group_id=gid AND x.target_trip=c.id;
  IF NOT FOUND OR gc.snapshot IS DISTINCT FROM nexo.group_snapshot(gc.booking_id) OR gc.responsible_id IS DISTINCT FROM nexo.responsible_user(gc.booking_id) OR EXISTS(SELECT FROM nexo.consent_uses WHERE consent_id=gc.id) THEN RAISE EXCEPTION 'STALE_CONSENT';END IF;
  INSERT INTO nexo.consent_uses VALUES(gc.id,gc.association_id,gc.booking_id,nexo.require_actor(),clock_timestamp());
 END LOOP;
 FOR b IN SELECT * FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED' ORDER BY id LOOP
  SELECT * INTO a FROM nexo.assignment_episodes WHERE booking_id=b.id ORDER BY episode DESC LIMIT 1;
  IF a.episode>=8 THEN RAISE EXCEPTION 'ADMIN_REVIEW_REQUIRED';END IF;
  INSERT INTO nexo.assignment_episodes(association_id,booking_id,episode,trip_id,original_trip_id,from_trip_id,source,approved_by,seats,from_stop,to_stop,fare_id,fare_version,price_bob)
  VALUES(b.association_id,b.id,a.episode+1,c.id,a.original_trip_id,b.trip_id,'TRANSFER',nexo.require_actor(),b.seats,b.from_stop,b.to_stop,b.fare_id,b.fare_version,b.price_bob);
  UPDATE nexo.bookings SET trip_id=c.id,driver_accepted=false WHERE id=b.id;
  INSERT INTO nexo.terminal_bindings VALUES(b.association_id,b.id,nexo.require_actor(),clock_timestamp())ON CONFLICT DO NOTHING;
  INSERT INTO nexo.assignment_outcomes VALUES(b.association_id,b.id,a.episode+1,'CONFIRMED',nexo.require_actor(),clock_timestamp())ON CONFLICT DO NOTHING;
  INSERT INTO nexo.operational_notices(association_id,trip_id,booking_id,recipient_id,kind)SELECT b.association_id,c.id,b.id,nexo.responsible_user(b.id),'TERMINAL_INCIDENT_REASSIGNED' WHERE nexo.responsible_user(b.id) IS NOT NULL;
 END LOOP;
 UPDATE nexo.trips SET status='WITHDRAWN' WHERE id=t.id;
 UPDATE nexo.fleet_incidents SET state='TRANSFERRED',replacement_queue_trip=c.id,replacement_vehicle=c.vehicle_id,onboard_at_assignment=nexo.observed_onboard(c.id) WHERE id=i.id;
 INSERT INTO nexo.journey_events(association_id,trip_id,actor_id,kind,payload)VALUES(t.association_id,t.id,nexo.require_actor(),'TERMINAL_REASSIGNED',jsonb_build_object('targetTripId',c.id,'originalVehicleId',t.vehicle_id,'targetVehicleId',c.vehicle_id,'safeTransferDeclared',safe_transfer,'snapshot',snapshot));
 PERFORM nexo.audit(t.association_id,'TERMINAL_INCIDENT_REASSIGNED',t.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('tripId',c.id,'status','CONFIRMED','surchargeBOB','0.00','delivery','DISABLED'));
END $$;
-- Preserve legacy terminal repair; a relocated withdrawn source is repaired explicitly.
ALTER FUNCTION nexo.restore_vehicle(text,uuid,boolean) RENAME TO restore_vehicle_017;
CREATE FUNCTION nexo.restore_vehicle(k text,vehicle uuid,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE i nexo.fleet_incidents;t nexo.trips;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT f.* INTO i FROM nexo.fleet_incidents f JOIN nexo.vehicle_blocks v ON v.incident_id=f.id WHERE v.vehicle_id=vehicle AND v.blocked;
 SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id;
 IF i.context IS DISTINCT FROM 'TERMINAL' OR i.state<>'TRANSFERRED' THEN RETURN nexo.restore_vehicle_017(k,vehicle,confirmed);END IF;
 IF NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_CONFIRMATION';END IF;
 p:=jsonb_build_object('op','restore_vehicle','vehicle',vehicle);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;PERFORM 1 FROM nexo.vehicles WHERE id=vehicle FOR UPDATE;
 IF NOT nexo.manage_route(t.route_id) OR EXISTS(SELECT FROM nexo.trips WHERE vehicle_id=vehicle AND status IN('QUEUED','IN_TRANSIT')) OR nexo.observed_onboard(t.id)>0 THEN RAISE EXCEPTION 'INVALID_RECOVERY_STATE';END IF;
 UPDATE nexo.vehicle_blocks SET blocked=false WHERE vehicle_id=vehicle;
 INSERT INTO nexo.journey_events(association_id,trip_id,actor_id,kind,payload)VALUES(t.association_id,t.id,nexo.require_actor(),'TERMINAL_VEHICLE_RESTORED',jsonb_build_object('vehicleId',vehicle,'repairVerifiedSimulated',true));
 PERFORM nexo.audit(t.association_id,'VEHICLE_RESTORED',vehicle);RETURN nexo.action_finish(k,p,jsonb_build_object('vehicleId',vehicle,'available',true,'repairVerifiedSimulated',true));
END $$;
REVOKE EXECUTE ON FUNCTION nexo.restore_vehicle_017(text,uuid,boolean) FROM nexo_app,PUBLIC;

CREATE FUNCTION nexo.road_candidates(incident uuid,priority text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE i nexo.fleet_incidents;t nexo.trips;r nexo.routes;result jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO i FROM nexo.fleet_incidents WHERE id=incident;SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id;SELECT * INTO r FROM nexo.routes WHERE id=t.route_id;
 IF NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF priority IS NOT NULL AND priority NOT IN('ORIGIN','DESTINATION') THEN RAISE EXCEPTION 'INVALID_TERMINAL';END IF;
 IF i.context<>'ROAD' OR i.state<>'CONFIRMED' THEN RETURN '[]';END IF;
 SELECT coalesce(jsonb_agg(x.entry ORDER BY x.rank,x.position_no,x.id),'[]') INTO result FROM (
 SELECT tr.id,tr.position_no,CASE WHEN priority IS NULL OR priority=CASE WHEN cr.origin_locality_id=r.origin_locality_id THEN 'ORIGIN' ELSE 'DESTINATION' END THEN 0 ELSE 1 END AS rank,
 jsonb_build_object('tripId',tr.id,'routeId',tr.route_id,'terminal',CASE WHEN cr.origin_locality_id=r.origin_locality_id THEN 'ORIGIN' ELSE 'DESTINATION' END,'position',tr.position_no,'routePermissionVerified',true,'travelTimeKnown',false,'requiresAdminChoice',priority IS NULL)AS entry
 FROM nexo.trips tr JOIN nexo.routes cr ON cr.id=tr.route_id JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
 WHERE tr.association_id=t.association_id AND tr.id<>t.id AND tr.status='QUEUED' AND tr.current_stop=0
 AND cr.catalog_id=r.catalog_id AND ((cr.origin_locality_id=r.origin_locality_id AND cr.destination_locality_id=r.destination_locality_id) OR (cr.origin_locality_id=r.destination_locality_id AND cr.destination_locality_id=r.origin_locality_id))
 AND nexo.scope_allows(cr.id) AND nexo.can_search_route(cr.id) AND nexo.can_search_route(r.id) AND nexo.capacity_accepts_operations(tr.id,1)
 AND NOT EXISTS(SELECT FROM nexo.urban_runs WHERE trip_id=tr.id) AND NOT EXISTS(SELECT FROM nexo.road_rescues WHERE trip_id=tr.id)
 AND NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=tr.id AND nexo.live(b))
 AND NOT EXISTS(SELECT FROM nexo.trips h WHERE h.vehicle_id=tr.vehicle_id AND nexo.observed_onboard(h.id)>0)
 ORDER BY rank,tr.position_no,tr.id LIMIT 100)x;RETURN result;
END $$;
CREATE FUNCTION nexo.road_command(k text,trip uuid,expected integer,command text,target uuid,priority text,onboard integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;c nexo.trips;i nexo.fleet_incidents;rr nexo.road_rescues;p jsonb;cached jsonb;choices jsonb;prior text;recipient uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT(nexo.drives(t.id) OR nexo.manage_route(t.route_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR command IS NULL OR command NOT IN('REPORT','CONFIRM','ASSIGN','SAFE_TRANSFER','ESCALATE') OR priority IS NOT NULL AND priority NOT IN('ORIGIN','DESTINATION') THEN RAISE EXCEPTION 'INVALID_ROAD_COMMAND';END IF;
 p:=jsonb_build_object('op','road_command','trip',trip,'version',expected,'command',command,'target',target,'priority',priority,'onboard',onboard);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 -- Lock both endpoint route queues in UUID order before either trip/asset.
 PERFORM 1 FROM nexo.routes q WHERE q.association_id=t.association_id AND q.catalog_id=(SELECT catalog_id FROM nexo.routes WHERE id=t.route_id)
 AND q.origin_locality_id IN(SELECT origin_locality_id FROM nexo.routes WHERE id=t.route_id UNION SELECT destination_locality_id FROM nexo.routes WHERE id=t.route_id) ORDER BY q.id FOR UPDATE;
 SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
 IF NOT(nexo.drives(t.id) OR nexo.manage_route(t.route_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT f.* INTO i FROM nexo.fleet_incidents f JOIN nexo.road_rescues re ON re.incident_id=f.id WHERE f.trip_id=t.id ORDER BY f.created_at DESC,f.id DESC LIMIT 1;
 SELECT * INTO rr FROM nexo.road_rescues WHERE incident_id=i.id;
 IF command='REPORT' THEN
  IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF expected<>0 OR t.status<>'IN_TRANSIT' OR t.current_stop>=(SELECT stop_count-1 FROM nexo.routes WHERE id=t.route_id) OR NOT nexo.trip_accepts_operations(t.id) OR rr.phase IS NOT NULL AND rr.phase<>'TRANSFERRED' THEN RAISE EXCEPTION 'INVALID_ROAD_STATE';END IF;
  SELECT phase INTO prior FROM nexo.urban_runs WHERE trip_id=t.id;
  IF prior IS NOT NULL AND prior<>'MAIN_TRIP' THEN RAISE EXCEPTION 'OUTSIDE_ROAD_SCOPE';END IF;
  PERFORM 1 FROM nexo.vehicles WHERE id=t.vehicle_id FOR UPDATE;
  INSERT INTO nexo.fleet_incidents(association_id,trip_id,original_vehicle,reported_by,state,context)VALUES(t.association_id,t.id,t.vehicle_id,nexo.require_actor(),'REPORTED','ROAD')RETURNING * INTO i;
  INSERT INTO nexo.road_rescues VALUES(t.association_id,i.id,t.id,1,NULL,'REPORTED',prior,nexo.run_snapshot(t.id),t.current_stop);
  INSERT INTO nexo.vehicle_blocks VALUES(t.association_id,t.vehicle_id,i.id,true)ON CONFLICT(vehicle_id)DO UPDATE SET incident_id=excluded.incident_id,blocked=true;
 ELSE
  IF rr.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'STALE_OPERATION';END IF;
  IF command IN('CONFIRM','ASSIGN','ESCALATE') AND NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF command='CONFIRM' THEN
   IF rr.phase<>'REPORTED' THEN RAISE EXCEPTION 'INVALID_ROAD_STATE';END IF;
   UPDATE nexo.fleet_incidents SET state='CONFIRMED' WHERE id=i.id;
   UPDATE nexo.road_rescues SET phase='CONFIRMED',version=version+1 WHERE incident_id=i.id;
  ELSIF command IN('ASSIGN','ESCALATE') THEN
   IF rr.phase NOT IN('CONFIRMED','URGENT_REVIEW') THEN RAISE EXCEPTION 'INVALID_ROAD_STATE';END IF;
   choices:=nexo.road_candidates(i.id,priority);
   IF command='ESCALATE' THEN
    IF jsonb_array_length(choices)>0 THEN RAISE EXCEPTION 'REPLACEMENT_AVAILABLE';END IF;
    UPDATE nexo.road_rescues SET phase='URGENT_REVIEW',version=version+1 WHERE incident_id=i.id;
   ELSE
    IF jsonb_array_length(choices)=0 THEN RAISE EXCEPTION 'NO_FREE_REPLACEMENT';END IF;
    IF priority IS NULL OR target IS DISTINCT FROM (choices->0->>'tripId')::uuid THEN RAISE EXCEPTION 'ADMIN_TERMINAL_CHOICE_REQUIRED';END IF;
    SELECT * INTO c FROM nexo.trips WHERE id=target FOR UPDATE;
    PERFORM nexo.require_eligible_route(t.route_id);PERFORM nexo.require_eligible_route(c.route_id);PERFORM nexo.check_scope(c.route_id);
    PERFORM 1 FROM nexo.memberships WHERE association_id=c.association_id AND user_id=c.driver_id AND role='DRIVER' AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
    PERFORM 1 FROM nexo.vehicles WHERE id=c.vehicle_id FOR UPDATE;
    IF NOT nexo.capacity_accepts_operations(c.id,1) OR EXISTS(SELECT FROM nexo.bookings WHERE trip_id=c.id AND nexo.live(bookings)) OR nexo.physical_onboard(c.id)<>0 THEN RAISE EXCEPTION 'NO_FREE_REPLACEMENT';END IF;
    IF EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND nexo.live(b) AND b.status<>'CONFIRMED') OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED' AND b.from_stop<t.current_stop AND b.to_stop>t.current_stop AND nexo.booking_onboard(b.id)<>b.seats) THEN RAISE EXCEPTION 'ADMIN_REVIEW_REQUIRED';END IF;
    UPDATE nexo.trips SET status='WITHDRAWN' WHERE id=c.id;
    UPDATE nexo.trips SET vehicle_id=c.vehicle_id,driver_id=c.driver_id WHERE id=t.id;
    UPDATE nexo.fleet_incidents SET state='ASSIGNED',replacement_queue_trip=c.id,replacement_vehicle=c.vehicle_id,onboard_at_assignment=nexo.observed_onboard(t.id) WHERE id=i.id;
    UPDATE nexo.road_rescues SET phase='ASSIGNED',version=version+1,terminal_priority=priority,snapshot=nexo.run_snapshot(t.id) WHERE incident_id=i.id;
    UPDATE nexo.urban_runs SET exclusive=true,version=version+1 WHERE trip_id=t.id;
   END IF;
  ELSIF command='SAFE_TRANSFER' THEN
   IF rr.phase<>'ASSIGNED' OR onboard IS NULL OR onboard IS DISTINCT FROM i.onboard_at_assignment OR onboard IS DISTINCT FROM nexo.observed_onboard(t.id) OR rr.snapshot IS DISTINCT FROM nexo.run_snapshot(t.id) THEN RAISE EXCEPTION 'INVALID_SAFE_TRANSFER';END IF;
   UPDATE nexo.fleet_incidents SET state='TRANSFERRED' WHERE id=i.id;
   UPDATE nexo.road_rescues SET phase='TRANSFERRED',version=version+1 WHERE incident_id=i.id;
  END IF;
 END IF;
 SELECT * INTO rr FROM nexo.road_rescues WHERE incident_id=i.id;
 INSERT INTO nexo.journey_events(association_id,trip_id,actor_id,kind,payload)VALUES(t.association_id,t.id,nexo.require_actor(),'ROAD_'||command,jsonb_build_object('incidentId',i.id,'originalVehicle',i.original_vehicle,'replacementTrip',target,'priority',priority,'onboard',onboard,'safePoint',CASE WHEN command='SAFE_TRANSFER' THEN 'SIMULATED_SAFE_POINT' END,'manifest',rr.snapshot));
 PERFORM nexo.audit(t.association_id,'ROAD_'||command,t.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('incidentId',i.id,'version',rr.version,'phase',rr.phase,'urgent',rr.phase='URGENT_REVIEW','delivery','DISABLED','surchargeBOB','0.00','humanAssistanceFirst',true));
END $$;
-- New explicitly targeted en-route requests reuse live inventory, pricing and offer acceptance.
CREATE FUNCTION nexo.reserve_enroute(k text,trip uuid,p jsonb,quote jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;f nexo.fares;bid uuid;gid uuid:=gen_random_uuid();u uuid:=nexo.require_actor();a jsonb;cached jsonb;first_stop integer;last_stop integer;n integer;src text;price numeric;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(p)x WHERE x<>ALL(ARRAY['routeId','from','to','seats','source'])) THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 first_stop:=(p->>'from')::integer;last_stop:=(p->>'to')::integer;n:=(p->>'seats')::integer;src:=coalesce(p->>'source','APP');
 IF first_stop IS NULL OR last_stop IS NULL OR n IS NULL OR n NOT BETWEEN 1 AND 6 OR src NOT IN('APP','WALK_IN') THEN RAISE EXCEPTION 'INVALID_SEGMENT';END IF;
 a:=jsonb_build_object('op','reserve_enroute','trip',trip,'request',p,'quote',quote);cached:=nexo.action_start(k,a);IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF t.id IS NULL OR t.route_id IS DISTINCT FROM (p->>'routeId')::uuid THEN RAISE EXCEPTION 'INVALID_TRIP';END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
 IF src='WALK_IN' AND NOT nexo.manage_route(t.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.require_eligible_route(t.route_id);
 IF t.status<>'IN_TRANSIT' OR t.current_stop>first_stop OR last_stop<=first_stop OR NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=t.route_id AND stop_index=first_stop AND boarding_allowed) OR NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=t.route_id AND stop_index=last_stop AND alighting_allowed) THEN RAISE EXCEPTION 'PICKUP_PASSED_OR_INCOMPATIBLE';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=t.association_id AND user_id=t.driver_id AND role='DRIVER' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATION_BLOCKED';END IF;
 IF NOT nexo.fits(t.id,first_stop,last_stop,n) THEN RAISE EXCEPTION 'NO_CAPACITY';END IF;
 BEGIN SELECT * INTO STRICT f FROM nexo.fares WHERE route_id=t.route_id AND from_stop=first_stop AND to_stop=last_stop AND NOT express AND valid_from<=clock_timestamp() AND(valid_until IS NULL OR valid_until>clock_timestamp());EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'FARE_UNRESOLVED';END;
 price:=f.amount_bob*n;
 IF quote IS NOT NULL AND quote IS DISTINCT FROM jsonb_build_object('fareId',f.id,'fareVersion',f.version,'totalBOB',price::numeric(12,2)::text) THEN RAISE EXCEPTION 'QUOTE_CHANGED';END IF;
 INSERT INTO nexo.bookings(association_id,trip_id,route_id,passenger_id,created_by,group_id,source,seats,express,from_stop,to_stop,fare_id,price_bob,fare_version,status,expires_at)
 VALUES(t.association_id,t.id,t.route_id,CASE WHEN src='APP' THEN u END,u,gid,src,n,false,first_stop,last_stop,f.id,price,f.version,'HELD',clock_timestamp()+interval '2 minutes')RETURNING id INTO bid;
 PERFORM nexo.audit(t.association_id,'ENROUTE_OFFER_CREATED',bid);
 RETURN nexo.action_finish(k,a,jsonb_build_object('bookingId',bid,'groupId',gid,'status','HELD','priceBOB',price::numeric(12,2)::text,'fareId',f.id,'fareVersion',f.version,'noWaitingRequired',true));
END $$;
-- A driver never has to wait or return for an offer: advancing expires passed pickups atomically.
ALTER FUNCTION nexo.progress(text,uuid,integer) RENAME TO progress_017;
REVOKE EXECUTE ON FUNCTION nexo.progress_017(text,uuid,integer) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.progress(k text,trip uuid,stop integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;p jsonb;cached jsonb;b nexo.bookings;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 p:=jsonb_build_object('op','progress','trip',trip,'stop',stop);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
 IF EXISTS(SELECT FROM nexo.minor_cases mc JOIN nexo.booking_members cm ON cm.id=mc.companion_id JOIN nexo.bookings cb ON cb.id=mc.booking_id
 WHERE cb.trip_id=t.id AND EXISTS(SELECT FROM nexo.effective_movements mb WHERE mb.member_id=mc.member_id AND mb.kind='BOARD') AND NOT EXISTS(SELECT FROM nexo.effective_movements ma WHERE ma.member_id=mc.member_id AND ma.kind='ALIGHT') AND EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=cm.id AND e.kind='ALIGHT')) THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;
 IF stop>t.current_stop THEN
  FOR b IN SELECT * FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED' AND from_stop>=t.current_stop AND from_stop<stop AND nexo.booking_onboard(id)<seats AND NOT EXISTS(SELECT FROM nexo.effective_movements e WHERE e.booking_id=bookings.id AND e.kind='ALIGHT') LOOP
   INSERT INTO nexo.journey_events(association_id,trip_id,actor_id,kind,payload)VALUES(t.association_id,t.id,nexo.require_actor(),'MISSED_PICKUP_REVIEW',jsonb_build_object('bookingId',b.id,'pickupStop',b.from_stop,'missingObservedSeats',b.seats-nexo.booking_onboard(b.id),'automaticCancellation',false,'delivery','DISABLED'));
  END LOOP;
 END IF;
 FOR b IN UPDATE nexo.bookings SET status='EXPIRED' WHERE trip_id=trip AND status='HELD' AND from_stop<stop RETURNING * LOOP PERFORM nexo.audit(b.association_id,'ENROUTE_PICKUP_PASSED',b.id);END LOOP;
 RETURN nexo.progress_017(k,trip,stop);
END $$;
ALTER FUNCTION nexo.respond_offer(text,uuid,boolean) RENAME TO respond_offer_018;
REVOKE EXECUTE ON FUNCTION nexo.respond_offer_018(text,uuid,boolean) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.respond_offer(k text,booking uuid,accept boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;t nexo.trips;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 p:=jsonb_build_object('op','respond','booking',booking,'accept',accept);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF t.current_stop>b.from_stop AND b.status='HELD' THEN UPDATE nexo.bookings SET status='EXPIRED' WHERE id=b.id;END IF;
 IF accept AND NOT nexo.trip_accepts_operations(t.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED';END IF;
 RETURN nexo.respond_offer_018(k,booking,accept);
END $$;
GRANT EXECUTE ON FUNCTION nexo.restore_vehicle(text,uuid,boolean),nexo.terminal_replacement_candidate(uuid),nexo.reassign_terminal_incident(text,uuid,uuid,uuid[],boolean,boolean),nexo.road_candidates(uuid,text),nexo.road_command(text,uuid,integer,text,uuid,text,integer,boolean),nexo.reserve_enroute(text,uuid,jsonb,jsonb),nexo.respond_offer(text,uuid,boolean),nexo.progress(text,uuid,integer) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
