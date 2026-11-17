-- Additive Stage 2. Existing inventory, prices and dispatch are reused.
CREATE FUNCTION nexo.reserve_business(k text,p jsonb,quote jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); result jsonb; details jsonb; total numeric; fare uuid; version integer;
BEGIN
  IF quote IS NOT NULL THEN
    IF jsonb_typeof(quote)<>'object' THEN RAISE EXCEPTION 'INVALID_QUOTE'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(quote))<>3 OR NOT quote ?& ARRAY['fareId','fareVersion','totalBOB'] OR
      jsonb_typeof(quote->'fareId') IS DISTINCT FROM 'string' OR
      (quote->>'fareId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
      jsonb_typeof(quote->'fareVersion') IS DISTINCT FROM 'number' OR (quote->>'fareVersion') !~ '^[1-9][0-9]{0,9}$' OR
      jsonb_typeof(quote->'totalBOB') IS DISTINCT FROM 'string' OR (quote->>'totalBOB') !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' THEN
      RAISE EXCEPTION 'INVALID_QUOTE';
    END IF;
    IF (quote->>'fareVersion')::numeric>2147483647 THEN RAISE EXCEPTION 'INVALID_QUOTE'; END IF;
  END IF;
  result:=nexo.reserve(k,p);
  SELECT jsonb_agg(jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'seats',b.seats,'from',b.from_stop,'to',b.to_stop,
    'status',b.status,'expiresAt',b.expires_at,'fareId',b.fare_id,'fareVersion',b.fare_version,'priceBOB',b.price_bob::text)
    ORDER BY b.id),sum(b.price_bob),min(b.fare_id::text)::uuid,min(b.fare_version)
    INTO details,total,fare,version FROM nexo.bookings b WHERE b.group_id=(result->>'groupId')::uuid AND b.created_by=u;
  IF details IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF quote IS NOT NULL AND ((quote->>'fareId')::uuid IS DISTINCT FROM fare OR
    (quote->>'fareVersion')::integer IS DISTINCT FROM version OR (quote->>'totalBOB')::numeric IS DISTINCT FROM total) THEN
    RAISE EXCEPTION 'QUOTE_CHANGED';
  END IF;
  RETURN (result-'status') || jsonb_build_object('initialStatus',result->>'status','bookings',details,
    'totalPriceBOB',total::numeric(12,2)::text,'currency','BOB');
END $$;

-- Observation per booking/group, not identification or verification of persons.
CREATE TABLE nexo.booking_movements (
  association_id uuid NOT NULL, booking_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('BOARD','ALIGHT')), stop_index integer NOT NULL CHECK(stop_index>=0),
  actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(association_id,booking_id,kind),
  FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
ALTER TABLE nexo.booking_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY movement_read ON nexo.booking_movements FOR SELECT USING (
  EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=booking_movements.association_id));
GRANT SELECT ON nexo.booking_movements TO nexo_app;
CREATE TRIGGER immutable_booking_movements BEFORE UPDATE OR DELETE ON nexo.booking_movements
  FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
CREATE FUNCTION nexo.record_movement(k text, booking uuid, movement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); b nexo.bookings; t nexo.trips; p jsonb; cached jsonb; stop integer;
BEGIN
  IF movement IS NULL OR movement NOT IN ('BOARD','ALIGHT') THEN RAISE EXCEPTION 'INVALID_MOVEMENT'; END IF;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  IF NOT FOUND OR NOT nexo.drives(b.trip_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  p:=jsonb_build_object('op','record_movement','booking',booking,'kind',movement);
  cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
  SELECT * INTO b FROM nexo.bookings WHERE id=booking;
  SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
  IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  -- A second action key is also idempotent once the observation exists.
  IF EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=booking AND kind=movement) THEN
    RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',booking,'kind',movement,'recorded',true));
  END IF;
  stop:=CASE WHEN movement='BOARD' THEN b.from_stop ELSE b.to_stop END;
  IF t.current_stop<>stop OR
    (movement='BOARD' AND (b.status<>'CONFIRMED' OR t.status<>'IN_TRANSIT')) OR
    (movement='ALIGHT' AND (b.status NOT IN ('CONFIRMED','COMPLETED') OR t.status NOT IN ('IN_TRANSIT','COMPLETED') OR
      NOT EXISTS(SELECT FROM nexo.booking_movements WHERE booking_id=booking AND kind='BOARD'))) OR
    NOT EXISTS(SELECT FROM nexo.stops s WHERE s.route_id=b.route_id AND s.stop_index=stop AND
      CASE WHEN movement='BOARD' THEN s.boarding_allowed ELSE s.alighting_allowed END) THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_STATE';
  END IF;
  INSERT INTO nexo.booking_movements VALUES(b.association_id,booking,movement,stop,u,clock_timestamp());
  PERFORM nexo.audit(b.association_id,CASE WHEN movement='BOARD' THEN 'BOOKING_BOARDED' ELSE 'BOOKING_ALIGHTED' END,booking);
  RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',booking,'kind',movement,'recorded',true));
END $$;
GRANT EXECUTE ON FUNCTION nexo.reserve_business(text,jsonb,jsonb),nexo.record_movement(text,uuid,text) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
