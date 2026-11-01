-- A web return must not conceal passengers still observed aboard the completed run.
-- Reuse the native receipt/payload and mutation; no second queue or inventory.
CREATE FUNCTION nexo.web_request_queue(k text,previous_trip uuid,target_route uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();t nexo.trips;cached jsonb;
BEGIN
 SELECT * INTO t FROM nexo.trips WHERE id=previous_trip;
 IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.check_scope(t.route_id);PERFORM nexo.check_scope(target_route);
 -- The exact existing payload preserves native replays after a later departure,
 -- a new incident or another change of operational state. Authorization stays live.
 cached:=nexo.action_start(k,jsonb_build_object('op','request_queue','previous',previous_trip,'target',target_route));
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id IN(t.route_id,target_route)ORDER BY id FOR UPDATE;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF nexo.observed_onboard(t.id)<>0 THEN RAISE EXCEPTION 'PASSENGERS_ONBOARD';END IF;
 RETURN nexo.request_queue(k,previous_trip,target_route);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.web_request_queue(text,uuid,uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.web_request_queue(text,uuid,uuid)TO nexo_app;
