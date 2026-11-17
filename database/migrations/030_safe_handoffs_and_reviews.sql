-- 8A: an assignment moves inventory; physical custody moves only on observed reception.
CREATE TABLE nexo.terminal_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL,incident_id uuid NOT NULL UNIQUE REFERENCES nexo.fleet_incidents,
 source_trip uuid NOT NULL,target_trip uuid NOT NULL,source_vehicle uuid NOT NULL,target_vehicle uuid NOT NULL,
 snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,source_trip)REFERENCES nexo.trips(association_id,id),FOREIGN KEY(association_id,target_trip)REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,source_vehicle)REFERENCES nexo.vehicles(association_id,id),FOREIGN KEY(association_id,target_vehicle)REFERENCES nexo.vehicles(association_id,id),UNIQUE(association_id,id),CHECK(source_trip<>target_trip)
);
CREATE TABLE nexo.terminal_handoff_members (
 association_id uuid NOT NULL,handoff_id uuid NOT NULL,booking_id uuid NOT NULL,member_id uuid NOT NULL,episode integer NOT NULL,original_fact_key text NOT NULL,
 PRIMARY KEY(handoff_id,member_id),FOREIGN KEY(association_id,handoff_id)REFERENCES nexo.terminal_handoffs(association_id,id),
 FOREIGN KEY(association_id,booking_id,member_id)REFERENCES nexo.booking_members(association_id,booking_id,id),FOREIGN KEY(association_id,booking_id,episode)REFERENCES nexo.assignment_episodes(association_id,booking_id,episode)
);
CREATE TABLE nexo.terminal_handoff_receipts (
 handoff_id uuid NOT NULL,member_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(handoff_id,member_id),FOREIGN KEY(handoff_id,member_id)REFERENCES nexo.terminal_handoff_members
);
CREATE TABLE nexo.terminal_handoff_confirmations (
 handoff_id uuid PRIMARY KEY REFERENCES nexo.terminal_handoffs,actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.passenger_discrepancies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL,booking_id uuid NOT NULL,trip_id uuid NOT NULL,episode integer NOT NULL,
 kind text NOT NULL CHECK(kind IN('NOT_BOARDED','ALIGHT_INCORRECT','WRONG_REPLACEMENT','OTHER_OPERATIONAL')),
 reporter_id uuid NOT NULL REFERENCES nexo.users,evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id)REFERENCES nexo.bookings(association_id,id),FOREIGN KEY(association_id,trip_id)REFERENCES nexo.trips(association_id,id)
);
CREATE INDEX discrepancy_booking ON nexo.passenger_discrepancies(booking_id,created_at,id);
CREATE INDEX discrepancy_trip ON nexo.passenger_discrepancies(trip_id,created_at,id);
CREATE INDEX handoff_target ON nexo.terminal_handoffs(target_trip);
CREATE INDEX handoff_source ON nexo.terminal_handoffs(source_trip);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['terminal_handoffs','terminal_handoff_members','terminal_handoff_receipts','terminal_handoff_confirmations','passenger_discrepancies']LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',t);
  EXECUTE format('REVOKE ALL ON nexo.%I FROM PUBLIC,nexo_app',t);
 END LOOP;
END $$;
-- Keep the original function identity so cached callers also see physical custody.
CREATE FUNCTION nexo.observed_without_handoff(trip uuid)RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(sum(CASE WHEN m.member_id IS NULL THEN b.seats ELSE 1 END),0)::integer FROM nexo.effective_movements m JOIN nexo.bookings b ON b.id=m.booking_id WHERE b.trip_id=trip AND m.kind='BOARD'
 AND NOT EXISTS(SELECT FROM nexo.effective_movements a WHERE a.booking_id=m.booking_id AND a.member_id IS NOT DISTINCT FROM m.member_id AND a.kind='ALIGHT')
$$;
CREATE OR REPLACE FUNCTION nexo.observed_onboard(trip uuid)RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.observed_without_handoff(trip)+coalesce(sum(CASE WHEN h.source_trip=trip THEN 1 WHEN h.target_trip=trip THEN -1 ELSE 0 END),0)::integer
 FROM nexo.terminal_handoffs h JOIN nexo.terminal_handoff_members m ON m.handoff_id=h.id
 WHERE (h.source_trip=trip OR h.target_trip=trip)AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_receipts r WHERE r.handoff_id=h.id AND r.member_id=m.member_id)
