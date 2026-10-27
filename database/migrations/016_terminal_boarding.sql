-- Approved terminal contract; legacy offers are retained for compatibility.
CREATE TABLE nexo.group_responsibles (
 association_id uuid NOT NULL, booking_id uuid NOT NULL, group_id uuid PRIMARY KEY,
 responsible_id uuid NOT NULL REFERENCES nexo.users, registered_by uuid NOT NULL REFERENCES nexo.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE TABLE nexo.group_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, booking_id uuid NOT NULL, group_id uuid NOT NULL,
 responsible_id uuid NOT NULL REFERENCES nexo.users, target_trip uuid NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id),
 FOREIGN KEY(association_id,target_trip) REFERENCES nexo.trips(association_id,id)
);
CREATE TABLE nexo.consent_uses (
 consent_id uuid PRIMARY KEY REFERENCES nexo.group_consents, association_id uuid NOT NULL, booking_id uuid NOT NULL,
 administrator_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE TABLE nexo.terminal_bindings (
 association_id uuid NOT NULL, booking_id uuid PRIMARY KEY, administrator_id uuid NOT NULL REFERENCES nexo.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE TABLE nexo.simulated_payments (
 serial bigint GENERATED ALWAYS AS IDENTITY, id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, booking_id uuid NOT NULL, group_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('VERIFIED_SIMULATED','REVOKED_SIMULATED')), actor_id uuid NOT NULL REFERENCES nexo.users,
 amount_bob numeric(12,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE INDEX simulated_payment_group ON nexo.simulated_payments(group_id,created_at,id);
CREATE TABLE nexo.operational_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, trip_id uuid NOT NULL,
 booking_id uuid, recipient_id uuid NOT NULL REFERENCES nexo.users, kind text NOT NULL,
 delivery text NOT NULL DEFAULT 'DISABLED' CHECK(delivery='DISABLED'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE INDEX operational_notice_recipient ON nexo.operational_notices(recipient_id,created_at,id);
CREATE FUNCTION nexo.responsible_user(booking uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(b.passenger_id,(SELECT r.responsible_id FROM nexo.group_responsibles r WHERE r.group_id=b.group_id)) FROM nexo.bookings b WHERE b.id=booking
$$;
CREATE FUNCTION nexo.is_responsible(booking uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT nexo.actor() IS NOT NULL AND nexo.actor()=nexo.responsible_user(booking) $$;
GRANT EXECUTE ON FUNCTION nexo.is_responsible(uuid) TO nexo_app;
CREATE POLICY responsible_booking_read ON nexo.bookings FOR SELECT USING(nexo.is_responsible(id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['group_responsibles','group_consents','consent_uses','terminal_bindings','simulated_payments'] LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY booking_read ON nexo.%I FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=%I.association_id))',t,t);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',t);
  EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
 END LOOP;
END $$;
ALTER TABLE nexo.operational_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipient_read ON nexo.operational_notices FOR SELECT USING(recipient_id=nexo.actor() OR nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
CREATE TRIGGER immutable_notice BEFORE UPDATE OR DELETE ON nexo.operational_notices FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
GRANT SELECT ON nexo.operational_notices TO nexo_app;
CREATE TABLE nexo.arrival_contracts (
 association_id uuid NOT NULL, booking_id uuid PRIMARY KEY, activated_by uuid NOT NULL REFERENCES nexo.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
ALTER TABLE nexo.arrival_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_read ON nexo.arrival_contracts FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=arrival_contracts.association_id));
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.arrival_contracts FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
GRANT SELECT ON nexo.arrival_contracts TO nexo_app;
CREATE FUNCTION nexo.trip_accepts_operations(trip uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT true $$;
CREATE FUNCTION nexo.capacity_accepts_operations(trip uuid,n integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT true $$;
CREATE FUNCTION nexo.operational_revision(trip uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT 0 $$;
CREATE FUNCTION nexo.movement_correction_allowed(trip uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT status='QUEUED' FROM nexo.trips WHERE id=trip $$;
CREATE FUNCTION nexo.group_snapshot(booking uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT jsonb_agg(jsonb_build_object('bookingId',x.id,'episode',nexo.assignment_episode(x.id),'tripId',x.trip_id,'seats',x.seats,'price',x.price_bob,'status',x.status,'routeId',x.route_id,'from',x.from_stop,'to',x.to_stop,'fareId',x.fare_id,'fareVersion',x.fare_version,'express',x.express,'responsibleId',nexo.responsible_user(x.id)) ORDER BY x.id)
 FROM nexo.bookings x WHERE x.group_id=(SELECT group_id FROM nexo.bookings WHERE id=booking)
$$;
CREATE FUNCTION nexo.register_responsible(k text,booking uuid,responsible uuid,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR responsible IS NULL OR (b.passenger_id IS NOT NULL AND b.passenger_id<>responsible) THEN RAISE EXCEPTION 'INVALID_RESPONSIBLE'; END IF;
 p:=jsonb_build_object('op','register_responsible','booking',booking,'user',responsible);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF EXISTS(SELECT FROM nexo.group_responsibles WHERE group_id=b.group_id AND responsible_id<>responsible) THEN RAISE EXCEPTION 'RESPONSIBLE_ALREADY_REGISTERED'; END IF;
 INSERT INTO nexo.group_responsibles VALUES(b.association_id,b.id,b.group_id,responsible,nexo.require_actor(),clock_timestamp()) ON CONFLICT DO NOTHING;
 PERFORM nexo.audit(b.association_id,'GROUP_RESPONSIBLE_REGISTERED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('responsibleId',responsible,'groupId',b.group_id));
END $$;
CREATE FUNCTION nexo.consent_group_transfer(k text,booking uuid,target uuid,expected integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;c uuid;total integer;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT coalesce(nexo.is_responsible(b.id),false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR expected IS NULL THEN RAISE EXCEPTION 'INVALID_CONSENT'; END IF;
 p:=jsonb_build_object('op','group_consent','booking',booking,'target',target,'episode',expected);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT coalesce(nexo.is_responsible(b.id),false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF nexo.assignment_episode(b.id)<>expected THEN RAISE EXCEPTION 'STALE_ASSIGNMENT'; END IF;
 IF NOT EXISTS(SELECT FROM nexo.trips WHERE id=target AND association_id=b.association_id AND route_id=b.route_id) THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
 SELECT sum(seats) INTO total FROM nexo.bookings WHERE group_id=b.group_id;
 IF total NOT BETWEEN 1 AND 6 OR EXISTS(SELECT FROM nexo.bookings x WHERE x.group_id=b.group_id AND
  (x.association_id<>b.association_id OR x.route_id<>b.route_id OR x.from_stop<>b.from_stop OR x.to_stop<>b.to_stop OR nexo.responsible_user(x.id) IS DISTINCT FROM nexo.actor())) THEN RAISE EXCEPTION 'INVALID_GROUP'; END IF;
 INSERT INTO nexo.group_consents(association_id,booking_id,group_id,responsible_id,target_trip,snapshot)
 VALUES(b.association_id,b.id,b.group_id,nexo.require_actor(),target,nexo.group_snapshot(b.id)) RETURNING id INTO c;
 PERFORM nexo.audit(b.association_id,'GROUP_TRANSFER_CONSENTED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('consentId',c,'groupId',b.group_id,'seats',total));
END $$;
CREATE FUNCTION nexo.approve_terminal_transfer(k text,consent uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE c nexo.group_consents;b nexo.bookings;leg nexo.bookings;t nexo.trips;a nexo.assignment_episodes;p jsonb;cached jsonb;total integer;first_trip uuid;ids jsonb:='[]';
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO c FROM nexo.group_consents WHERE id=consent;
 IF NOT FOUND OR NOT nexo.has_role(c.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 p:=jsonb_build_object('op','approve_terminal_transfer','consent',consent);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO b FROM nexo.bookings WHERE id=c.booking_id;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT nexo.has_role(c.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF EXISTS(SELECT FROM nexo.consent_uses WHERE consent_id=c.id) THEN RAISE EXCEPTION 'CONSENT_USED'; END IF;
 IF c.snapshot IS DISTINCT FROM nexo.group_snapshot(b.id) OR c.responsible_id IS DISTINCT FROM nexo.responsible_user(b.id) THEN RAISE EXCEPTION 'STALE_CONSENT'; END IF;
 PERFORM nexo.require_eligible_route(b.route_id);
 SELECT sum(seats) INTO total FROM nexo.bookings WHERE group_id=b.group_id;
 IF EXISTS(SELECT FROM nexo.bookings WHERE group_id=b.group_id AND status='HELD' AND expires_at<=clock_timestamp()) THEN PERFORM nexo.expire_holds(b.route_id); END IF;
 FOR leg IN SELECT * FROM nexo.bookings WHERE group_id=b.group_id ORDER BY id LOOP
  IF NOT((leg.status='CONFIRMED' AND EXISTS(SELECT FROM nexo.trips WHERE id=leg.trip_id AND status='QUEUED'))
   OR nexo.assignment_status(leg.id)->>'state'='RECOVERY_PENDING')
   OR EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=leg.id) OR EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=leg.id)
   OR nexo.assignment_episode(leg.id)>=8 OR NOT nexo.assignment_conditions(leg.id) THEN RAISE EXCEPTION 'INVALID_TERMINAL_TRANSFER'; END IF;
 END LOOP;
 SELECT tr.id INTO first_trip FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
 WHERE tr.route_id=b.route_id AND tr.status='QUEUED' AND tr.current_stop<=b.from_stop AND nexo.fits(tr.id,b.from_stop,b.to_stop,total)
 AND NOT EXISTS(SELECT FROM nexo.bookings x WHERE x.group_id=b.group_id AND x.trip_id=tr.id)
 ORDER BY tr.position_no,tr.id LIMIT 1;
 IF first_trip IS NULL THEN RAISE EXCEPTION 'NO_CAPACITY'; END IF;
 IF first_trip IS DISTINCT FROM c.target_trip THEN RAISE EXCEPTION 'QUEUE_ORDER'; END IF;
 SELECT * INTO t FROM nexo.trips WHERE id=first_trip FOR UPDATE;
 PERFORM 1 FROM nexo.memberships WHERE association_id=t.association_id AND user_id=t.driver_id AND role='DRIVER' AND active FOR SHARE;
 IF NOT FOUND OR NOT nexo.trip_accepts_operations(t.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;
 IF t.position_no<(SELECT min(tr.position_no) FROM nexo.bookings x JOIN nexo.trips tr ON tr.id=x.trip_id WHERE x.group_id=b.group_id)
 AND EXISTS(SELECT FROM nexo.bookings x WHERE x.group_id=b.group_id AND NOT nexo.effective_verified(x.id,nexo.assignment_episode(x.id))) THEN RAISE EXCEPTION 'PRESENCE_REQUIRED'; END IF;
 FOR leg IN SELECT * FROM nexo.bookings WHERE group_id=b.group_id ORDER BY id LOOP
  SELECT * INTO a FROM nexo.assignment_episodes WHERE booking_id=leg.id ORDER BY episode DESC LIMIT 1;
  INSERT INTO nexo.assignment_episodes(association_id,booking_id,episode,trip_id,original_trip_id,from_trip_id,source,approved_by,seats,from_stop,to_stop,fare_id,fare_version,price_bob)
  VALUES(leg.association_id,leg.id,a.episode+1,t.id,a.original_trip_id,leg.trip_id,'TRANSFER',nexo.require_actor(),leg.seats,leg.from_stop,leg.to_stop,leg.fare_id,leg.fare_version,leg.price_bob);
  UPDATE nexo.bookings SET trip_id=t.id,status='CONFIRMED',driver_accepted=false WHERE id=leg.id;
  INSERT INTO nexo.terminal_bindings VALUES(leg.association_id,leg.id,nexo.require_actor(),clock_timestamp()) ON CONFLICT DO NOTHING;
  INSERT INTO nexo.assignment_outcomes VALUES(leg.association_id,leg.id,a.episode+1,'CONFIRMED',nexo.require_actor(),clock_timestamp()) ON CONFLICT DO NOTHING;
  INSERT INTO nexo.operational_notices(association_id,trip_id,booking_id,recipient_id,kind)
  VALUES(leg.association_id,t.id,leg.id,t.driver_id,'ADMIN_ASSIGNMENT_CONFIRMED'),(leg.association_id,t.id,leg.id,c.responsible_id,'GROUP_TRANSFER_CONFIRMED');
  PERFORM nexo.audit(leg.association_id,'TERMINAL_TRANSFER_CONFIRMED',leg.id);ids:=ids||to_jsonb(leg.id);
 END LOOP;
 INSERT INTO nexo.consent_uses VALUES(c.id,c.association_id,c.booking_id,nexo.require_actor(),clock_timestamp());
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingIds',ids,'tripId',t.id,'status','CONFIRMED','delivery','DISABLED','surchargeBOB','0.00'));
END $$;
CREATE FUNCTION nexo.simulate_payment(k text,booking uuid,state text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;amount numeric;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR state IS NULL OR state NOT IN ('VERIFIED_SIMULATED','REVOKED_SIMULATED') THEN RAISE EXCEPTION 'INVALID_PAYMENT_SIMULATION'; END IF;
 p:=jsonb_build_object('op','payment_simulation','booking',booking,'state',state);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT sum(price_bob) INTO amount FROM nexo.bookings WHERE group_id=b.group_id;
 INSERT INTO nexo.simulated_payments(association_id,booking_id,group_id,kind,actor_id,amount_bob) VALUES(b.association_id,b.id,b.group_id,state,nexo.require_actor(),amount);
 PERFORM nexo.audit(b.association_id,'PAYMENT_'||state,b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('state',state,'amountBOB',amount::text,'simulated',true));
END $$;
CREATE FUNCTION nexo.group_status(booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;payment text;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(nexo.is_responsible(b.id),false) OR b.created_by=nexo.actor() OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT kind INTO payment FROM nexo.simulated_payments WHERE group_id=b.group_id ORDER BY serial DESC LIMIT 1;
 RETURN jsonb_build_object('groupId',b.group_id,'responsibleId',nexo.responsible_user(b.id),'paymentState',coalesce(payment,'UNVERIFIED'),'paymentIsReal',false,'confirmationAuthority',CASE WHEN EXISTS(SELECT FROM nexo.terminal_bindings WHERE booking_id=b.id) THEN 'ADMIN_APPROVED' ELSE 'LEGACY_DRIVER_CONTRACT' END,'seats',(SELECT sum(seats) FROM nexo.bookings WHERE group_id=b.group_id));
END $$;
CREATE FUNCTION nexo.guard_terminal_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF OLD.status='CONFIRMED' AND NEW.status='HELD' AND EXISTS(SELECT FROM nexo.terminal_bindings WHERE booking_id=OLD.id) THEN RAISE EXCEPTION 'TERMINAL_RESERVATION_BINDING'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_terminal_binding BEFORE UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.guard_terminal_binding();
ALTER FUNCTION nexo.respond_offer(text,uuid,boolean) RENAME TO respond_offer_legacy_015;
REVOKE EXECUTE ON FUNCTION nexo.respond_offer_legacy_015(text,uuid,boolean) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.respond_offer(k text,booking uuid,accept boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF accept IS DISTINCT FROM true AND b.status='CONFIRMED' AND EXISTS(SELECT FROM nexo.terminal_bindings WHERE booking_id=b.id) THEN RAISE EXCEPTION 'TERMINAL_RESERVATION_BINDING'; END IF;
 RETURN nexo.respond_offer_legacy_015(k,booking,accept);
END $$;
CREATE OR REPLACE FUNCTION nexo.assignment_status(booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; a nexo.assignment_episodes; effective text; incident boolean;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR coalesce(nexo.is_responsible(b.id),false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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
CREATE OR REPLACE FUNCTION nexo.terminal_assignment_command(k text,booking uuid,command text,confirmed boolean,expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; p jsonb; cached jsonb; ttl integer; deadline timestamptz; n integer; before_n integer;
BEGIN
 IF confirmed IS DISTINCT FROM true OR command IS NULL OR command NOT IN ('DECLARED','VERIFIED','READY','PICKUP','TRANSFER_REQUEST','PICKUP_ARRIVED') THEN RAISE EXCEPTION 'INVALID_TERMINAL_COMMAND'; END IF;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=u,false) OR coalesce(nexo.is_responsible(b.id),false) OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') OR nexo.drives(b.trip_id)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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
 (command IN ('DECLARED','PICKUP','TRANSFER_REQUEST') AND NOT(coalesce(b.passenger_id=nexo.actor(),false) OR coalesce(nexo.is_responsible(b.id),false) OR b.created_by=nexo.actor() OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF b.status<>'CONFIRMED' OR EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NOT NULL) OR EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NULL) THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 IF command='PICKUP_ARRIVED' THEN
   IF t.status<>'IN_TRANSIT' OR t.current_stop<>b.from_stop OR NOT EXISTS(SELECT FROM nexo.terminal_timeline WHERE booking_id=b.id AND episode=n AND kind='PICKUP') THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 ELSE
   IF t.status<>'QUEUED' OR (command IN ('DECLARED','VERIFIED') AND b.from_stop<>0) THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 END IF;
 IF command='READY' AND (coalesce((SELECT sum(seats) FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED'),0)<6 OR
 EXISTS(SELECT FROM nexo.bookings x WHERE x.trip_id=t.id AND x.status='HELD' AND x.expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'NOT_FULL'; END IF;
 IF command='DECLARED' THEN
   SELECT declaration_seconds INTO ttl FROM nexo.terminal_config WHERE association_id=b.association_id;
 IF EXISTS(SELECT FROM nexo.arrival_contracts WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.terminal_bindings WHERE booking_id=b.id) THEN ttl:=120; END IF;
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
CREATE FUNCTION nexo.activate_terminal_booking(k text,booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 p:=jsonb_build_object('op','activate_terminal','booking',booking);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM nexo.require_eligible_route(b.route_id);
 IF b.status<>'CONFIRMED' OR NOT EXISTS(SELECT FROM nexo.trips WHERE id=b.trip_id AND status='QUEUED') OR NOT nexo.assignment_conditions(b.id) OR NOT nexo.trip_accepts_operations(b.trip_id) THEN RAISE EXCEPTION 'INVALID_TERMINAL_STATE'; END IF;
 INSERT INTO nexo.terminal_bindings VALUES(b.association_id,b.id,nexo.require_actor(),clock_timestamp()) ON CONFLICT DO NOTHING;
 INSERT INTO nexo.operational_notices(association_id,trip_id,booking_id,recipient_id,kind) SELECT b.association_id,b.trip_id,b.id,driver_id,'TERMINAL_ASSIGNMENT_BINDING' FROM nexo.trips WHERE id=b.trip_id;
 PERFORM nexo.audit(b.association_id,'TERMINAL_CONTRACT_ACTIVATED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'status','CONFIRMED','declarationSeconds',120));
END $$;
CREATE FUNCTION nexo.terminal_arrival(k text,booking uuid,expected integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT coalesce(nexo.is_responsible(b.id),false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR expected IS NULL THEN RAISE EXCEPTION 'INVALID_CONFIRMATION'; END IF;
 p:=jsonb_build_object('op','terminal_command','booking',booking,'command','DECLARED','confirmed',true,'episode',expected);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT coalesce(nexo.is_responsible(b.id),false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 INSERT INTO nexo.arrival_contracts VALUES(b.association_id,b.id,nexo.require_actor(),clock_timestamp()) ON CONFLICT DO NOTHING;
 RETURN nexo.terminal_assignment_command(k,booking,'DECLARED',true,expected);
END $$;
CREATE TABLE nexo.movement_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, booking_id uuid NOT NULL,
 member_id uuid REFERENCES nexo.booking_members, kind text NOT NULL CHECK(kind IN ('BOARD','ALIGHT','VOID')),
 stop_index integer NOT NULL, actor_id uuid NOT NULL REFERENCES nexo.users,
 target_key text UNIQUE, reason text CHECK(reason IN ('OPERATOR_ERROR','WRONG_RESERVATION','WRONG_MEMBER')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='VOID' AND target_key IS NOT NULL AND reason IS NOT NULL) OR (kind<>'VOID' AND target_key IS NULL AND reason IS NULL)),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id),
 FOREIGN KEY(association_id,booking_id,member_id) REFERENCES nexo.booking_members(association_id,booking_id,id)
);
CREATE INDEX correction_booking ON nexo.movement_corrections(booking_id,created_at,id);
ALTER TABLE nexo.movement_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_read ON nexo.movement_corrections FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=movement_corrections.association_id));
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.movement_corrections FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
GRANT SELECT ON nexo.movement_corrections TO nexo_app;
CREATE VIEW nexo.movement_facts WITH(security_invoker=true) AS
 SELECT 'group:'||booking_id::text||':'||kind AS fact_key,association_id,booking_id,NULL::uuid AS member_id,kind,stop_index,actor_id,created_at FROM nexo.booking_movements
 UNION ALL
 SELECT 'member:'||member_id::text||':'||kind,association_id,booking_id,member_id,kind,stop_index,actor_id,created_at FROM nexo.member_movements
 UNION ALL
 SELECT 'event:'||id::text,association_id,booking_id,member_id,kind,stop_index,actor_id,created_at FROM nexo.movement_corrections WHERE kind<>'VOID';
CREATE VIEW nexo.effective_movements WITH(security_invoker=true) AS
 SELECT f.* FROM nexo.movement_facts f WHERE NOT EXISTS(SELECT FROM nexo.movement_corrections c WHERE c.target_key=f.fact_key AND c.kind='VOID');
GRANT SELECT ON nexo.movement_facts,nexo.effective_movements TO nexo_app;
CREATE OR REPLACE FUNCTION nexo.observed_onboard(trip uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(sum(CASE WHEN m.member_id IS NULL THEN b.seats ELSE 1 END),0)::integer
 FROM nexo.effective_movements m JOIN nexo.bookings b ON b.id=m.booking_id WHERE b.trip_id=trip AND m.kind='BOARD'
 AND NOT EXISTS(SELECT FROM nexo.effective_movements a WHERE a.booking_id=m.booking_id AND a.member_id IS NOT DISTINCT FROM m.member_id AND a.kind='ALIGHT')
$$;
CREATE FUNCTION nexo.physical_onboard(trip uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(sum(nexo.observed_onboard(h.id)),0)::integer FROM nexo.trips h WHERE h.vehicle_id=(SELECT vehicle_id FROM nexo.trips WHERE id=trip)
$$;
CREATE FUNCTION nexo.record_observation(k text,booking uuid,member uuid,movement text,terminal_mode boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;t nexo.trips;p jsonb;cached jsonb;stop integer;legacy_exists boolean;weight integer;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(nexo.drives(b.trip_id) OR (terminal_mode AND nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF movement IS NULL OR movement NOT IN ('BOARD','ALIGHT') OR (member IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.booking_members WHERE id=member AND booking_id=b.id)) THEN RAISE EXCEPTION 'INVALID_MOVEMENT'; END IF;
 p:=CASE WHEN member IS NULL THEN jsonb_build_object('op','record_movement','booking',booking,'kind',movement) ELSE jsonb_build_object('op','member_movement','member',member,'kind',movement) END;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 IF NOT(nexo.drives(b.trip_id) OR (terminal_mode AND nexo.has_role(b.association_id,'ASSOCIATION_ADMIN'))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF NOT nexo.trip_accepts_operations(t.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;
 IF member IS NOT NULL AND (EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.movement_corrections WHERE booking_id=b.id AND member_id IS NULL)) THEN RAISE EXCEPTION 'AGGREGATE_HISTORY_ONLY'; END IF;
 IF member IS NULL AND (EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=b.id) OR EXISTS(SELECT FROM nexo.movement_corrections WHERE booking_id=b.id AND member_id IS NOT NULL)) THEN RAISE EXCEPTION 'INDIVIDUAL_HISTORY_ONLY'; END IF;
 IF EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NOT DISTINCT FROM member AND kind=movement) THEN
  RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'memberId',member,'kind',movement,'recorded',true));
 END IF;
 stop:=CASE WHEN movement='BOARD' THEN b.from_stop ELSE b.to_stop END;
 IF t.current_stop<>stop OR (movement='BOARD' AND (b.status<>'CONFIRMED' OR NOT(t.status='IN_TRANSIT' OR (terminal_mode AND t.status='QUEUED' AND stop=0)))) OR
 (movement='ALIGHT' AND (b.status NOT IN ('CONFIRMED','COMPLETED') OR t.status NOT IN ('IN_TRANSIT','COMPLETED') OR NOT EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NOT DISTINCT FROM member AND kind='BOARD'))) OR
 NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=b.route_id AND stop_index=stop AND CASE WHEN movement='BOARD' THEN boarding_allowed ELSE alighting_allowed END) THEN RAISE EXCEPTION 'INVALID_MOVEMENT_STATE'; END IF;
 weight:=CASE WHEN member IS NULL THEN b.seats ELSE 1 END;
 IF movement='BOARD' AND nexo.physical_onboard(t.id)+weight>6 THEN RAISE EXCEPTION 'OBSERVED_CAPACITY_EXCEEDED'; END IF;
 legacy_exists:=CASE WHEN member IS NULL THEN EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id AND kind=movement) ELSE EXISTS(SELECT FROM nexo.member_movements WHERE member_id=member AND kind=movement) END;
 IF legacy_exists THEN
  INSERT INTO nexo.movement_corrections(association_id,booking_id,member_id,kind,stop_index,actor_id) VALUES(b.association_id,b.id,member,movement,stop,nexo.require_actor());
 ELSIF member IS NULL THEN
  INSERT INTO nexo.booking_movements VALUES(b.association_id,b.id,movement,stop,nexo.require_actor(),clock_timestamp());
 ELSE
  INSERT INTO nexo.member_movements VALUES(b.association_id,b.id,member,movement,stop,nexo.require_actor(),clock_timestamp());
 END IF;
 PERFORM nexo.audit(b.association_id,CASE WHEN member IS NULL THEN 'BOOKING_' ELSE 'MEMBER_' END||CASE WHEN movement='BOARD' THEN 'BOARDED' ELSE 'ALIGHTED' END,coalesce(member,b.id));
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'memberId',member,'kind',movement,'recorded',true));
END $$;
CREATE OR REPLACE FUNCTION nexo.record_movement(k text,booking uuid,movement text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT nexo.record_observation(k,booking,NULL,movement,false) $$;
CREATE OR REPLACE FUNCTION nexo.record_member_movement(k text,member uuid,movement text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE booking uuid;
BEGIN SELECT booking_id INTO booking FROM nexo.booking_members WHERE id=member;RETURN nexo.record_observation(k,booking,member,movement,false);END $$;
CREATE FUNCTION nexo.terminal_observation(k text,booking uuid,member uuid,movement text,seats integer,destination integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings; current_b nexo.bookings; n integer; revision integer; p jsonb; cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(nexo.drives(b.trip_id) OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 n:=nexo.assignment_episode(b.id);revision:=nexo.operational_revision(b.trip_id);
 IF confirmed IS DISTINCT FROM true OR seats IS DISTINCT FROM b.seats OR destination IS DISTINCT FROM b.to_stop THEN RAISE EXCEPTION 'INVALID_BOARDING_CHECK'; END IF;
 p:=CASE WHEN member IS NULL THEN jsonb_build_object('op','record_movement','booking',booking,'kind',movement) ELSE jsonb_build_object('op','member_movement','member',member,'kind',movement) END;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO current_b FROM nexo.bookings WHERE id=booking;
 IF current_b.trip_id<>b.trip_id OR nexo.assignment_episode(b.id)<>n THEN RAISE EXCEPTION 'STALE_ASSIGNMENT'; END IF;
 IF nexo.operational_revision(current_b.trip_id)<>revision THEN RAISE EXCEPTION 'STALE_OPERATION'; END IF;
 RETURN nexo.record_observation(k,booking,member,movement,true);
END $$;
CREATE FUNCTION nexo.correct_movement(k text,booking uuid,fact text,reason_code text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;t nexo.trips;f nexo.movement_facts;p jsonb;cached jsonb;weight integer;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR reason_code IS NULL OR reason_code NOT IN ('OPERATOR_ERROR','WRONG_RESERVATION','WRONG_MEMBER') THEN RAISE EXCEPTION 'INVALID_CORRECTION'; END IF;
 p:=jsonb_build_object('op','correct_movement','booking',booking,'fact',fact,'reason',reason_code);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 IF NOT nexo.has_role(b.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO f FROM nexo.movement_facts WHERE fact_key=fact AND booking_id=b.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CORRECTION_TARGET'; END IF;
 IF NOT nexo.movement_correction_allowed(t.id) OR t.current_stop<>f.stop_index THEN RAISE EXCEPTION 'INVALID_CORRECTION_STATE'; END IF;
 IF EXISTS(SELECT FROM nexo.movement_corrections WHERE target_key=fact) THEN RETURN nexo.action_finish(k,p,jsonb_build_object('correctedFact',fact));END IF;
 IF f.kind='BOARD' AND EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NOT DISTINCT FROM f.member_id AND kind='ALIGHT') THEN RAISE EXCEPTION 'INVALID_CORRECTION_STATE'; END IF;
 weight:=CASE WHEN f.member_id IS NULL THEN b.seats ELSE 1 END;
 IF f.kind='ALIGHT' AND nexo.physical_onboard(t.id)+weight>6 THEN RAISE EXCEPTION 'OBSERVED_CAPACITY_EXCEEDED'; END IF;
 INSERT INTO nexo.movement_corrections(association_id,booking_id,member_id,kind,stop_index,actor_id,target_key,reason) VALUES(b.association_id,b.id,f.member_id,'VOID',f.stop_index,nexo.require_actor(),fact,reason_code);
 PERFORM nexo.audit(b.association_id,'MOVEMENT_CORRECTED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('correctedFact',fact));
END $$;
GRANT EXECUTE ON FUNCTION nexo.respond_offer(text,uuid,boolean),nexo.register_responsible(text,uuid,uuid,boolean),nexo.consent_group_transfer(text,uuid,uuid,integer,boolean),
 nexo.approve_terminal_transfer(text,uuid),nexo.simulate_payment(text,uuid,text,boolean),nexo.group_status(uuid),nexo.activate_terminal_booking(text,uuid),
 nexo.terminal_arrival(text,uuid,integer,boolean),nexo.terminal_observation(text,uuid,uuid,text,integer,integer,boolean),nexo.correct_movement(text,uuid,text,text,boolean) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
CREATE OR REPLACE FUNCTION nexo.terminal_evaluation(booking uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE status jsonb:=nexo.assignment_status(booking); b nexo.bookings; t nexo.trips;
 n integer:=(status->>'episode')::integer; start_at timestamptz; pickup_at timestamptz;
 declared boolean; verified boolean; responded boolean; boarded boolean; elapsed numeric; verification uuid; declaration uuid;
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
 SELECT EXISTS(SELECT FROM nexo.effective_movements m WHERE m.booking_id=b.id AND m.kind='BOARD' AND NOT EXISTS(SELECT FROM nexo.effective_movements a WHERE a.booking_id=m.booking_id AND a.member_id IS NOT DISTINCT FROM m.member_id AND a.kind='ALIGHT')) INTO boarded;
 elapsed:=extract(epoch FROM clock_timestamp()-start_at);
 RETURN jsonb_build_object('bookingId',b.id,'episode',n,'declaredActive',declared,'verified',verified,'responded',responded,'boarded',boarded,'readyAt',start_at,
 'verificationEventId',verification,'declarationEventId',declaration,
 'offerAlternatives',coalesce(elapsed>=300 AND NOT declared AND NOT verified AND NOT responded AND NOT boarded AND b.status='CONFIRMED' AND t.status='QUEUED',false),
 'cancellationEligibleSimulation',coalesce(elapsed>=480 AND NOT declared AND NOT verified AND NOT responded AND NOT boarded AND b.from_stop=0 AND b.status='CONFIRMED' AND t.status='QUEUED',false),
 'pickupWaitStartedAt',pickup_at,'pickupFiveMinutesElapsed',coalesce(clock_timestamp()>=pickup_at+interval '5 minutes',false),
 'simulatedReadyNotice',start_at IS NOT NULL,'automaticCancellationEnabled',false,'delivery','DISABLED','assignment',status);
END $$;
CREATE OR REPLACE FUNCTION nexo.correct_arrival(k text,booking uuid,expected integer,target uuid,reason_code text) RETURNS jsonb
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
 IF t.status<>'QUEUED' OR b.status<>'CONFIRMED' OR EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NOT NULL) OR EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id AND member_id IS NULL) THEN RAISE EXCEPTION 'INVALID_CORRECTION_STATE'; END IF;
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
ALTER FUNCTION nexo.cancel(text,uuid) RENAME TO cancel_legacy_015;
REVOKE EXECUTE ON FUNCTION nexo.cancel_legacy_015(text,uuid) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.cancel(k text,booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb:=jsonb_build_object('op','cancel','booking',booking);cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(b.passenger_id=nexo.actor(),false) OR b.created_by=nexo.actor() OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF EXISTS(SELECT FROM nexo.bookings x JOIN nexo.trips t ON t.id=x.trip_id JOIN nexo.effective_movements m ON m.booking_id=x.id
 WHERE x.group_id=b.group_id AND t.status='QUEUED' AND m.kind='BOARD' AND NOT EXISTS(SELECT FROM nexo.effective_movements a WHERE a.booking_id=m.booking_id AND a.member_id IS NOT DISTINCT FROM m.member_id AND a.kind='ALIGHT')) THEN RAISE EXCEPTION 'PASSENGERS_ONBOARD'; END IF;
 RETURN nexo.cancel_legacy_015(k,booking);
END $$;
GRANT EXECUTE ON FUNCTION nexo.cancel(text,uuid) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
