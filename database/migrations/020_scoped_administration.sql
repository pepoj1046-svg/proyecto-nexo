-- Restricted administrators cannot inherit legacy association-wide authority.
CREATE OR REPLACE FUNCTION nexo.check_scope(route uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('admin-scope:'||u::text,0));
 IF NOT nexo.scope_allows(route) THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
END $$;
CREATE FUNCTION nexo.configure_admin_scope(subject uuid,association uuid,routes uuid[],restricted boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF subject IS NULL OR association IS NULL OR routes IS NULL OR restricted IS NULL OR cardinality(routes)>100 THEN RAISE EXCEPTION 'INVALID_SCOPE';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-scope:'||subject::text,0));
 IF NOT EXISTS(SELECT FROM nexo.memberships WHERE user_id=subject AND association_id=association AND role='ASSOCIATION_ADMIN' AND active) OR EXISTS(SELECT FROM unnest(routes)x WHERE x IS NULL OR NOT EXISTS(SELECT FROM nexo.routes r WHERE r.id=x AND r.association_id=association)) THEN RAISE EXCEPTION 'INVALID_SCOPE';END IF;
 IF restricted THEN
  INSERT INTO nexo.admin_limits VALUES(association,subject)ON CONFLICT DO NOTHING;
  INSERT INTO nexo.identity_events(subject_id,association_id,event,reason) SELECT subject,association,'ADMIN_ROUTE_REVOKED','Ruta de laboratorio: '||route_id::text FROM nexo.admin_route_grants WHERE user_id=subject AND association_id=association;
  DELETE FROM nexo.admin_route_grants WHERE user_id=subject AND association_id=association;
  INSERT INTO nexo.admin_route_grants SELECT association,subject,x FROM unnest(routes)x ON CONFLICT DO NOTHING;
  INSERT INTO nexo.identity_events(subject_id,association_id,event,reason) SELECT subject,association,'ADMIN_ROUTE_GRANTED','Ruta de laboratorio: '||route_id::text FROM nexo.admin_route_grants WHERE user_id=subject AND association_id=association;
 ELSE
  DELETE FROM nexo.admin_route_grants WHERE user_id=subject AND association_id=association;
  DELETE FROM nexo.admin_limits WHERE user_id=subject AND association_id=association;
 END IF;
 INSERT INTO nexo.identity_events(subject_id,association_id,event,reason) VALUES(subject,association,CASE WHEN restricted THEN 'ADMIN_SCOPE_RESTRICTED' ELSE 'ADMIN_SCOPE_UNRESTRICTED' END,'Configuración offline de permisos de laboratorio');
 RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION nexo.configure_admin_scope(uuid,uuid,uuid[],boolean) TO nexo_provisioner;
CREATE FUNCTION nexo.review_association(k text,association uuid,state text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR state IS NULL OR state NOT IN('PENDING','ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'INVALID_ASSOCIATION_STATE';END IF;
 p:=jsonb_build_object('op','review_association','association',association,'state',state);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE association_id=association ORDER BY id FOR UPDATE;
 IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 UPDATE nexo.associations SET adherence_status=CASE WHEN state='PENDING' THEN 'PENDING' ELSE 'ADHERED' END,operating_status=CASE WHEN state='ACTIVE' THEN 'OPERATING' ELSE 'SUSPENDED' END WHERE id=association;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ASSOCIATION';END IF;
 PERFORM nexo.audit(association,'ASSOCIATION_'||state,association);RETURN nexo.action_finish(k,p,jsonb_build_object('state',state,'legalVerification',false,'simulated',true));
END $$;
CREATE FUNCTION nexo.set_association_contact(k text,association uuid,code text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope(NULL);
 IF NOT nexo.has_role(association,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR code IS NULL OR code !~ '^LAB-[A-Z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'INVALID_SYNTHETIC_CONTACT';END IF;
 p:=jsonb_build_object('op','association_contact','association',association,'code',code);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.associations WHERE id=association FOR UPDATE;
 IF NOT nexo.has_role(association,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 INSERT INTO nexo.association_contacts VALUES(association,code,nexo.require_actor(),clock_timestamp())ON CONFLICT(association_id)DO UPDATE SET contact_code=excluded.contact_code,actor_id=excluded.actor_id,updated_at=excluded.updated_at;
 PERFORM nexo.audit(association,'CONTACT_UPDATED',association);RETURN nexo.action_finish(k,p,jsonb_build_object('contactCode',code,'synthetic',true));
END $$;
CREATE FUNCTION nexo.passenger_decision(k text,booking uuid,decision text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;p jsonb;cached jsonb;contact text;result jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT coalesce(nexo.is_responsible(b.id),false) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR decision IS NULL OR decision NOT IN('REQUEST_ALTERNATIVE','CANCEL_REQUEST','REFUND_CONTACT_REQUESTED') THEN RAISE EXCEPTION 'INVALID_DECISION';END IF;
 p:=jsonb_build_object('op','passenger_decision','booking',booking,'decision',decision);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;
 IF NOT coalesce(nexo.is_responsible(b.id),false) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT contact_code INTO contact FROM nexo.association_contacts WHERE association_id=b.association_id;
 INSERT INTO nexo.passenger_decisions(association_id,booking_id,decision,actor_id)VALUES(b.association_id,b.id,decision,nexo.require_actor());
 result:=jsonb_build_object('decision',decision,'contactCode',contact,'contactPending',contact IS NULL,'associationResponsibleForRefund',true,'moneyProcessed',false,'resolutionOptions',nexo.resolution_options(b.id),'simulated',true,'automaticCancellation',false);
 PERFORM nexo.audit(b.association_id,'PASSENGER_'||decision,b.id);RETURN nexo.action_finish(k,p,result);
END $$;
CREATE TABLE nexo.late_replacements (
 association_id uuid NOT NULL, original_booking uuid PRIMARY KEY, replacement_booking uuid UNIQUE NOT NULL,
 actor_id uuid NOT NULL REFERENCES nexo.users, price_bob numeric(12,2) NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,original_booking) REFERENCES nexo.bookings(association_id,id),FOREIGN KEY(association_id,replacement_booking) REFERENCES nexo.bookings(association_id,id)
);
ALTER TABLE nexo.late_replacements ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_read ON nexo.late_replacements FOR SELECT USING(EXISTS(SELECT FROM nexo.bookings b WHERE b.id=original_booking));
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.late_replacements FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
GRANT SELECT ON nexo.late_replacements TO nexo_app;
CREATE FUNCTION nexo.approve_late_resolution(k text,booking uuid,target uuid,cancel_only boolean,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;t nexo.trips;p jsonb;cached jsonb;replacement uuid;gid uuid:=gen_random_uuid();contact text;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT nexo.manage_route(b.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR cancel_only IS NULL OR cancel_only<>(target IS NULL) THEN RAISE EXCEPTION 'INVALID_LATE_RESOLUTION';END IF;
 p:=jsonb_build_object('op','late_resolution','booking',booking,'target',target,'cancelOnly',cancel_only);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;SELECT * INTO b FROM nexo.bookings WHERE id=booking FOR UPDATE;
 IF NOT nexo.manage_route(b.route_id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF b.status NOT IN('CONFIRMED','CANCELLED') OR nexo.booking_onboard(b.id)>0 OR EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id) OR (SELECT count(*) FROM nexo.bookings WHERE group_id=b.group_id)<>1 OR EXISTS(SELECT FROM nexo.late_replacements WHERE original_booking=b.id) THEN RAISE EXCEPTION 'ADMIN_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT FROM nexo.passenger_decisions d WHERE d.booking_id=b.id AND d.actor_id=nexo.responsible_user(b.id) AND d.decision=CASE WHEN cancel_only THEN 'CANCEL_REQUEST' ELSE 'REQUEST_ALTERNATIVE' END) THEN RAISE EXCEPTION 'PASSENGER_DECISION_REQUIRED';END IF;
 IF NOT cancel_only THEN
  PERFORM nexo.require_eligible_route(b.route_id);
  SELECT * INTO t FROM nexo.trips WHERE id=target AND route_id=b.route_id AND status='QUEUED' AND current_stop<=b.from_stop FOR UPDATE;
  IF NOT FOUND OR NOT nexo.fits(t.id,b.from_stop,b.to_stop,b.seats) OR t.id=b.trip_id THEN RAISE EXCEPTION 'NO_CAPACITY';END IF;
  IF NOT EXISTS(SELECT FROM nexo.memberships WHERE association_id=t.association_id AND user_id=t.driver_id AND role='DRIVER' AND active) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF t.id IS DISTINCT FROM(SELECT tr.id FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active WHERE tr.route_id=b.route_id AND tr.id<>b.trip_id AND tr.status='QUEUED' AND tr.current_stop<=b.from_stop AND nexo.fits(tr.id,b.from_stop,b.to_stop,b.seats) ORDER BY tr.position_no,tr.id LIMIT 1) THEN RAISE EXCEPTION 'QUEUE_ORDER';END IF;
 END IF;
 UPDATE nexo.bookings SET status='CANCELLED' WHERE id=b.id;
 IF NOT cancel_only THEN
  INSERT INTO nexo.bookings(association_id,trip_id,route_id,passenger_id,created_by,group_id,source,seats,express,from_stop,to_stop,fare_id,price_bob,fare_version,status,expires_at)
  VALUES(b.association_id,t.id,b.route_id,b.passenger_id,b.created_by,gid,b.source,b.seats,b.express,b.from_stop,b.to_stop,b.fare_id,b.price_bob,b.fare_version,'CONFIRMED',clock_timestamp())RETURNING id INTO replacement;
  INSERT INTO nexo.terminal_bindings VALUES(b.association_id,replacement,nexo.require_actor(),clock_timestamp());
  IF b.source='WALK_IN' THEN INSERT INTO nexo.group_responsibles VALUES(b.association_id,replacement,gid,nexo.responsible_user(b.id),nexo.require_actor(),clock_timestamp());END IF;
  INSERT INTO nexo.late_replacements VALUES(b.association_id,b.id,replacement,nexo.require_actor(),b.price_bob,clock_timestamp());
  -- Technical minor cases are copied to new slots with fresh PENDING review, never legal approval.
  INSERT INTO nexo.minor_cases(association_id,booking_id,member_id,kind,companion_id)
  SELECT b.association_id,replacement,nm.id,mc.kind,nc.id FROM nexo.minor_cases mc JOIN nexo.booking_members om ON om.id=mc.member_id
  JOIN nexo.booking_members nm ON nm.booking_id=replacement AND nm.ordinal=om.ordinal
  LEFT JOIN nexo.booking_members oc ON oc.id=mc.companion_id LEFT JOIN nexo.booking_members nc ON nc.booking_id=replacement AND nc.ordinal=oc.ordinal WHERE mc.booking_id=b.id;
  INSERT INTO nexo.minor_reviews(association_id,member_id,result,actor_id)SELECT b.association_id,m.member_id,'PENDING',nexo.require_actor()FROM nexo.minor_cases m WHERE m.booking_id=replacement;
 END IF;
 SELECT contact_code INTO contact FROM nexo.association_contacts WHERE association_id=b.association_id;
 INSERT INTO nexo.passenger_decisions(association_id,booking_id,decision,actor_id,payload)VALUES(b.association_id,b.id,CASE WHEN cancel_only THEN 'CANCEL_CONFIRMED' ELSE 'LATE_TRANSFER_APPROVED' END,nexo.require_actor(),jsonb_build_object('replacementBookingId',replacement,'noNewCharge',true));
 PERFORM nexo.audit(b.association_id,'LATE_RESOLUTION',b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('originalBookingId',b.id,'replacementBookingId',replacement,'status',CASE WHEN cancel_only THEN 'CANCELLED' ELSE 'CONFIRMED' END,'priceBOB',b.price_bob::text,'contactCode',contact,'moneyProcessed',false,'surchargeBOB','0.00'));
END $$;
GRANT EXECUTE ON FUNCTION nexo.review_association(text,uuid,text,boolean),nexo.set_association_contact(text,uuid,text,boolean),nexo.passenger_decision(text,uuid,text,boolean),nexo.approve_late_resolution(text,uuid,uuid,boolean,boolean) TO nexo_app;

-- Additional restrictive policies constrain existing permissive RLS without weakening it.
DO $$ DECLARE t record;expr text;BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexo' AND c.relkind='r' AND c.relrowsecurity LOOP
  expr:=NULL;
  IF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='nexo' AND table_name=t.relname AND column_name='route_id') THEN expr:='nexo.scope_allows(route_id)';
  ELSIF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='nexo' AND table_name=t.relname AND column_name='booking_id') THEN expr:='nexo.scope_allows((SELECT route_id FROM nexo.bookings b WHERE b.id=booking_id))';
  ELSIF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='nexo' AND table_name=t.relname AND column_name='trip_id') THEN expr:='nexo.scope_allows((SELECT route_id FROM nexo.trips t WHERE t.id=trip_id))';
  END IF;
  IF expr IS NOT NULL THEN EXECUTE format('CREATE POLICY limited_admin_read ON nexo.%I AS RESTRICTIVE FOR SELECT USING(%s)',t.relname,expr);END IF;
 END LOOP;
END $$;
CREATE POLICY limited_admin_read ON nexo.vehicles AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR EXISTS(SELECT FROM nexo.trips t WHERE t.vehicle_id=vehicles.id AND nexo.scope_allows(t.route_id)));
CREATE POLICY limited_admin_read ON nexo.memberships AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR user_id=nexo.actor());
CREATE POLICY limited_admin_read ON nexo.audit_events AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR EXISTS(SELECT FROM nexo.bookings b WHERE (b.id=entity_id OR b.group_id=entity_id) AND nexo.scope_allows(b.route_id)) OR EXISTS(SELECT FROM nexo.trips t WHERE t.id=entity_id AND nexo.scope_allows(t.route_id)));
CREATE POLICY limited_admin_read ON nexo.admin_limits AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR user_id=nexo.actor());
CREATE POLICY own_scope_read ON nexo.admin_route_grants AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR user_id=nexo.actor());
CREATE POLICY limited_admin_read ON nexo.vehicle_blocks AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR EXISTS(SELECT FROM nexo.fleet_incidents f JOIN nexo.trips t ON t.id=f.trip_id WHERE f.id=incident_id AND nexo.scope_allows(t.route_id)));
CREATE POLICY limited_admin_read ON nexo.minor_reviews AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR EXISTS(SELECT FROM nexo.booking_members m JOIN nexo.bookings b ON b.id=m.booking_id WHERE m.id=member_id AND nexo.scope_allows(b.route_id)));

