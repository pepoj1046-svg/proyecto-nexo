-- 4A.4: administrative workflow, never a second operational inventory.
CREATE TABLE nexo.fleet_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL REFERENCES nexo.associations,
 kind text NOT NULL CHECK(kind IN('DRIVER','VEHICLE')),lab_code text NOT NULL CHECK(lab_code~'^LAB-[A-Z0-9_-]{1,40}$'),
 subject_id uuid REFERENCES nexo.identity_accounts(user_id),identity_revision text,
 vehicle_type text,capacity integer,vehicle_id uuid,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')),
 requested_by uuid NOT NULL REFERENCES nexo.users,reason text NOT NULL CHECK(length(trim(reason))BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,vehicle_id)REFERENCES nexo.vehicles(association_id,id),
 CHECK((kind='DRIVER'AND subject_id IS NOT NULL AND identity_revision IS NOT NULL AND vehicle_type IS NULL AND capacity IS NULL AND vehicle_id IS NULL)
 OR(kind='VEHICLE'AND subject_id IS NULL AND identity_revision IS NULL AND vehicle_type IS NOT NULL AND vehicle_type='VAGONETA_6'AND capacity IS NOT NULL AND capacity=6)),
 UNIQUE(association_id,id),UNIQUE(association_id,subject_id)
);
CREATE UNIQUE INDEX fleet_vehicle_code ON nexo.fleet_requests(lab_code)WHERE kind='VEHICLE';
CREATE TABLE nexo.fleet_base_assignments (
 association_id uuid NOT NULL,vehicle_id uuid PRIMARY KEY,driver_id uuid NOT NULL UNIQUE,
 driver_role text NOT NULL DEFAULT 'DRIVER'CHECK(driver_role='DRIVER'),
 FOREIGN KEY(association_id,vehicle_id)REFERENCES nexo.vehicles(association_id,id),
 FOREIGN KEY(association_id,driver_id,driver_role)REFERENCES nexo.memberships(association_id,user_id,role)
);
CREATE TABLE nexo.fleet_admin_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL REFERENCES nexo.associations,
 request_id uuid,actor_id uuid NOT NULL REFERENCES nexo.users,kind text NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))BETWEEN 1 AND 200),details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,request_id)REFERENCES nexo.fleet_requests(association_id,id)
);
CREATE INDEX fleet_requests_association ON nexo.fleet_requests(association_id,kind,id);
CREATE INDEX fleet_admin_events_association ON nexo.fleet_admin_events(association_id,id);
CREATE TRIGGER immutable_fleet_events BEFORE UPDATE OR DELETE ON nexo.fleet_admin_events FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['fleet_requests','fleet_base_assignments','fleet_admin_events']LOOP
 EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON nexo.%I FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance',t);
 END LOOP;
END$$;

CREATE FUNCTION nexo.fleet_identity_revision(subject uuid)RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
 (SELECT to_jsonb(v)FROM nexo.platform_verifications v WHERE user_id=subject),
 (SELECT jsonb_build_array(a.active,a.version)FROM nexo.identity_accounts a WHERE a.user_id=subject),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id),'[]')FROM nexo.identity_events e WHERE e.subject_id=subject AND e.event IN('PLATFORM_LAB_ATTESTED','IDENTITY_ENABLED','IDENTITY_DISABLED','RECOVERED','LOGOUT_ALL'))
 )::text,'UTF8')),'hex')
$$;
CREATE FUNCTION nexo.fleet_revision(association uuid)RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(nexo.platform_revision(association),
 (SELECT coalesce(jsonb_agg(to_jsonb(r)ORDER BY id),'[]')FROM nexo.fleet_requests r WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(a)ORDER BY vehicle_id),'[]')FROM nexo.fleet_base_assignments a),
 (SELECT coalesce(jsonb_agg(to_jsonb(v)ORDER BY id),'[]')FROM nexo.vehicles v WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY association_id,user_id),'[]')FROM nexo.memberships m WHERE role='DRIVER'),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(user_id,active,version)ORDER BY user_id),'[]')FROM nexo.identity_accounts),
 (SELECT coalesce(jsonb_agg(to_jsonb(l)ORDER BY association_id,user_id),'[]')FROM nexo.admin_limits l),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY id),'[]')FROM nexo.fleet_admin_events e),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY id),'[]')FROM nexo.identity_events e WHERE e.event LIKE 'DRIVER_%'),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY id),'[]')FROM nexo.audit_events e)
 )::text,'UTF8')),'hex')
