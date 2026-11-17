-- 4B.1: the driver of the trip in turn may register a terminal walk-in while his
-- association has configured unstaffed hours. Same inventory, fares, queue order and
-- idempotency as an administrative walk-in; 001-042 are not edited.

-- Weekly unstaffed windows per association, in America/La_Paz. A window whose end is
-- not after its start crosses midnight into the next day. No window: no driver sale.
CREATE TABLE nexo.unstaffed_schedules (
 association_id uuid PRIMARY KEY REFERENCES nexo.associations,
 revision integer NOT NULL CHECK(revision>0),
 updated_by uuid NOT NULL REFERENCES nexo.users,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.unstaffed_windows (
 association_id uuid NOT NULL REFERENCES nexo.unstaffed_schedules ON DELETE CASCADE,
 weekday smallint NOT NULL CHECK(weekday BETWEEN 1 AND 7),
 starts_at time NOT NULL, ends_at time NOT NULL,
 CHECK(starts_at<>ends_at AND date_trunc('minute',starts_at)=starts_at AND date_trunc('minute',ends_at)=ends_at),
 PRIMARY KEY(association_id,weekday,starts_at)
);
CREATE TABLE nexo.unstaffed_schedule_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 association_id uuid NOT NULL REFERENCES nexo.associations,
 revision integer NOT NULL CHECK(revision>0), windows jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES nexo.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(association_id,revision)
);
CREATE TRIGGER immutable_unstaffed_schedule_events BEFORE UPDATE OR DELETE ON nexo.unstaffed_schedule_events
 FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
-- Only the functions below read or write these tables; no direct grant to nexo_app.
ALTER TABLE nexo.unstaffed_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.unstaffed_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.unstaffed_schedule_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexo.unstaffed_schedules,nexo.unstaffed_windows,nexo.unstaffed_schedule_events FROM PUBLIC;

CREATE FUNCTION nexo.unstaffed_at(association uuid,instant timestamptz)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 WITH local AS(SELECT instant AT TIME ZONE 'America/La_Paz' AS t)
 SELECT EXISTS(SELECT FROM nexo.unstaffed_windows w,local n WHERE w.association_id=association AND(
  (w.starts_at<w.ends_at AND w.weekday=extract(isodow FROM n.t) AND n.t::time>=w.starts_at AND n.t::time<w.ends_at)OR
  (w.starts_at>w.ends_at AND((w.weekday=extract(isodow FROM n.t) AND n.t::time>=w.starts_at)OR
   (w.weekday=extract(isodow FROM n.t-interval '1 day') AND n.t::time<w.ends_at)))))