$$;
CREATE OR REPLACE FUNCTION nexo.trip_accepts_operations(trip uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.trips t WHERE t.id=trip AND t.status<>'WITHDRAWN'
 AND NOT EXISTS(SELECT FROM nexo.vehicle_blocks v WHERE v.vehicle_id=t.vehicle_id AND v.blocked)
 AND NOT EXISTS(SELECT FROM nexo.urban_runs r WHERE r.trip_id=t.id AND r.phase IN('BREAKDOWN_REPORTED','AWAITING_REPLACEMENT','RESCUE'))
 AND NOT EXISTS(SELECT FROM nexo.road_rescues r WHERE r.trip_id=t.id AND r.phase<>'TRANSFERRED')
 AND NOT EXISTS(SELECT FROM nexo.terminal_handoffs h WHERE h.target_trip=t.id AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id)))
$$;
CREATE FUNCTION nexo.guard_pending_handoff()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='bookings'THEN
  IF (NEW.trip_id,NEW.status,NEW.from_stop,NEW.to_stop,NEW.seats)IS DISTINCT FROM(OLD.trip_id,OLD.status,OLD.from_stop,OLD.to_stop,OLD.seats)AND EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.booking_id=OLD.id AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=m.handoff_id))THEN RAISE EXCEPTION 'HANDOFF_PENDING';END IF;
 ELSE
  IF (NEW.vehicle_id,NEW.driver_id,NEW.status,NEW.current_stop)IS DISTINCT FROM(OLD.vehicle_id,OLD.driver_id,OLD.status,OLD.current_stop)AND EXISTS(SELECT FROM nexo.terminal_handoffs h WHERE h.target_trip=OLD.id AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id))THEN RAISE EXCEPTION 'HANDOFF_PENDING';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_pending_handoff BEFORE UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.guard_pending_handoff();
CREATE TRIGGER guard_pending_handoff BEFORE UPDATE ON nexo.trips FOR EACH ROW EXECUTE FUNCTION nexo.guard_pending_handoff();
CREATE FUNCTION nexo.guard_safe_reception_actor()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF (TG_TABLE_NAME='fleet_events'AND NEW.kind='SAFE_TRANSFER_RECORDED')OR(TG_TABLE_NAME='journey_events'AND NEW.kind='ROAD_SAFE_TRANSFER')THEN
  PERFORM nexo.require_actor();PERFORM nexo.check_scope((SELECT route_id FROM nexo.trips WHERE id=NEW.trip_id));
  PERFORM 1 FROM nexo.memberships m JOIN nexo.trips t ON t.association_id=m.association_id AND t.driver_id=m.user_id WHERE t.id=NEW.trip_id AND m.user_id=nexo.actor()AND m.role='DRIVER'AND m.active FOR SHARE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVER_DRIVER_REQUIRED';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER safe_reception_actor BEFORE INSERT ON nexo.fleet_events FOR EACH ROW EXECUTE FUNCTION nexo.guard_safe_reception_actor();
CREATE TRIGGER safe_reception_actor BEFORE INSERT ON nexo.journey_events FOR EACH ROW EXECUTE FUNCTION nexo.guard_safe_reception_actor();

