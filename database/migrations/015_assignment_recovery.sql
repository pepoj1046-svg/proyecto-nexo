-- Local episodes and compensating events. No absence cancellation or delivery.
CREATE TABLE nexo.assignment_episodes (
 association_id uuid NOT NULL, booking_id uuid NOT NULL, episode integer NOT NULL CHECK(episode BETWEEN 0 AND 8),
 trip_id uuid NOT NULL, original_trip_id uuid NOT NULL, from_trip_id uuid,
 source text NOT NULL CHECK(source IN ('INITIAL','LEGACY_TRANSFER','TRANSFER','RECOVERY')),
 approved_by uuid REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 seats integer NOT NULL, from_stop integer NOT NULL, to_stop integer NOT NULL,
 fare_id uuid NOT NULL, fare_version integer NOT NULL, price_bob numeric(12,2) NOT NULL,
 PRIMARY KEY(association_id,booking_id,episode), UNIQUE(booking_id,episode), UNIQUE(association_id,booking_id,episode,trip_id),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id),
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,original_trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,from_trip_id) REFERENCES nexo.trips(association_id,id)
);
INSERT INTO nexo.assignment_episodes(association_id,booking_id,episode,trip_id,original_trip_id,source,approved_by,seats,from_stop,to_stop,fare_id,fare_version,price_bob)
 SELECT b.association_id,b.id,0,b.trip_id,
 coalesce((SELECT e.trip_id FROM nexo.terminal_events e WHERE e.booking_id=b.id AND kind='TRANSFERRED' ORDER BY created_at,id LIMIT 1),b.trip_id),
 CASE WHEN EXISTS(SELECT FROM nexo.terminal_events e WHERE e.booking_id=b.id AND kind='TRANSFERRED' AND target_trip=b.trip_id) THEN 'LEGACY_TRANSFER' ELSE 'INITIAL' END,
 (SELECT e.actor_id FROM nexo.terminal_events e WHERE e.booking_id=b.id AND kind='TRANSFERRED' AND target_trip=b.trip_id ORDER BY created_at DESC,id DESC LIMIT 1),
 b.seats,b.from_stop,b.to_stop,b.fare_id,b.fare_version,b.price_bob FROM nexo.bookings b;
CREATE TABLE nexo.assignment_outcomes (
 association_id uuid NOT NULL, booking_id uuid NOT NULL, episode integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('CONFIRMED','REJECTED','EXPIRED','CANCELLED')),
 actor_id uuid REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(association_id,booking_id,episode,kind),
 FOREIGN KEY(association_id,booking_id,episode) REFERENCES nexo.assignment_episodes
);
CREATE TABLE nexo.episode_terminal_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), serial bigint GENERATED ALWAYS AS IDENTITY,
 association_id uuid NOT NULL, booking_id uuid NOT NULL, episode integer NOT NULL, trip_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('DECLARED','VERIFIED','READY','PICKUP','TRANSFER_REQUEST','PICKUP_ARRIVED','DECLARATION_WITHDRAWN','VERIFICATION_WITHDRAWN')),
 actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz,
 reason text CHECK(reason IN ('OPERATOR_ERROR','WRONG_RESERVATION','PASSENGER_CORRECTION')), target_event uuid,
 CHECK((kind IN ('DECLARATION_WITHDRAWN','VERIFICATION_WITHDRAWN') AND reason IS NOT NULL AND target_event IS NOT NULL) OR
 (kind NOT IN ('DECLARATION_WITHDRAWN','VERIFICATION_WITHDRAWN') AND reason IS NULL AND target_event IS NULL)),
 FOREIGN KEY(association_id,booking_id,episode) REFERENCES nexo.assignment_episodes,
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,booking_id,episode,trip_id) REFERENCES nexo.assignment_episodes(association_id,booking_id,episode,trip_id)
);
CREATE UNIQUE INDEX correction_target_once ON nexo.episode_terminal_events(target_event) WHERE target_event IS NOT NULL;
CREATE INDEX episode_terminal_lookup ON nexo.episode_terminal_events(booking_id,episode,serial);
CREATE UNIQUE INDEX episode_terminal_once ON nexo.episode_terminal_events(booking_id,episode,kind)
 WHERE kind NOT IN ('VERIFIED','VERIFICATION_WITHDRAWN');
