-- Preserve the proven inventory implementation; no caller can bypass the gate.
ALTER FUNCTION nexo.reserve(text,jsonb) RENAME TO reserve_inventory;
REVOKE EXECUTE ON FUNCTION nexo.reserve_inventory(text,jsonb) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.reserve(k text,p jsonb) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); cached jsonb;
BEGIN
  cached:=nexo.action_start(k,jsonb_build_object('op','reserve','request',p));
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  PERFORM nexo.require_eligible_route((p->>'routeId')::uuid);
  RETURN nexo.reserve_inventory(k,p);
END $$;
GRANT EXECUTE ON FUNCTION nexo.reserve(text,jsonb) TO nexo_app;
CREATE FUNCTION nexo.guard_booking_eligibility() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF TG_OP='INSERT' OR (NEW.status='CONFIRMED' AND OLD.status='HELD') THEN
    PERFORM nexo.require_eligible_route(NEW.route_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_eligibility BEFORE INSERT OR UPDATE ON nexo.bookings
  FOR EACH ROW EXECUTE FUNCTION nexo.guard_booking_eligibility();

CREATE FUNCTION nexo.owns_route(route uuid) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT EXISTS(SELECT FROM nexo.routes r WHERE r.id=route AND
    (nexo.has_role(r.association_id,'ASSOCIATION_ADMIN') OR
      EXISTS(SELECT FROM nexo.trips t WHERE t.route_id=r.id AND nexo.drives(t.id))))
$$;
CREATE FUNCTION nexo.can_read_route(route uuid) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT nexo.actor() IS NOT NULL AND (nexo.route_eligible(route) OR nexo.owns_route(route)
    OR EXISTS(SELECT FROM nexo.bookings b WHERE b.route_id=route
      AND (b.passenger_id=nexo.actor() OR b.created_by=nexo.actor())))
$$;
CREATE FUNCTION nexo.is_operation_reviewer() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT EXISTS(SELECT FROM nexo.operation_reviewers WHERE user_id=nexo.actor())
$$;
GRANT EXECUTE ON FUNCTION nexo.owns_route(uuid),nexo.can_read_route(uuid),nexo.is_operation_reviewer() TO nexo_app;
DROP POLICY association_read ON nexo.associations;
CREATE POLICY association_read ON nexo.associations FOR SELECT USING (nexo.actor() IS NOT NULL AND
  (nexo.has_role(id,'ASSOCIATION_ADMIN') OR nexo.has_role(id,'DRIVER') OR
   EXISTS(SELECT FROM nexo.routes r WHERE r.association_id=associations.id AND nexo.route_eligible(r.id))));
DROP POLICY route_read ON nexo.routes;
CREATE POLICY route_read ON nexo.routes FOR SELECT USING (nexo.can_read_route(id));
DROP POLICY stop_read ON nexo.stops;
CREATE POLICY stop_read ON nexo.stops FOR SELECT USING (nexo.can_read_route(route_id));
DROP POLICY fare_read ON nexo.fares;
CREATE POLICY fare_read ON nexo.fares FOR SELECT USING (nexo.actor() IS NOT NULL AND
  (nexo.owns_route(route_id) OR EXISTS(SELECT FROM nexo.bookings b WHERE b.fare_id=fares.id
    AND (b.passenger_id=nexo.actor() OR b.created_by=nexo.actor())) OR
   (nexo.route_eligible(route_id) AND valid_from<=statement_timestamp()
    AND (valid_until IS NULL OR valid_until>statement_timestamp()))));
DROP POLICY authorization_owner_read ON nexo.route_authorizations;
CREATE POLICY authorization_owner_read ON nexo.route_authorizations FOR SELECT
  USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN') OR nexo.is_operation_reviewer());
DROP POLICY authorization_event_read ON nexo.authorization_events;
CREATE POLICY authorization_event_read ON nexo.authorization_events FOR SELECT
  USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN') OR nexo.is_operation_reviewer());

-- Destination identity now comes from localities, never arbitrary text codes.
CREATE OR REPLACE FUNCTION nexo.request_queue(k text, previous_trip uuid, target_route uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); t nexo.trips; source nexo.routes; target nexo.routes;
  p jsonb; cached jsonb; next_position bigint; next_trip uuid;
BEGIN
  p:=jsonb_build_object('op','request_queue','previous',previous_trip,'target',target_route);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO t FROM nexo.trips WHERE id=previous_trip;
  IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF t.status<>'COMPLETED' THEN RAISE EXCEPTION 'NOT_AVAILABLE'; END IF;
  PERFORM 1 FROM nexo.routes WHERE id IN (t.route_id,target_route) ORDER BY id FOR UPDATE;
  SELECT * INTO source FROM nexo.routes WHERE id=t.route_id;
  SELECT * INTO target FROM nexo.routes WHERE id=target_route AND association_id=t.association_id;
  IF NOT FOUND OR source.destination_locality_id IS NULL OR target.catalog_id IS DISTINCT FROM source.catalog_id
    OR target.origin_locality_id IS DISTINCT FROM source.destination_locality_id THEN
    RAISE EXCEPTION 'INVALID_DESTINATION_QUEUE';
  END IF;
  IF t.completed_at IS NULL OR EXISTS(SELECT FROM nexo.trips later WHERE
    (later.vehicle_id=t.vehicle_id OR later.driver_id=u) AND later.status='COMPLETED'
    AND later.completed_at>t.completed_at) THEN RAISE EXCEPTION 'STALE_PREVIOUS_TRIP'; END IF;
  IF EXISTS(SELECT FROM nexo.trips WHERE status<>'COMPLETED' AND (vehicle_id=t.vehicle_id OR driver_id=u)) THEN
    RAISE EXCEPTION 'ALREADY_ACTIVE';
  END IF;
  PERFORM nexo.require_eligible_route(target_route);
  SELECT coalesce(max(position_no),0)+1 INTO next_position FROM nexo.trips WHERE route_id=target.id;
  INSERT INTO nexo.trips(association_id,route_id,vehicle_id,driver_id,position_no)
    VALUES(t.association_id,target.id,t.vehicle_id,u,next_position) RETURNING id INTO next_trip;
  PERFORM nexo.audit(t.association_id,'QUEUE_REQUESTED',next_trip);
  RETURN nexo.action_finish(k,p,jsonb_build_object('tripId',next_trip,'position',next_position));
END $$;