$$;
CREATE FUNCTION nexo.fleet_driver_ready(association uuid,subject uuid)RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.memberships m JOIN nexo.identity_accounts a ON a.user_id=m.user_id AND a.active
 WHERE m.association_id=association AND m.user_id=subject AND m.role='DRIVER'AND m.active)
 AND NOT EXISTS(SELECT FROM nexo.admin_limits WHERE user_id=subject)
$$;
CREATE FUNCTION nexo.fleet_resource_pending(association uuid,vehicle uuid,subject uuid)RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.driver_access_pending(association,subject)
 OR EXISTS(SELECT FROM nexo.memberships m WHERE m.user_id=subject AND m.role='DRIVER'AND nexo.driver_access_pending(m.association_id,subject))
 OR EXISTS(SELECT FROM nexo.trips t WHERE(t.vehicle_id=vehicle OR t.driver_id=subject)AND
 (t.status IN('QUEUED','IN_TRANSIT')OR nexo.observed_onboard(t.id)>0 OR nexo.physical_onboard(t.id)>0
  OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND nexo.live(b))))
 OR EXISTS(SELECT FROM nexo.vehicle_blocks WHERE vehicle_id=vehicle AND blocked)
$$;
CREATE FUNCTION nexo.fleet_actor(association uuid)RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.directory_actor(association);
BEGIN
 IF association IS NULL OR NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;RETURN u;
END$$;
CREATE FUNCTION nexo.web_fleet_context(association uuid)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.fleet_actor(association);
 RETURN jsonb_build_object('associationId',association,'revision',nexo.fleet_revision(association),'capacity',6,'legalVerification',false);
