-- Laboratory contracts only. No backfill, legal attestation, money or real contact.
CREATE TABLE nexo.admin_limits (
 association_id uuid NOT NULL REFERENCES nexo.associations, user_id uuid NOT NULL REFERENCES nexo.users,
 PRIMARY KEY(association_id,user_id)
);
CREATE TABLE nexo.admin_route_grants (
 association_id uuid NOT NULL, user_id uuid NOT NULL, route_id uuid NOT NULL,
 PRIMARY KEY(association_id,user_id,route_id),
 FOREIGN KEY(association_id,user_id) REFERENCES nexo.admin_limits,
 FOREIGN KEY(association_id,route_id) REFERENCES nexo.routes(association_id,id)
);
CREATE FUNCTION nexo.scope_allows(route uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT NOT EXISTS(SELECT FROM nexo.admin_limits l WHERE l.user_id=nexo.actor()) OR EXISTS(
 SELECT FROM nexo.admin_route_grants g WHERE g.user_id=nexo.actor() AND g.route_id=route AND nexo.has_role(g.association_id,'ASSOCIATION_ADMIN'))
$$;
CREATE FUNCTION nexo.check_scope(route uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.require_actor();
 IF NOT nexo.scope_allows(route) THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE'; END IF;
END $$;
CREATE FUNCTION nexo.manage_route(route uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.routes r WHERE r.id=route AND nexo.has_role(r.association_id,'ASSOCIATION_ADMIN')) AND nexo.scope_allows(route)
$$;
CREATE TABLE nexo.route_conditions (
 association_id uuid NOT NULL, route_id uuid PRIMARY KEY, revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('NORMAL','DESVIO','SUSPENDIDA')),
 reason text NOT NULL CHECK(reason IN ('NORMAL','BLOCKADE','STRIKE','LANDSLIDE','OTHER_DECLARED')),
 alternate_description text NOT NULL CHECK(length(alternate_description)<=500),
 affected_stops integer[] NOT NULL DEFAULT '{}', actor_id uuid NOT NULL REFERENCES nexo.users,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,route_id) REFERENCES nexo.routes(association_id,id)
);
CREATE TABLE nexo.condition_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, association_id uuid NOT NULL, route_id uuid NOT NULL,
 revision integer NOT NULL, snapshot jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES nexo.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(route_id,revision), FOREIGN KEY(association_id,route_id) REFERENCES nexo.routes(association_id,id)
);
CREATE TABLE nexo.condition_decisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, association_id uuid NOT NULL, booking_id uuid NOT NULL,
 revision integer NOT NULL, decision text NOT NULL CHECK(decision IN ('ACCEPT','ADMIN_REVIEW')),
 actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(booking_id,revision,decision), FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE TABLE nexo.booking_contracts (
 association_id uuid NOT NULL, booking_id uuid PRIMARY KEY, condition_revision integer NOT NULL,
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE TABLE nexo.association_contacts (
 association_id uuid PRIMARY KEY REFERENCES nexo.associations, contact_code text NOT NULL CHECK(contact_code ~ '^LAB-[A-Z0-9_-]{1,40}$'),
 actor_id uuid NOT NULL REFERENCES nexo.users, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.passenger_decisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, association_id uuid NOT NULL, booking_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('REQUEST_ALTERNATIVE','CANCEL_REQUEST','CANCEL_CONFIRMED','REFUND_CONTACT_REQUESTED','LATE_TRANSFER_APPROVED')),
 actor_id uuid NOT NULL REFERENCES nexo.users, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id) REFERENCES nexo.bookings(association_id,id)
);
CREATE TABLE nexo.minor_cases (
 association_id uuid NOT NULL, booking_id uuid NOT NULL, member_id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('PARENT_ACCOMPANIED','AUTHORIZED_COMPANION','UNACCOMPANIED')),
 companion_id uuid REFERENCES nexo.booking_members,
 CHECK((kind='UNACCOMPANIED')=(companion_id IS NULL)), CHECK(member_id IS DISTINCT FROM companion_id),
 FOREIGN KEY(association_id,booking_id,member_id) REFERENCES nexo.booking_members(association_id,booking_id,id)
);
CREATE TABLE nexo.minor_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, association_id uuid NOT NULL, member_id uuid NOT NULL REFERENCES nexo.minor_cases,
 result text NOT NULL CHECK(result IN ('PENDING','VERIFIED_SIMULATED','REJECTED')),
 actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['admin_limits','admin_route_grants','route_conditions','condition_history','association_contacts'] LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_read ON nexo.%I FOR SELECT USING(nexo.has_role(association_id,''ASSOCIATION_ADMIN''))',t);
  EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['condition_decisions','booking_contracts','passenger_decisions','minor_cases'] LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY booking_read ON nexo.%I FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=%I.association_id))',t,t);
  EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['condition_history','condition_decisions','booking_contracts','passenger_decisions','minor_cases','minor_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',t);
 END LOOP;
