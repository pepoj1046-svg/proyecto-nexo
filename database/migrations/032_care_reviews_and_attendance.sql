-- Observations and reviews never release inventory or authorize legal travel.
CREATE TABLE nexo.care_absences(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL,booking_id uuid NOT NULL,member_id uuid NOT NULL,episode integer NOT NULL,
 reason text NOT NULL CHECK(reason IN('NOT_PRESENT_AT_BOARDING','PICKUP_NOT_PRESENT')),trip_id uuid NOT NULL,observed_stop integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(member_id,episode),
 FOREIGN KEY(association_id,booking_id,member_id)REFERENCES nexo.booking_members(association_id,booking_id,id),FOREIGN KEY(association_id,booking_id,episode)REFERENCES nexo.assignment_episodes(association_id,booking_id,episode),FOREIGN KEY(association_id,trip_id)REFERENCES nexo.trips(association_id,id)
);
CREATE TABLE nexo.care_discrepancy_reviews(
 report_id uuid NOT NULL REFERENCES nexo.passenger_discrepancies,version integer NOT NULL CHECK(version>0),association_id uuid NOT NULL,booking_id uuid NOT NULL,
 result text NOT NULL CHECK(result IN('DOCUMENTED','PENDING_POLICY','NO_CHANGE','NATIVE_CORRECTION')),
 reason text NOT NULL CHECK(reason IN('EVIDENCE_REVIEWED','POLICY_REQUIRED','PHYSICAL_FACT_NOT_CONFIRMED','OPERATOR_ERROR','WRONG_RESERVATION','WRONG_MEMBER')),
 corrected_fact text,actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(report_id,version),FOREIGN KEY(association_id,booking_id)REFERENCES nexo.bookings(association_id,id),CHECK((result='NATIVE_CORRECTION')=(corrected_fact IS NOT NULL))
);
CREATE INDEX care_absence_booking ON nexo.care_absences(booking_id,episode);
CREATE INDEX care_review_booking ON nexo.care_discrepancy_reviews(booking_id,report_id,version DESC);
DO $$DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['care_absences','care_discrepancy_reviews']LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON nexo.%I FROM PUBLIC,nexo_app',tab);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',tab);
 END LOOP;
END $$;
ALTER TABLE nexo.passenger_discrepancies DROP CONSTRAINT passenger_discrepancies_kind_check;
ALTER TABLE nexo.passenger_discrepancies ADD CONSTRAINT passenger_discrepancies_kind_check CHECK(kind IN('NOT_BOARDED','ALIGHT_INCORRECT','WRONG_REPLACEMENT','OTHER_OPERATIONAL','SAFE_TRANSFER_INCORRECT'));
-- A movement used as evidence of a physical handoff cannot be voided by a legacy
-- movement primitive. There is no approved contract for reversing safe custody.
CREATE FUNCTION nexo.guard_care_custody_correction()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF NEW.kind='VOID'AND EXISTS(SELECT FROM nexo.terminal_handoff_members h WHERE h.original_fact_key=NEW.target_key)THEN RAISE EXCEPTION 'CUSTODY_REVIEW_REQUIRED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_care_custody_correction BEFORE INSERT ON nexo.movement_corrections FOR EACH ROW EXECUTE FUNCTION nexo.guard_care_custody_correction();
CREATE FUNCTION nexo.care_absence(k text,booking uuid,expected integer,member uuid,reason_code text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;t nexo.trips;p jsonb;cached jsonb;amount integer;
BEGIN
 b:=nexo.care_access(booking,'STAFF');
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected NOT BETWEEN 0 AND 8 OR reason_code IS NULL OR reason_code NOT IN('NOT_PRESENT_AT_BOARDING','PICKUP_NOT_PRESENT')THEN RAISE EXCEPTION 'INVALID_ABSENCE';END IF;
 p:=jsonb_build_object('op','care_absence','booking',booking,'episode',expected,'member',member,'reason',reason_code);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(booking,'STAFF');SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 IF expected<>nexo.assignment_episode(b.id)THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 IF b.express THEN RAISE EXCEPTION 'ADMIN_REVIEW_REQUIRED';END IF;
 IF b.status NOT IN('CONFIRMED','COMPLETED')OR t.status NOT IN('QUEUED','IN_TRANSIT','COMPLETED')OR t.current_stop<b.from_stop OR NOT EXISTS(SELECT FROM nexo.stops s WHERE s.route_id=b.route_id AND s.stop_index=b.from_stop AND s.boarding_allowed)THEN RAISE EXCEPTION 'INVALID_ABSENCE_STATE';END IF;
 IF member IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.booking_members m WHERE m.booking_id=b.id AND m.id=member)THEN RAISE EXCEPTION 'INVALID_MEMBER';END IF;
 IF member IS NOT NULL AND EXISTS(SELECT FROM nexo.movement_facts f WHERE f.booking_id=b.id AND f.kind='BOARD'AND(f.member_id=member OR f.member_id IS NULL))THEN RAISE EXCEPTION 'BOARDING_HISTORY_REVIEW_REQUIRED';END IF;
 INSERT INTO nexo.care_absences(association_id,booking_id,member_id,episode,reason,trip_id,observed_stop,actor_id)
 SELECT b.association_id,b.id,m.id,expected,reason_code,t.id,t.current_stop,nexo.require_actor()FROM nexo.booking_members m WHERE m.booking_id=b.id AND(member IS NULL OR m.id=member)
 AND NOT EXISTS(SELECT FROM nexo.movement_facts f WHERE f.booking_id=b.id AND f.kind='BOARD'AND(f.member_id=m.id OR f.member_id IS NULL))
 AND NOT EXISTS(SELECT FROM nexo.care_absences a WHERE a.member_id=m.id AND a.episode=expected);
 GET DIAGNOSTICS amount=ROW_COUNT;IF amount=0 THEN RAISE EXCEPTION 'NO_ABSENCE_CANDIDATES';END IF;
 PERFORM nexo.audit(b.association_id,'CARE_ABSENCE_OBSERVED',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('recorded',amount,'inventoryChanged',false,'automaticCancellation',false,'reviewRequired',true,'moneyProcessed',false));
