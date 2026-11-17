-- Laboratory web extension. Existing inventory and monetary amounts are untouched.
CREATE TABLE nexo.route_condition_estimates (
 route_id uuid NOT NULL, revision integer NOT NULL, additional_minutes integer CHECK(additional_minutes BETWEEN 0 AND 10080),
 actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(route_id,revision), FOREIGN KEY(route_id,revision)REFERENCES nexo.condition_history(route_id,revision)
);
ALTER TABLE nexo.route_condition_estimates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.route_condition_estimates FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
CREATE INDEX passenger_cancel_lookup ON nexo.passenger_decisions(booking_id,id)WHERE decision IN('CANCEL_REQUEST','CANCEL_CONFIRMED');
-- REJECT is a recorded choice, not a cancellation or a release of inventory.
ALTER TABLE nexo.condition_decisions DROP CONSTRAINT condition_decisions_decision_check;
ALTER TABLE nexo.condition_decisions ADD CHECK(decision IN('ACCEPT','REJECT','ADMIN_REVIEW'));
CREATE FUNCTION nexo.guard_condition_choice()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF NEW.decision IN('ACCEPT','REJECT') THEN
  PERFORM 1 FROM nexo.routes WHERE id=(SELECT route_id FROM nexo.bookings WHERE id=NEW.booking_id)FOR UPDATE;
  IF EXISTS(SELECT FROM nexo.condition_decisions WHERE booking_id=NEW.booking_id AND revision=NEW.revision AND decision IN('ACCEPT','REJECT')AND decision<>NEW.decision)THEN RAISE EXCEPTION 'DECISION_CONFLICT';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_choice BEFORE INSERT ON nexo.condition_decisions FOR EACH ROW EXECUTE FUNCTION nexo.guard_condition_choice();
CREATE OR REPLACE FUNCTION nexo.assert_boarding_contract(booking uuid,member uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;c nexo.route_conditions;mc nexo.minor_cases;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;SELECT * INTO c FROM nexo.route_conditions WHERE route_id=b.route_id;
 IF EXISTS(SELECT FROM nexo.condition_decisions d WHERE d.booking_id=b.id AND d.revision=c.revision AND d.decision='REJECT')THEN RAISE EXCEPTION 'CONDITION_REJECTED';END IF;
 IF c.state='SUSPENDIDA' AND EXISTS(SELECT FROM nexo.trips WHERE id=b.trip_id AND status='QUEUED') THEN RAISE EXCEPTION 'ROUTE_CONDITION_BLOCKED';END IF;
 IF c.revision>coalesce((SELECT condition_revision FROM nexo.booking_contracts WHERE booking_id=b.id),0) AND
 (c.state='DESVIO' OR b.from_stop=ANY(c.affected_stops) OR b.to_stop=ANY(c.affected_stops)) AND NOT EXISTS(SELECT FROM nexo.condition_decisions d WHERE d.booking_id=b.id AND d.revision=c.revision AND decision='ACCEPT') THEN RAISE EXCEPTION 'CONDITION_ACCEPTANCE_REQUIRED';END IF;
 FOR mc IN SELECT x.* FROM nexo.minor_cases x JOIN nexo.bookings cb ON cb.id=x.booking_id WHERE cb.group_id=b.group_id LOOP
  IF (SELECT r.result FROM nexo.minor_reviews r WHERE r.member_id=mc.member_id ORDER BY r.id DESC LIMIT 1) IS DISTINCT FROM 'VERIFIED_SIMULATED' THEN RAISE EXCEPTION 'MINOR_REVIEW_REQUIRED';END IF;
  IF mc.companion_id IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.booking_members cm JOIN nexo.bookings cb ON cb.id=cm.booking_id WHERE cm.id=mc.companion_id AND cb.trip_id=b.trip_id AND cb.status IN ('CONFIRMED','COMPLETED')) THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;
  IF mc.member_id=member AND mc.companion_id IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=mc.companion_id AND e.kind='BOARD') THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;
 END LOOP;