END $$;
ALTER TABLE nexo.minor_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_read ON nexo.minor_reviews FOR SELECT USING(EXISTS(SELECT FROM nexo.booking_members m WHERE m.id=member_id AND m.association_id=minor_reviews.association_id));
GRANT SELECT ON nexo.minor_reviews TO nexo_app;
GRANT EXECUTE ON FUNCTION nexo.scope_allows(uuid),nexo.manage_route(uuid) TO nexo_app;

ALTER FUNCTION nexo.route_eligible(uuid) RENAME TO route_eligible_017;
CREATE FUNCTION nexo.route_eligible(route uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.route_eligible_017(route) AND NOT EXISTS(SELECT FROM nexo.route_conditions c WHERE c.route_id=route AND c.state='SUSPENDIDA')
$$;
-- Public lookup returns a projection only; suspended routes remain visible, capacity zero.
CREATE FUNCTION nexo.public_availability(origin uuid,destination uuid,requested integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF origin IS NULL OR destination IS NULL OR origin=destination OR requested IS NULL OR requested NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'INVALID_PUBLIC_QUERY'; END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'associationId',entry->>'routeId',(entry->>'position')::bigint NULLS LAST),'[]') INTO result FROM (
 SELECT jsonb_build_object('associationId',r.association_id,'association',a.name,'routeId',r.id,'route',r.name,
 'state',coalesce(c.state,'NORMAL'),'reason',coalesce(c.reason,'NORMAL'),'alternateDescription',coalesce(c.alternate_description,''),
 'affectedStops',coalesce(c.affected_stops,'{}'::integer[]),'updatedAt',c.updated_at,'conditionRevision',coalesce(c.revision,0),
 'contactCode',ct.contact_code,'contactIsSynthetic',true,'from',s.stop_index,'to',d.stop_index,
 'tripId',t.id,'position',t.position_no,'tripState',t.status,'newReservationsAllowed',ok.allowed,
 'confirmedSeats',coalesce(occ.confirmed,0),'availableSeats',CASE WHEN ok.allowed THEN coalesce(occ.free,0) ELSE 0 END,
 'missingToSix',6-coalesce(occ.confirmed,0),'segments',coalesce(occ.segments,'[]'::jsonb),
 'fareBOB',fa.amount_bob::text,'fareVersion',fa.version,'currency','BOB','departureTimePromised',false) AS entry
 FROM nexo.routes r JOIN nexo.associations a ON a.id=r.association_id
 JOIN nexo.stops s ON s.route_id=r.id AND s.locality_id=origin AND s.boarding_allowed
 JOIN nexo.stops d ON d.route_id=r.id AND d.locality_id=destination AND d.alighting_allowed AND d.stop_index>s.stop_index
 LEFT JOIN nexo.route_conditions c ON c.route_id=r.id LEFT JOIN nexo.association_contacts ct ON ct.association_id=a.id
 LEFT JOIN LATERAL(SELECT tr.* FROM nexo.trips tr WHERE tr.route_id=r.id AND tr.status IN ('QUEUED','IN_TRANSIT') AND tr.current_stop<=s.stop_index ORDER BY CASE WHEN tr.status='IN_TRANSIT' THEN 0 ELSE 1 END,tr.position_no,tr.id LIMIT 20)t ON true
 LEFT JOIN LATERAL(SELECT f.* FROM nexo.fares f WHERE f.route_id=r.id AND f.from_stop=s.stop_index AND f.to_stop=d.stop_index AND NOT f.express AND f.valid_from<=clock_timestamp() AND (f.valid_until IS NULL OR f.valid_until>clock_timestamp()) ORDER BY f.version DESC,f.id LIMIT 1)fa ON true
 CROSS JOIN LATERAL(SELECT coalesce(c.state,'NORMAL')<>'SUSPENDIDA' AND t.id IS NOT NULL AND fa.id IS NOT NULL
 AND NOT(s.stop_index=ANY(coalesce(c.affected_stops,'{}'::integer[])) OR d.stop_index=ANY(coalesce(c.affected_stops,'{}'::integer[])))
 AND EXISTS(SELECT FROM nexo.memberships m WHERE m.user_id=t.driver_id AND m.association_id=a.id AND m.role='DRIVER' AND m.active)
 AND nexo.capacity_accepts_operations(t.id,requested) AS allowed)ok
 LEFT JOIN LATERAL(SELECT min(6-x.used)::integer AS free,max(x.confirmed)::integer AS confirmed,jsonb_agg(jsonb_build_object('segment',x.segment,'reserved',x.used,'confirmed',x.confirmed,'available',CASE WHEN ok.allowed THEN 6-x.used ELSE 0 END) ORDER BY x.segment) AS segments
 FROM (SELECT seg AS segment,coalesce(sum(b.seats) FILTER(WHERE nexo.live(b)),0)::integer AS used,coalesce(sum(b.seats) FILTER(WHERE b.status='CONFIRMED'),0)::integer AS confirmed
 FROM generate_series(s.stop_index,d.stop_index-1)seg LEFT JOIN nexo.bookings b ON b.trip_id=t.id AND b.from_stop<=seg AND b.to_stop>seg GROUP BY seg)x)occ ON true
 WHERE nexo.route_eligible_017(r.id) LIMIT 200
 )q;
 RETURN jsonb_build_object('services',result,'asOf',clock_timestamp(),'snapshotOnly',true,'personalDataIncluded',false,'delivery','DISABLED');