-- Keep exact signatures and payloads. All app-callable privileged business functions
-- receive a scope gate; aliases are private and no GUC can forge an admin grant.
DO $$ DECLARE f record;expr text;args text;body text;sig text;arg text;BEGIN
 FOR f IN SELECT p.*,pg_get_function_arguments(p.oid) AS declaration,pg_get_function_identity_arguments(p.oid) AS identity_args,pg_get_function_result(p.oid) AS result_type FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nexo' AND p.prosecdef AND has_function_privilege('nexo_app',p.oid,'EXECUTE') AND p.proname=ANY(ARRAY[
 'reserve','reserve_business','reserve_enroute','set_driver_membership','submit_authorization','configure_terminal','terminal_command','terminal_assignment_command','terminal_arrival','terminal_evaluation','transfer_candidates','advancement_candidates','transfer_booking','transfer_assignment','assignment_status','respond_assignment','register_responsible','consent_group_transfer','approve_terminal_transfer','simulate_payment','group_status','activate_terminal_booking','terminal_observation','correct_movement','correct_arrival','begin_urban','fleet_command','free_replacement','restore_vehicle','terminal_impediment','terminal_replacement_candidate','reassign_terminal_incident','road_candidates','road_command','set_route_condition','condition_decision','review_minor','passenger_decision','approve_late_resolution','operational_status','cancel','record_movement','record_member_movement','record_absence_draft','refresh_offers']) LOOP
  expr:=NULL;
  IF 'booking'=ANY(f.proargnames) THEN expr:='(SELECT route_id FROM nexo.bookings WHERE id=booking)';
  ELSIF 'member'=ANY(f.proargnames) THEN expr:='(SELECT b.route_id FROM nexo.booking_members m JOIN nexo.bookings b ON b.id=m.booking_id WHERE m.id=member)';
  ELSIF 'trip'=ANY(f.proargnames) THEN expr:='(SELECT route_id FROM nexo.trips WHERE id=trip)';
  ELSIF 'route'=ANY(f.proargnames) THEN expr:='route';
  ELSIF 'consent'=ANY(f.proargnames) THEN expr:='(SELECT b.route_id FROM nexo.group_consents c JOIN nexo.bookings b ON b.id=c.booking_id WHERE c.id=consent)';
  ELSIF 'incident'=ANY(f.proargnames) THEN expr:='(SELECT t.route_id FROM nexo.fleet_incidents i JOIN nexo.trips t ON t.id=i.trip_id WHERE i.id=incident)';
  ELSIF 'vehicle'=ANY(f.proargnames) THEN expr:='(SELECT t.route_id FROM nexo.vehicle_blocks v JOIN nexo.fleet_incidents i ON i.id=v.incident_id JOIN nexo.trips t ON t.id=i.trip_id WHERE v.vehicle_id=vehicle)';
  ELSIF f.proname IN('reserve','reserve_business') THEN expr:='(p->>''routeId'')::uuid';
  ELSE expr:='NULL';END IF;
  args:='';FOREACH arg IN ARRAY f.proargnames LOOP args:=args||CASE WHEN args='' THEN '' ELSE ',' END||quote_ident(arg);END LOOP;
  sig:=format('nexo.%I(%s)',f.proname,f.identity_args);
  EXECUTE format('ALTER FUNCTION %s RENAME TO %I',sig,'scope_core_'||f.proname);
  EXECUTE format('REVOKE EXECUTE ON FUNCTION nexo.%I(%s) FROM nexo_app,PUBLIC','scope_core_'||f.proname,f.identity_args);
  body:=format('BEGIN PERFORM nexo.check_scope(%s); %s nexo.%I(%s); END',expr,CASE WHEN f.proretset THEN 'RETURN QUERY SELECT * FROM' ELSE 'RETURN' END,'scope_core_'||f.proname,args);
  EXECUTE format('CREATE FUNCTION nexo.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS %L',f.proname,f.declaration,f.result_type,body);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO nexo_app',sig);
 END LOOP;
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

