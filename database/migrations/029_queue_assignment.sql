-- 8A: direct queue assignments use the existing inventory transaction.
-- Historical rows/receipts are not converted, expired holds are never resurrected.
CREATE TABLE nexo.booking_assignment_rules (
 association_id uuid NOT NULL, booking_id uuid PRIMARY KEY,
 mode text NOT NULL CHECK(mode IN('TURN_ASSIGNED','DRIVER_CONFIRMATION')),
 reason text NOT NULL CHECK(reason IN('TERMINAL','EXPRESS','AUTHORIZED_PICKUP','UNCLASSIFIED')),
 policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version=1),
 actor_id uuid NOT NULL REFERENCES nexo.users, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id)REFERENCES nexo.bookings(association_id,id)
);
ALTER TABLE nexo.booking_assignment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_read ON nexo.booking_assignment_rules FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=booking_id AND b.association_id=booking_assignment_rules.association_id));
GRANT SELECT ON nexo.booking_assignment_rules TO nexo_app;
CREATE TRIGGER immutable_rule BEFORE UPDATE OR DELETE ON nexo.booking_assignment_rules FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
ALTER FUNCTION nexo.reserve(text,jsonb)RENAME TO reserve_028;
REVOKE EXECUTE ON FUNCTION nexo.reserve_028(text,jsonb)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.reserve(k text,p jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE route uuid:=(p->>'routeId')::uuid;cached jsonb;r jsonb;b nexo.bookings;kind text;direct boolean;
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope(route);
 cached:=nexo.action_start(k,jsonb_build_object('op','reserve','request',p));IF cached IS NOT NULL THEN RETURN cached;END IF;
 r:=nexo.reserve_028(k,p);
 -- The core has locked the route, checked queue/capacity and created every part.
 FOR b IN SELECT * FROM nexo.bookings WHERE group_id=(r->>'groupId')::uuid ORDER BY id LOOP
  SELECT m.kind INTO kind FROM nexo.web_point_profiles m WHERE m.route_id=b.route_id AND m.stop_index=b.from_stop;
  direct:=b.express OR coalesce(kind='TERMINAL',false);
  INSERT INTO nexo.booking_assignment_rules(association_id,booking_id,mode,reason,actor_id)VALUES(b.association_id,b.id,CASE WHEN direct THEN'TURN_ASSIGNED'ELSE'DRIVER_CONFIRMATION'END,CASE WHEN b.express THEN'EXPRESS'WHEN kind='TERMINAL'THEN'TERMINAL'WHEN kind IS NULL THEN'UNCLASSIFIED'ELSE'AUTHORIZED_PICKUP'END,nexo.require_actor());
 END LOOP;
 IF NOT EXISTS(SELECT FROM nexo.bookings x JOIN nexo.booking_assignment_rules a ON a.booking_id=x.id WHERE x.group_id=(r->>'groupId')::uuid AND a.mode<>'TURN_ASSIGNED')THEN
  UPDATE nexo.bookings SET status='CONFIRMED' WHERE group_id=(r->>'groupId')::uuid;
  FOR b IN SELECT * FROM nexo.bookings WHERE group_id=(r->>'groupId')::uuid ORDER BY id LOOP PERFORM nexo.audit(b.association_id,'QUEUE_ASSIGNED',b.id);END LOOP;
  r:=r||jsonb_build_object('status','CONFIRMED','confirmationAuthority','TURN_ASSIGNED','driverAcceptanceRequired',false);
  UPDATE nexo.actions SET result=r WHERE actor_id=nexo.require_actor()AND action_key=k;
 END IF;
 RETURN r;
END $$;
-- Even a legacy administration API cannot turn a direct terminal obligation back
-- into a discretionary offer. Consent-based confirmed transfers remain supported.
CREATE FUNCTION nexo.guard_direct_assignment()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF OLD.status='CONFIRMED'AND NEW.status IN('HELD','REJECTED','EXPIRED')AND EXISTS(SELECT FROM nexo.booking_assignment_rules a WHERE a.booking_id=OLD.id AND a.mode='TURN_ASSIGNED')THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_DECLINABLE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_direct_assignment BEFORE UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.guard_direct_assignment();
ALTER FUNCTION nexo.respond_offer(text,uuid,boolean)RENAME TO respond_offer_028;
REVOKE EXECUTE ON FUNCTION nexo.respond_offer_028(text,uuid,boolean)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.respond_offer(k text,booking uuid,accept boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 PERFORM nexo.check_scope(b.route_id);
 IF b.id IS NULL OR NOT nexo.drives(b.trip_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF EXISTS(SELECT FROM nexo.booking_assignment_rules a WHERE a.booking_id=b.id AND a.mode='TURN_ASSIGNED')THEN
  IF accept IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_DECLINABLE';ELSE RAISE EXCEPTION 'NO_DRIVER_DECISION_REQUIRED';END IF;
 END IF;
 RETURN nexo.respond_offer_028(k,booking,accept);
END $$;
ALTER FUNCTION nexo.group_status(uuid)RENAME TO group_status_028;
REVOKE EXECUTE ON FUNCTION nexo.group_status_028(uuid)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.group_status(booking uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r jsonb;rule nexo.booking_assignment_rules;
BEGIN
 PERFORM nexo.check_scope((SELECT route_id FROM nexo.bookings WHERE id=booking));
 r:=nexo.group_status_028(booking);SELECT * INTO rule FROM nexo.booking_assignment_rules WHERE booking_id=booking;
 IF rule.booking_id IS NOT NULL THEN r:=r||jsonb_build_object('assignmentMode',rule.mode,'assignmentReason',rule.reason,'driverAcceptanceRequired',rule.mode='DRIVER_CONFIRMATION');
  IF rule.mode='TURN_ASSIGNED'AND r->>'confirmationAuthority'<>'ADMIN_APPROVED'THEN r:=r||jsonb_build_object('confirmationAuthority','TURN_ASSIGNED');END IF;
 END IF;
 RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION nexo.guard_direct_assignment()FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.reserve(text,jsonb),nexo.respond_offer(text,uuid,boolean),nexo.group_status(uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.reserve(text,jsonb),nexo.respond_offer(text,uuid,boolean),nexo.group_status(uuid)TO nexo_app;

-- Shared readiness: legacy groups retain driver acceptance; direct parts are ready without a fictitious driver response.
CREATE OR REPLACE FUNCTION nexo.respond_offer_internal(k text, booking uuid, accept boolean) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
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
    IF NOT EXISTS(SELECT FROM nexo.bookings WHERE group_id=b.group_id AND ((NOT driver_accepted AND NOT EXISTS(SELECT FROM nexo.booking_assignment_rules ar WHERE ar.booking_id=bookings.id AND ar.mode='TURN_ASSIGNED')) OR status<>'HELD')) THEN
      UPDATE nexo.bookings SET status='CONFIRMED' WHERE group_id=b.group_id;
      state:='CONFIRMED';
    ELSE state:='HELD'; END IF;
  END IF;
  PERFORM nexo.audit(b.association_id,CASE WHEN accept THEN 'OFFER_ACCEPTED' ELSE 'OFFER_REJECTED' END,booking);
  RETURN nexo.action_finish(k,p,jsonb_build_object('status',state));
END $$;
REVOKE EXECUTE ON FUNCTION nexo.respond_offer_internal(text,uuid,boolean)FROM PUBLIC,nexo_app;
-- The same server-side classification also applies to late reservations at an
-- enabled terminal point; real off-terminal pickups still need their conductor.
ALTER FUNCTION nexo.reserve_enroute(text,uuid,jsonb,jsonb)RENAME TO reserve_enroute_028;
REVOKE EXECUTE ON FUNCTION nexo.reserve_enroute_028(text,uuid,jsonb,jsonb)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.reserve_enroute(k text,trip uuid,p jsonb,quote jsonb DEFAULT NULL)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r jsonb;a jsonb;b nexo.bookings;kind text;route uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT route_id INTO route FROM nexo.trips WHERE id=trip;PERFORM nexo.check_scope(route);
 a:=jsonb_build_object('op','reserve_enroute','trip',trip,'request',p,'quote',quote);r:=nexo.action_start(k,a);IF r IS NOT NULL THEN RETURN r;END IF;
 r:=nexo.reserve_enroute_028(k,trip,p,quote);SELECT * INTO b FROM nexo.bookings WHERE id=(r->>'bookingId')::uuid;
 SELECT m.kind INTO kind FROM nexo.web_point_profiles m WHERE m.route_id=b.route_id AND m.stop_index=b.from_stop;
 INSERT INTO nexo.booking_assignment_rules(association_id,booking_id,mode,reason,actor_id)VALUES(b.association_id,b.id,CASE WHEN kind='TERMINAL'THEN'TURN_ASSIGNED'ELSE'DRIVER_CONFIRMATION'END,CASE WHEN kind='TERMINAL'THEN'TERMINAL'WHEN kind IS NULL THEN'UNCLASSIFIED'ELSE'AUTHORIZED_PICKUP'END,nexo.require_actor());
 IF kind='TERMINAL'THEN
  UPDATE nexo.bookings SET status='CONFIRMED' WHERE id=b.id;PERFORM nexo.audit(b.association_id,'QUEUE_ASSIGNED',b.id);
  r:=r||jsonb_build_object('status','CONFIRMED','confirmationAuthority','TURN_ASSIGNED','driverAcceptanceRequired',false);UPDATE nexo.actions SET result=r WHERE actor_id=nexo.require_actor()AND action_key=k;
 END IF;
 RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION nexo.reserve_enroute(text,uuid,jsonb,jsonb)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.reserve_enroute(text,uuid,jsonb,jsonb)TO nexo_app;
