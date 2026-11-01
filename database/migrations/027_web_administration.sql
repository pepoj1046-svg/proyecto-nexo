-- Incremento 6: bounded web projections and reasoned cancellation over the existing core.
-- 001-026 remain unchanged. No inventory, price or historical-row backfill.
CREATE FUNCTION nexo.web_booking_entry(booking uuid,own_view boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF own_view THEN
SELECT jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'routeId',b.route_id,'association',a.name,'boardingName',s.name,'alightingName',d.name,'boardingPointId',b.route_id::text||':'||b.from_stop,'alightingPointId',b.route_id::text||':'||b.to_stop,
 'seats',b.seats,'priceBOB',b.price_bob::text,'fareVersion',b.fare_version,'currency','BOB','status',b.status,'effectiveStatus',CASE WHEN b.status='HELD'AND b.expires_at<=clock_timestamp()THEN'EXPIRED'ELSE b.status END,'createdAt',b.created_at,'expiresAt',b.expires_at,
 'vehicleLabel',v.label,'operation',nexo.operational_status(b.trip_id),'assignmentState',nexo.assignment_status(b.id)->>'state',
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',h.kind,'createdAt',h.created_at)ORDER BY h.created_at,h.kind),'[]')FROM(SELECT 'REQUEST_RECEIVED'::text AS kind,b.created_at UNION ALL SELECT o.kind,o.created_at FROM nexo.assignment_outcomes o WHERE o.booking_id=b.id)h))INTO result
 FROM nexo.bookings b JOIN nexo.associations a ON a.id=b.association_id JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id
 JOIN nexo.stops s ON s.route_id=b.route_id AND s.stop_index=b.from_stop JOIN nexo.stops d ON d.route_id=b.route_id AND d.stop_index=b.to_stop
 WHERE b.id=booking;
 ELSE
SELECT jsonb_build_object('bookingId',b.id,'source',b.source,'seats',b.seats,'status',b.status,
 'effectiveStatus',CASE WHEN b.status='HELD'AND b.expires_at<=clock_timestamp()THEN'EXPIRED'ELSE b.status END,
 'priceBOB',b.price_bob::text,'boardingPointId',b.route_id::text||':'||b.from_stop,'alightingPointId',b.route_id::text||':'||b.to_stop,
 'boardingName',s.name,'alightingName',d.name,'episode',nexo.assignment_episode(b.id),
 'presence',(SELECT jsonb_build_object('declarationRecorded',(e->>'declarationEventId')IS NOT NULL,'declaredActive',e->'declaredActive','verified',e->'verified','boarded',e->'boarded','pickupRequested',e->'responded','pickupArrived',e->'pickupWaitStartedAt')FROM(SELECT nexo.terminal_evaluation(b.id)e)q),
 'movementMode',CASE WHEN EXISTS(SELECT FROM nexo.movement_facts m WHERE m.booking_id=b.id AND member_id IS NULL)THEN'GROUP'WHEN EXISTS(SELECT FROM nexo.movement_facts m WHERE m.booking_id=b.id AND member_id IS NOT NULL)THEN'INDIVIDUAL'ELSE'NONE'END,
 'movements',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',m.kind,'pointId',b.route_id::text||':'||m.stop_index)ORDER BY m.created_at,m.kind),'[]')FROM nexo.effective_movements m WHERE m.booking_id=b.id AND member_id IS NULL),
 'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('memberId',m.id,'ordinal',m.ordinal,'boarded',EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=m.id AND e.kind='BOARD'),'alighted',EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=m.id AND e.kind='ALIGHT'))ORDER BY m.ordinal),'[]')FROM nexo.booking_members m WHERE m.booking_id=b.id)) INTO result
 FROM nexo.bookings b JOIN nexo.stops s ON s.route_id=b.route_id AND s.stop_index=b.from_stop JOIN nexo.stops d ON d.route_id=b.route_id AND d.stop_index=b.to_stop
 WHERE b.id=booking;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION nexo.web_bookings_page(trip uuid,view_kind text,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL,focus uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();revision text;scope_key text;total bigint;last_time timestamptz;last_id uuid;items jsonb;tail jsonb;has_more boolean;
BEGIN
 IF view_kind IS NULL OR view_kind NOT IN('OWN','ADMIN','DRIVER','PASSENGER') OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 IF view_kind='OWN' THEN
  IF trip IS NOT NULL OR focus IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 ELSE
  PERFORM nexo.web_trip_snapshot(trip,view_kind);
  IF focus IS NOT NULL AND view_kind<>'PASSENGER' THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 END IF;
 scope_key:=encode(sha256(convert_to(u::text||':'||view_kind||':'||coalesce(trip::text,'OWN')||':'||coalesce(focus::text,''),'UTF8')),'hex');
 SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(b.id::text||':'||b.created_at::text||':'||b.trip_id::text||':'||b.status,'|'ORDER BY b.id),''),'UTF8')),'hex') INTO total,revision
 FROM nexo.bookings b WHERE (view_kind='OWN'AND b.passenger_id=u AND b.source='APP' OR view_kind<>'OWN'AND b.trip_id=trip AND(view_kind<>'PASSENGER'OR b.passenger_id=u AND b.source='APP'))AND(focus IS NULL OR b.id=focus);
 IF page_cursor IS NOT NULL THEN
  IF jsonb_typeof(page_cursor)<>'object' OR (SELECT count(*)FROM jsonb_object_keys(page_cursor))<>6 OR page_cursor->>'scope'IS DISTINCT FROM scope_key OR page_cursor->>'size'IS DISTINCT FROM page_size::text OR page_cursor->>'v'IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
  IF page_cursor->>'revision'IS DISTINCT FROM revision THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
  BEGIN last_time:=(page_cursor->>'createdAt')::timestamptz;last_id:=(page_cursor->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_CURSOR';END;
  IF last_time IS NULL OR last_id IS NULL OR NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.id=last_id AND b.created_at=last_time AND(view_kind='OWN'AND b.passenger_id=u AND b.source='APP'OR view_kind<>'OWN'AND b.trip_id=trip AND(view_kind<>'PASSENGER'OR b.passenger_id=u AND b.source='APP'))AND(focus IS NULL OR b.id=focus)) THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
 END IF;
 WITH candidates AS MATERIALIZED(
  SELECT b.id,b.created_at,row_number()OVER(ORDER BY CASE WHEN view_kind='OWN'THEN b.created_at END DESC,CASE WHEN view_kind='OWN'THEN b.id END DESC,b.created_at,b.id) AS n
  FROM nexo.bookings b WHERE(view_kind='OWN'AND b.passenger_id=u AND b.source='APP'OR view_kind<>'OWN'AND b.trip_id=trip AND(view_kind<>'PASSENGER'OR b.passenger_id=u AND b.source='APP'))AND(focus IS NULL OR b.id=focus)
  AND(last_id IS NULL OR view_kind='OWN'AND(b.created_at,b.id)<(last_time,last_id)OR view_kind<>'OWN'AND(b.created_at,b.id)>(last_time,last_id))
  ORDER BY CASE WHEN view_kind='OWN'THEN b.created_at END DESC,CASE WHEN view_kind='OWN'THEN b.id END DESC,b.created_at,b.id LIMIT page_size+1)
 SELECT coalesce(jsonb_agg(nexo.web_booking_entry(id,view_kind='OWN')ORDER BY n)FILTER(WHERE n<=page_size),'[]'),
  (jsonb_agg(jsonb_build_object('createdAt',created_at,'id',id)ORDER BY n DESC)FILTER(WHERE n<=page_size))->0,count(*)>page_size INTO items,tail,has_more FROM candidates;
 RETURN jsonb_build_object('bookings',items,'limit',page_size,'total',total,'nextCursor',CASE WHEN has_more THEN tail||jsonb_build_object('v',1,'scope',scope_key,'revision',revision,'size',page_size)ELSE NULL END,'snapshotOnly',true,'storage','EPHEMERAL_LAB');
