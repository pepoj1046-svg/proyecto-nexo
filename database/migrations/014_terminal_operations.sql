-- Local simulation only. No scheduler, notification provider or absence cancellation.
ALTER TABLE nexo.trips ADD CONSTRAINT trip_tenant_key UNIQUE(association_id,id);
CREATE TABLE nexo.terminal_config (
 association_id uuid PRIMARY KEY REFERENCES nexo.associations,
 declaration_seconds integer NOT NULL CHECK(declaration_seconds BETWEEN 1 AND 86400)
);
CREATE TABLE nexo.terminal_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, booking_id uuid NOT NULL,
 trip_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('DECLARED','VERIFIED','READY','PICKUP','TRANSFER_REQUEST','PICKUP_ARRIVED','TRANSFERRED')),
 actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz, target_trip uuid,
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id),
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,target_trip) REFERENCES nexo.trips(association_id,id),
 UNIQUE(booking_id,trip_id,kind)
);
CREATE INDEX terminal_booking ON nexo.terminal_events(booking_id,trip_id,kind);
ALTER TABLE nexo.terminal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.terminal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_read ON nexo.terminal_config FOR SELECT USING(nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
CREATE POLICY terminal_read ON nexo.terminal_events FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=terminal_events.association_id));
CREATE TRIGGER immutable_terminal BEFORE UPDATE OR DELETE ON nexo.terminal_events FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
GRANT SELECT ON nexo.terminal_config,nexo.terminal_events TO nexo_app;
CREATE FUNCTION nexo.configure_terminal(k text,a uuid,seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE p jsonb:=jsonb_build_object('op','terminal_config','association',a,'seconds',seconds); cached jsonb;
BEGIN
 PERFORM nexo.require_actor();
 IF NOT nexo.has_role(a,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF seconds IS NULL OR seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'INVALID_DURATION'; END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 INSERT INTO nexo.terminal_config VALUES(a,seconds) ON CONFLICT(association_id) DO UPDATE SET declaration_seconds=excluded.declaration_seconds;
 PERFORM nexo.audit(a,'TERMINAL_CONFIGURED',a);
 RETURN nexo.action_finish(k,p,jsonb_build_object('declarationSeconds',seconds,'commercialPolicyApproved',false));
END $$;
CREATE FUNCTION nexo.terminal_command(k text,booking uuid,command text,confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; p jsonb; cached jsonb; ttl integer; deadline timestamptz;
BEGIN
 IF confirmed IS DISTINCT FROM true OR command IS NULL OR command NOT IN ('DECLARED','VERIFIED','READY','PICKUP','TRANSFER_REQUEST','PICKUP_ARRIVED') THEN RAISE EXCEPTION 'INVALID_TERMINAL_COMMAND'; END IF;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 p:=jsonb_build_object('op','terminal_command','booking',booking,'command',command,'confirmed',confirmed);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 PERFORM nexo.require_actor();
 IF (command='VERIFIED' AND NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) OR
 (command IN ('READY','PICKUP_ARRIVED') AND NOT(nexo.drives(t.id) OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) OR
 (command IN ('DECLARED','PICKUP','TRANSFER_REQUEST') AND NOT(coalesce(b.passenger_id=nexo.actor(),false) OR b.created_by=nexo.actor() OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF b.status<>'CONFIRMED' OR EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 IF command='PICKUP_ARRIVED' THEN
   IF t.status<>'IN_TRANSIT' OR t.current_stop<>b.from_stop OR NOT EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=t.id AND kind='PICKUP') THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 ELSE
   IF t.status<>'QUEUED' OR (command IN ('DECLARED','VERIFIED') AND b.from_stop<>0) THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 END IF;
 IF command='READY' AND (coalesce((SELECT sum(seats) FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED'),0)<6 OR
 EXISTS(SELECT FROM nexo.bookings x WHERE x.trip_id=t.id AND x.status='HELD' AND x.expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'NOT_FULL'; END IF;
 IF command='DECLARED' THEN
   SELECT declaration_seconds INTO ttl FROM nexo.terminal_config WHERE association_id=b.association_id;
   IF ttl IS NULL THEN RAISE EXCEPTION 'TERMINAL_CONFIG_REQUIRED'; END IF;
   deadline:=clock_timestamp()+make_interval(secs=>ttl);
 END IF;
 INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,expires_at)
 VALUES(b.association_id,b.id,t.id,command,u,deadline) ON CONFLICT(booking_id,trip_id,kind) DO NOTHING;
 IF FOUND THEN PERFORM nexo.audit(b.association_id,'TERMINAL_'||command,b.id); END IF;
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'kind',command,'simulated',true,'delivery','DISABLED'));
END $$;
CREATE FUNCTION nexo.terminal_evaluation(booking uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; start_at timestamptz; pickup_at timestamptz; declared boolean; verified boolean; responded boolean; elapsed numeric;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id;
 SELECT min(created_at) INTO start_at FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=b.trip_id AND kind='READY';
 SELECT min(created_at) INTO pickup_at FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=b.trip_id AND kind='PICKUP_ARRIVED';
 SELECT EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=b.trip_id AND kind='DECLARED' AND expires_at>clock_timestamp()),
 EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND kind='VERIFIED'),
 EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=b.trip_id AND kind IN ('PICKUP','TRANSFER_REQUEST')) INTO declared,verified,responded;
 elapsed:=extract(epoch FROM clock_timestamp()-start_at);
 RETURN jsonb_build_object('bookingId',b.id,'declaredActive',declared,'verified',verified,'responded',responded,'readyAt',start_at,
 'offerAlternatives',coalesce(elapsed>=300 AND NOT declared AND NOT verified AND NOT responded AND b.status='CONFIRMED' AND t.status='QUEUED',false),
 'cancellationEligibleSimulation',coalesce(elapsed>=480 AND NOT declared AND NOT verified AND NOT responded AND b.from_stop=0 AND b.status='CONFIRMED' AND t.status='QUEUED',false),
 'pickupWaitStartedAt',pickup_at,'pickupFiveMinutesElapsed',coalesce(clock_timestamp()>=pickup_at+interval '5 minutes',false),
 'simulatedReadyNotice',start_at IS NOT NULL,'automaticCancellationEnabled',false,'delivery','DISABLED');
END $$;
-- Candidates and execution use the same route lock. No automatic reassignment.
CREATE FUNCTION nexo.transfer_candidates(booking uuid,direction text) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings; source nexo.trips;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF direction IS NULL OR direction NOT IN ('LATER','EARLIER') THEN RAISE EXCEPTION 'INVALID_DIRECTION'; END IF;
 SELECT * INTO source FROM nexo.trips WHERE id=b.trip_id;
 IF EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=b.trip_id AND kind='TRANSFERRED') THEN RETURN; END IF;
 IF b.status<>'CONFIRMED' OR source.status<>'QUEUED' OR (SELECT count(*) FROM nexo.bookings WHERE group_id=b.group_id)<>1 OR
 EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) THEN RETURN; END IF;
 IF direction='EARLIER' AND NOT EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND kind='VERIFIED') THEN RETURN; END IF;
 IF direction='LATER' AND NOT EXISTS(SELECT FROM nexo.terminal_events WHERE booking_id=b.id AND trip_id=b.trip_id AND kind='TRANSFER_REQUEST') THEN RETURN; END IF;
 IF NOT nexo.can_search_route(b.route_id) OR NOT EXISTS(SELECT FROM nexo.fares f WHERE f.id=b.fare_id AND f.version=b.fare_version AND f.valid_from<=clock_timestamp() AND (f.valid_until IS NULL OR f.valid_until>clock_timestamp()) AND f.amount_bob*(CASE WHEN b.express THEN 1 ELSE b.seats END)=b.price_bob) THEN RETURN; END IF;
 RETURN QUERY SELECT tr.id FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
 WHERE tr.route_id=b.route_id AND tr.association_id=b.association_id AND tr.status='QUEUED' AND tr.current_stop<=b.from_stop AND tr.id<>b.trip_id
 AND CASE WHEN direction='LATER' THEN tr.position_no>source.position_no ELSE tr.position_no<source.position_no END
 AND nexo.fits(tr.id,b.from_stop,b.to_stop,b.seats) ORDER BY tr.position_no,tr.id;
END $$;
CREATE FUNCTION nexo.transfer_booking(k text,booking uuid,target uuid,direction text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb; cached jsonb; candidate uuid;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 p:=jsonb_build_object('op','transfer','booking',booking,'target',target,'direction',direction);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 PERFORM nexo.require_eligible_route(b.route_id);
 SELECT * INTO candidate FROM nexo.transfer_candidates(booking,direction) LIMIT 1;
 IF candidate IS NULL THEN RAISE EXCEPTION 'NO_COMPATIBLE_TRANSFER'; END IF;
 IF candidate IS DISTINCT FROM target THEN RAISE EXCEPTION 'QUEUE_ORDER'; END IF;
 INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,target_trip) VALUES(b.association_id,b.id,b.trip_id,'TRANSFERRED',u,target);
 UPDATE nexo.bookings SET trip_id=target,status='HELD',driver_accepted=false,expires_at=clock_timestamp()+interval '2 minutes' WHERE id=b.id;
 PERFORM nexo.audit(b.association_id,'BOOKING_TRANSFERRED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'tripId',target,'status','HELD','surchargeBOB','0.00'));
END $$;
GRANT EXECUTE ON FUNCTION nexo.configure_terminal(text,uuid,integer),nexo.terminal_command(text,uuid,text,boolean),nexo.terminal_evaluation(uuid),nexo.transfer_candidates(uuid,text),nexo.transfer_booking(text,uuid,uuid,text) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

CREATE FUNCTION nexo.advancement_candidates(target uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips; b record; first_trip uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=target;
 IF NOT FOUND OR NOT nexo.has_role(t.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 FOR b IN SELECT x.id,x.seats FROM nexo.bookings x JOIN nexo.trips tr ON tr.id=x.trip_id
 WHERE x.route_id=t.route_id AND tr.position_no>t.position_no AND x.status='CONFIRMED'
 ORDER BY tr.position_no,x.created_at,x.id LIMIT 50 LOOP
  SELECT * INTO first_trip FROM nexo.transfer_candidates(b.id,'EARLIER') LIMIT 1;
  IF first_trip=target THEN RETURN NEXT jsonb_build_object('bookingId',b.id,'seats',b.seats,'targetTripId',target,'requiresAdminConfirmation',true); END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION nexo.advancement_candidates(uuid) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

-- A terminal WALK_IN has no passenger_id. SQL NULL must not authorize cancellation.
ALTER FUNCTION nexo.cancel(text,uuid) RENAME TO cancel_internal;
REVOKE EXECUTE ON FUNCTION nexo.cancel_internal(text,uuid) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.cancel(k text,booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb:=jsonb_build_object('op','cancel','booking',booking); cached jsonb;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT(coalesce(b.passenger_id=nexo.actor(),false) OR b.created_by=nexo.actor() OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN nexo.cancel_internal(k,booking);
END $$;
GRANT EXECUTE ON FUNCTION nexo.cancel(text,uuid) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
