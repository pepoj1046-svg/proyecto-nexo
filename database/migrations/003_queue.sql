-- Terminal codes are association-owned fictitious catalog identifiers in this pilot.
ALTER TABLE nexo.routes ADD COLUMN origin_code text NOT NULL DEFAULT 'UNCONFIGURED';
ALTER TABLE nexo.routes ADD COLUMN destination_code text NOT NULL DEFAULT 'UNCONFIGURED';

CREATE FUNCTION nexo.request_queue(k text, previous_trip uuid, target_route uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); t nexo.trips; source nexo.routes; target nexo.routes;
  p jsonb; cached jsonb; next_position bigint; next_trip uuid;
BEGIN
  p:=jsonb_build_object('op','request_queue','previous',previous_trip,'target',target_route);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO t FROM nexo.trips WHERE id=previous_trip;
  IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF t.status<>'COMPLETED' THEN RAISE EXCEPTION 'NOT_AVAILABLE'; END IF;
  -- Deterministic order for transfers between queues in opposite directions.
  PERFORM 1 FROM nexo.routes WHERE id IN (t.route_id,target_route) ORDER BY id FOR UPDATE;
  SELECT * INTO source FROM nexo.routes WHERE id=t.route_id;
  SELECT * INTO target FROM nexo.routes WHERE id=target_route AND association_id=t.association_id;
  IF NOT FOUND OR source.destination_code='UNCONFIGURED' OR target.origin_code<>source.destination_code THEN
    RAISE EXCEPTION 'INVALID_DESTINATION_QUEUE';
  END IF;
  IF t.completed_at IS NULL OR EXISTS(SELECT FROM nexo.trips later WHERE
    (later.vehicle_id=t.vehicle_id OR later.driver_id=u) AND later.status='COMPLETED'
    AND later.completed_at>t.completed_at) THEN
    RAISE EXCEPTION 'STALE_PREVIOUS_TRIP';
  END IF;
  IF EXISTS(SELECT FROM nexo.trips WHERE status<>'COMPLETED' AND (vehicle_id=t.vehicle_id OR driver_id=u)) THEN
    RAISE EXCEPTION 'ALREADY_ACTIVE';
  END IF;
  SELECT coalesce(max(position_no),0)+1 INTO next_position FROM nexo.trips WHERE route_id=target.id;
  INSERT INTO nexo.trips(association_id,route_id,vehicle_id,driver_id,position_no)
    VALUES(t.association_id,target.id,t.vehicle_id,u,next_position) RETURNING id INTO next_trip;
  PERFORM nexo.audit(t.association_id,'QUEUE_REQUESTED',next_trip);
  RETURN nexo.action_finish(k,p,jsonb_build_object('tripId',next_trip,'position',next_position));
END $$;
GRANT EXECUTE ON FUNCTION nexo.request_queue(text,uuid,uuid) TO nexo_app;

CREATE FUNCTION nexo.immutable_audit() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,nexo AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_AUDIT'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON nexo.audit_events
  FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