CREATE OR REPLACE FUNCTION nexo.reassign_terminal_incident(k text,incident uuid,target uuid,consents uuid[],safe_transfer boolean,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE i nexo.fleet_incidents;t nexo.trips;c nexo.trips;b nexo.bookings;a nexo.assignment_episodes;gc nexo.group_consents;p jsonb;cached jsonb;snapshot jsonb;gid uuid;people jsonb;handoff uuid;expected_count integer;
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope((SELECT x.route_id FROM nexo.fleet_incidents f JOIN nexo.trips x ON x.id=f.trip_id WHERE f.id=incident));SELECT * INTO i FROM nexo.fleet_incidents WHERE id=incident;SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id;
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',bk.id,'memberId',bm.id,'factKey',board.fact_key)ORDER BY bk.id,bm.ordinal),'[]')INTO people
 FROM nexo.bookings bk JOIN nexo.booking_members bm ON bm.booking_id=bk.id JOIN nexo.effective_movements board ON board.booking_id=bk.id AND(board.member_id=bm.id OR board.member_id IS NULL)AND board.kind='BOARD'
 WHERE bk.trip_id=t.id AND bk.status='CONFIRMED'AND NOT EXISTS(SELECT FROM nexo.effective_movements alight WHERE alight.booking_id=bk.id AND alight.member_id IS NOT DISTINCT FROM board.member_id AND alight.kind='ALIGHT');
 expected_count:=jsonb_array_length(people);
 IF expected_count IS DISTINCT FROM nexo.observed_onboard(t.id)THEN RAISE EXCEPTION 'INVALID_HANDOFF_MANIFEST';END IF;
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
 UPDATE nexo.fleet_incidents SET state=CASE WHEN expected_count>0 THEN'ASSIGNED'ELSE'TRANSFERRED'END,replacement_queue_trip=c.id,replacement_vehicle=c.vehicle_id,onboard_at_assignment=expected_count WHERE id=i.id;
 IF expected_count>0 THEN
  INSERT INTO nexo.terminal_handoffs(association_id,incident_id,source_trip,target_trip,source_vehicle,target_vehicle,snapshot,actor_id)VALUES(t.association_id,i.id,t.id,c.id,t.vehicle_id,c.vehicle_id,snapshot,nexo.require_actor())RETURNING id INTO handoff;
  INSERT INTO nexo.terminal_handoff_members(association_id,handoff_id,booking_id,member_id,episode,original_fact_key)
  SELECT t.association_id,handoff,(x->>'bookingId')::uuid,(x->>'memberId')::uuid,nexo.assignment_episode((x->>'bookingId')::uuid),x->>'factKey' FROM jsonb_array_elements(people)x;
 END IF;
 INSERT INTO nexo.journey_events(association_id,trip_id,actor_id,kind,payload)VALUES(t.association_id,t.id,nexo.require_actor(),'TERMINAL_REASSIGNED',jsonb_build_object('targetTripId',c.id,'originalVehicleId',t.vehicle_id,'targetVehicleId',c.vehicle_id,'humanCoordinationConfirmed',safe_transfer,'receptionPending',expected_count>0,'handoffId',handoff,'snapshot',snapshot));
 PERFORM nexo.audit(t.association_id,'TERMINAL_INCIDENT_REASSIGNED',t.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('tripId',c.id,'status','CONFIRMED','surchargeBOB','0.00','delivery','DISABLED','handoffPending',expected_count>0,'handoffId',handoff));
END $$;

ALTER FUNCTION nexo.fleet_command(text,uuid,integer,text,uuid,integer,boolean)RENAME TO fleet_command_029;
REVOKE EXECUTE ON FUNCTION nexo.fleet_command_029(text,uuid,integer,text,uuid,integer,boolean)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.fleet_command(k text,trip uuid,expected integer,command text,target uuid,onboard integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope((SELECT route_id FROM nexo.trips WHERE id=trip));
 IF command='SAFE_TRANSFER'AND NOT nexo.drives(trip)THEN RAISE EXCEPTION 'RECEIVER_DRIVER_REQUIRED';END IF;
 RETURN nexo.fleet_command_029(k,trip,expected,command,target,onboard,confirmed);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.fleet_command(text,uuid,integer,text,uuid,integer,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.fleet_command(text,uuid,integer,text,uuid,integer,boolean)TO nexo_app;

ALTER FUNCTION nexo.road_command(text,uuid,integer,text,uuid,text,integer,boolean)RENAME TO road_command_029;
REVOKE EXECUTE ON FUNCTION nexo.road_command_029(text,uuid,integer,text,uuid,text,integer,boolean)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.road_command(k text,trip uuid,expected integer,command text,target uuid,priority text,onboard integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope((SELECT route_id FROM nexo.trips WHERE id=trip));
 IF command='SAFE_TRANSFER'AND NOT nexo.drives(trip)THEN RAISE EXCEPTION 'RECEIVER_DRIVER_REQUIRED';END IF;
 RETURN nexo.road_command_029(k,trip,expected,command,target,priority,onboard,confirmed);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.road_command(text,uuid,integer,text,uuid,text,integer,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.road_command(text,uuid,integer,text,uuid,text,integer,boolean)TO nexo_app;
CREATE FUNCTION nexo.handoff_context(incident uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE h nexo.terminal_handoffs;full_view boolean;receiver boolean;done boolean;members jsonb;total integer;received integer;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO h FROM nexo.terminal_handoffs WHERE incident_id=incident;
 IF h.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM nexo.check_scope((SELECT route_id FROM nexo.trips WHERE id=h.target_trip));
 full_view:=nexo.manage_route((SELECT route_id FROM nexo.trips WHERE id=h.target_trip))OR nexo.drives(h.target_trip)OR nexo.drives(h.source_trip);
 IF NOT full_view AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND nexo.is_responsible(m.booking_id))THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 receiver:=nexo.drives(h.target_trip);done:=EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id);
 SELECT count(*),count(r.member_id)INTO total,received FROM nexo.terminal_handoff_members m LEFT JOIN nexo.terminal_handoff_receipts r ON r.handoff_id=m.handoff_id AND r.member_id=m.member_id WHERE m.handoff_id=h.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',m.booking_id,'memberId',m.member_id,'ordinal',b.ordinal,'episode',m.episode,'received',r.member_id IS NOT NULL)ORDER BY m.booking_id,b.ordinal),'[]')INTO members FROM nexo.terminal_handoff_members m JOIN nexo.booking_members b ON b.id=m.member_id LEFT JOIN nexo.terminal_handoff_receipts r ON r.handoff_id=m.handoff_id AND r.member_id=m.member_id WHERE m.handoff_id=h.id AND(full_view OR nexo.is_responsible(m.booking_id));
 RETURN jsonb_build_object('incidentId',h.incident_id,'handoffId',h.id,'sourceTripId',h.source_trip,'targetTripId',h.target_trip,'sourceVehicle',(SELECT label FROM nexo.vehicles WHERE id=h.source_vehicle),'targetVehicle',(SELECT label FROM nexo.vehicles WHERE id=h.target_vehicle),
 'members',members,'version',received+CASE WHEN done THEN 1 ELSE 0 END,'complete',done,'canReceive',receiver AND NOT done,'canConfirm',receiver AND NOT done AND received=total,'expected',CASE WHEN full_view THEN total ELSE jsonb_array_length(members)END,'received',CASE WHEN full_view THEN received ELSE(SELECT count(*)FROM jsonb_array_elements(members)x WHERE(x->>'received')::boolean)END,'movementFactsCreated',false);
END $$;
CREATE FUNCTION nexo.handoff_command(k text,incident uuid,expected integer,command text,booking uuid,member uuid,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE h nexo.terminal_handoffs;p jsonb;cached jsonb;version integer;total integer;received integer;done boolean;inserted integer;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO h FROM nexo.terminal_handoffs WHERE incident_id=incident;
 IF h.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 PERFORM nexo.check_scope((SELECT route_id FROM nexo.trips WHERE id=h.target_trip));
 IF NOT nexo.drives(h.target_trip)THEN RAISE EXCEPTION 'RECEIVER_DRIVER_REQUIRED';END IF;
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected NOT BETWEEN 0 AND 7 OR command IS NULL OR command NOT IN('RECEIVE_MEMBER','RECEIVE_GROUP','CONFIRM_SAFE')THEN RAISE EXCEPTION 'INVALID_HANDOFF_COMMAND';END IF;
 IF command='CONFIRM_SAFE'AND(booking IS NOT NULL OR member IS NOT NULL)OR command='RECEIVE_GROUP'AND(booking IS NULL OR member IS NOT NULL)OR command='RECEIVE_MEMBER'AND(booking IS NULL OR member IS NULL)THEN RAISE EXCEPTION 'INVALID_HANDOFF_COMMAND';END IF;
 p:=jsonb_build_object('op','handoff','incident',incident,'version',expected,'command',command,'booking',booking,'member',member);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=(SELECT route_id FROM nexo.trips WHERE id=h.target_trip)FOR UPDATE;
 PERFORM 1 FROM nexo.trips WHERE id IN(h.source_trip,h.target_trip)ORDER BY id FOR UPDATE;
 PERFORM nexo.require_actor();
 PERFORM 1 FROM nexo.memberships m JOIN nexo.trips t ON t.association_id=m.association_id AND t.driver_id=m.user_id WHERE t.id=h.target_trip AND m.user_id=nexo.actor()AND m.role='DRIVER'AND m.active FOR SHARE OF m;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECEIVER_DRIVER_REQUIRED';END IF;
 IF NOT EXISTS(SELECT FROM nexo.trips WHERE id=h.target_trip AND status='QUEUED'AND current_stop=0 AND vehicle_id=h.target_vehicle)OR EXISTS(SELECT FROM nexo.vehicle_blocks WHERE vehicle_id=h.target_vehicle AND blocked)THEN RAISE EXCEPTION 'OPERATION_BLOCKED';END IF;
 IF EXISTS(SELECT FROM nexo.terminal_handoff_members m JOIN nexo.bookings b ON b.id=m.booking_id WHERE m.handoff_id=h.id AND(b.trip_id<>h.target_trip OR b.status<>'CONFIRMED'OR nexo.assignment_episode(b.id)<>m.episode))THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 SELECT count(*),count(r.member_id)INTO total,received FROM nexo.terminal_handoff_members m LEFT JOIN nexo.terminal_handoff_receipts r ON r.handoff_id=m.handoff_id AND r.member_id=m.member_id WHERE m.handoff_id=h.id;
 done:=EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id);version:=received+CASE WHEN done THEN 1 ELSE 0 END;
 IF expected<>version THEN RAISE EXCEPTION 'STALE_HANDOFF';END IF;IF done THEN RAISE EXCEPTION 'HANDOFF_ALREADY_COMPLETED';END IF;
 IF command='CONFIRM_SAFE'THEN
  IF received<>total THEN RAISE EXCEPTION 'RECEPTION_INCOMPLETE';END IF;
  INSERT INTO nexo.terminal_handoff_confirmations VALUES(h.id,nexo.require_actor(),clock_timestamp());
  UPDATE nexo.fleet_incidents SET state='TRANSFERRED'WHERE id=h.incident_id;
  PERFORM nexo.audit(h.association_id,'HANDOFF_SAFE_CONFIRMED',h.id);
 ELSE
  IF NOT EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND m.booking_id=booking AND(command='RECEIVE_GROUP'OR m.member_id=member))THEN RAISE EXCEPTION 'INVALID_HANDOFF_MEMBER';END IF;
  INSERT INTO nexo.terminal_handoff_receipts(handoff_id,member_id,actor_id)SELECT h.id,m.member_id,nexo.require_actor()FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND m.booking_id=booking AND(command='RECEIVE_GROUP'OR m.member_id=member)ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;IF inserted=0 THEN RAISE EXCEPTION 'ALREADY_RECEIVED';END IF;
  PERFORM nexo.audit(h.association_id,'HANDOFF_RECEIVED',h.id);
 END IF;
 RETURN nexo.action_finish(k,p,jsonb_build_object('handoffId',h.id,'command',command,'recorded',true,'movementFactsCreated',false));
END $$;
CREATE FUNCTION nexo.report_passenger_discrepancy(k text,booking uuid,expected integer,kind text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;report uuid;evidence jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF b.id IS NULL OR NOT coalesce(nexo.is_responsible(b.id),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.check_scope(b.route_id);
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected NOT BETWEEN 0 AND 8 OR kind IS NULL OR kind NOT IN('NOT_BOARDED','ALIGHT_INCORRECT','WRONG_REPLACEMENT','OTHER_OPERATIONAL')THEN RAISE EXCEPTION 'INVALID_DISCREPANCY';END IF;
 p:=jsonb_build_object('op','passenger_discrepancy','booking',booking,'episode',expected,'kind',kind);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 PERFORM nexo.require_actor();IF NOT coalesce(nexo.is_responsible(b.id),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF expected<>nexo.assignment_episode(b.id)THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 evidence:=jsonb_build_object('status',b.status,'tripId',b.trip_id,'episode',expected,'priceBOB',b.price_bob::text,'seats',b.seats,'vehicleId',(SELECT vehicle_id FROM nexo.trips WHERE id=b.trip_id),'movements',(SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY m.fact_key),'[]')FROM nexo.movement_facts m WHERE m.booking_id=b.id),'voided',(SELECT coalesce(jsonb_agg(target_key),'[]')FROM nexo.movement_corrections mc WHERE mc.booking_id=b.id AND mc.kind='VOID'),'handoffs',(SELECT coalesce(jsonb_agg(jsonb_build_object('handoffId',h.id,'sourceTripId',h.source_trip,'targetTripId',h.target_trip,'complete',EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id))),'[]')FROM nexo.terminal_handoffs h WHERE EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND m.booking_id=b.id)));
 INSERT INTO nexo.passenger_discrepancies(association_id,booking_id,trip_id,episode,kind,reporter_id,evidence)VALUES(b.association_id,b.id,b.trip_id,expected,kind,nexo.require_actor(),evidence)RETURNING id INTO report;
 PERFORM nexo.audit(b.association_id,'PASSENGER_DISCREPANCY',report);
 RETURN nexo.action_finish(k,p,jsonb_build_object('reportId',report,'review','PENDING_HUMAN_REVIEW','inventoryChanged',false,'moneyProcessed',false));
END $$;
CREATE FUNCTION nexo.discrepancy_context(booking uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;reports jsonb;handoffs jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;PERFORM nexo.check_scope(b.route_id);
 IF b.id IS NULL OR NOT(coalesce(nexo.is_responsible(b.id),false)OR nexo.manage_route(b.route_id))THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY x."createdAt" DESC,x."reportId"),'[]')INTO reports FROM(SELECT id AS "reportId",episode,kind,created_at AS "createdAt",'PENDING_HUMAN_REVIEW'::text AS review FROM nexo.passenger_discrepancies WHERE booking_id=b.id ORDER BY created_at DESC,id LIMIT 50)x;
 SELECT coalesce(jsonb_agg(nexo.handoff_context(h.incident_id)ORDER BY h.created_at,h.id),'[]')INTO handoffs FROM nexo.terminal_handoffs h WHERE EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND m.booking_id=b.id);
 RETURN jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'episode',nexo.assignment_episode(b.id),'reports',reports,'reportsTotal',(SELECT count(*)FROM nexo.passenger_discrepancies WHERE booking_id=b.id),'reportsLimit',50,'handoffs',handoffs,'canReport',nexo.is_responsible(b.id),'automaticCorrection',false);
