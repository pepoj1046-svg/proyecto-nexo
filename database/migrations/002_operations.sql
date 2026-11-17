-- Internal helpers are not executable by runtime/PUBLIC.
CREATE FUNCTION nexo.live(b nexo.bookings) RETURNS boolean LANGUAGE sql VOLATILE
SET search_path=pg_catalog,nexo AS $$
  SELECT b.status='CONFIRMED' OR (b.status='HELD' AND b.expires_at>clock_timestamp())
$$;
CREATE FUNCTION nexo.fits(t uuid, f integer, e integer, n integer) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT NOT EXISTS(
    SELECT FROM generate_series(f,e-1) s
    WHERE n+coalesce((SELECT sum(b.seats) FROM nexo.bookings b
      WHERE b.trip_id=t AND nexo.live(b) AND b.from_stop<=s AND b.to_stop>s),0)>6)
$$;
CREATE FUNCTION nexo.action_start(k text, p jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); a nexo.actions;
BEGIN
  IF k IS NULL OR length(k) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'INVALID_ACTION_KEY'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(u::text || ':' || k,0));
  SELECT * INTO a FROM nexo.actions WHERE actor_id=u AND action_key=k;
  IF FOUND THEN
    IF a.payload<>p THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN a.result;
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION nexo.action_finish(k text,p jsonb,r jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
BEGIN
  INSERT INTO nexo.actions VALUES(nexo.require_actor(),k,p,r);
  RETURN r;
END $$;
CREATE FUNCTION nexo.audit(a uuid,kind text,e uuid) RETURNS void LANGUAGE sql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  INSERT INTO nexo.audit_events(association_id,actor_id,action,entity_id) VALUES(a,nexo.require_actor(),kind,e)
$$;
CREATE FUNCTION nexo.expire_holds(r uuid) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE b record;
BEGIN
  FOR b IN UPDATE nexo.bookings SET status='EXPIRED'
    WHERE route_id=r AND status='HELD' AND expires_at<=clock_timestamp() RETURNING * LOOP
    PERFORM nexo.audit(b.association_id,'OFFER_EXPIRED',b.id);
  END LOOP;
END $$;

ALTER TABLE nexo.bookings ADD COLUMN driver_accepted boolean NOT NULL DEFAULT false;

-- Route-scoped lock intentionally coarse for the pilot: every inventory mutation
-- takes it BEFORE reading inventory; volatile PL/pgSQL statements see new commits.
CREATE FUNCTION nexo.reserve(k text, p jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE
  u uuid:=nexo.require_actor(); cached jsonb; r nexo.routes; a nexo.associations;
  f integer:=(p->>'from')::integer; e integer:=(p->>'to')::integer;
  n integer:=(p->>'seats')::integer; ex boolean:=coalesce((p->>'express')::boolean,false);
  src text:=coalesce(p->>'source','APP'); consent boolean:=coalesce((p->>'splitConsent')::boolean,false);
  parts jsonb:=p->'parts'; part jsonb; t nexo.trips; fare nexo.fares;
  v_id uuid; first_eligible uuid; leg_seats integer; gid uuid:=gen_random_uuid(); ids jsonb:='[]'; bid uuid;
  deadline timestamptz; total integer;
BEGIN
  cached:=nexo.action_start(k,jsonb_build_object('op','reserve','request',p));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  IF p IS NULL OR jsonb_typeof(p)<>'object' OR EXISTS(
    SELECT FROM jsonb_object_keys(p) key WHERE key<>ALL(ARRAY['routeId','from','to','seats','express','source','splitConsent','containsMinors','parts'])) THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  SELECT * INTO r FROM nexo.routes WHERE id=(p->>'routeId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ROUTE'; END IF;
  SELECT * INTO a FROM nexo.associations WHERE id=r.association_id FOR SHARE;
  IF a.status<>'ACTIVE' THEN RAISE EXCEPTION 'ASSOCIATION_SUSPENDED'; END IF;
  IF n IS NULL OR n NOT BETWEEN 1 AND 6 OR (ex AND n<>6) THEN RAISE EXCEPTION 'INVALID_SEATS'; END IF;
  IF f IS NULL OR e IS NULL OR f<0 OR e<=f OR e>=r.stop_count OR
    NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=r.id AND stop_index=f AND boarding_allowed) OR
    NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=r.id AND stop_index=e AND alighting_allowed) THEN
    RAISE EXCEPTION 'INVALID_SEGMENT';
  END IF;
  IF src NOT IN ('APP','WALK_IN') OR (src='WALK_IN' AND NOT nexo.has_role(r.association_id,'ASSOCIATION_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN_SOURCE' USING ERRCODE='42501';
  END IF;
  PERFORM nexo.expire_holds(r.id);
  BEGIN
    SELECT * INTO STRICT fare FROM nexo.fares WHERE route_id=r.id AND from_stop=f AND to_stop=e AND express=ex
      AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp());
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'FARE_UNRESOLVED';
  END;
  IF parts IS NULL THEN
    SELECT tr.* INTO t FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id
      AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
      WHERE tr.route_id=r.id AND tr.status='QUEUED' AND tr.current_stop<=f
      AND nexo.fits(tr.id,f,e,n) ORDER BY tr.position_no,tr.id LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_CAPACITY'; END IF;
    parts:=jsonb_build_array(jsonb_build_object('tripId',t.id,'seats',n));
  ELSE
    IF jsonb_typeof(parts)<>'array' OR jsonb_array_length(parts)<1 OR jsonb_array_length(parts)>6 THEN
      RAISE EXCEPTION 'INVALID_PARTS';
    END IF;
    IF jsonb_array_length(parts)>1 AND (NOT consent OR n<3 OR ex OR coalesce((p->>'containsMinors')::boolean,true)) THEN
      RAISE EXCEPTION 'SPLIT_NOT_ALLOWED';
    END IF;
    SELECT sum((x->>'seats')::integer), count(DISTINCT x->>'tripId') INTO total,leg_seats FROM jsonb_array_elements(parts) x;
    IF total IS DISTINCT FROM n OR leg_seats<>jsonb_array_length(parts) THEN RAISE EXCEPTION 'INVALID_PARTS'; END IF;
  END IF;
  deadline:=clock_timestamp()+interval '2 minutes';
  FOR part IN SELECT value FROM jsonb_array_elements(parts) LOOP
    v_id:=(part->>'tripId')::uuid; leg_seats:=(part->>'seats')::integer;
    SELECT * INTO t FROM nexo.trips WHERE id=v_id AND route_id=r.id AND association_id=r.association_id FOR UPDATE;
    IF NOT FOUND OR t.status<>'QUEUED' OR t.current_stop>f OR leg_seats IS NULL OR leg_seats<1 OR
      NOT EXISTS(SELECT FROM nexo.memberships WHERE association_id=t.association_id AND user_id=t.driver_id AND role='DRIVER' AND active) THEN
      RAISE EXCEPTION 'INCOMPATIBLE_TRIP';
    END IF;
    IF NOT nexo.fits(t.id,f,e,leg_seats) THEN RAISE EXCEPTION 'NO_CAPACITY'; END IF;
    -- Explicit split proposals cannot bypass the first compatible queue entry.
    SELECT tr.id INTO first_eligible FROM nexo.trips tr
      JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
      WHERE tr.route_id=r.id AND tr.status='QUEUED' AND tr.current_stop<=f AND nexo.fits(tr.id,f,e,leg_seats)
      AND NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.group_id=gid AND b.trip_id=tr.id)
      ORDER BY tr.position_no,tr.id LIMIT 1;
    IF t.id IS DISTINCT FROM first_eligible THEN RAISE EXCEPTION 'QUEUE_ORDER'; END IF;
    INSERT INTO nexo.bookings(association_id,trip_id,route_id,passenger_id,created_by,group_id,source,
      seats,express,from_stop,to_stop,fare_id,price_bob,fare_version,status,expires_at)
    VALUES(r.association_id,t.id,r.id,CASE WHEN src='APP' THEN u END,u,gid,src,leg_seats,ex,f,e,
      fare.id,CASE WHEN ex THEN fare.amount_bob ELSE fare.amount_bob*leg_seats END,fare.version,'HELD',deadline)
    RETURNING id INTO bid;
    ids:=ids || jsonb_build_array(bid);
    PERFORM nexo.audit(r.association_id,'OFFER_CREATED',bid);
  END LOOP;
  RETURN nexo.action_finish(k,jsonb_build_object('op','reserve','request',p),
    jsonb_build_object('groupId',gid,'bookingIds',ids,'status','HELD'));
END $$;

CREATE FUNCTION nexo.respond_offer(k text, booking uuid, accept boolean) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb; cached jsonb; state text;
BEGIN
  IF accept IS NULL THEN RAISE EXCEPTION 'INVALID_RESPONSE'; END IF;
  p:=jsonb_build_object('op','respond','booking',booking,'accept',accept);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  PERFORM nexo.expire_holds(b.route_id);
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF b.status<>'HELD' THEN
    RETURN nexo.action_finish(k,p,jsonb_build_object('status',b.status));
  END IF;
  IF NOT accept THEN
    UPDATE nexo.bookings SET status='REJECTED' WHERE group_id=b.group_id AND status='HELD';
    state:='REJECTED';
  ELSE
    UPDATE nexo.bookings SET driver_accepted=true WHERE id=booking;
    IF EXISTS(SELECT FROM nexo.bookings WHERE group_id=b.group_id AND expires_at<=clock_timestamp()) THEN
      PERFORM nexo.expire_holds(b.route_id);
      RETURN nexo.action_finish(k,p,jsonb_build_object('status','EXPIRED'));
    END IF;
    IF NOT EXISTS(SELECT FROM nexo.bookings WHERE group_id=b.group_id AND (NOT driver_accepted OR status<>'HELD')) THEN
      UPDATE nexo.bookings SET status='CONFIRMED' WHERE group_id=b.group_id;
      state:='CONFIRMED';
    ELSE state:='HELD'; END IF;
  END IF;
  PERFORM nexo.audit(b.association_id,CASE WHEN accept THEN 'OFFER_ACCEPTED' ELSE 'OFFER_REJECTED' END,booking);
  RETURN nexo.action_finish(k,p,jsonb_build_object('status',state));
END $$;

CREATE FUNCTION nexo.cancel(k text, booking uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; p jsonb; cached jsonb;
BEGIN
  p:=jsonb_build_object('op','cancel','booking',booking);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF NOT FOUND OR NOT (b.passenger_id=u OR b.created_by=u OR nexo.has_role(b.association_id,'ASSOCIATION_ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF b.status NOT IN ('HELD','CONFIRMED') THEN
    RETURN nexo.action_finish(k,p,jsonb_build_object('status',b.status));
  END IF;
  IF EXISTS(SELECT FROM nexo.trips t JOIN nexo.bookings x ON x.trip_id=t.id
    WHERE x.group_id=b.group_id AND t.status<>'QUEUED') THEN RAISE EXCEPTION 'TRIP_ALREADY_STARTED'; END IF;
  UPDATE nexo.bookings SET status='CANCELLED' WHERE group_id=b.group_id AND status IN ('HELD','CONFIRMED');
  PERFORM nexo.audit(b.association_id,'GROUP_CANCELLED',b.group_id);
  RETURN nexo.action_finish(k,p,jsonb_build_object('status','CANCELLED'));
END $$;

CREATE FUNCTION nexo.depart(k text, trip uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); t nexo.trips; p jsonb; cached jsonb; count_seats integer;
BEGIN
  p:=jsonb_build_object('op','depart','trip',trip);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO t FROM nexo.trips WHERE id=trip;
  IF NOT FOUND OR NOT nexo.drives(trip) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
  SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
  PERFORM nexo.expire_holds(t.route_id);
  IF t.status<>'QUEUED' THEN RAISE EXCEPTION 'INVALID_TRIP_STATE'; END IF;
  IF EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=trip AND b.status='HELD') THEN RAISE EXCEPTION 'UNACCEPTED_OFFERS'; END IF;
  SELECT coalesce(sum(seats),0) INTO count_seats FROM nexo.bookings WHERE trip_id=trip AND status='CONFIRMED';
  IF count_seats<6 THEN RAISE EXCEPTION 'NOT_FULL'; END IF;
  UPDATE nexo.trips SET status='IN_TRANSIT',departed_at=clock_timestamp() WHERE id=trip;
  PERFORM nexo.audit(t.association_id,'DEPARTED',trip);
  RETURN nexo.action_finish(k,p,jsonb_build_object('status','IN_TRANSIT','tripId',trip));
END $$;

CREATE FUNCTION nexo.progress(k text, trip uuid, stop integer) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); t nexo.trips; p jsonb; cached jsonb; last_stop integer;
BEGIN
  p:=jsonb_build_object('op','progress','trip',trip,'stop',stop);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO t FROM nexo.trips WHERE id=trip;
  IF NOT FOUND OR NOT nexo.drives(trip) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
  SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
  SELECT stop_count-1 INTO last_stop FROM nexo.routes WHERE id=t.route_id;
  IF t.status<>'IN_TRANSIT' OR stop IS NULL OR stop<t.current_stop OR stop>last_stop THEN RAISE EXCEPTION 'INVALID_PROGRESS'; END IF;
  UPDATE nexo.trips SET current_stop=stop,
    status=CASE WHEN stop=last_stop THEN 'COMPLETED' ELSE status END,
    completed_at=CASE WHEN stop=last_stop THEN clock_timestamp() END WHERE id=trip;
  IF stop=last_stop THEN UPDATE nexo.bookings SET status='COMPLETED' WHERE trip_id=trip AND status='CONFIRMED'; END IF;
  PERFORM nexo.audit(t.association_id,'PROGRESS',trip);
  RETURN nexo.action_finish(k,p,jsonb_build_object('stop',stop,'status',CASE WHEN stop=last_stop THEN 'COMPLETED' ELSE 'IN_TRANSIT' END));
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.reserve(text,jsonb),nexo.respond_offer(text,uuid,boolean),
  nexo.cancel(text,uuid),nexo.depart(text,uuid),nexo.progress(text,uuid,integer) TO nexo_app;