END$$;
CREATE FUNCTION nexo.web_fleet_command(k text,body jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();association uuid;op text:=body->>'kind';p jsonb;cached jsonb;r jsonb;req nexo.fleet_requests;subject uuid;vehicle uuid;prior_driver uuid;code text;blocked boolean:=false;
BEGIN
 -- Do not call directory_actor here: action -> mutex -> scope -> routes -> authority.
 IF jsonb_typeof(body)IS DISTINCT FROM'object'OR op IS NULL OR op NOT IN('REQUEST_DRIVER','REQUEST_VEHICLE','APPROVE','REJECT','ASSIGN','UNASSIGN')
 OR body->'confirmed'IS DISTINCT FROM'true'::jsonb OR jsonb_typeof(body->'reason')IS DISTINCT FROM'string'OR length(trim(body->>'reason'))NOT BETWEEN 1 AND 200
 OR body->>'revision'IS NULL OR body->>'revision'!~'^[a-f0-9]{64}$'
 OR EXISTS(SELECT FROM jsonb_object_keys(body)x WHERE x NOT IN('kind','associationId','identityCode','vehicleCode','vehicleType','capacity','requestId','vehicleId','driverRef','revision','reason','confirmed'))THEN RAISE EXCEPTION 'INVALID_FLEET_COMMAND';END IF;
 association:=(body->>'associationId')::uuid;
 IF association IS NULL OR NOT nexo.has_role(association,'ASSOCIATION_ADMIN')THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 IF (op='REQUEST_DRIVER'AND(body?'vehicleCode'OR body?'vehicleType'OR body?'capacity'OR body?'requestId'OR body?'vehicleId'OR body?'driverRef'))
 OR(op='REQUEST_VEHICLE'AND(body?'identityCode'OR body?'requestId'OR body?'vehicleId'OR body?'driverRef'))
 OR(op IN('APPROVE','REJECT')AND(body?'identityCode'OR body?'vehicleCode'OR body?'vehicleType'OR body?'capacity'OR body?'vehicleId'OR body?'driverRef'))
 OR(op IN('ASSIGN','UNASSIGN')AND(body?'identityCode'OR body?'vehicleCode'OR body?'vehicleType'OR body?'capacity'OR body?'requestId'))
 OR(op='UNASSIGN'AND body?'driverRef')THEN RAISE EXCEPTION 'INVALID_FLEET_COMMAND';END IF;
 p:=jsonb_build_object('op','fleet_admin','body',body);cached:=nexo.action_start(k,p);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('platform-administration:036',0))THEN RAISE EXCEPTION 'FLEET_ADMIN_BUSY';END IF;
 PERFORM nexo.platform_mutex();PERFORM nexo.fleet_actor(association);
 -- Driver memberships span associations; lock routes globally in the native UUID order.
 BEGIN
  PERFORM 1 FROM nexo.routes ORDER BY id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'FLEET_ADMIN_BUSY';END;
 u:=nexo.driver_admin_lock(association);PERFORM nexo.fleet_actor(association);
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF body->>'revision'IS DISTINCT FROM nexo.fleet_revision(association)THEN RAISE EXCEPTION 'STALE_FLEET_STATE';END IF;
 IF op='REQUEST_DRIVER'THEN
  code:=body->>'identityCode';
  IF code IS NULL OR code!~'^LAB-[A-Z0-9_-]{1,40}$'THEN RAISE EXCEPTION 'INVALID_FLEET_IDENTITY';END IF;
  SELECT v.user_id INTO subject FROM nexo.platform_verifications v JOIN nexo.identity_accounts a ON a.user_id=v.user_id AND a.active AND a.version=v.identity_version WHERE v.lab_code=code FOR SHARE OF a;
  IF subject IS NULL OR EXISTS(SELECT FROM nexo.admin_limits WHERE user_id=subject)THEN RAISE EXCEPTION 'INVALID_FLEET_IDENTITY';END IF;
  IF EXISTS(SELECT FROM nexo.memberships WHERE association_id=association AND user_id=subject AND role='DRIVER')
   OR EXISTS(SELECT FROM nexo.fleet_requests WHERE association_id=association AND subject_id=subject)THEN RAISE EXCEPTION 'FLEET_IDENTITY_CONFLICT';END IF;
  INSERT INTO nexo.fleet_requests(association_id,kind,lab_code,subject_id,identity_revision,requested_by,reason)VALUES(association,'DRIVER',code,subject,nexo.fleet_identity_revision(subject),u,body->>'reason')RETURNING * INTO req;
 ELSIF op='REQUEST_VEHICLE'THEN
  code:=body->>'vehicleCode';
  IF code IS NULL OR code!~'^LAB-[A-Z0-9_-]{1,40}$'OR body->>'vehicleType'IS DISTINCT FROM'VAGONETA_6'OR body->'capacity'IS DISTINCT FROM'6'::jsonb THEN RAISE EXCEPTION 'INVALID_FLEET_VEHICLE';END IF;
  IF EXISTS(SELECT FROM nexo.fleet_requests WHERE kind='VEHICLE'AND lab_code=code)OR EXISTS(SELECT FROM nexo.vehicles WHERE upper(trim(label))=code)THEN RAISE EXCEPTION 'FLEET_VEHICLE_CONFLICT';END IF;
  INSERT INTO nexo.fleet_requests(association_id,kind,lab_code,vehicle_type,capacity,requested_by,reason)VALUES(association,'VEHICLE',code,'VAGONETA_6',6,u,body->>'reason')RETURNING * INTO req;
 ELSIF op IN('APPROVE','REJECT')THEN
  SELECT * INTO req FROM nexo.fleet_requests WHERE id=(body->>'requestId')::uuid AND association_id=association FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'INVALID_FLEET_REQUEST';END IF;
  IF req.status<>'PENDING'THEN RAISE EXCEPTION 'FLEET_DECISION_CONFLICT';END IF;
  IF op='APPROVE'THEN
   IF req.kind='DRIVER'THEN
    subject:=req.subject_id;
    PERFORM 1 FROM nexo.identity_accounts WHERE user_id=subject FOR SHARE;
    IF req.identity_revision IS DISTINCT FROM nexo.fleet_identity_revision(subject)
     OR NOT EXISTS(SELECT FROM nexo.platform_verifications v JOIN nexo.identity_accounts a ON a.user_id=v.user_id AND a.active AND a.version=v.identity_version WHERE v.user_id=subject AND v.lab_code=req.lab_code)
     OR EXISTS(SELECT FROM nexo.admin_limits WHERE user_id=subject)THEN RAISE EXCEPTION 'FLEET_IDENTITY_REVIEW_REQUIRED';END IF;
    IF EXISTS(SELECT FROM nexo.memberships WHERE association_id=association AND user_id=subject AND role='DRIVER')THEN RAISE EXCEPTION 'FLEET_IDENTITY_CONFLICT';END IF;
    blocked:=nexo.fleet_resource_pending(association,NULL,subject);
    IF NOT blocked THEN PERFORM nexo.set_driver_membership(association,subject,true,body->>'reason');END IF;
   ELSE
    IF EXISTS(SELECT FROM nexo.vehicles WHERE upper(trim(label))=req.lab_code)THEN RAISE EXCEPTION 'FLEET_VEHICLE_CONFLICT';END IF;
    INSERT INTO nexo.vehicles(association_id,label,capacity)VALUES(association,req.lab_code,6)RETURNING id INTO vehicle;
   END IF;
  END IF;
  IF NOT blocked THEN UPDATE nexo.fleet_requests SET status=CASE WHEN op='APPROVE'THEN'APPROVED'ELSE'REJECTED'END,vehicle_id=vehicle WHERE id=req.id RETURNING * INTO req;END IF;
 ELSE
  vehicle:=(body->>'vehicleId')::uuid;
  PERFORM 1 FROM nexo.vehicles WHERE id=vehicle AND association_id=association FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_FLEET_VEHICLE';END IF;
  SELECT driver_id INTO prior_driver FROM nexo.fleet_base_assignments WHERE vehicle_id=vehicle FOR UPDATE;
  IF prior_driver IS NOT NULL THEN PERFORM 1 FROM nexo.identity_accounts WHERE user_id=prior_driver FOR SHARE;END IF;
  IF op='ASSIGN'THEN
   subject:=(body->>'driverRef')::uuid;
   PERFORM 1 FROM nexo.identity_accounts WHERE user_id=subject FOR SHARE;
   IF body->>'revision'IS DISTINCT FROM nexo.fleet_revision(association)THEN RAISE EXCEPTION 'STALE_FLEET_STATE';END IF;
   IF subject IS NULL OR NOT nexo.fleet_driver_ready(association,subject)THEN RAISE EXCEPTION 'INVALID_FLEET_DRIVER';END IF;
   IF EXISTS(SELECT FROM nexo.fleet_base_assignments WHERE driver_id=subject)THEN RAISE EXCEPTION 'FLEET_ASSIGNMENT_CONFLICT';END IF;
  ELSIF prior_driver IS NULL THEN RAISE EXCEPTION 'FLEET_ASSIGNMENT_CONFLICT';END IF;
  IF body->>'revision'IS DISTINCT FROM nexo.fleet_revision(association)THEN RAISE EXCEPTION 'STALE_FLEET_STATE';END IF;
  blocked:=nexo.fleet_resource_pending(association,vehicle,subject)OR(prior_driver IS NOT NULL AND(NOT nexo.fleet_driver_ready(association,prior_driver)OR nexo.fleet_resource_pending(association,vehicle,prior_driver)));
  -- Route locks stabilize all native operation/access changes; offline identity writers hold the mutex.
  IF NOT blocked THEN
  IF op='ASSIGN'THEN
   INSERT INTO nexo.fleet_base_assignments(association_id,vehicle_id,driver_id)VALUES(association,vehicle,subject)ON CONFLICT(vehicle_id)DO UPDATE SET driver_id=excluded.driver_id;
  ELSE DELETE FROM nexo.fleet_base_assignments WHERE vehicle_id=vehicle;END IF;END IF;
 END IF;
 PERFORM nexo.fleet_actor(association);
 INSERT INTO nexo.fleet_admin_events(association_id,request_id,actor_id,kind,reason,details)VALUES(association,req.id,u,op||CASE WHEN blocked THEN'_REVIEW_REQUIRED'ELSE''END,body->>'reason',jsonb_build_object('subjectRef',subject,'vehicleId',vehicle,'priorDriverRef',prior_driver,'status',req.status,'applied',NOT blocked,'reviewRequired',blocked));
 PERFORM nexo.audit(association,'FLEET_ADMIN_'||op||CASE WHEN blocked THEN'_REVIEW_REQUIRED'ELSE''END,coalesce(req.id,vehicle));
 r:=jsonb_build_object('requestId',req.id,'status',req.status,'subjectRef',subject,'vehicleId',vehicle,'kind',op,'applied',NOT blocked,'reviewRequired',blocked,'legalVerification',false);
 RETURN nexo.action_finish(k,p,r);
