-- Technical roster only. No names, documents, ages or inferred boarding history.
CREATE TABLE nexo.booking_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, booking_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 6),
  UNIQUE(association_id,booking_id,id), UNIQUE(association_id,booking_id,ordinal),
  FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE FUNCTION nexo.create_booking_members() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
  INSERT INTO nexo.booking_members(association_id,booking_id,ordinal)
    SELECT NEW.association_id,NEW.id,i FROM generate_series(1,NEW.seats) i;
  RETURN NEW;
END $$;
CREATE TRIGGER create_booking_members AFTER INSERT ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.create_booking_members();
INSERT INTO nexo.booking_members(association_id,booking_id,ordinal)
  SELECT b.association_id,b.id,i FROM nexo.bookings b CROSS JOIN LATERAL generate_series(1,b.seats) i;
CREATE TABLE nexo.member_movements (
  association_id uuid NOT NULL, booking_id uuid NOT NULL, member_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('BOARD','ALIGHT')), stop_index integer NOT NULL CHECK(stop_index>=0),
  actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(association_id,booking_id,member_id,kind),
  FOREIGN KEY(association_id,booking_id,member_id) REFERENCES nexo.booking_members(association_id,booking_id,id)
);
CREATE TABLE nexo.absence_drafts (
  association_id uuid NOT NULL, booking_id uuid NOT NULL, member_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('WAITING','WARNING_DRAFT','GRACE_DRAFT','RESOLVED')),
  delivery text NOT NULL DEFAULT 'DISABLED' CHECK(delivery='DISABLED'),
  actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(association_id,booking_id,member_id,kind),
  FOREIGN KEY(association_id,booking_id,member_id) REFERENCES nexo.booking_members(association_id,booking_id,id)
);
CREATE INDEX member_booking ON nexo.booking_members(booking_id,ordinal);
CREATE INDEX member_event_lookup ON nexo.member_movements(member_id,kind);
CREATE INDEX member_event_booking ON nexo.member_movements(booking_id);
CREATE INDEX absence_member_lookup ON nexo.absence_drafts(member_id,kind);
CREATE INDEX aggregate_event_lookup ON nexo.booking_movements(booking_id,kind);
CREATE INDEX manifest_trip_lookup ON nexo.bookings(trip_id,id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['booking_members','member_movements','absence_drafts'] LOOP
    EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY booking_scope ON nexo.%I FOR SELECT USING (EXISTS(
      SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=%I.association_id))',t,t);
    EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
    EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I
      FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',t);
  END LOOP;
END $$;
CREATE FUNCTION nexo.observed_onboard(trip uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
  SELECT (SELECT count(*) FROM nexo.member_movements m JOIN nexo.bookings b ON b.id=m.booking_id
    WHERE b.trip_id=trip AND m.kind='BOARD' AND NOT EXISTS(
      SELECT FROM nexo.member_movements a WHERE a.member_id=m.member_id AND a.kind='ALIGHT'))::integer
    +coalesce((SELECT sum(b.seats) FROM nexo.booking_movements m JOIN nexo.bookings b ON b.id=m.booking_id
      WHERE b.trip_id=trip AND m.kind='BOARD' AND NOT EXISTS(
        SELECT FROM nexo.booking_movements a WHERE a.booking_id=m.booking_id AND a.kind='ALIGHT')),0)::integer
$$;
CREATE FUNCTION nexo.record_member_movement(k text, member uuid, movement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; m nexo.booking_members;
  p jsonb; cached jsonb; stop integer;
BEGIN
  IF movement IS NULL OR movement NOT IN ('BOARD','ALIGHT') THEN RAISE EXCEPTION 'INVALID_MOVEMENT'; END IF;
  SELECT * INTO m FROM nexo.booking_members WHERE id=member;
  SELECT * INTO b FROM nexo.bookings WHERE id=m.booking_id;
  IF b.id IS NULL OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  p:=jsonb_build_object('op','member_movement','member',member,'kind',movement);
  cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  SELECT * INTO b FROM nexo.bookings WHERE id=m.booking_id;
  SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
  IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id) THEN RAISE EXCEPTION 'AGGREGATE_HISTORY_ONLY'; END IF;
  IF EXISTS(SELECT FROM nexo.member_movements WHERE member_id=member AND kind=movement) THEN
    RETURN nexo.action_finish(k,p,jsonb_build_object('memberId',member,'kind',movement,'recorded',true));
  END IF;
  stop:=CASE WHEN movement='BOARD' THEN b.from_stop ELSE b.to_stop END;
  IF t.current_stop<>stop OR
    (movement='BOARD' AND (b.status<>'CONFIRMED' OR t.status<>'IN_TRANSIT')) OR
    (movement='ALIGHT' AND (b.status NOT IN ('CONFIRMED','COMPLETED') OR t.status NOT IN ('IN_TRANSIT','COMPLETED') OR
      NOT EXISTS(SELECT FROM nexo.member_movements WHERE member_id=member AND kind='BOARD'))) OR
    NOT EXISTS(SELECT FROM nexo.stops s WHERE s.route_id=b.route_id AND s.stop_index=stop AND
      CASE WHEN movement='BOARD' THEN s.boarding_allowed ELSE s.alighting_allowed END) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_STATE';
  END IF;
  IF movement='BOARD' AND nexo.observed_onboard(t.id)>=6 THEN RAISE EXCEPTION 'OBSERVED_CAPACITY_EXCEEDED'; END IF;
  INSERT INTO nexo.member_movements VALUES(m.association_id,m.booking_id,member,movement,stop,u,clock_timestamp());
  PERFORM nexo.audit(b.association_id,CASE WHEN movement='BOARD' THEN 'MEMBER_BOARDED' ELSE 'MEMBER_ALIGHTED' END,member);
  RETURN nexo.action_finish(k,p,jsonb_build_object('memberId',member,'kind',movement,'recorded',true));
END $$;

-- Keep aggregate clients operational but prevent mixing two sources of truth.
ALTER FUNCTION nexo.record_movement(text,uuid,text) RENAME TO record_movement_aggregate_internal;
REVOKE EXECUTE ON FUNCTION nexo.record_movement_aggregate_internal(text,uuid,text) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.record_movement(k text, booking uuid, movement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb; cached jsonb;
BEGIN
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  p:=jsonb_build_object('op','record_movement','booking',booking,'kind',movement);
  cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  IF EXISTS(SELECT FROM nexo.member_movements WHERE booking_id=booking) THEN RAISE EXCEPTION 'INDIVIDUAL_HISTORY_ONLY'; END IF;
  IF movement='BOARD' AND NOT EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=booking AND kind='BOARD')
    AND nexo.observed_onboard(b.trip_id)+b.seats>6 THEN RAISE EXCEPTION 'OBSERVED_CAPACITY_EXCEEDED'; END IF;
  RETURN nexo.record_movement_aggregate_internal(k,booking,movement);
END $$;

CREATE FUNCTION nexo.record_absence_draft(k text, member uuid, draft text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); m nexo.booking_members; b nexo.bookings; t nexo.trips;
  p jsonb; cached jsonb; since timestamptz;
BEGIN
  IF draft IS NULL OR draft NOT IN ('WAITING','WARNING_DRAFT','GRACE_DRAFT','RESOLVED') THEN RAISE EXCEPTION 'INVALID_ABSENCE_DRAFT'; END IF;
  SELECT * INTO m FROM nexo.booking_members WHERE id=member;
  SELECT * INTO b FROM nexo.bookings WHERE id=m.booking_id;
  IF b.id IS NULL OR NOT (nexo.drives(b.trip_id) OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  p:=jsonb_build_object('op','absence_draft','member',member,'kind',draft);
  cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  SELECT * INTO b FROM nexo.bookings WHERE id=m.booking_id;
  SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
  IF NOT (nexo.drives(t.id) OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT FROM nexo.absence_drafts WHERE member_id=member AND kind=draft) THEN
    RETURN nexo.action_finish(k,p,jsonb_build_object('memberId',member,'kind',draft,'delivery','DISABLED','policyActive',false));
  END IF;
  SELECT created_at INTO since FROM nexo.absence_drafts WHERE member_id=member AND kind='WAITING';
  IF draft='RESOLVED' THEN
    IF since IS NULL THEN RAISE EXCEPTION 'INVALID_ABSENCE_STATE'; END IF;
  ELSE
    IF b.status<>'CONFIRMED' OR t.status NOT IN ('QUEUED','IN_TRANSIT') OR t.current_stop<>b.from_stop OR
      NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=b.route_id AND stop_index=b.from_stop AND boarding_allowed) OR
      EXISTS(SELECT FROM nexo.member_movements WHERE member_id=member AND kind='BOARD') OR
      EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=b.id AND kind='BOARD') OR
      EXISTS(SELECT FROM nexo.absence_drafts WHERE member_id=member AND kind='RESOLVED') THEN
      RAISE EXCEPTION 'INVALID_ABSENCE_STATE';
    END IF;
    IF (draft='WARNING_DRAFT' AND (since IS NULL OR clock_timestamp()<since+interval '10 minutes')) OR
      (draft='GRACE_DRAFT' AND (since IS NULL OR clock_timestamp()<since+interval '15 minutes' OR
        NOT EXISTS(SELECT FROM nexo.absence_drafts WHERE member_id=member AND kind='WARNING_DRAFT'))) THEN
      RAISE EXCEPTION 'INVALID_ABSENCE_STATE';
    END IF;
  END IF;
  INSERT INTO nexo.absence_drafts(association_id,booking_id,member_id,kind,actor_id) VALUES(m.association_id,m.booking_id,member,draft,u);
  PERFORM nexo.audit(b.association_id,'ABSENCE_DRAFT_'||draft,member);
  RETURN nexo.action_finish(k,p,jsonb_build_object('memberId',member,'kind',draft,'delivery','DISABLED','policyActive',false));
END $$;

-- Accepting one leg of a split is also an acceptance, even before final confirmation.
ALTER FUNCTION nexo.respond_offer(text,uuid,boolean) RENAME TO respond_offer_internal;
REVOKE EXECUTE ON FUNCTION nexo.respond_offer_internal(text,uuid,boolean) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.respond_offer(k text, booking uuid, accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb; cached jsonb;
BEGIN
  IF accept IS NULL THEN RAISE EXCEPTION 'INVALID_RESPONSE'; END IF;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  p:=jsonb_build_object('op','respond','booking',booking,'accept',accept);
  cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF accept AND b.status='HELD' AND b.expires_at>clock_timestamp() THEN PERFORM nexo.require_eligible_route(b.route_id); END IF;
  RETURN nexo.respond_offer_internal(k,booking,accept);
END $$;
CREATE FUNCTION nexo.refresh_offers(k text, trip uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); t nexo.trips; p jsonb; cached jsonb; n integer;
BEGIN
  SELECT * INTO t FROM nexo.trips WHERE id=trip;
  IF NOT FOUND OR NOT (nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  p:=jsonb_build_object('op','refresh_offers','trip',trip);
  cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
  IF NOT (nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM nexo.expire_holds(t.route_id);
  SELECT count(*) INTO n FROM nexo.bookings WHERE trip_id=trip AND status='EXPIRED';
  RETURN nexo.action_finish(k,p,jsonb_build_object('tripId',trip,'expiredBookings',n,'provisionalTtlSeconds',120));
END $$;
GRANT EXECUTE ON FUNCTION nexo.record_member_movement(text,uuid,text),nexo.record_absence_draft(text,uuid,text),
  nexo.refresh_offers(text,uuid) TO nexo_app;
-- Grants on renamed functions were revoked; grant only the checked wrappers.
GRANT EXECUTE ON FUNCTION nexo.record_movement(text,uuid,text),nexo.respond_offer(text,uuid,boolean) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
