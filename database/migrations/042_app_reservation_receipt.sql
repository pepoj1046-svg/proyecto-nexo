-- Closed, read-only APP receipt projection. No receipt/inventory table or raw grant.
CREATE FUNCTION nexo.web_app_reservation_receipt(k text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();a nexo.actions;ids uuid[];gid uuid;op text;original text;count_rows integer;
BEGIN
 IF k IS NULL OR k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_RECOVERY_TICKET';END IF;
 -- Same namespace as action_start; try-only and shared, compatible with READ ONLY.
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended(u::text||':'||k,0)) THEN RETURN jsonb_build_object('state','NOT_OBSERVED');END IF;
 SELECT * INTO a FROM nexo.actions WHERE actor_id=u AND action_key=k;
 IF nexo.actor()IS DISTINCT FROM u THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','NOT_OBSERVED');END IF;
 op:=a.payload->>'op';original:=a.result->>'status';
 IF op IS NULL OR op NOT IN('reserve','reserve_enroute') OR a.payload#>>'{request,source}'IS DISTINCT FROM'APP'
  OR original IS NULL OR original NOT IN('HELD','CONFIRMED') OR jsonb_typeof(a.result->'groupId')IS DISTINCT FROM'string'
  OR(a.result->>'groupId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
 gid:=(a.result->>'groupId')::uuid;
 IF op='reserve' THEN
  IF jsonb_typeof(a.result->'bookingIds')IS DISTINCT FROM'array' THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
  IF jsonb_array_length(a.result->'bookingIds')NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(a.result->'bookingIds')x WHERE jsonb_typeof(x)IS DISTINCT FROM'string'OR(x#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
  SELECT array_agg((x#>>'{}')::uuid ORDER BY n)INTO ids FROM jsonb_array_elements(a.result->'bookingIds')WITH ORDINALITY v(x,n);
 ELSE
  IF jsonb_typeof(a.result->'bookingId')IS DISTINCT FROM'string'OR(a.result->>'bookingId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
  ids:=ARRAY[(a.result->>'bookingId')::uuid];
 END IF;
 IF cardinality(ids)<>(SELECT count(DISTINCT x)FROM unnest(ids)x)THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
 -- Explicit owner checks: SECURITY DEFINER does not inherit caller RLS.
 SELECT count(*)INTO count_rows FROM nexo.bookings b WHERE b.group_id=gid;
 IF count_rows<>cardinality(ids) OR EXISTS(SELECT FROM unnest(ids)id WHERE NOT EXISTS(
  SELECT FROM nexo.bookings b WHERE b.id=id AND b.group_id=gid AND b.source='APP'AND b.passenger_id=u AND b.created_by=u AND nexo.can_read_route(b.route_id)))
 THEN RAISE EXCEPTION 'RECOVERY_UNAVAILABLE';END IF;
 IF nexo.actor()IS DISTINCT FROM u THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 RETURN jsonb_build_object('state','RECORDED','receipt',jsonb_build_object('operation',op,'groupId',gid,'bookingIds',to_jsonb(ids),'originalStatus',original));
END $$;
REVOKE ALL ON FUNCTION nexo.web_app_reservation_receipt(text)FROM PUBLIC,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_app_reservation_receipt(text)TO nexo_app;