END$$;

CREATE FUNCTION nexo.fleet_rows(association uuid,section text)RETURNS TABLE(key text,item jsonb)LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF section IN('DRIVERS','VEHICLES')THEN
 RETURN QUERY SELECT r.id::text,jsonb_build_object('id',r.id,'kind',r.kind,'code',r.lab_code,'status',r.status,'subjectRef',r.subject_id,'vehicleId',r.vehicle_id,'capacity',r.capacity,'vehicleType',r.vehicle_type,'actorRef',r.requested_by,'reason',r.reason,'createdAt',r.created_at)
 FROM nexo.fleet_requests r WHERE r.association_id=association AND r.kind=CASE WHEN section='DRIVERS'THEN'DRIVER'ELSE'VEHICLE'END;
 ELSIF section='ASSIGNMENTS'THEN
 RETURN QUERY SELECT v.id::text,jsonb_build_object('id',v.id,'code',v.label,'driverRef',a.driver_id,'driverLabel',u.label,'capacity',v.capacity,'reviewRequired',nexo.fleet_resource_pending(association,v.id,a.driver_id)OR(a.driver_id IS NOT NULL AND NOT nexo.fleet_driver_ready(association,a.driver_id)),'administrativeOnly',true)
 FROM nexo.vehicles v LEFT JOIN nexo.fleet_base_assignments a ON a.vehicle_id=v.id LEFT JOIN nexo.users u ON u.id=a.driver_id WHERE v.association_id=association;
 ELSIF section='HISTORY'THEN
 RETURN QUERY SELECT e.id::text,jsonb_build_object('id',e.id,'requestId',e.request_id,'actorRef',e.actor_id,'kind',e.kind,'reason',e.reason,'details',e.details,'createdAt',e.created_at)FROM nexo.fleet_admin_events e WHERE e.association_id=association;
 ELSE RAISE EXCEPTION 'INVALID_FLEET_SECTION';END IF;