END $$;
CREATE FUNCTION nexo.trip_handoffs(trip uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE route uuid;items jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT route_id INTO route FROM nexo.trips WHERE id=trip;PERFORM nexo.check_scope(route);
 IF route IS NULL OR NOT(nexo.manage_route(route)OR nexo.drives(trip))THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(nexo.handoff_context(h.incident_id)ORDER BY h.created_at,h.id),'[]')INTO items FROM nexo.terminal_handoffs h WHERE h.source_trip=trip OR h.target_trip=trip;
 RETURN jsonb_build_object('handoffs',items);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.observed_without_handoff(uuid),nexo.guard_pending_handoff(),nexo.guard_safe_reception_actor()FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.handoff_context(uuid),nexo.handoff_command(text,uuid,integer,text,uuid,uuid,boolean),nexo.report_passenger_discrepancy(text,uuid,integer,text,boolean),nexo.discrepancy_context(uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.handoff_context(uuid),nexo.handoff_command(text,uuid,integer,text,uuid,uuid,boolean),nexo.report_passenger_discrepancy(text,uuid,integer,text,boolean),nexo.discrepancy_context(uuid)TO nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.trip_handoffs(uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.trip_handoffs(uuid)TO nexo_app;
CREATE FUNCTION nexo.trip_discrepancy_notices(trip uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE route uuid;items jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT route_id INTO route FROM nexo.trips WHERE id=trip;PERFORM nexo.check_scope(route);
 IF route IS NULL OR NOT nexo.manage_route(route)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',x.booking_id,'reports',x.total)),'[]')INTO items FROM(SELECT d.booking_id,count(*)AS total FROM nexo.passenger_discrepancies d JOIN nexo.bookings b ON b.id=d.booking_id WHERE b.trip_id=trip GROUP BY d.booking_id)x;
 RETURN items;
END $$;
REVOKE EXECUTE ON FUNCTION nexo.trip_discrepancy_notices(uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.trip_discrepancy_notices(uuid)TO nexo_app;