END $$;
GRANT EXECUTE ON FUNCTION nexo.public_availability(uuid,uuid,integer) TO nexo_app;

CREATE FUNCTION nexo.set_route_condition(k text,route uuid,state text,reason text,description text,affected integer[],fare uuid,amount numeric,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r nexo.routes;p jsonb;cached jsonb;rev integer;entry jsonb;
BEGIN
 PERFORM nexo.require_actor();IF NOT nexo.manage_route(route) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR state IS NULL OR state NOT IN ('NORMAL','DESVIO','SUSPENDIDA') OR reason IS NULL OR reason NOT IN ('NORMAL','BLOCKADE','STRIKE','LANDSLIDE','OTHER_DECLARED') OR description IS NULL OR length(description)>500 OR affected IS NULL OR cardinality(affected)>100
 OR (state='DESVIO' AND length(trim(description))=0) OR (state='NORMAL' AND (reason<>'NORMAL' OR cardinality(affected)<>0)) OR (fare IS NULL)<>(amount IS NULL) OR amount<0 OR amount>9999999999.99 OR amount<>round(amount,2) THEN RAISE EXCEPTION 'INVALID_ROUTE_CONDITION';END IF;
 p:=jsonb_build_object('op','route_condition','route',route,'state',state,'reason',reason,'description',description,'affected',affected,'fare',fare,'amount',amount);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT * INTO r FROM nexo.routes WHERE id=route FOR UPDATE;
 IF NOT nexo.manage_route(route) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF EXISTS(SELECT FROM unnest(affected)x WHERE x IS NULL OR NOT EXISTS(SELECT FROM nexo.stops s WHERE s.route_id=r.id AND s.stop_index=x)) THEN RAISE EXCEPTION 'INVALID_STOP';END IF;
 IF fare IS NOT NULL THEN
  UPDATE nexo.fares SET amount_bob=amount,version=version+1 WHERE id=fare AND route_id=r.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_FARE';END IF;
 END IF;
 SELECT coalesce(max(revision),0)+1 INTO rev FROM nexo.condition_history WHERE route_id=r.id;
 INSERT INTO nexo.route_conditions VALUES(r.association_id,r.id,rev,state,reason,description,affected,nexo.require_actor(),clock_timestamp())
 ON CONFLICT(route_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,alternate_description=excluded.alternate_description,affected_stops=excluded.affected_stops,actor_id=excluded.actor_id,updated_at=excluded.updated_at;
 entry:=jsonb_build_object('routeId',r.id,'revision',rev,'state',state,'reason',reason,'description',description,'affectedStops',affected,'newFareId',fare,'newFareBOB',amount,'simulated',true,'transitabilityVerified',false);
 INSERT INTO nexo.condition_history(association_id,route_id,revision,snapshot,actor_id)VALUES(r.association_id,r.id,rev,entry,nexo.require_actor());
 PERFORM nexo.audit(r.association_id,'ROUTE_CONDITION',r.id);RETURN nexo.action_finish(k,p,entry);
END $$;
CREATE FUNCTION nexo.condition_decision(k text,booking uuid,revision integer,decision text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
<<input>>
DECLARE b nexo.bookings;p jsonb;cached jsonb;requested_revision integer:=revision;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(nexo.is_responsible(b.id),false) OR nexo.manage_route(b.route_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR decision IS NULL OR decision NOT IN ('ACCEPT','ADMIN_REVIEW') THEN RAISE EXCEPTION 'INVALID_DECISION';END IF;
 IF (decision='ACCEPT' AND NOT coalesce(nexo.is_responsible(b.id),false)) OR (decision='ADMIN_REVIEW' AND NOT nexo.manage_route(b.route_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 p:=jsonb_build_object('op','condition_decision','booking',booking,'revision',revision,'decision',decision);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF revision IS NULL OR NOT EXISTS(SELECT FROM nexo.route_conditions c WHERE c.route_id=b.route_id AND c.revision=requested_revision) THEN RAISE EXCEPTION 'STALE_CONDITION';END IF;
 IF decision='ACCEPT' AND NOT coalesce(nexo.is_responsible(b.id),false) OR decision='ADMIN_REVIEW' AND NOT nexo.manage_route(b.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO nexo.condition_decisions(association_id,booking_id,revision,decision,actor_id) VALUES(b.association_id,b.id,revision,decision,nexo.require_actor()) ON CONFLICT DO NOTHING;
 PERFORM nexo.audit(b.association_id,'CONDITION_'||decision,b.id);RETURN nexo.action_finish(k,p,jsonb_build_object('revision',revision,'decision',decision,'priceUnchanged',true));
END $$;
CREATE FUNCTION nexo.guard_contract_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE c nexo.route_conditions;
BEGIN
 SELECT * INTO c FROM nexo.route_conditions WHERE route_id=NEW.route_id;
 IF NEW.status IN ('HELD','CONFIRMED') AND (TG_OP='INSERT' OR (NEW.status='CONFIRMED' AND OLD.status='HELD') OR NEW.trip_id IS DISTINCT FROM OLD.trip_id) THEN
  IF c.state='SUSPENDIDA' OR NEW.from_stop=ANY(c.affected_stops) OR NEW.to_stop=ANY(c.affected_stops) THEN RAISE EXCEPTION 'ROUTE_CONDITION_BLOCKED';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_contract_insert BEFORE INSERT OR UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.guard_contract_insert();
CREATE FUNCTION nexo.capture_booking_contract() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 INSERT INTO nexo.booking_contracts VALUES(NEW.association_id,NEW.id,coalesce((SELECT revision FROM nexo.route_conditions WHERE route_id=NEW.route_id),0));RETURN NEW;
END $$;
CREATE TRIGGER capture_booking_contract AFTER INSERT ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.capture_booking_contract();

CREATE FUNCTION nexo.review_minor(k text,member uuid,kind text,companion uuid,result text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
<<input>>
DECLARE m nexo.booking_members;b nexo.bookings;p jsonb;cached jsonb;requested_kind text:=kind;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO m FROM nexo.booking_members WHERE id=member;SELECT * INTO b FROM nexo.bookings WHERE id=m.booking_id;
 IF b.id IS NULL OR NOT nexo.manage_route(b.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR kind IS NULL OR kind NOT IN ('PARENT_ACCOMPANIED','AUTHORIZED_COMPANION','UNACCOMPANIED') OR result IS NULL OR result NOT IN ('PENDING','VERIFIED_SIMULATED','REJECTED') OR (kind='UNACCOMPANIED')<>(companion IS NULL) THEN RAISE EXCEPTION 'INVALID_MINOR_REVIEW';END IF;
 p:=jsonb_build_object('op','minor_review','member',member,'kind',kind,'companion',companion,'result',result);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT nexo.manage_route(b.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF EXISTS(SELECT FROM nexo.effective_movements e WHERE e.booking_id=b.id AND e.kind='BOARD') THEN RAISE EXCEPTION 'INVALID_REVIEW_STATE';END IF;
 IF EXISTS(SELECT FROM nexo.minor_cases c WHERE c.member_id=companion OR c.companion_id=member) OR companion=member OR (companion IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.booking_members c JOIN nexo.bookings cb ON cb.id=c.booking_id WHERE c.id=companion AND cb.group_id=b.group_id AND cb.trip_id=b.trip_id)) OR EXISTS(SELECT FROM nexo.bookings x WHERE x.group_id=b.group_id AND x.trip_id<>b.trip_id) THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;
 INSERT INTO nexo.minor_cases VALUES(b.association_id,b.id,member,kind,companion) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT FROM nexo.minor_cases c WHERE c.member_id=member AND c.kind=requested_kind AND c.companion_id IS NOT DISTINCT FROM companion) THEN RAISE EXCEPTION 'INVALID_REVIEW_STATE';END IF;
 INSERT INTO nexo.minor_reviews(association_id,member_id,result,actor_id)VALUES(b.association_id,member,result,nexo.require_actor());
 PERFORM nexo.audit(b.association_id,'MINOR_'||result,b.id);RETURN nexo.action_finish(k,p,jsonb_build_object('memberId',member,'result',result,'legalVerification',false,'simulated',true));
END $$;
CREATE FUNCTION nexo.assert_boarding_contract(booking uuid,member uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;c nexo.route_conditions;mc nexo.minor_cases;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;SELECT * INTO c FROM nexo.route_conditions WHERE route_id=b.route_id;
 IF c.state='SUSPENDIDA' AND EXISTS(SELECT FROM nexo.trips WHERE id=b.trip_id AND status='QUEUED') THEN RAISE EXCEPTION 'ROUTE_CONDITION_BLOCKED';END IF;
 IF c.revision>coalesce((SELECT condition_revision FROM nexo.booking_contracts WHERE booking_id=b.id),0) AND
 (c.state='DESVIO' OR b.from_stop=ANY(c.affected_stops) OR b.to_stop=ANY(c.affected_stops)) AND NOT EXISTS(SELECT FROM nexo.condition_decisions d WHERE d.booking_id=b.id AND d.revision=c.revision AND decision='ACCEPT') THEN RAISE EXCEPTION 'CONDITION_ACCEPTANCE_REQUIRED';END IF;
 FOR mc IN SELECT x.* FROM nexo.minor_cases x JOIN nexo.bookings cb ON cb.id=x.booking_id WHERE cb.group_id=b.group_id LOOP
  IF (SELECT r.result FROM nexo.minor_reviews r WHERE r.member_id=mc.member_id ORDER BY r.id DESC LIMIT 1) IS DISTINCT FROM 'VERIFIED_SIMULATED' THEN RAISE EXCEPTION 'MINOR_REVIEW_REQUIRED';END IF;
  IF mc.companion_id IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.booking_members cm JOIN nexo.bookings cb ON cb.id=cm.booking_id WHERE cm.id=mc.companion_id AND cb.trip_id=b.trip_id AND cb.status IN ('CONFIRMED','COMPLETED')) THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;
  IF mc.member_id=member AND mc.companion_id IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.effective_movements e WHERE e.member_id=mc.companion_id AND e.kind='BOARD') THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;
 END LOOP;
END $$;
-- Reuse observation implementation; gates also cover legacy/group entrypoints.
ALTER FUNCTION nexo.record_observation(text,uuid,uuid,text,boolean) RENAME TO record_observation_017;
CREATE FUNCTION nexo.record_observation(k text,booking uuid,member uuid,movement text,terminal_mode boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(nexo.drives(b.trip_id) OR terminal_mode AND nexo.manage_route(b.route_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 p:=CASE WHEN member IS NULL THEN jsonb_build_object('op','record_movement','booking',booking,'kind',movement) ELSE jsonb_build_object('op','member_movement','member',member,'kind',movement) END;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF movement='BOARD' THEN PERFORM nexo.assert_boarding_contract(booking,member);END IF;
 RETURN nexo.record_observation_017(k,booking,member,movement,terminal_mode);
END $$;
GRANT EXECUTE ON FUNCTION nexo.set_route_condition(text,uuid,text,text,text,integer[],uuid,numeric,boolean),nexo.condition_decision(text,uuid,integer,text,boolean),nexo.review_minor(text,uuid,text,uuid,text,boolean) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