END$$;

CREATE FUNCTION nexo.web_fleet_page(association uuid,section text,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL)RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;scope_key text;permissions text;revision text;total bigint;items jsonb;tail text;more boolean;cursor_exists boolean;
BEGIN
 u:=nexo.fleet_actor(association);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 permissions:=nexo.directory_permissions();scope_key:=encode(sha256(convert_to(u::text||':'||current_setting('nexo.session_token',true)||':'||association||':'||section||':FLEET:'||page_size,'UTF8')),'hex');
 IF page_cursor IS NOT NULL THEN
  IF jsonb_typeof(page_cursor)<>'object'OR(SELECT count(*)FROM jsonb_object_keys(page_cursor))<>6 OR NOT(page_cursor?&ARRAY['v','scope','permissions','revision','size','key'])
   OR page_cursor->>'v'IS DISTINCT FROM'1'OR page_cursor->>'size'IS DISTINCT FROM page_size::text OR page_cursor->>'scope'IS DISTINCT FROM scope_key
   OR jsonb_typeof(page_cursor->'v')<>'number'OR jsonb_typeof(page_cursor->'size')<>'number'OR jsonb_typeof(page_cursor->'key')<>'string'
   OR jsonb_typeof(page_cursor->'revision')<>'string'OR jsonb_typeof(page_cursor->'permissions')<>'string'OR length(page_cursor->>'key')NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
  IF page_cursor->>'permissions'IS DISTINCT FROM permissions THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 END IF;
 WITH all_rows AS MATERIALIZED(SELECT * FROM nexo.fleet_rows(association,section)),
 page AS MATERIALIZED(SELECT * FROM all_rows WHERE page_cursor IS NULL OR key>page_cursor->>'key'ORDER BY key LIMIT page_size+1),
 numbered AS(SELECT *,row_number()OVER(ORDER BY key)n FROM page)
 SELECT(SELECT count(*)FROM all_rows),(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(key,item)ORDER BY key),'[]')::text,'UTF8')),'hex')FROM all_rows),
 coalesce(jsonb_agg(item ORDER BY key)FILTER(WHERE n<=page_size),'[]'),max(key)FILTER(WHERE n<=page_size),count(*)>page_size,
 CASE WHEN page_cursor IS NULL THEN true ELSE EXISTS(SELECT FROM all_rows WHERE key=page_cursor->>'key')END
 INTO total,revision,items,tail,more,cursor_exists FROM numbered;
 IF page_cursor IS NOT NULL AND(page_cursor->>'revision'IS DISTINCT FROM revision OR NOT cursor_exists)THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 PERFORM nexo.fleet_actor(association);IF permissions IS DISTINCT FROM nexo.directory_permissions()THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 RETURN jsonb_build_object('items',items,'total',total,'limit',page_size,'nextCursor',CASE WHEN more THEN jsonb_build_object('v',1,'scope',scope_key,'permissions',permissions,'revision',revision,'size',page_size,'key',tail)ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION nexo.fleet_driver_ready(uuid,uuid),nexo.fleet_identity_revision(uuid),nexo.fleet_revision(uuid),nexo.fleet_resource_pending(uuid,uuid,uuid),nexo.fleet_actor(uuid),nexo.fleet_rows(uuid,text),nexo.web_fleet_context(uuid),nexo.web_fleet_command(text,jsonb),nexo.web_fleet_page(uuid,text,integer,jsonb)FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_fleet_context(uuid),nexo.web_fleet_command(text,jsonb),nexo.web_fleet_page(uuid,text,integer,jsonb)TO nexo_app;