END $$;
CREATE FUNCTION nexo.care_minor(k text,booking uuid,expected integer,member uuid,kind text,companion uuid,result text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;r nexo.minor_cases;p jsonb;cached jsonb;receipt jsonb;
BEGIN
 b:=nexo.care_access(booking,'MANAGE');
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected NOT BETWEEN 0 AND 8 OR kind IS NULL OR kind NOT IN('PARENT_ACCOMPANIED','AUTHORIZED_COMPANION','UNACCOMPANIED')OR result IS NULL OR result NOT IN('PENDING','VERIFIED_SIMULATED','REJECTED')OR(kind='UNACCOMPANIED')IS DISTINCT FROM(companion IS NULL)THEN RAISE EXCEPTION 'INVALID_MINOR_REVIEW';END IF;
 IF kind='UNACCOMPANIED'AND result='VERIFIED_SIMULATED'THEN RAISE EXCEPTION 'LEGAL_POLICY_REVIEW_REQUIRED';END IF;
 p:=jsonb_build_object('op','care_minor','booking',booking,'episode',expected,'member',member,'kind',kind,'companion',companion,'result',result);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(booking,'MANAGE');IF expected<>nexo.assignment_episode(b.id)THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 IF NOT EXISTS(SELECT FROM nexo.booking_members m WHERE m.id=member AND m.booking_id=b.id)THEN RAISE EXCEPTION 'INVALID_MEMBER';END IF;
 SELECT * INTO r FROM nexo.minor_cases m WHERE m.member_id=member;
 IF r.member_id IS NOT NULL AND(r.kind<>kind OR r.companion_id IS DISTINCT FROM companion)THEN RAISE EXCEPTION 'MINOR_LINK_REVIEW_REQUIRED';END IF;
 receipt:=nexo.review_minor('care-minor:'||encode(sha256(convert_to(k,'UTF8')),'hex'),member,kind,companion,result,true);
 RETURN nexo.action_finish(k,p,receipt);
END $$;
CREATE FUNCTION nexo.care_review(k text,report uuid,expected integer,result text,reason_code text,fact text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE d nexo.passenger_discrepancies;b nexo.bookings;t nexo.trips;p jsonb;cached jsonb;version integer;native_reason text;
BEGIN
 SELECT * INTO d FROM nexo.passenger_discrepancies WHERE id=report;b:=nexo.care_access(d.booking_id,'MANAGE');
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected<0 OR result IS NULL OR result NOT IN('DOCUMENTED','PENDING_POLICY','NO_CHANGE','NATIVE_CORRECTION')OR reason_code IS NULL OR reason_code NOT IN('EVIDENCE_REVIEWED','POLICY_REQUIRED','PHYSICAL_FACT_NOT_CONFIRMED','OPERATOR_ERROR','WRONG_RESERVATION','WRONG_MEMBER')OR(result='NATIVE_CORRECTION')IS DISTINCT FROM(fact IS NOT NULL)THEN RAISE EXCEPTION 'INVALID_DISCREPANCY_REVIEW';END IF;
 p:=jsonb_build_object('op','care_review','report',report,'expected',expected,'result',result,'reason',reason_code,'fact',fact);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(d.booking_id,'MANAGE');SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id FOR UPDATE;
 SELECT coalesce(max(r.version),0)INTO version FROM nexo.care_discrepancy_reviews r WHERE r.report_id=d.id;IF expected<>version THEN RAISE EXCEPTION 'STALE_REVIEW';END IF;
 IF result='NATIVE_CORRECTION'THEN
  IF t.status='COMPLETED'OR d.episode<>nexo.assignment_episode(b.id)OR d.kind NOT IN('NOT_BOARDED','ALIGHT_INCORRECT')OR NOT nexo.movement_correction_allowed(t.id)OR EXISTS(SELECT FROM nexo.terminal_handoff_members h WHERE h.booking_id=b.id)THEN RAISE EXCEPTION 'PHYSICAL_REVIEW_REQUIRED';END IF;
  IF reason_code NOT IN('OPERATOR_ERROR','WRONG_RESERVATION','WRONG_MEMBER')OR NOT EXISTS(SELECT FROM nexo.movement_facts f WHERE f.fact_key=fact AND f.booking_id=b.id AND f.stop_index=t.current_stop AND f.kind=CASE d.kind WHEN'NOT_BOARDED'THEN'BOARD'ELSE'ALIGHT'END AND EXISTS(SELECT FROM jsonb_array_elements(d.evidence->'movements')m WHERE m->>'fact_key'=f.fact_key))OR EXISTS(SELECT FROM nexo.movement_corrections c WHERE c.target_key=fact)THEN RAISE EXCEPTION 'INVALID_CORRECTION_TARGET';END IF;
  PERFORM nexo.correct_movement('care-correct:'||encode(sha256(convert_to(k,'UTF8')),'hex'),b.id,fact,reason_code,true);
 END IF;
 INSERT INTO nexo.care_discrepancy_reviews(report_id,version,association_id,booking_id,result,reason,corrected_fact,actor_id)VALUES(d.id,version+1,b.association_id,b.id,result,reason_code,fact,nexo.require_actor());
 PERFORM nexo.audit(b.association_id,'CARE_DISCREPANCY_'||result,b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('reportId',d.id,'version',version+1,'result',result,'review',CASE result WHEN'PENDING_POLICY'THEN'PENDING_HUMAN_REVIEW'WHEN'NATIVE_CORRECTION'THEN'RECTIFIED_NATIVE'ELSE'REVIEWED_NO_AUTOMATIC_CHANGE'END,'moneyProcessed',false));
END $$;
CREATE FUNCTION nexo.care_review_context(report uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE d nexo.passenger_discrepancies;b nexo.bookings;history jsonb;version integer;
BEGIN
 SELECT * INTO d FROM nexo.passenger_discrepancies WHERE id=report;b:=nexo.care_access(d.booking_id,'MANAGE');
 SELECT coalesce(jsonb_agg(jsonb_build_object('version',r.version,'result',r.result,'reason',r.reason,'correctedFact',r.corrected_fact,'actorRef',r.actor_id,'createdAt',r.created_at)ORDER BY r.version),'[]'),coalesce(max(r.version),0)INTO history,version FROM nexo.care_discrepancy_reviews r WHERE r.report_id=d.id;
 RETURN jsonb_build_object('reportId',d.id,'bookingId',b.id,'kind',d.kind,'episode',d.episode,'currentEpisode',nexo.assignment_episode(b.id),'evidence',d.evidence,'reviews',history,'version',version,'canCorrect',d.kind IN('NOT_BOARDED','ALIGHT_INCORRECT')AND d.episode=nexo.assignment_episode(b.id)AND(SELECT status<>'COMPLETED'FROM nexo.trips WHERE id=b.trip_id)AND nexo.movement_correction_allowed(b.trip_id)AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_members h WHERE h.booking_id=b.id));
END $$;
REVOKE EXECUTE ON FUNCTION nexo.guard_care_custody_correction()FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.care_absence(text,uuid,integer,uuid,text,boolean),nexo.care_minor(text,uuid,integer,uuid,text,uuid,text,boolean),nexo.care_review(text,uuid,integer,text,text,text,boolean),nexo.care_review_context(uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.care_absence(text,uuid,integer,uuid,text,boolean),nexo.care_minor(text,uuid,integer,uuid,text,uuid,text,boolean),nexo.care_review(text,uuid,integer,text,text,text,boolean),nexo.care_review_context(uuid)TO nexo_app;

CREATE OR REPLACE FUNCTION nexo.report_passenger_discrepancy(k text,booking uuid,expected integer,kind text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;report uuid;evidence jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF b.id IS NULL OR NOT coalesce(nexo.is_responsible(b.id),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.check_scope(b.route_id);
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected NOT BETWEEN 0 AND 8 OR kind IS NULL OR kind NOT IN('NOT_BOARDED','ALIGHT_INCORRECT','WRONG_REPLACEMENT','OTHER_OPERATIONAL','SAFE_TRANSFER_INCORRECT')THEN RAISE EXCEPTION 'INVALID_DISCREPANCY';END IF;
 p:=jsonb_build_object('op','passenger_discrepancy','booking',booking,'episode',expected,'kind',kind);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 PERFORM nexo.require_actor();IF NOT coalesce(nexo.is_responsible(b.id),false)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF expected<>nexo.assignment_episode(b.id)THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 evidence:=jsonb_build_object('status',b.status,'tripId',b.trip_id,'episode',expected,'priceBOB',b.price_bob::text,'seats',b.seats,'vehicleId',(SELECT vehicle_id FROM nexo.trips WHERE id=b.trip_id),'movements',(SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY m.fact_key),'[]')FROM nexo.movement_facts m WHERE m.booking_id=b.id),'voided',(SELECT coalesce(jsonb_agg(target_key),'[]')FROM nexo.movement_corrections mc WHERE mc.booking_id=b.id AND mc.kind='VOID'),'handoffs',(SELECT coalesce(jsonb_agg(jsonb_build_object('handoffId',h.id,'sourceTripId',h.source_trip,'targetTripId',h.target_trip,'complete',EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id))),'[]')FROM nexo.terminal_handoffs h WHERE EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND m.booking_id=b.id)));
 INSERT INTO nexo.passenger_discrepancies(association_id,booking_id,trip_id,episode,kind,reporter_id,evidence)VALUES(b.association_id,b.id,b.trip_id,expected,kind,nexo.require_actor(),evidence)RETURNING id INTO report;
 PERFORM nexo.audit(b.association_id,'PASSENGER_DISCREPANCY',report);
 RETURN nexo.action_finish(k,p,jsonb_build_object('reportId',report,'review','PENDING_HUMAN_REVIEW','inventoryChanged',false,'moneyProcessed',false));
END $$;

CREATE OR REPLACE FUNCTION nexo.discrepancy_context(booking uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;reports jsonb;handoffs jsonb;
BEGIN
 b:=nexo.care_access(booking,'VIEW');IF NOT(coalesce(nexo.is_responsible(b.id),false)OR nexo.manage_route(b.route_id))THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY x."createdAt" DESC,x."reportId"),'[]')INTO reports FROM(
 SELECT d.id AS "reportId",d.episode,d.kind,d.created_at AS "createdAt",coalesce(last_review.version,0)AS version,last_review.result,
 CASE WHEN last_review.result IS NULL OR last_review.result='PENDING_POLICY'THEN'PENDING_HUMAN_REVIEW'WHEN last_review.result='NATIVE_CORRECTION'THEN'RECTIFIED_NATIVE'ELSE'REVIEWED_NO_AUTOMATIC_CHANGE'END AS review,
 coalesce((SELECT jsonb_agg(jsonb_build_object('version',r.version,'result',r.result,'reason',r.reason,'correctedFact',r.corrected_fact,'createdAt',r.created_at)ORDER BY r.version)FROM nexo.care_discrepancy_reviews r WHERE r.report_id=d.id),'[]')AS reviews
 FROM nexo.passenger_discrepancies d LEFT JOIN LATERAL(SELECT r.version,r.result FROM nexo.care_discrepancy_reviews r WHERE r.report_id=d.id ORDER BY r.version DESC LIMIT 1)last_review ON true
 WHERE d.booking_id=b.id ORDER BY d.created_at DESC,d.id LIMIT 50)x;
 SELECT coalesce(jsonb_agg(nexo.handoff_context(h.incident_id)ORDER BY h.created_at,h.id),'[]')INTO handoffs FROM nexo.terminal_handoffs h WHERE EXISTS(SELECT FROM nexo.terminal_handoff_members m WHERE m.handoff_id=h.id AND m.booking_id=b.id);
 RETURN jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'episode',nexo.assignment_episode(b.id),'reports',reports,'reportsTotal',(SELECT count(*)FROM nexo.passenger_discrepancies WHERE booking_id=b.id),'reportsLimit',50,'handoffs',handoffs,'canReport',nexo.is_responsible(b.id),'automaticCorrection',false);