CREATE TABLE nexo.terminal_config_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL REFERENCES nexo.associations,
 actor_id uuid REFERENCES nexo.users, previous_seconds integer, declaration_seconds integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['assignment_episodes','assignment_outcomes','episode_terminal_events'] LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY booking_read ON nexo.%I FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=%I.association_id))',t,t);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',t);
  EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
 END LOOP;
END $$;
ALTER TABLE nexo.terminal_config_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_read ON nexo.terminal_config_changes FOR SELECT USING(nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
CREATE TRIGGER immutable_config_changes BEFORE UPDATE OR DELETE ON nexo.terminal_config_changes FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
GRANT SELECT ON nexo.terminal_config_changes TO nexo_app;
CREATE FUNCTION nexo.assignment_episode(booking uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT max(episode) FROM nexo.assignment_episodes WHERE booking_id=booking $$;
CREATE FUNCTION nexo.assignment_tracking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO nexo.assignment_episodes(association_id,booking_id,episode,trip_id,original_trip_id,source,seats,from_stop,to_stop,fare_id,fare_version,price_bob)
  VALUES(NEW.association_id,NEW.id,0,NEW.trip_id,NEW.trip_id,'INITIAL',NEW.seats,NEW.from_stop,NEW.to_stop,NEW.fare_id,NEW.fare_version,NEW.price_bob);
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('CONFIRMED','REJECTED','EXPIRED','CANCELLED') THEN
  n:=nexo.assignment_episode(NEW.id);
  INSERT INTO nexo.assignment_outcomes VALUES(NEW.association_id,NEW.id,n,NEW.status,nexo.actor(),clock_timestamp()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_tracking AFTER INSERT OR UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.assignment_tracking();
CREATE FUNCTION nexo.track_terminal_config() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 INSERT INTO nexo.terminal_config_changes(association_id,actor_id,previous_seconds,declaration_seconds)
 VALUES(NEW.association_id,nexo.actor(),CASE WHEN TG_OP='UPDATE' THEN OLD.declaration_seconds END,NEW.declaration_seconds);
 RETURN NEW;
END $$;
CREATE TRIGGER track_terminal_config AFTER INSERT OR UPDATE ON nexo.terminal_config FOR EACH ROW EXECUTE FUNCTION nexo.track_terminal_config();
-- Legacy observations are visible only in baseline episode 0. No history is rewritten.
CREATE VIEW nexo.terminal_timeline WITH(security_invoker=true) AS
 SELECT id,association_id,booking_id,episode,trip_id,kind,actor_id,created_at,expires_at,reason,target_event,serial FROM nexo.episode_terminal_events
 UNION ALL
 SELECT e.id,e.association_id,e.booking_id,0,e.trip_id,e.kind,e.actor_id,e.created_at,e.expires_at,NULL::text,NULL::uuid,0::bigint
 FROM nexo.terminal_events e JOIN nexo.assignment_episodes a ON a.booking_id=e.booking_id AND a.episode=0
 WHERE e.kind<>'TRANSFERRED' AND (e.trip_id=a.trip_id OR e.kind='VERIFIED');
GRANT SELECT ON nexo.terminal_timeline TO nexo_app;
CREATE FUNCTION nexo.effective_verified(booking uuid,n integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce((SELECT kind='VERIFIED' FROM nexo.terminal_timeline WHERE booking_id=booking AND episode=n
 AND kind IN ('VERIFIED','VERIFICATION_WITHDRAWN') ORDER BY serial DESC,created_at DESC,id DESC LIMIT 1),false)
$$;
CREATE FUNCTION nexo.assignment_status(booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; a nexo.assignment_episodes; effective text; incident boolean;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO a FROM nexo.assignment_episodes WHERE booking_id=b.id ORDER BY episode DESC LIMIT 1;
 effective:=CASE WHEN b.status='HELD' AND b.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE b.status END;
 incident:=a.source IN ('TRANSFER','RECOVERY','LEGACY_TRANSFER') AND effective IN ('REJECTED','EXPIRED');
 RETURN jsonb_build_object('bookingId',b.id,'episode',a.episode,'originalTripId',a.original_trip_id,'assignedTripId',b.trip_id,
 'confirmedTripId',CASE WHEN effective='CONFIRMED' THEN b.trip_id END,
 'proposedTripId',CASE WHEN effective='HELD' THEN b.trip_id END,
 'effectiveOfferStatus',effective,'state',CASE WHEN incident THEN 'RECOVERY_PENDING' WHEN effective='HELD' THEN 'OFFER_PENDING' ELSE effective END,
 'confirmedAssignment',effective='CONFIRMED','recoveryRequired',incident,'episodeLimitReached',a.episode>=8,'automaticRestoration',false,
 'episodes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.episode) FROM nexo.assignment_episodes x WHERE x.booking_id=b.id),'[]'),
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.episode,x.created_at,x.kind) FROM nexo.assignment_outcomes x WHERE x.booking_id=b.id),'[]'));
END $$;
CREATE FUNCTION nexo.correct_arrival(k text,booking uuid,expected integer,target uuid,reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; event nexo.terminal_timeline; n integer; p jsonb; cached jsonb; correction_kind text;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF expected IS NULL OR expected<0 OR target IS NULL OR reason_code IS NULL OR reason_code NOT IN ('OPERATOR_ERROR','WRONG_RESERVATION','PASSENGER_CORRECTION') THEN RAISE EXCEPTION 'INVALID_CORRECTION'; END IF;
 p:=jsonb_build_object('op','correct_arrival','booking',booking,'episode',expected,'target',target,'reason',reason_code);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 IF NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 n:=nexo.assignment_episode(b.id);
 IF n<>expected THEN RAISE EXCEPTION 'STALE_ASSIGNMENT'; END IF;
 IF t.status<>'QUEUED' OR b.status<>'CONFIRMED' OR EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) THEN RAISE EXCEPTION 'INVALID_CORRECTION_STATE'; END IF;
 SELECT * INTO event FROM nexo.terminal_timeline WHERE id=target AND booking_id=b.id AND episode=n AND kind IN ('DECLARED','VERIFIED');
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CORRECTION_TARGET'; END IF;
 correction_kind:=CASE WHEN event.kind='DECLARED' THEN 'DECLARATION_WITHDRAWN' ELSE 'VERIFICATION_WITHDRAWN' END;
 IF EXISTS(SELECT FROM nexo.episode_terminal_events WHERE booking_id=b.id AND episode=n AND target_event=target) THEN
  RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'episode',n,'correctedEventId',target));
 END IF;
 IF event.kind='VERIFIED' AND (NOT nexo.effective_verified(b.id,n) OR target IS DISTINCT FROM
 (SELECT id FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='VERIFIED' ORDER BY serial DESC,created_at DESC,id DESC LIMIT 1)) THEN RAISE EXCEPTION 'INVALID_CORRECTION_TARGET'; END IF;
 INSERT INTO nexo.episode_terminal_events(association_id,booking_id,episode,trip_id,kind,actor_id,reason,target_event)
 VALUES(b.association_id,b.id,n,b.trip_id,correction_kind,u,reason_code,target);
 PERFORM nexo.audit(b.association_id,'ARRIVAL_CORRECTED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'episode',n,'correctedEventId',target));
END $$;
CREATE FUNCTION nexo.terminal_assignment_command(k text,booking uuid,command text,confirmed boolean,expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; p jsonb; cached jsonb; ttl integer; deadline timestamptz; n integer; before_n integer;
BEGIN
 IF confirmed IS DISTINCT FROM true OR command IS NULL OR command NOT IN ('DECLARED','VERIFIED','READY','PICKUP','TRANSFER_REQUEST','PICKUP_ARRIVED') THEN RAISE EXCEPTION 'INVALID_TERMINAL_COMMAND'; END IF;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 before_n:=nexo.assignment_episode(booking);
 p:=jsonb_build_object('op','terminal_command','booking',booking,'command',command,'confirmed',confirmed);
 IF expected IS NOT NULL THEN p:=p||jsonb_build_object('episode',expected); END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 PERFORM nexo.require_actor();
 n:=nexo.assignment_episode(b.id);
 IF n<>coalesce(expected,before_n) THEN RAISE EXCEPTION 'STALE_ASSIGNMENT'; END IF;
 IF (command='VERIFIED' AND NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) OR
 (command IN ('READY','PICKUP_ARRIVED') AND NOT(nexo.drives(t.id) OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) OR
 (command IN ('DECLARED','PICKUP','TRANSFER_REQUEST') AND NOT(coalesce(b.passenger_id=nexo.actor(),false) OR b.created_by=nexo.actor() OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF b.status<>'CONFIRMED' OR EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 IF command='PICKUP_ARRIVED' THEN
   IF t.status<>'IN_TRANSIT' OR t.current_stop<>b.from_stop OR NOT EXISTS(SELECT FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='PICKUP') THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
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
 IF command='VERIFIED' AND nexo.effective_verified(b.id,n) THEN
  RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'kind',command,'episode',n,'simulated',true,'delivery','DISABLED'));
 END IF;
 IF command<>'VERIFIED' AND EXISTS(SELECT FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind=command) THEN
  RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'kind',command,'episode',n,'simulated',true,'delivery','DISABLED'));
 END IF;
 IF n=0 AND NOT EXISTS(SELECT FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=0 AND kind=command) THEN
  INSERT INTO nexo.terminal_events(association_id,booking_id,trip_id,kind,actor_id,expires_at)
  VALUES(b.association_id,b.id,t.id,command,u,deadline) ON CONFLICT(booking_id,trip_id,kind) DO NOTHING;
 ELSE
  INSERT INTO nexo.episode_terminal_events(association_id,booking_id,episode,trip_id,kind,actor_id,expires_at)
  VALUES(b.association_id,b.id,n,t.id,command,u,deadline);
 END IF;
 PERFORM nexo.audit(b.association_id,'TERMINAL_'||command,b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'kind',command,'episode',n,'simulated',true,'delivery','DISABLED'));