END $$;
CREATE FUNCTION nexo.web_trip_page(trip uuid,view_kind text,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL,focus uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.web_trip_snapshot(trip,view_kind)||nexo.web_bookings_page(trip,view_kind,page_size,page_cursor,focus)||jsonb_build_object('bookingLimit',page_size)
$$;
CREATE FUNCTION nexo.web_admin_booking(booking uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;r uuid;parts jsonb;condition jsonb;reviewed boolean:=false;history jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.manage_route(b.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 FOR r IN SELECT DISTINCT route_id FROM nexo.bookings WHERE group_id=b.group_id ORDER BY route_id LOOP
  PERFORM nexo.check_scope(r);IF NOT nexo.manage_route(r)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',x.id,'tripId',x.trip_id,'seats',x.seats,'status',x.status,'priceBOB',x.price_bob::text,'vehicle',v.label,'tripStatus',t.status,'onboard',nexo.booking_onboard(x.id))ORDER BY x.created_at,x.id),'[]')INTO parts
 FROM nexo.bookings x JOIN nexo.trips t ON t.id=x.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE x.group_id=b.group_id;
 SELECT jsonb_build_object('revision',revision,'state',state,'reason',reason,'description',alternate_description)INTO condition FROM nexo.route_conditions WHERE route_id=b.route_id;
 IF condition IS NOT NULL THEN SELECT EXISTS(SELECT FROM nexo.condition_decisions WHERE booking_id=b.id AND revision=(condition->>'revision')::integer AND decision='ADMIN_REVIEW')INTO reviewed;END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('action',action,'createdAt',created_at)ORDER BY created_at,id),'[]')INTO history FROM nexo.audit_events WHERE entity_id=b.group_id AND association_id=b.association_id AND action LIKE 'ADMIN_CANCELLED:%';
 RETURN jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'episode',nexo.assignment_episode(b.id),'parts',parts,'seats',(SELECT sum(seats)FROM nexo.bookings WHERE group_id=b.group_id),
 'canCancel',EXISTS(SELECT FROM nexo.bookings WHERE group_id=b.group_id AND status IN('HELD','CONFIRMED'))AND NOT EXISTS(SELECT FROM nexo.bookings x JOIN nexo.trips t ON t.id=x.trip_id WHERE x.group_id=b.group_id AND(t.status<>'QUEUED'OR nexo.booking_onboard(x.id)>0)),
 'condition',condition,'reviewed',reviewed,'cancellations',history,'moneyProcessed',false);