END $$;
CREATE FUNCTION nexo.care_context(booking uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;t nexo.trips;r nexo.care_responsibilities;members jsonb;history jsonb;facts jsonb;manager boolean;staff boolean;owner boolean;options jsonb;
BEGIN
 b:=nexo.care_access(booking,'VIEW');SELECT * INTO t FROM nexo.trips WHERE id=b.trip_id;manager:=nexo.manage_route(b.route_id);staff:=manager OR nexo.drives(b.trip_id);owner:=coalesce(nexo.is_responsible(b.id),false);
 SELECT * INTO r FROM nexo.care_responsibilities WHERE group_id=b.group_id ORDER BY revision DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('revision',x.revision,'kind',x.kind,'reason',x.reason,'actorRef',x.actor_id,'createdAt',x.created_at,'accountLinked',x.account_id IS NOT NULL,'offlineRef',x.party_id)ORDER BY x.revision),'[]')INTO history FROM nexo.care_responsibilities x WHERE x.group_id=b.group_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('memberId',m.id,'ordinal',m.ordinal,'hasBoardingHistory',EXISTS(SELECT FROM nexo.movement_facts f WHERE f.booking_id=b.id AND f.kind='BOARD'AND(f.member_id=m.id OR f.member_id IS NULL)),
 'boarded',EXISTS(SELECT FROM nexo.effective_movements f WHERE f.booking_id=b.id AND f.kind='BOARD'AND(f.member_id=m.id OR f.member_id IS NULL)),
 'alighted',EXISTS(SELECT FROM nexo.effective_movements f WHERE f.booking_id=b.id AND f.kind='ALIGHT'AND(f.member_id=m.id OR f.member_id IS NULL)),
 'absences',coalesce((SELECT jsonb_agg(jsonb_build_object('episode',a.episode,'reason',a.reason,'tripId',a.trip_id,'observedStop',a.observed_stop,'actorRef',a.actor_id,'createdAt',a.created_at)ORDER BY a.created_at,a.id)FROM nexo.care_absences a WHERE a.member_id=m.id),'[]'),
 'minor',CASE WHEN mc.member_id IS NULL THEN NULL ELSE jsonb_build_object('kind',mc.kind,'companionId',mc.companion_id,'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('result',mr.result,'actorRef',mr.actor_id,'createdAt',mr.created_at)ORDER BY mr.id)FROM nexo.minor_reviews mr WHERE mr.member_id=m.id),'[]'),'result',(SELECT mr.result FROM nexo.minor_reviews mr WHERE mr.member_id=m.id ORDER BY mr.id DESC LIMIT 1))END)ORDER BY m.ordinal),'[]')INTO members FROM nexo.booking_members m LEFT JOIN nexo.minor_cases mc ON mc.member_id=m.id WHERE m.booking_id=b.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('factKey',f.fact_key,'kind',f.kind,'memberId',f.member_id,'stop',f.stop_index,'voided',EXISTS(SELECT FROM nexo.movement_corrections c WHERE c.target_key=f.fact_key),'createdAt',f.created_at)ORDER BY f.created_at,f.fact_key),'[]')INTO facts FROM nexo.movement_facts f WHERE f.booking_id=b.id;
 IF manager OR owner THEN options:=nexo.resolution_options(b.id);END IF;
 RETURN jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'episode',nexo.assignment_episode(b.id),'source',b.source,'status',b.status,'vehicle',(SELECT label FROM nexo.vehicles WHERE id=t.vehicle_id),'tripStatus',t.status,'currentStop',t.current_stop,'boardingStop',b.from_stop,'currentPointName',(SELECT name FROM nexo.stops WHERE route_id=t.route_id AND stop_index=t.current_stop),'boardingName',(SELECT name FROM nexo.stops WHERE route_id=b.route_id AND stop_index=b.from_stop),'alightingName',(SELECT name FROM nexo.stops WHERE route_id=b.route_id AND stop_index=b.to_stop),'priceBOB',b.price_bob::text,'seats',b.seats,'canManage',manager,'canStaff',staff,'canDecide',owner,'absenceReviewRequired',b.express,'canObserveAbsence',staff AND NOT b.express AND b.status IN('CONFIRMED','COMPLETED')AND t.status IN('QUEUED','IN_TRANSIT','COMPLETED')AND t.current_stop>=b.from_stop,'members',members,'facts',facts,
 'responsibility',jsonb_build_object('revision',coalesce(r.revision,0),'offlineRef',r.party_id,'accountLinked',r.account_id IS NOT NULL,'hasResponsible',nexo.responsible_user(b.id)IS NOT NULL,'history',history,'canManage',manager AND b.source='WALK_IN','canCreate',manager AND b.source='WALK_IN'AND r.revision IS NULL AND NOT EXISTS(SELECT FROM nexo.group_responsibles gr WHERE gr.group_id=b.group_id)),
 'groupParts',(SELECT count(*)FROM nexo.bookings x WHERE x.group_id=b.group_id),'resolutionOptions',options,'canResolveLate',manager AND(SELECT count(*)FROM nexo.bookings x WHERE x.group_id=b.group_id)=1 AND NOT EXISTS(SELECT FROM nexo.effective_movements f WHERE f.booking_id=b.id)AND b.status IN('CONFIRMED','CANCELLED'),
 'decisions',CASE WHEN manager OR owner THEN coalesce((SELECT jsonb_agg(jsonb_build_object('decision',d.decision,'createdAt',d.created_at)ORDER BY d.id)FROM nexo.passenger_decisions d WHERE d.booking_id=b.id),'[]')ELSE'[]'::jsonb END,
 'conditionReviewRequired',nexo.care_condition_stale(b.id),'cancelRequested',nexo.care_pending_cancel(b.id),'legalVerification',false,'automaticCancellation',false,'inventoryChanged',false);
END $$;
CREATE FUNCTION nexo.care_responsible_list(page_size integer,cursor uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE items jsonb;next_id uuid;total integer;
BEGIN
 PERFORM nexo.require_actor();IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 SELECT count(*)INTO total FROM nexo.bookings b WHERE b.source='WALK_IN'AND nexo.is_responsible(b.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',x.id,'tripId',x.trip_id,'seats',x.seats,'status',x.status,'priceBOB',x.price_bob::text,'vehicle',x.vehicle)ORDER BY x.id),'[]')INTO items FROM(
 SELECT b.*,v.label AS vehicle FROM nexo.bookings b JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE b.source='WALK_IN'AND nexo.is_responsible(b.id)AND(cursor IS NULL OR b.id>cursor)ORDER BY b.id LIMIT page_size)x;
 IF jsonb_array_length(items)=page_size THEN next_id:=(items->(page_size-1)->>'bookingId')::uuid;IF NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.source='WALK_IN'AND nexo.is_responsible(b.id)AND b.id>next_id)THEN next_id:=NULL;END IF;END IF;
 RETURN jsonb_build_object('bookings',items,'total',total,'nextCursor',next_id,'limit',page_size);
END $$;
CREATE FUNCTION nexo.care_accounts(trip uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;items jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;PERFORM nexo.check_scope(t.route_id);IF t.id IS NULL OR NOT nexo.manage_route(t.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('userRef',m.user_id,'role',m.role,'active',m.active,'label',u.label)ORDER BY m.user_id),'[]')INTO items FROM nexo.memberships m JOIN nexo.users u ON u.id=m.user_id WHERE m.association_id=t.association_id AND m.user_id=t.driver_id AND m.role='DRIVER';
 RETURN jsonb_build_object('tripId',t.id,'associationId',t.association_id,'members',items,'canManage',nexo.scope_allows(NULL),'roleProvisioning','OFFLINE_ONLY');
END $$;
CREATE FUNCTION nexo.care_account_command(k text,trip uuid,subject uuid,enabled boolean,reason_code text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;PERFORM nexo.check_scope(NULL);
 IF t.id IS NULL OR NOT nexo.manage_route(t.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR enabled IS NULL OR reason_code IS NULL OR reason_code NOT IN('ACCESS_REVIEW','ACCESS_REVOKED','ACCESS_RESTORED')OR NOT EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=t.association_id AND m.user_id=subject AND m.role='DRIVER')THEN RAISE EXCEPTION 'INVALID_ACCOUNT_COMMAND';END IF;
 p:=jsonb_build_object('op','care_account','trip',trip,'user',subject,'enabled',enabled,'reason',reason_code);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;PERFORM nexo.require_actor();PERFORM nexo.check_scope(NULL);IF NOT nexo.manage_route(t.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=t.association_id AND m.user_id=subject AND m.role='DRIVER')THEN RAISE EXCEPTION 'INVALID_ACCOUNT_COMMAND';END IF;
 PERFORM nexo.set_driver_membership(t.association_id,subject,enabled,reason_code);PERFORM nexo.audit(t.association_id,'CARE_DRIVER_ACCESS_CHANGED',subject);
 RETURN nexo.action_finish(k,p,jsonb_build_object('userRef',subject,'active',enabled,'automaticAssociationAccess',false));
END $$;
REVOKE EXECUTE ON FUNCTION nexo.care_context(uuid),nexo.care_responsible_list(integer,uuid),nexo.care_accounts(uuid),nexo.care_account_command(text,uuid,uuid,boolean,text,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.care_context(uuid),nexo.care_responsible_list(integer,uuid),nexo.care_accounts(uuid),nexo.care_account_command(text,uuid,uuid,boolean,text,boolean)TO nexo_app;

-- Bind subsequent decisions to the authority revision without rewriting old rows.
CREATE TABLE nexo.care_condition_authorities(decision_id bigint PRIMARY KEY REFERENCES nexo.condition_decisions,revision integer NOT NULL);
CREATE TABLE nexo.care_request_authorities(decision_id bigint PRIMARY KEY REFERENCES nexo.passenger_decisions,revision integer NOT NULL);
DO $$DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['care_condition_authorities','care_request_authorities']LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON nexo.%I FROM PUBLIC,nexo_app',tab);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',tab);
 END LOOP;
END $$;
CREATE FUNCTION nexo.capture_care_authority()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE revision integer:=nexo.care_responsibility_revision(NEW.booking_id);binding nexo.care_responsibilities;replacement uuid;
BEGIN
 IF revision>0 THEN
  IF TG_TABLE_NAME='condition_decisions'THEN INSERT INTO nexo.care_condition_authorities VALUES(NEW.id,revision);
  ELSE
   INSERT INTO nexo.care_request_authorities VALUES(NEW.id,revision);
   IF NEW.decision='LATE_TRANSFER_APPROVED'THEN
    SELECT r.* INTO binding FROM nexo.care_responsibilities r WHERE r.group_id=(SELECT group_id FROM nexo.bookings WHERE id=NEW.booking_id)ORDER BY r.revision DESC LIMIT 1;
    replacement:=(NEW.payload->>'replacementBookingId')::uuid;
    IF replacement IS NULL THEN RAISE EXCEPTION 'INVALID_RECOVERY_OUTCOME';END IF;
    INSERT INTO nexo.care_responsibilities(association_id,booking_id,group_id,revision,party_id,account_id,kind,reason,actor_id)
    SELECT NEW.association_id,replacement,b.group_id,1,binding.party_id,binding.account_id,'INHERIT_NATIVE','NATIVE_RECOVERY',NEW.actor_id FROM nexo.bookings b WHERE b.id=replacement;
    PERFORM nexo.audit(NEW.association_id,'CARE_RESPONSIBILITY_INHERITED',replacement);
   END IF;
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER capture_care_authority AFTER INSERT ON nexo.condition_decisions FOR EACH ROW EXECUTE FUNCTION nexo.capture_care_authority();
CREATE TRIGGER capture_care_authority AFTER INSERT ON nexo.passenger_decisions FOR EACH ROW EXECUTE FUNCTION nexo.capture_care_authority();
CREATE FUNCTION nexo.care_condition_stale(booking uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.care_responsibility_revision(booking)>0 AND EXISTS(SELECT FROM nexo.condition_decisions d JOIN nexo.bookings b ON b.id=d.booking_id JOIN nexo.route_conditions c ON c.route_id=b.route_id LEFT JOIN nexo.care_condition_authorities a ON a.decision_id=d.id WHERE d.booking_id=booking AND d.revision=c.revision AND d.decision IN('ACCEPT','REJECT')AND(a.revision IS DISTINCT FROM nexo.care_responsibility_revision(booking)OR d.actor_id IS DISTINCT FROM nexo.responsible_user(booking)))
$$;
CREATE FUNCTION nexo.guard_care_condition()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF NEW.decision IN('ACCEPT','REJECT')THEN
  PERFORM 1 FROM nexo.routes WHERE id=(SELECT route_id FROM nexo.bookings WHERE id=NEW.booking_id)FOR UPDATE;
  IF nexo.care_condition_stale(NEW.booking_id)THEN RAISE EXCEPTION 'RESPONSIBILITY_CONSENT_REVIEW_REQUIRED';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_care_condition BEFORE INSERT ON nexo.condition_decisions FOR EACH ROW EXECUTE FUNCTION nexo.guard_care_condition();
CREATE FUNCTION nexo.care_current_request(booking uuid,choice text)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.passenger_decisions d LEFT JOIN nexo.care_request_authorities a ON a.decision_id=d.id WHERE d.booking_id=booking AND d.decision=choice AND d.actor_id=nexo.responsible_user(booking)AND(nexo.care_responsibility_revision(booking)=0 OR a.revision=nexo.care_responsibility_revision(booking))
 AND(choice<>'CANCEL_REQUEST'OR NOT EXISTS(SELECT FROM nexo.passenger_decisions done LEFT JOIN nexo.care_request_authorities ca ON ca.decision_id=done.id WHERE done.booking_id=booking AND done.id>d.id AND done.decision='CANCEL_CONFIRMED'AND(nexo.care_responsibility_revision(booking)=0 OR ca.revision=nexo.care_responsibility_revision(booking)))))
$$;
CREATE FUNCTION nexo.care_pending_cancel(booking uuid)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;
BEGIN b:=nexo.care_access(booking,'VIEW');RETURN b.status IN('HELD','CONFIRMED')AND nexo.care_current_request(b.id,'CANCEL_REQUEST');END $$;
-- Existing condition uniqueness is intentionally not reinterpreted: stale choices
-- require human review instead of pretending a new acceptance was persisted.
CREATE OR REPLACE FUNCTION nexo.assert_boarding_contract(booking uuid,member uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;c nexo.route_conditions;mc nexo.minor_cases;
BEGIN
 IF nexo.care_condition_stale(booking)THEN RAISE EXCEPTION 'RESPONSIBILITY_CONSENT_REVIEW_REQUIRED';END IF;
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
ALTER FUNCTION nexo.web_condition_context(uuid)RENAME TO web_condition_context_030;
REVOKE EXECUTE ON FUNCTION nexo.web_condition_context_030(uuid)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.web_condition_context(booking uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r jsonb;
BEGIN
 r:=nexo.web_condition_context_030(booking);
 IF nexo.care_responsibility_revision(booking)>0 THEN
  r:=r||jsonb_build_object('cancelRequested',nexo.care_pending_cancel(booking),'canResolve',coalesce((r->>'canResolve')::boolean,false)AND nexo.care_pending_cancel(booking));
  IF nexo.care_condition_stale(booking)THEN r:=r||jsonb_build_object('choice',NULL,'canDecide',false,'responsibilityReviewRequired',true);END IF;
 END IF;RETURN r;
END $$;
ALTER FUNCTION nexo.web_condition_command(text,uuid,integer,text,boolean)RENAME TO web_condition_command_030;
REVOKE EXECUTE ON FUNCTION nexo.web_condition_command_030(text,uuid,integer,text,boolean)FROM PUBLIC,nexo_app;
CREATE OR REPLACE FUNCTION nexo.web_condition_command_030(k text,booking uuid,revision integer,decision text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
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
 SELECT d.decision INTO choice FROM nexo.condition_decisions d WHERE d.booking_id=b.id AND d.revision=web_condition_command_030.revision AND d.decision IN('ACCEPT','REJECT')ORDER BY d.id DESC LIMIT 1;
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
CREATE FUNCTION nexo.web_condition_command(k text,booking uuid,revision integer,decision text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;
BEGIN
 b:=nexo.care_access(booking,CASE WHEN decision='RESOLVE_CANCEL'THEN'MANAGE'ELSE'OWNER'END);
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(booking,CASE WHEN decision='RESOLVE_CANCEL'THEN'MANAGE'ELSE'OWNER'END);
 IF nexo.care_condition_stale(booking)OR decision='CANCEL_REQUEST'AND nexo.care_responsibility_revision(booking)>0 AND EXISTS(SELECT FROM nexo.passenger_decisions d WHERE d.booking_id=booking AND d.decision='CANCEL_REQUEST')AND NOT nexo.care_current_request(booking,'CANCEL_REQUEST')THEN RAISE EXCEPTION 'RESPONSIBILITY_CONSENT_REVIEW_REQUIRED';END IF;
 RETURN nexo.web_condition_command_030(k,booking,revision,decision,confirmed);
END $$;
ALTER FUNCTION nexo.approve_late_resolution(text,uuid,uuid,boolean,boolean)RENAME TO approve_late_resolution_030;
REVOKE EXECUTE ON FUNCTION nexo.approve_late_resolution_030(text,uuid,uuid,boolean,boolean)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.approve_late_resolution(k text,booking uuid,target uuid,cancel_only boolean,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;r jsonb;binding nexo.care_responsibilities;new_booking uuid;
BEGIN
 b:=nexo.care_access(booking,'MANAGE');p:=jsonb_build_object('op','late_resolution','booking',booking,'target',target,'cancelOnly',cancel_only);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(booking,'MANAGE');
 IF nexo.care_responsibility_revision(booking)>0 AND NOT nexo.care_current_request(booking,CASE WHEN cancel_only THEN'CANCEL_REQUEST'ELSE'REQUEST_ALTERNATIVE'END)THEN RAISE EXCEPTION 'FRESH_RESPONSIBLE_DECISION_REQUIRED';END IF;
 r:=nexo.approve_late_resolution_030(k,booking,target,cancel_only,confirmed);
 SELECT * INTO binding FROM nexo.care_responsibilities WHERE group_id=b.group_id ORDER BY revision DESC LIMIT 1;
 new_booking:=(r->>'replacementBookingId')::uuid;
 RETURN r;
END $$;
CREATE FUNCTION nexo.care_exception(k text,booking uuid,expected integer,command text,target uuid,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;r jsonb;
BEGIN
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected NOT BETWEEN 0 AND 8 OR command IS NULL OR command NOT IN('REQUEST_ALTERNATIVE','CANCEL_REQUEST','LATE_REPLACE','LATE_CANCEL')OR(command='LATE_REPLACE')IS DISTINCT FROM(target IS NOT NULL)THEN RAISE EXCEPTION 'INVALID_EXCEPTION_COMMAND';END IF;
 b:=nexo.care_access(booking,CASE WHEN command IN('LATE_REPLACE','LATE_CANCEL')THEN'MANAGE'ELSE'OWNER'END);
 p:=jsonb_build_object('op','care_exception','booking',booking,'episode',expected,'command',command,'target',target);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(booking,CASE WHEN command IN('LATE_REPLACE','LATE_CANCEL')THEN'MANAGE'ELSE'OWNER'END);IF expected<>nexo.assignment_episode(booking)THEN RAISE EXCEPTION 'STALE_ASSIGNMENT';END IF;
 IF command IN('REQUEST_ALTERNATIVE','CANCEL_REQUEST')THEN r:=nexo.passenger_decision('care-exception:'||encode(sha256(convert_to(k,'UTF8')),'hex'),booking,command,true);
 ELSE r:=nexo.approve_late_resolution('care-exception:'||encode(sha256(convert_to(k,'UTF8')),'hex'),booking,target,command='LATE_CANCEL',true);END IF;
 RETURN nexo.action_finish(k,p,r);
END $$;
CREATE FUNCTION nexo.care_consent_current(consent uuid)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE c nexo.group_consents;
BEGIN SELECT * INTO c FROM nexo.group_consents WHERE id=consent;PERFORM nexo.care_access(c.booking_id,'VIEW');RETURN c.snapshot IS NOT DISTINCT FROM nexo.group_snapshot(c.booking_id);END $$;
REVOKE EXECUTE ON FUNCTION nexo.capture_care_authority(),nexo.care_condition_stale(uuid),nexo.guard_care_condition(),nexo.care_current_request(uuid,text)FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.care_pending_cancel(uuid),nexo.web_condition_context(uuid),nexo.web_condition_command(text,uuid,integer,text,boolean),nexo.approve_late_resolution(text,uuid,uuid,boolean,boolean),nexo.care_exception(text,uuid,integer,text,uuid,boolean),nexo.care_consent_current(uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.care_pending_cancel(uuid),nexo.web_condition_context(uuid),nexo.web_condition_command(text,uuid,integer,text,boolean),nexo.approve_late_resolution(text,uuid,uuid,boolean,boolean),nexo.care_exception(text,uuid,integer,text,uuid,boolean),nexo.care_consent_current(uuid)TO nexo_app;

CREATE FUNCTION nexo.guard_care_request_consumption()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF NEW.decision='LATE_TRANSFER_APPROVED'AND nexo.care_condition_stale(NEW.booking_id)THEN RAISE EXCEPTION 'RESPONSIBILITY_CONSENT_REVIEW_REQUIRED';END IF;
 IF NEW.decision IN('CANCEL_CONFIRMED','LATE_TRANSFER_APPROVED')AND nexo.care_responsibility_revision(NEW.booking_id)>0 AND NOT nexo.care_current_request(NEW.booking_id,CASE NEW.decision WHEN'CANCEL_CONFIRMED'THEN'CANCEL_REQUEST'ELSE'REQUEST_ALTERNATIVE'END)THEN RAISE EXCEPTION 'FRESH_RESPONSIBLE_DECISION_REQUIRED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_care_request_consumption BEFORE INSERT ON nexo.passenger_decisions FOR EACH ROW EXECUTE FUNCTION nexo.guard_care_request_consumption();
REVOKE EXECUTE ON FUNCTION nexo.guard_care_request_consumption()FROM PUBLIC,nexo_app;

CREATE OR REPLACE FUNCTION nexo.web_booking_recovery(booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();b nexo.bookings;options jsonb;history jsonb;consents jsonb;availability jsonb;operation jsonb;group_seats integer;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking AND coalesce(nexo.is_responsible(id),false);
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.check_scope(b.route_id);
 operation:=nexo.operational_status(b.trip_id);
 SELECT sum(seats)INTO group_seats FROM nexo.bookings WHERE group_id=b.group_id;
 -- The existing public projection supplies eligibility/capacity. This is consent,
 -- not a reservation or an administrative guarantee of candidate order/capacity.
 IF b.status='CONFIRMED'AND EXISTS(SELECT FROM nexo.trips WHERE id=b.trip_id AND status='QUEUED')THEN
  availability:=nexo.public_segment_availability(b.route_id,b.from_stop,b.to_stop);
  SELECT coalesce(jsonb_agg(jsonb_build_object('tripId',t.id,'vehicle',v.label,'position',t.position_no,'availableSeats',p.value->'availableSeats')ORDER BY t.position_no,t.id),'[]')INTO options
  FROM jsonb_array_elements(availability->'services')p JOIN nexo.trips t ON t.id=(p.value->>'tripId')::uuid JOIN nexo.vehicles v ON v.id=t.vehicle_id
  WHERE t.id<>b.trip_id AND t.status='QUEUED'AND(p.value->>'newReservationsAllowed')::boolean;
 END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at DESC,id),'[]')INTO consents FROM(
 SELECT c.id,c.created_at,jsonb_build_object('consentId',c.id,'targetTripId',c.target_trip,'vehicle',v.label,'createdAt',c.created_at,
 'used',EXISTS(SELECT FROM nexo.consent_uses x WHERE x.consent_id=c.id),'matchesCurrentGroup',c.snapshot=nexo.group_snapshot(b.id))AS entry
 FROM nexo.group_consents c JOIN nexo.trips t ON t.id=c.target_trip JOIN nexo.vehicles v ON v.id=t.vehicle_id
 WHERE c.group_id=b.group_id AND c.responsible_id=u ORDER BY c.created_at DESC,c.id LIMIT 10)q;
 SELECT coalesce(jsonb_agg(entry ORDER BY created_at DESC,id),'[]')INTO history FROM(
 SELECT f.id,f.created_at,jsonb_build_object('context',f.context,'state',f.state,'reason',f.reason,'originalVehicle',v.label,'replacementVehicle',c.label,'createdAt',f.created_at)AS entry
 FROM nexo.fleet_incidents f JOIN nexo.vehicles v ON v.id=f.original_vehicle LEFT JOIN nexo.vehicles c ON c.id=f.replacement_vehicle
 WHERE EXISTS(SELECT FROM nexo.assignment_episodes e WHERE e.booking_id=b.id AND e.trip_id=f.trip_id
 AND f.created_at>=e.created_at AND NOT EXISTS(SELECT FROM nexo.assignment_episodes later WHERE later.booking_id=e.booking_id AND later.episode>e.episode AND later.created_at<=f.created_at))
 ORDER BY f.created_at DESC,f.id LIMIT 20)q;
 RETURN jsonb_build_object('bookingId',b.id,'tripId',b.trip_id,'status',b.status,'episode',nexo.assignment_episode(b.id),'groupSeats',group_seats,
 'vehicle',(SELECT v.label FROM nexo.trips t JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE t.id=b.trip_id),'operation',operation,
 'targets',coalesce(options,'[]'),'consents',consents,'incidents',history,'snapshotOnly',true,'delivery','DISABLED','automaticCancellation',false);
END $$;

-- Historical authorship is audit evidence, not continuing authority over a
-- walk-in group after staff revocation. Keep APP ownership and native payloads.
CREATE POLICY care_walk_in_access ON nexo.bookings AS RESTRICTIVE FOR SELECT USING(
 source<>'WALK_IN'OR coalesce(nexo.is_responsible(id),false)OR nexo.manage_route(route_id)OR nexo.drives(trip_id)
);
CREATE FUNCTION nexo.care_legacy_boundary(booking uuid,writing boolean)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF b.source='WALK_IN'THEN
  PERFORM nexo.care_access(booking,'VIEW');
  IF writing THEN
   PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
   PERFORM nexo.care_write_access(booking,CASE WHEN coalesce(nexo.is_responsible(booking),false)THEN'OWNER'ELSE'STAFF'END);
  END IF;
 END IF;
END $$;
-- Preserve OIDs, argument names, ACLs and the existing implementation. In
-- particular, native self-qualified PL/pgSQL parameters must not be renamed.
DO $$DECLARE f record;definition text;prefix text;BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='nexo'AND p.proname IN('cancel','group_status','assignment_status','terminal_evaluation','terminal_command','terminal_assignment_command','terminal_arrival','activate_terminal_booking')LOOP
  definition:=pg_get_functiondef(f.oid);
  prefix:='BEGIN PERFORM nexo.care_legacy_boundary(booking,'||CASE WHEN f.proname IN('group_status','assignment_status','terminal_evaluation')THEN'false'ELSE'true'END||');';
  IF strpos(definition,'BEGIN')=0 THEN RAISE EXCEPTION 'UNSUPPORTED_CARE_BOUNDARY';END IF;
  EXECUTE overlay(definition placing prefix from strpos(definition,'BEGIN')for 5);
 END LOOP;
END $$;
CREATE FUNCTION nexo.care_trip_boundary(trip uuid)RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;u uuid:=nexo.require_actor();
BEGIN
 SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF t.id IS NULL OR NOT(nexo.manage_route(t.route_id)OR nexo.drives(trip)OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=trip AND(nexo.is_responsible(b.id)OR b.source='APP'AND(b.passenger_id=u OR b.created_by=u)))OR nexo.has_role(t.association_id,'DRIVER')AND EXISTS(SELECT FROM nexo.fleet_incidents f WHERE f.trip_id=trip AND f.reported_by=u))THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
END $$;
DO $$DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('nexo.operational_status(uuid)'::regprocedure);
 EXECUTE overlay(definition placing 'BEGIN PERFORM nexo.care_trip_boundary(trip);'from strpos(definition,'BEGIN')for 5);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.care_legacy_boundary(uuid,boolean),nexo.care_trip_boundary(uuid)FROM PUBLIC,nexo_app;