END $$;
CREATE OR REPLACE FUNCTION nexo.terminal_command(k text,booking uuid,command text,confirmed boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.terminal_assignment_command(k,booking,command,confirmed,NULL)
$$;
CREATE OR REPLACE FUNCTION nexo.terminal_evaluation(booking uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE status jsonb:=nexo.assignment_status(booking); b nexo.bookings; t nexo.trips;
 n integer:=(status->>'episode')::integer; start_at timestamptz; pickup_at timestamptz;
 declared boolean; verified boolean; responded boolean; elapsed numeric; verification uuid; declaration uuid;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id;
 SELECT min(created_at) INTO start_at FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='READY';
 SELECT min(created_at) INTO pickup_at FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='PICKUP_ARRIVED';
 SELECT id INTO verification FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='VERIFIED' ORDER BY serial DESC,created_at DESC,id DESC LIMIT 1;
 SELECT id INTO declaration FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='DECLARED' ORDER BY serial,created_at,id LIMIT 1;
 SELECT EXISTS(SELECT FROM nexo.terminal_timeline e WHERE e.id=declaration AND e.expires_at>clock_timestamp()
 AND NOT EXISTS(SELECT FROM nexo.episode_terminal_events c WHERE c.target_event=e.id AND c.booking_id=b.id AND c.episode=n)),
 nexo.effective_verified(b.id,n),
 EXISTS(SELECT FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind IN ('PICKUP','TRANSFER_REQUEST')) INTO declared,verified,responded;
 elapsed:=extract(epoch FROM clock_timestamp()-start_at);
 RETURN jsonb_build_object('bookingId',b.id,'episode',n,'declaredActive',declared,'verified',verified,'responded',responded,'readyAt',start_at,
 'verificationEventId',verification,'declarationEventId',declaration,
 'offerAlternatives',coalesce(elapsed>=300 AND NOT declared AND NOT verified AND NOT responded AND b.status='CONFIRMED' AND t.status='QUEUED',false),
 'cancellationEligibleSimulation',coalesce(elapsed>=480 AND NOT declared AND NOT verified AND NOT responded AND b.from_stop=0 AND b.status='CONFIRMED' AND t.status='QUEUED',false),
 'pickupWaitStartedAt',pickup_at,'pickupFiveMinutesElapsed',coalesce(clock_timestamp()>=pickup_at+interval '5 minutes',false),
 'simulatedReadyNotice',start_at IS NOT NULL,'automaticCancellationEnabled',false,'delivery','DISABLED','assignment',status);
END $$;
CREATE OR REPLACE FUNCTION nexo.transfer_candidates(booking uuid,direction text) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings; source nexo.trips; a nexo.assignment_episodes; recovering boolean;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF direction IS NULL OR direction NOT IN ('LATER','EARLIER','RECOVER') THEN RAISE EXCEPTION 'INVALID_DIRECTION'; END IF;
 SELECT * INTO a FROM nexo.assignment_episodes WHERE booking_id=b.id ORDER BY episode DESC LIMIT 1;
 SELECT * INTO source FROM nexo.trips WHERE id=b.trip_id;
 recovering:=direction='RECOVER';
 IF a.episode>=8 OR (SELECT count(*) FROM nexo.bookings WHERE group_id=b.group_id)<>1 OR
 EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) THEN RETURN; END IF;
 IF recovering THEN
  IF a.source NOT IN ('TRANSFER','RECOVERY','LEGACY_TRANSFER') OR NOT(b.status IN ('REJECTED','EXPIRED') OR (b.status='HELD' AND b.expires_at<=clock_timestamp())) THEN RETURN; END IF;
 ELSE
  IF b.status<>'CONFIRMED' OR source.status<>'QUEUED' THEN RETURN; END IF;
  IF direction='EARLIER' AND NOT nexo.effective_verified(b.id,a.episode) THEN RETURN; END IF;
  IF direction='LATER' AND NOT EXISTS(SELECT FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=a.episode AND kind='TRANSFER_REQUEST') THEN RETURN; END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=b.route_id AND stop_index=b.from_stop AND boarding_allowed) OR
 NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=b.route_id AND stop_index=b.to_stop AND alighting_allowed) THEN RETURN; END IF;
 IF NOT nexo.can_search_route(b.route_id) OR NOT EXISTS(SELECT FROM nexo.fares f WHERE f.id=b.fare_id AND f.version=b.fare_version AND f.valid_from<=clock_timestamp() AND (f.valid_until IS NULL OR f.valid_until>clock_timestamp()) AND f.amount_bob*(CASE WHEN b.express THEN 1 ELSE b.seats END)=b.price_bob) THEN RETURN; END IF;
 RETURN QUERY SELECT tr.id FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
 WHERE tr.route_id=b.route_id AND tr.association_id=b.association_id AND tr.status='QUEUED' AND tr.current_stop<=b.from_stop AND tr.id<>b.trip_id
 AND (recovering OR CASE WHEN direction='LATER' THEN tr.position_no>source.position_no ELSE tr.position_no<source.position_no END)
 AND nexo.fits(tr.id,b.from_stop,b.to_stop,b.seats) ORDER BY tr.position_no,tr.id;