$$;
-- Server clock only; the browser's time never decides.
CREATE FUNCTION nexo.unstaffed_now(association uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.unstaffed_at(association,clock_timestamp())
$$;

CREATE FUNCTION nexo.unstaffed_schedule_view(association uuid)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT jsonb_build_object('associationId',association,'revision',coalesce((SELECT revision FROM nexo.unstaffed_schedules WHERE association_id=association),0),
  'timeZone','America/La_Paz','unstaffedNow',nexo.unstaffed_now(association),
  'windows',coalesce((SELECT jsonb_agg(jsonb_build_object('weekday',w.weekday,'start',to_char(w.starts_at,'HH24:MI'),'end',to_char(w.ends_at,'HH24:MI'))ORDER BY w.weekday,w.starts_at)
   FROM nexo.unstaffed_windows w WHERE w.association_id=association),'[]'::jsonb))
$$;

-- Any administrator of the association may read it; restricted administrators too.
CREATE FUNCTION nexo.web_unstaffed_schedule(association uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.require_actor();
 IF association IS NULL OR NOT nexo.has_role(association,'ASSOCIATION_ADMIN')THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN nexo.unstaffed_schedule_view(association)||jsonb_build_object('editable',NOT EXISTS(SELECT FROM nexo.admin_limits l WHERE l.association_id=association AND l.user_id=nexo.actor()));
END $$;

-- Only a full (unrestricted) administrator replaces the whole schedule (H1). The
-- association row lock serializes with every reservation, which takes it FOR SHARE.
CREATE FUNCTION nexo.web_set_unstaffed_schedule(k text,association uuid,expected integer,windows jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();p jsonb;cached jsonb;cur_rev integer;w jsonb;n integer;
BEGIN
 p:=jsonb_build_object('op','web_set_unstaffed_schedule','association',association,'expected',expected,'windows',windows);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF association IS NULL OR expected IS NULL OR expected<0 OR windows IS NULL OR jsonb_typeof(windows)<>'array' OR jsonb_array_length(windows)>21 THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
 PERFORM 1 FROM nexo.associations WHERE id=association FOR UPDATE;
 IF NOT FOUND OR NOT nexo.has_role(association,'ASSOCIATION_ADMIN')OR EXISTS(SELECT FROM nexo.admin_limits l WHERE l.association_id=association AND l.user_id=u)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=association AND user_id=u AND role='ASSOCIATION_ADMIN' AND active FOR SHARE;
 FOR w IN SELECT value FROM jsonb_array_elements(windows)LOOP
  IF jsonb_typeof(w)<>'object' OR(SELECT count(*)FROM jsonb_object_keys(w))<>3 OR NOT w?&ARRAY['weekday','start','end']OR
   jsonb_typeof(w->'weekday')<>'number' OR(w->>'weekday')!~'^[1-7]$' OR
   jsonb_typeof(w->'start')<>'string' OR(w->>'start')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR
   jsonb_typeof(w->'end')<>'string' OR(w->>'end')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR w->>'start'=w->>'end' THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
 END LOOP;
 SELECT count(DISTINCT(x->>'weekday',x->>'start'))INTO n FROM jsonb_array_elements(windows)x;
 IF n<>jsonb_array_length(windows)THEN RAISE EXCEPTION 'INVALID_SCHEDULE';END IF;
 SELECT revision INTO cur_rev FROM nexo.unstaffed_schedules WHERE association_id=association FOR UPDATE;
 IF coalesce(cur_rev,0)<>expected THEN RAISE EXCEPTION 'STALE_SCHEDULE';END IF;
 IF cur_rev IS NULL THEN INSERT INTO nexo.unstaffed_schedules(association_id,revision,updated_by)VALUES(association,1,u);
 ELSE UPDATE nexo.unstaffed_schedules SET revision=cur_rev+1,updated_by=u,updated_at=clock_timestamp()WHERE association_id=association;END IF;
 DELETE FROM nexo.unstaffed_windows WHERE association_id=association;
 INSERT INTO nexo.unstaffed_windows SELECT association,(x->>'weekday')::smallint,(x->>'start')::time,(x->>'end')::time FROM jsonb_array_elements(windows)x;
 INSERT INTO nexo.unstaffed_schedule_events(association_id,revision,windows,actor_id)SELECT association,revision,(nexo.unstaffed_schedule_view(association))->'windows',u FROM nexo.unstaffed_schedules WHERE association_id=association;
 RETURN nexo.action_finish(k,p,nexo.unstaffed_schedule_view(association));
END $$;

-- Authority used inside the native inventory transaction, after the route row lock
-- and the association FOR SHARE. Queue order, capacity and fare stay in the core.
-- A driver sells only: his own QUEUED trip, a single part, not express, from a
-- TERMINAL point, without minors declared (M1), inside an unstaffed window.
CREATE FUNCTION nexo.driver_walk_in_allowed(route uuid,p jsonb)RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;
BEGIN
 IF p->>'source' IS DISTINCT FROM 'WALK_IN' OR jsonb_typeof(p->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'parts')<>1 OR
  coalesce(p->'express','false'::jsonb)<>'false'::jsonb OR p->'containsMinors' IS DISTINCT FROM 'false'::jsonb OR
  coalesce(p->'splitConsent','false'::jsonb)<>'false'::jsonb OR (p->'parts'->0->>'tripId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false;END IF;
 SELECT * INTO t FROM nexo.trips WHERE id=(p->'parts'->0->>'tripId')::uuid AND route_id=route;
 IF t.id IS NULL OR t.status<>'QUEUED' OR NOT nexo.drives(t.id)THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT FROM nexo.web_point_profiles m WHERE m.route_id=route AND m.stop_index=(p->>'from')::integer AND m.kind='TERMINAL')THEN RETURN false;END IF;
 RETURN nexo.unstaffed_now(t.association_id);
END $$;

-- Driver panel context: the server, not the browser, says whether the action applies.
CREATE FUNCTION nexo.web_driver_walk_in_context(trip uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;first_trip uuid;unstaffed boolean;terminal boolean;
BEGIN
 PERFORM nexo.require_actor();
 SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF t.id IS NULL OR NOT nexo.drives(t.id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT tr.id INTO first_trip FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
  WHERE tr.route_id=t.route_id AND tr.status='QUEUED' ORDER BY tr.position_no,tr.id LIMIT 1;
 unstaffed:=nexo.unstaffed_now(t.association_id);
 terminal:=EXISTS(SELECT FROM nexo.web_point_profiles m JOIN nexo.stops s ON s.route_id=m.route_id AND s.stop_index=m.stop_index AND s.boarding_allowed WHERE m.route_id=t.route_id AND m.kind='TERMINAL');
 RETURN jsonb_build_object('tripId',t.id,'routeId',t.route_id,'status',t.status,'inTurn',first_trip IS NOT DISTINCT FROM t.id AND t.status='QUEUED',
  'unstaffedNow',unstaffed,'terminalPoint',terminal,'minorsAllowed',false,
  'allowed',t.status='QUEUED' AND first_trip IS NOT DISTINCT FROM t.id AND unstaffed AND terminal,
  'reason',CASE WHEN t.status<>'QUEUED' THEN 'NOT_QUEUED' WHEN first_trip IS DISTINCT FROM t.id THEN 'NOT_IN_TURN' WHEN NOT unstaffed THEN 'STAFFED_HOURS' WHEN NOT terminal THEN 'NO_TERMINAL_POINT' ELSE NULL END);
END $$;

-- Administrative traceability (H3 keeps admins able to sell): walk-ins created by the
-- trip's own driver. Reading never changes a reservation.
CREATE FUNCTION nexo.web_driver_walk_ins(association uuid,page_size integer,page_offset integer)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE items jsonb;
BEGIN
 PERFORM nexo.require_actor();
 IF association IS NULL OR NOT nexo.has_role(association,'ASSOCIATION_ADMIN')THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 SELECT coalesce(jsonb_agg(x.entry ORDER BY x.created_at DESC,x.id),'[]'::jsonb)INTO items FROM(
  SELECT b.id,b.created_at,jsonb_build_object('bookingId',b.id,'groupId',b.group_id,'createdAt',b.created_at,'tripId',b.trip_id,'route',r.name,'vehicle',v.label,
   'driver',d.label,'seats',b.seats,'from',b.from_stop,'to',b.to_stop,'status',b.status,'priceBOB',b.price_bob::numeric(12,2)::text,'moneyProcessed',false)AS entry
  FROM nexo.bookings b JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.routes r ON r.id=b.route_id JOIN nexo.vehicles v ON v.id=t.vehicle_id JOIN nexo.users d ON d.id=b.created_by
  WHERE b.association_id=association AND b.source='WALK_IN' AND b.created_by=t.driver_id AND nexo.manage_route(b.route_id)
  ORDER BY b.created_at DESC,b.id LIMIT page_size+1 OFFSET page_offset)x;
 RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(items)>page_size THEN items-page_size ELSE items END,'limit',page_size,'offset',page_offset,'hasMore',jsonb_array_length(items)>page_size);
END $$;

-- Only the WALK_IN source gate of the proven core changes; OID, ACL, signature,
-- locks and six-seat allocation are preserved.
DO $$DECLARE definition text;old text:='(src=''WALK_IN'' AND NOT nexo.has_role(r.association_id,''ASSOCIATION_ADMIN''))';BEGIN
 definition:=pg_get_functiondef('nexo.reserve_inventory(text,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'DRIVER_WALK_IN_MIGRATION_MISMATCH';END IF;
 EXECUTE replace(definition,old,'(src=''WALK_IN'' AND NOT nexo.has_role(r.association_id,''ASSOCIATION_ADMIN'') AND NOT nexo.driver_walk_in_allowed(r.id,p))');
END$$;

REVOKE ALL ON FUNCTION nexo.unstaffed_at(uuid,timestamptz),nexo.unstaffed_now(uuid),nexo.unstaffed_schedule_view(uuid),nexo.driver_walk_in_allowed(uuid,jsonb),
 nexo.web_unstaffed_schedule(uuid),nexo.web_set_unstaffed_schedule(text,uuid,integer,jsonb),nexo.web_driver_walk_in_context(uuid),
 nexo.web_driver_walk_ins(uuid,integer,integer)FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_unstaffed_schedule(uuid),nexo.web_set_unstaffed_schedule(text,uuid,integer,jsonb),
 nexo.web_driver_walk_in_context(uuid),nexo.web_driver_walk_ins(uuid,integer,integer)TO nexo_app;