CREATE FUNCTION nexo.operating_history(route uuid,page_size integer DEFAULT 50,page_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope(route);
 IF NOT nexo.manage_route(route) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at,e.id),'[]') INTO result FROM(
 SELECT a.id::text,a.created_at,a.action AS kind,a.entity_id FROM nexo.audit_events a WHERE a.association_id=(SELECT association_id FROM nexo.routes WHERE id=route) AND
 (a.entity_id=route OR EXISTS(SELECT FROM nexo.trips t WHERE t.id=a.entity_id AND t.route_id=route) OR EXISTS(SELECT FROM nexo.bookings b WHERE (b.id=a.entity_id OR b.group_id=a.entity_id) AND b.route_id=route))
 ORDER BY a.created_at,a.id LIMIT page_size OFFSET page_offset)e;
 RETURN jsonb_build_object('events',result,'limit',page_size,'offset',page_offset,'retentionPolicyPending',true,'destructiveCleanup',false);
END $$;
GRANT EXECUTE ON FUNCTION nexo.operating_history(uuid,integer,integer) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

ALTER FUNCTION nexo.operational_status(uuid) RENAME TO operational_status_020;
REVOKE EXECUTE ON FUNCTION nexo.operational_status_020(uuid) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.operational_status(trip uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE result jsonb;r nexo.road_rescues;
BEGIN
 result:=nexo.operational_status_020(trip);
 SELECT * INTO r FROM nexo.road_rescues WHERE trip_id=trip ORDER BY (SELECT created_at FROM nexo.fleet_incidents f WHERE f.id=incident_id) DESC,incident_id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN result;END IF;
 IF r.phase<>'TRANSFERRED' THEN result:=result||jsonb_build_object('phase',CASE r.phase WHEN 'ASSIGNED' THEN 'ROAD_RESCUE' WHEN 'REPORTED' THEN 'ROAD_REPORTED' ELSE 'ROAD_AWAITING_REPLACEMENT' END);END IF;
 RETURN result||jsonb_build_object('roadRescue',jsonb_build_object('incidentId',r.incident_id,'version',r.version,'phase',r.phase,'terminalPriority',r.terminal_priority,'urgent',r.phase='URGENT_REVIEW','positionIsSimulated',true,'humanAssistanceFirst',true));
END $$;
GRANT EXECUTE ON FUNCTION nexo.operational_status(uuid) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

-- A compensating correction cannot remove the boarding evidence of an accompanying
-- slot while a declared minor remains individually onboard.
CREATE FUNCTION nexo.guard_companion_correction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF NEW.kind='VOID' AND EXISTS(SELECT FROM nexo.movement_facts f JOIN nexo.minor_cases c ON c.companion_id=f.member_id
 WHERE f.fact_key=NEW.target_key AND f.kind='BOARD'
 AND EXISTS(SELECT FROM nexo.effective_movements mb WHERE mb.member_id=c.member_id AND mb.kind='BOARD')
 AND NOT EXISTS(SELECT FROM nexo.effective_movements ma WHERE ma.member_id=c.member_id AND ma.kind='ALIGHT')) THEN RAISE EXCEPTION 'COMPANION_REQUIRED';END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_companion_correction BEFORE INSERT ON nexo.movement_corrections FOR EACH ROW EXECUTE FUNCTION nexo.guard_companion_correction();
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

CREATE FUNCTION nexo.resolution_options(booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;options jsonb;contact text;
BEGIN
 PERFORM nexo.require_actor();PERFORM nexo.check_scope((SELECT route_id FROM nexo.bookings WHERE id=booking));
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;
 IF NOT FOUND OR NOT(coalesce(nexo.is_responsible(b.id),false) OR nexo.manage_route(b.route_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT contact_code INTO contact FROM nexo.association_contacts WHERE association_id=b.association_id;
 SELECT coalesce(jsonb_agg(x.entry ORDER BY x.position_no,x.id),'[]') INTO options FROM(
 SELECT t.id,t.position_no,jsonb_build_object('tripId',t.id,'position',t.position_no,'priceBOB',b.price_bob::text,'surchargeBOB','0.00','adminValidationRequired',true)AS entry
 FROM nexo.trips t JOIN nexo.memberships m ON m.association_id=t.association_id AND m.user_id=t.driver_id AND m.role='DRIVER' AND m.active
 WHERE t.route_id=b.route_id AND t.id<>b.trip_id AND t.status='QUEUED' AND t.current_stop<=b.from_stop AND nexo.can_search_route(t.route_id) AND nexo.fits(t.id,b.from_stop,b.to_stop,b.seats)
 AND b.status IN('CONFIRMED','CANCELLED') AND NOT EXISTS(SELECT FROM nexo.effective_movements WHERE booking_id=b.id) AND(SELECT count(*)FROM nexo.bookings WHERE group_id=b.group_id)=1
 ORDER BY t.position_no,t.id LIMIT 20)x;
 RETURN jsonb_build_object('bookingId',b.id,'alternatives',options,'contactCode',contact,'contactPending',contact IS NULL,'snapshotOnly',true,'associationResponsibleForRefund',true,'moneyProcessed',false);
END $$;
GRANT EXECUTE ON FUNCTION nexo.resolution_options(uuid) TO nexo_app;
ALTER FUNCTION nexo.cancel(text,uuid) RENAME TO cancel_020;
REVOKE EXECUTE ON FUNCTION nexo.cancel_020(text,uuid) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.cancel(k text,booking uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE result jsonb;contact text;
BEGIN
 result:=nexo.cancel_020(k,booking);
 SELECT c.contact_code INTO contact FROM nexo.bookings b JOIN nexo.association_contacts c ON c.association_id=b.association_id WHERE b.id=booking;
 RETURN result||jsonb_build_object('contactCode',contact,'contactPending',contact IS NULL,'associationResponsibleForRefund',true,'moneyProcessed',false);
END $$;
GRANT EXECUTE ON FUNCTION nexo.cancel(text,uuid) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

-- A declared route suspension blocks new departures, while an already started run
-- may continue safely. This does not retroactively change legacy permit policies.
ALTER FUNCTION nexo.depart(text,uuid) RENAME TO depart_020;
REVOKE EXECUTE ON FUNCTION nexo.depart_020(text,uuid) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.depart(k text,trip uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;p jsonb:=jsonb_build_object('op','depart','trip',trip);cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF EXISTS(SELECT FROM nexo.route_conditions WHERE route_id=t.route_id AND state='SUSPENDIDA') THEN RAISE EXCEPTION 'ROUTE_CONDITION_BLOCKED';END IF;
 RETURN nexo.depart_020(k,trip);
END $$;
GRANT EXECUTE ON FUNCTION nexo.depart(text,uuid) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