END $$;
-- Final revalidation locks only the tariff/stops of this reservation.
CREATE FUNCTION nexo.assignment_conditions(booking uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings; n integer;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 PERFORM 1 FROM nexo.fares f WHERE f.id=b.fare_id AND f.association_id=b.association_id AND f.route_id=b.route_id
 AND f.version=b.fare_version AND f.valid_from<=clock_timestamp() AND (f.valid_until IS NULL OR f.valid_until>clock_timestamp())
 AND f.amount_bob*(CASE WHEN b.express THEN 1 ELSE b.seats END)=b.price_bob FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM nexo.stops s WHERE s.association_id=b.association_id AND s.route_id=b.route_id
 AND ((s.stop_index=b.from_stop AND s.boarding_allowed) OR (s.stop_index=b.to_stop AND s.alighting_allowed)) FOR SHARE;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n=2;
END $$;
CREATE FUNCTION nexo.guard_assignment_confirmation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE a nexo.assignment_episodes; t nexo.trips;
BEGIN
 IF OLD.status='HELD' AND NEW.status='CONFIRMED' THEN
  SELECT * INTO a FROM nexo.assignment_episodes WHERE booking_id=NEW.id ORDER BY episode DESC LIMIT 1;
  IF a.source IN ('TRANSFER','RECOVERY','LEGACY_TRANSFER') THEN
   IF NOT nexo.assignment_conditions(NEW.id) THEN RAISE EXCEPTION 'TRANSFER_CONDITIONS_CHANGED'; END IF;
   SELECT * INTO t FROM nexo.trips WHERE id=NEW.trip_id FOR SHARE;
   PERFORM 1 FROM nexo.memberships m WHERE m.association_id=t.association_id AND m.user_id=t.driver_id AND m.role='DRIVER' AND m.active FOR SHARE;
   IF NOT FOUND OR NEW.expires_at<=clock_timestamp() OR t.status<>'QUEUED' OR t.current_stop>NEW.from_stop OR NOT nexo.fits(NEW.trip_id,NEW.from_stop,NEW.to_stop,0) THEN RAISE EXCEPTION 'TRANSFER_CONDITIONS_CHANGED'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_assignment_confirmation BEFORE UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.guard_assignment_confirmation();
CREATE FUNCTION nexo.transfer_assignment(k text,booking uuid,target uuid,direction text,expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; a nexo.assignment_episodes; p jsonb; cached jsonb; candidate uuid; before_n integer;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 before_n:=nexo.assignment_episode(b.id);
 p:=jsonb_build_object('op','transfer','booking',booking,'target',target,'direction',direction);
 IF expected IS NOT NULL THEN p:=p||jsonb_build_object('episode',expected); END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 SELECT * INTO a FROM nexo.assignment_episodes WHERE booking_id=b.id ORDER BY episode DESC LIMIT 1;
 IF a.episode<>coalesce(expected,before_n) THEN RAISE EXCEPTION 'STALE_ASSIGNMENT'; END IF;
 PERFORM nexo.require_eligible_route(b.route_id);
 IF NOT nexo.assignment_conditions(b.id) THEN RAISE EXCEPTION 'TRANSFER_CONDITIONS_CHANGED'; END IF;
 SELECT * INTO candidate FROM nexo.transfer_candidates(booking,direction) LIMIT 1;
 IF candidate IS NULL THEN RAISE EXCEPTION 'NO_COMPATIBLE_TRANSFER'; END IF;
 IF candidate IS DISTINCT FROM target THEN RAISE EXCEPTION 'QUEUE_ORDER'; END IF;
 -- Persist an expired outgoing offer before the new episode is installed.
 PERFORM nexo.expire_holds(b.route_id);
 INSERT INTO nexo.assignment_episodes(association_id,booking_id,episode,trip_id,original_trip_id,from_trip_id,source,approved_by,seats,from_stop,to_stop,fare_id,fare_version,price_bob)
 VALUES(b.association_id,b.id,a.episode+1,target,a.original_trip_id,b.trip_id,
 CASE WHEN direction='RECOVER' THEN 'RECOVERY' ELSE 'TRANSFER' END,nexo.require_actor(),b.seats,b.from_stop,b.to_stop,b.fare_id,b.fare_version,b.price_bob);
 UPDATE nexo.bookings SET trip_id=target,status='HELD',driver_accepted=false,expires_at=clock_timestamp()+interval '2 minutes' WHERE id=b.id;
 PERFORM nexo.audit(b.association_id,'BOOKING_TRANSFERRED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'episode',a.episode+1,'tripId',target,'status','HELD','surchargeBOB','0.00'));
END $$;
CREATE OR REPLACE FUNCTION nexo.transfer_booking(k text,booking uuid,target uuid,direction text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.transfer_assignment(k,booking,target,direction,NULL)
$$;
-- Explicit episode for driver responses prevents stale approvals after repeated visits.
CREATE FUNCTION nexo.respond_assignment(k text,booking uuid,expected integer,accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb; cached jsonb; r jsonb; internal_key text;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF expected IS NULL OR expected<0 OR accept IS NULL THEN RAISE EXCEPTION 'INVALID_RESPONSE'; END IF;
 p:=jsonb_build_object('op','respond_assignment','booking',booking,'episode',expected,'accept',accept);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
 internal_key:='episode:'||expected::text||':'||encode(sha256(convert_to(k,'UTF8')),'hex');
 PERFORM nexo.action_start(internal_key,jsonb_build_object('op','respond','booking',booking,'accept',accept));
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF nexo.assignment_episode(booking)<>expected THEN RAISE EXCEPTION 'STALE_ASSIGNMENT'; END IF;
 -- Core key is namespaced by the action's payload and never shared across episodes.
 r:=nexo.respond_offer(internal_key,booking,accept);
 RETURN nexo.action_finish(k,p,r||jsonb_build_object('episode',expected));
END $$;
GRANT EXECUTE ON FUNCTION nexo.assignment_status(uuid),nexo.correct_arrival(text,uuid,integer,uuid,text),
 nexo.terminal_assignment_command(text,uuid,text,boolean,integer),nexo.transfer_assignment(text,uuid,uuid,text,integer),
 nexo.respond_assignment(text,uuid,integer,boolean) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