END $$;
CREATE FUNCTION nexo.web_declare_condition(k text,p jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE route uuid;cached jsonb;result jsonb;minutes integer;expected integer;
BEGIN
 PERFORM nexo.require_actor();
 IF jsonb_typeof(p)IS DISTINCT FROM'object' OR EXISTS(SELECT FROM jsonb_object_keys(p)x WHERE x<>ALL(ARRAY['routeId','expectedRevision','state','reason','description','affectedStops','fareId','amountBOB','additionalMinutes','confirmed']))THEN RAISE EXCEPTION 'INVALID_REQUEST';END IF;
 route:=(p->>'routeId')::uuid;
 IF NOT coalesce(nexo.manage_route(route),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;PERFORM nexo.check_scope(route);
 IF jsonb_typeof(p->'expectedRevision')IS DISTINCT FROM'number' OR (p->>'expectedRevision')!~'^[0-9]{1,10}$' OR (p->>'expectedRevision')::numeric>2147483647 OR p->'confirmed'IS DISTINCT FROM'true'::jsonb THEN RAISE EXCEPTION 'INVALID_CONFIRMATION';END IF;
 expected:=(p->>'expectedRevision')::integer;
 IF p->>'additionalMinutes'IS NOT NULL THEN
  IF jsonb_typeof(p->'additionalMinutes')IS DISTINCT FROM'number' OR (p->>'additionalMinutes')!~'^[0-9]{1,5}$' OR (p->>'additionalMinutes')::integer>10080 THEN RAISE EXCEPTION 'INVALID_DURATION';END IF;minutes:=(p->>'additionalMinutes')::integer;
 END IF;
 cached:=nexo.action_start(k,jsonb_build_object('op','web_declare_condition','request',p));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=route FOR UPDATE;
 IF NOT nexo.manage_route(route)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF expected<>coalesce((SELECT revision FROM nexo.route_conditions WHERE route_id=route),0)THEN RAISE EXCEPTION 'STALE_CONDITION';END IF;
 IF jsonb_typeof(p->'affectedStops')IS DISTINCT FROM'array'THEN RAISE EXCEPTION 'INVALID_ROUTE_CONDITION';END IF;
 result:=nexo.set_route_condition('web-condition:'||encode(sha256(convert_to(k,'UTF8')),'hex'),route,p->>'state',p->>'reason',p->>'description',ARRAY(SELECT jsonb_array_elements_text(p->'affectedStops')::integer),(p->>'fareId')::uuid,(p->>'amountBOB')::numeric,true);
 INSERT INTO nexo.route_condition_estimates VALUES(route,(result->>'revision')::integer,minutes,nexo.require_actor(),clock_timestamp());
 RETURN nexo.action_finish(k,jsonb_build_object('op','web_declare_condition','request',p),result||jsonb_build_object('additionalMinutes',minutes,'estimateDeclaredByAssociation',true));
END $$;
CREATE FUNCTION nexo.web_condition_context(booking uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;original jsonb;previous_entry jsonb;current_entry jsonb;rev integer;choice text;pending boolean;is_admin boolean;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 is_admin:=coalesce(nexo.manage_route(b.route_id),false);
 IF b.id IS NULL OR NOT(coalesce(nexo.is_responsible(b.id),false)OR is_admin)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF is_admin THEN PERFORM nexo.check_scope(b.route_id);END IF;
 SELECT h.snapshot||jsonb_build_object('additionalMinutes',e.additional_minutes)INTO original FROM nexo.booking_contracts bc JOIN nexo.condition_history h ON h.route_id=b.route_id AND h.revision=bc.condition_revision LEFT JOIN nexo.route_condition_estimates e ON e.route_id=h.route_id AND e.revision=h.revision WHERE bc.booking_id=b.id;
 SELECT c.revision,h.snapshot||jsonb_build_object('additionalMinutes',e.additional_minutes)INTO rev,current_entry FROM nexo.route_conditions c JOIN nexo.condition_history h ON h.route_id=c.route_id AND h.revision=c.revision LEFT JOIN nexo.route_condition_estimates e ON e.route_id=h.route_id AND e.revision=h.revision WHERE c.route_id=b.route_id;
 SELECT h.snapshot||jsonb_build_object('additionalMinutes',e.additional_minutes)INTO previous_entry FROM nexo.condition_history h LEFT JOIN nexo.route_condition_estimates e ON e.route_id=h.route_id AND e.revision=h.revision WHERE h.route_id=b.route_id AND h.revision<rev ORDER BY h.revision DESC LIMIT 1;
 SELECT decision INTO choice FROM nexo.condition_decisions WHERE booking_id=b.id AND revision=rev AND decision IN('ACCEPT','REJECT')ORDER BY id DESC LIMIT 1;
 SELECT EXISTS(SELECT FROM nexo.passenger_decisions d WHERE d.booking_id=b.id AND d.decision='CANCEL_REQUEST' AND NOT EXISTS(SELECT FROM nexo.passenger_decisions r WHERE r.booking_id=b.id AND r.decision='CANCEL_CONFIRMED'AND r.id>d.id))AND b.status IN('HELD','CONFIRMED')INTO pending;
 RETURN jsonb_build_object('bookingId',b.id,'routeId',b.route_id,'original',original,'previous',previous_entry,'current',current_entry,'revision',coalesce(rev,0),'choice',choice,'cancelRequested',pending,'status',b.status,'express',b.express,'seats',b.seats,'originalPriceBOB',b.price_bob::text,'fareVersion',b.fare_version,
 'currentFareBOB',(SELECT amount_bob::text FROM nexo.fares WHERE id=b.fare_id),'currentFareVersion',(SELECT version FROM nexo.fares WHERE id=b.fare_id),'currentFareActive',EXISTS(SELECT FROM nexo.fares WHERE id=b.fare_id AND valid_from<=clock_timestamp()AND(valid_until IS NULL OR valid_until>clock_timestamp())),
 'canDecide',nexo.is_responsible(b.id)AND b.status IN('HELD','CONFIRMED')AND coalesce(rev,0)>coalesce((SELECT condition_revision FROM nexo.booking_contracts WHERE booking_id=b.id),0)AND choice IS NULL,
 'canResolve',is_admin AND pending AND b.status='CONFIRMED'AND NOT EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id)AND(SELECT count(*)FROM nexo.bookings WHERE group_id=b.group_id)=1,
 'points',(SELECT coalesce(jsonb_agg(jsonb_build_object('index',stop_index,'name',name)ORDER BY stop_index),'[]')FROM nexo.stops WHERE route_id=b.route_id),
 'decisions',(SELECT coalesce(jsonb_agg(jsonb_build_object('revision',revision,'decision',decision,'createdAt',created_at)ORDER BY id),'[]')FROM nexo.condition_decisions WHERE booking_id=b.id),
 'requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('decision',decision,'createdAt',created_at)ORDER BY id),'[]')FROM nexo.passenger_decisions WHERE booking_id=b.id),'moneyProcessed',false);
END $$;
CREATE FUNCTION nexo.web_condition_route(trip uuid)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE route uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT route_id INTO route FROM nexo.trips WHERE id=trip;
 IF route IS NULL OR NOT nexo.manage_route(route)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;PERFORM nexo.check_scope(route);
 RETURN jsonb_build_object('routeId',route,'revision',coalesce((SELECT revision FROM nexo.route_conditions WHERE route_id=route),0),
 'points',(SELECT jsonb_agg(jsonb_build_object('index',stop_index,'name',name)ORDER BY stop_index)FROM nexo.stops WHERE route_id=route),
 'fares',(SELECT coalesce(jsonb_agg(jsonb_build_object('fareId',f.id,'fromName',s.name,'toName',d.name,'express',f.express,'amountBOB',f.amount_bob::text,'version',f.version)ORDER BY f.from_stop,f.to_stop,f.express),'[]')FROM nexo.fares f JOIN nexo.stops s ON s.route_id=f.route_id AND s.stop_index=f.from_stop JOIN nexo.stops d ON d.route_id=f.route_id AND d.stop_index=f.to_stop WHERE f.route_id=route AND f.valid_from<=clock_timestamp()AND(f.valid_until IS NULL OR f.valid_until>clock_timestamp())));
END $$;
CREATE FUNCTION nexo.web_condition_command(k text,booking uuid,revision integer,decision text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;cached jsonb;p jsonb;result jsonb;choice text;inner_key text;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF b.id IS NULL OR decision IS NULL OR decision NOT IN('ACCEPT','REJECT','CANCEL_REQUEST','RESOLVE_CANCEL')OR confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_DECISION';END IF;
 IF decision='RESOLVE_CANCEL' THEN
  IF NOT nexo.manage_route(b.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;PERFORM nexo.check_scope(b.route_id);
 ELSIF NOT coalesce(nexo.is_responsible(b.id),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 p:=jsonb_build_object('op','web_condition_choice','booking',booking,'revision',revision,'decision',decision);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF decision='RESOLVE_CANCEL' THEN
  IF NOT nexo.manage_route(b.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 ELSIF NOT coalesce(nexo.is_responsible(b.id),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF revision IS NULL OR revision IS DISTINCT FROM(SELECT c.revision FROM nexo.route_conditions c WHERE c.route_id=b.route_id)THEN RAISE EXCEPTION 'STALE_CONDITION';END IF;
 inner_key:='web-choice:'||encode(sha256(convert_to(k,'UTF8')),'hex');
 SELECT d.decision INTO choice FROM nexo.condition_decisions d WHERE d.booking_id=b.id AND d.revision=web_condition_command.revision AND d.decision IN('ACCEPT','REJECT')ORDER BY d.id DESC LIMIT 1;
 IF decision='RESOLVE_CANCEL' THEN result:=nexo.approve_late_resolution(inner_key,booking,NULL,true,true);
 ELSIF b.status NOT IN('HELD','CONFIRMED')THEN RAISE EXCEPTION 'INVALID_DECISION';
 ELSIF decision='CANCEL_REQUEST'THEN
  IF choice IS DISTINCT FROM'REJECT'THEN RAISE EXCEPTION 'PASSENGER_DECISION_REQUIRED';END IF;
  IF EXISTS(SELECT FROM nexo.passenger_decisions WHERE booking_id=b.id AND passenger_decisions.decision='CANCEL_REQUEST')THEN result:=jsonb_build_object('decision',decision,'automaticCancellation',false,'moneyProcessed',false);
  ELSE result:=nexo.passenger_decision(inner_key,booking,'CANCEL_REQUEST',true);END IF;
 ELSE
  IF choice IS NOT NULL AND choice<>decision THEN RAISE EXCEPTION 'DECISION_CONFLICT';END IF;
  IF revision<=coalesce((SELECT condition_revision FROM nexo.booking_contracts WHERE booking_id=b.id),0)THEN RAISE EXCEPTION 'INVALID_DECISION';END IF;
  IF decision='ACCEPT' THEN IF choice IS NULL THEN result:=nexo.condition_decision(inner_key,booking,revision,'ACCEPT',true);ELSE result:=jsonb_build_object('revision',revision,'decision',decision,'priceUnchanged',true);END IF;
  ELSE
   INSERT INTO nexo.condition_decisions(association_id,booking_id,revision,decision,actor_id)VALUES(b.association_id,b.id,revision,'REJECT',nexo.require_actor())ON CONFLICT DO NOTHING;
   IF choice IS NULL THEN PERFORM nexo.audit(b.association_id,'CONDITION_REJECT',b.id);END IF;result:=jsonb_build_object('decision',decision,'revision',revision,'automaticCancellation',false,'moneyProcessed',false);
  END IF;
 END IF;
 RETURN nexo.action_finish(k,p,result);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.guard_condition_choice(),nexo.assert_boarding_contract(uuid,uuid)FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.web_declare_condition(text,jsonb),nexo.web_condition_context(uuid),nexo.web_condition_route(uuid),nexo.web_condition_command(text,uuid,integer,text,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.web_declare_condition(text,jsonb),nexo.web_condition_context(uuid),nexo.web_condition_route(uuid),nexo.web_condition_command(text,uuid,integer,text,boolean)TO nexo_app;