END $$;
CREATE FUNCTION nexo.web_admin_cancel(k text,booking uuid,expected_trip uuid,expected_episode integer,reason_code text,confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;result jsonb;inner_key text;r uuid;was_live boolean;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.manage_route(b.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 FOR r IN SELECT DISTINCT route_id FROM nexo.bookings WHERE group_id=b.group_id ORDER BY route_id LOOP
  PERFORM nexo.check_scope(r);IF NOT nexo.manage_route(r)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END LOOP;
 IF confirmed IS DISTINCT FROM true OR reason_code IS NULL OR reason_code NOT IN('OPERATOR_ERROR','WRONG_RESERVATION','PASSENGER_CORRECTION') THEN RAISE EXCEPTION 'INVALID_CANCELLATION';END IF;
 p:=jsonb_build_object('op','web_admin_cancel','booking',booking,'trip',expected_trip,'episode',expected_episode,'reason',reason_code);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 inner_key:='web-admin-cancel:'||encode(sha256(convert_to(k,'UTF8')),'hex');
 PERFORM nexo.action_start(inner_key,jsonb_build_object('op','cancel','booking',booking));
 FOR r IN SELECT DISTINCT route_id FROM nexo.bookings WHERE group_id=b.group_id ORDER BY route_id LOOP PERFORM 1 FROM nexo.routes WHERE id=r FOR UPDATE;END LOOP;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF expected_trip IS DISTINCT FROM b.trip_id OR expected_episode IS DISTINCT FROM nexo.assignment_episode(b.id) THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 SELECT EXISTS(SELECT FROM nexo.bookings WHERE group_id=b.group_id AND status IN('HELD','CONFIRMED'))INTO was_live;
 result:=nexo.cancel(inner_key,booking);
 IF was_live AND result->>'status'='CANCELLED' THEN PERFORM nexo.audit(b.association_id,'ADMIN_CANCELLED:'||reason_code,b.group_id);END IF;
 RETURN nexo.action_finish(k,p,result||jsonb_build_object('reason',reason_code,'reasonRecorded',was_live AND result->>'status'='CANCELLED'));
END $$;
REVOKE EXECUTE ON FUNCTION nexo.web_booking_entry(uuid,boolean) FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.web_bookings_page(uuid,text,integer,jsonb,uuid),nexo.web_trip_page(uuid,text,integer,jsonb,uuid),nexo.web_admin_cancel(text,uuid,uuid,integer,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.web_bookings_page(uuid,text,integer,jsonb,uuid),nexo.web_trip_page(uuid,text,integer,jsonb,uuid),nexo.web_admin_cancel(text,uuid,uuid,integer,text,boolean) TO nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.web_admin_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.web_admin_booking(uuid) TO nexo_app;
