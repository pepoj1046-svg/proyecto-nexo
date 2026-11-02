-- 4A.2: existing DRIVER administration. No replacement inventory or provisioning pool.
CREATE FUNCTION nexo.driver_access_pending(association uuid,subject uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.trips t WHERE t.association_id=association AND t.driver_id=subject
  AND(t.status IN('QUEUED','IN_TRANSIT')OR nexo.observed_onboard(t.id)>0 OR nexo.physical_onboard(t.id)>0
   OR(t.status='WITHDRAWN'AND EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND nexo.live(b)))))
 -- Old replacement records do not always retain the original driver. Until a
 -- custody contract resolves that ambiguity, pending association custody blocks
 -- access changes conservatively, including an original driver no longer on t.
 OR EXISTS(SELECT FROM nexo.fleet_incidents f WHERE f.association_id=association AND f.state NOT IN('TRANSFERRED','CLEARED'))
 OR EXISTS(SELECT FROM nexo.terminal_handoffs h WHERE h.association_id=association
  AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id))
 OR EXISTS(SELECT FROM nexo.road_rescues r WHERE r.association_id=association AND r.phase<>'TRANSFERRED')
$$;

CREATE FUNCTION nexo.driver_admin_lock(association uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.directory_actor(association);
BEGIN
 IF association IS NULL OR NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 -- All operational writers take route first. Never retain session/member locks
 -- while waiting for a route, and always acquire multiple routes in UUID order.
 PERFORM 1 FROM nexo.routes WHERE association_id=association ORDER BY id FOR UPDATE;
 PERFORM nexo.directory_actor(association);
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u AND active FOR SHARE;
 PERFORM 1 FROM nexo.sessions s WHERE s.user_id=u AND s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')
  AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=association AND user_id=u AND role='ASSOCIATION_ADMIN'AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM nexo.directory_actor(association);
 RETURN u;
END $$;

-- Preserve the trusted legacy UPSERT contract; the new web RPC below never
-- permits creation. Harden every existing caller against abandoning a service.
CREATE OR REPLACE FUNCTION nexo.set_driver_membership(association uuid,subject uuid,enabled boolean,reason text)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.driver_admin_lock(association);
 IF enabled IS NULL OR reason IS NULL OR length(trim(reason))NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_MEMBERSHIP';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=association AND user_id=subject AND role='DRIVER'FOR UPDATE;
 PERFORM nexo.directory_actor(association);
 IF enabled AND EXISTS(SELECT FROM nexo.identity_accounts WHERE user_id=subject AND NOT active)THEN RAISE EXCEPTION 'INVALID_DRIVER_IDENTITY';END IF;
 IF nexo.driver_access_pending(association,subject)THEN RAISE EXCEPTION 'DRIVER_SERVICE_REVIEW_REQUIRED';END IF;
 RETURN nexo.scope_core_set_driver_membership(association,subject,enabled,reason);
END $$;

-- Remove the old single-route-before-all-routes inversion, retaining its API.
CREATE OR REPLACE FUNCTION nexo.care_account_command(k text,trip uuid,subject uuid,enabled boolean,reason_code text,confirmed boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;PERFORM nexo.check_scope(NULL);
 IF t.id IS NULL OR NOT nexo.manage_route(t.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR enabled IS NULL OR reason_code IS NULL OR reason_code NOT IN('ACCESS_REVIEW','ACCESS_REVOKED','ACCESS_RESTORED')
  OR NOT EXISTS(SELECT FROM nexo.memberships WHERE association_id=t.association_id AND user_id=subject AND role='DRIVER')THEN RAISE EXCEPTION 'INVALID_ACCOUNT_COMMAND';END IF;
 p:=jsonb_build_object('op','care_account','trip',trip,'user',subject,'enabled',enabled,'reason',reason_code);cached:=nexo.action_start(k,p);
 PERFORM nexo.driver_admin_lock(t.association_id);
 IF NOT nexo.manage_route(t.route_id)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM nexo.set_driver_membership(t.association_id,subject,enabled,reason_code);PERFORM nexo.audit(t.association_id,'CARE_DRIVER_ACCESS_CHANGED',subject);
 RETURN nexo.action_finish(k,p,jsonb_build_object('userRef',subject,'active',enabled,'automaticAssociationAccess',false));
END $$;

CREATE OR REPLACE FUNCTION nexo.set_association_contact(k text,association uuid,code text,confirmed boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE p jsonb;cached jsonb;u uuid;
BEGIN
 PERFORM nexo.directory_actor(association);PERFORM nexo.check_scope(NULL);
 IF confirmed IS DISTINCT FROM true OR code IS NULL OR code !~ '^LAB-[A-Z0-9_-]{1,40}$'THEN RAISE EXCEPTION 'INVALID_SYNTHETIC_CONTACT';END IF;
 p:=jsonb_build_object('op','association_contact','association',association,'code',code);cached:=nexo.action_start(k,p);
 -- Match route -> association order used by the operational core. Revalidate
 -- real expiry and stabilize authority after all waits, also on a receipt.
 PERFORM 1 FROM nexo.routes WHERE association_id=association ORDER BY id FOR UPDATE;
 PERFORM 1 FROM nexo.associations WHERE id=association FOR UPDATE;
 u:=nexo.driver_admin_lock(association);
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 INSERT INTO nexo.association_contacts VALUES(association,code,u,clock_timestamp())ON CONFLICT(association_id)DO UPDATE
  SET contact_code=excluded.contact_code,actor_id=excluded.actor_id,updated_at=excluded.updated_at;
 INSERT INTO nexo.identity_events(actor_id,subject_id,association_id,event,reason)VALUES(u,u,association,'CONTACT_UPDATED','Contacto ficticio: '||code);
 PERFORM nexo.audit(association,'CONTACT_UPDATED',association);
 RETURN nexo.action_finish(k,p,jsonb_build_object('contactCode',code,'synthetic',true));
END $$;

CREATE FUNCTION nexo.driver_admin_revision(association uuid,subject uuid)RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
  (SELECT to_jsonb(m)FROM nexo.memberships m WHERE m.association_id=association AND m.user_id=subject AND m.role='DRIVER'),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(e.id,e.event)ORDER BY e.id),'[]')FROM nexo.identity_events e
   WHERE e.association_id=association AND e.subject_id=subject AND e.event IN('DRIVER_ENABLED','DRIVER_DISABLED'))
 )::text,'UTF8')),'hex')
$$;

CREATE FUNCTION nexo.web_driver_admin_context(association uuid,subject uuid DEFAULT NULL)RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE member jsonb;contact jsonb;
BEGIN
 PERFORM nexo.directory_actor(association);IF association IS NULL OR NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 IF subject IS NOT NULL THEN
  SELECT jsonb_build_object('id',m.user_id,'label',u.label,'active',m.active,'revision',nexo.driver_admin_revision(association,subject),
   'reviewRequired',nexo.driver_access_pending(association,subject))INTO member
  FROM nexo.memberships m JOIN nexo.users u ON u.id=m.user_id WHERE m.association_id=association AND m.user_id=subject AND m.role='DRIVER';
  IF member IS NULL THEN RAISE EXCEPTION 'INVALID_EXISTING_DRIVER';END IF;
 END IF;
 SELECT jsonb_build_object('code',c.contact_code,'updatedAt',c.updated_at)INTO contact FROM nexo.association_contacts c WHERE c.association_id=association;
 PERFORM nexo.directory_actor(association);
 RETURN jsonb_build_object('associationId',association,'member',member,'contact',contact,'existingOnly',true,'synthetic',true,'legalVerification',false);
END $$;

CREATE FUNCTION nexo.web_driver_admin_command(k text,association uuid,subject uuid,enabled boolean,expected_revision text,reason text,confirmed boolean)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;p jsonb;cached jsonb;current_active boolean;r jsonb;
BEGIN
 u:=nexo.directory_actor(association);IF association IS NULL OR NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 IF confirmed IS DISTINCT FROM true OR enabled IS NULL OR expected_revision IS NULL OR expected_revision!~'^[a-f0-9]{64}$'
  OR reason IS NULL OR length(trim(reason))NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_DRIVER_COMMAND';END IF;
 p:=jsonb_build_object('op','existing_driver_access','association',association,'subject',subject,'enabled',enabled,'revision',expected_revision,'reason',reason);
 cached:=nexo.action_start(k,p);PERFORM nexo.driver_admin_lock(association);
 SELECT active INTO current_active FROM nexo.memberships WHERE association_id=association AND user_id=subject AND role='DRIVER'FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_EXISTING_DRIVER';END IF;
 PERFORM nexo.directory_actor(association);
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF expected_revision IS DISTINCT FROM nexo.driver_admin_revision(association,subject)THEN RAISE EXCEPTION 'STALE_DRIVER_ACCESS';END IF;
 IF current_active=enabled THEN RAISE EXCEPTION 'INVALID_DRIVER_COMMAND';END IF;
 IF nexo.driver_access_pending(association,subject)THEN
  INSERT INTO nexo.identity_events(actor_id,subject_id,association_id,event,reason)VALUES(u,subject,association,'DRIVER_ACCESS_REVIEW_REQUIRED',reason);
  PERFORM nexo.audit(association,'DRIVER_ACCESS_REVIEW_REQUIRED',subject);
  r:=jsonb_build_object('userRef',subject,'active',current_active,'applied',false,'reviewRequired',true,'reasonCode','DRIVER_SERVICE_REVIEW_REQUIRED');
 ELSE
  PERFORM nexo.set_driver_membership(association,subject,enabled,reason);PERFORM nexo.audit(association,'DIRECTORY_DRIVER_ACCESS_CHANGED',subject);
  r:=jsonb_build_object('userRef',subject,'active',enabled,'applied',true,'reviewRequired',false,'automaticAssociationAccess',false,'vehicleOrQueueRestored',false);
 END IF;
 RETURN nexo.action_finish(k,p,r);
END $$;

CREATE FUNCTION nexo.driver_admin_history_rows(association uuid,subject uuid)RETURNS TABLE(key text,item jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT e.id::text,jsonb_build_object('id',e.id,'actorRef',e.actor_id,'subjectRef',e.subject_id,'event',e.event,'reason',e.reason,'createdAt',e.created_at)
 FROM nexo.identity_events e WHERE e.association_id=association
  AND e.event IN('DRIVER_ENABLED','DRIVER_DISABLED','DRIVER_ACCESS_REVIEW_REQUIRED','CONTACT_UPDATED')
  AND(subject IS NULL OR(e.subject_id=subject AND e.event<>'CONTACT_UPDATED'))
 UNION ALL
 SELECT e.id::text,jsonb_build_object('id',e.id,'actorRef',e.actor_id,'subjectRef',NULL,'event',e.action,'reason','Actuación histórica sin motivo detallado','createdAt',e.created_at)
 FROM nexo.audit_events e WHERE e.association_id=association AND subject IS NULL AND e.action='CONTACT_UPDATED'
 AND NOT EXISTS(SELECT FROM nexo.identity_events i WHERE i.association_id=e.association_id AND i.actor_id=e.actor_id AND i.created_at=e.created_at AND i.event='CONTACT_UPDATED')
$$;

CREATE FUNCTION nexo.web_driver_admin_history(association uuid,subject uuid,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL)RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;scope_key text;permissions text;revision text;total bigint;items jsonb;tail text;more boolean;cursor_exists boolean;
BEGIN
 u:=nexo.directory_actor(association);IF association IS NULL OR NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 IF subject IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.memberships WHERE association_id=association AND user_id=subject AND role='DRIVER')THEN RAISE EXCEPTION 'INVALID_EXISTING_DRIVER';END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 permissions:=nexo.directory_permissions();scope_key:=encode(sha256(convert_to(u::text||':'||current_setting('nexo.session_token',true)||':'||association||':'||coalesce(subject::text,'ALL')||':DRIVER_HISTORY:'||page_size,'UTF8')),'hex');
 IF page_cursor IS NOT NULL THEN
  IF jsonb_typeof(page_cursor)<>'object'OR(SELECT count(*)FROM jsonb_object_keys(page_cursor))<>6 OR NOT(page_cursor?&ARRAY['v','scope','permissions','revision','size','key'])
   OR page_cursor->>'v'IS DISTINCT FROM'1'OR page_cursor->>'size'IS DISTINCT FROM page_size::text OR page_cursor->>'scope'IS DISTINCT FROM scope_key
   OR jsonb_typeof(page_cursor->'v')<>'number'OR jsonb_typeof(page_cursor->'size')<>'number'OR jsonb_typeof(page_cursor->'key')<>'string'
   OR jsonb_typeof(page_cursor->'revision')<>'string'OR jsonb_typeof(page_cursor->'permissions')<>'string'OR length(page_cursor->>'key')NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
  IF page_cursor->>'permissions'IS DISTINCT FROM permissions THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 END IF;
 WITH all_rows AS MATERIALIZED(SELECT * FROM nexo.driver_admin_history_rows(association,subject)),
 page AS MATERIALIZED(SELECT * FROM all_rows WHERE page_cursor IS NULL OR key>page_cursor->>'key'ORDER BY key LIMIT page_size+1),
 numbered AS(SELECT *,row_number()OVER(ORDER BY key)n FROM page)
 SELECT(SELECT count(*)FROM all_rows),(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(key,item)ORDER BY key),'[]')::text,'UTF8')),'hex')FROM all_rows),
 coalesce(jsonb_agg(item ORDER BY key)FILTER(WHERE n<=page_size),'[]'),max(key)FILTER(WHERE n<=page_size),count(*)>page_size,
 CASE WHEN page_cursor IS NULL THEN true ELSE EXISTS(SELECT FROM all_rows WHERE key=page_cursor->>'key')END
 INTO total,revision,items,tail,more,cursor_exists FROM numbered;
 IF page_cursor IS NOT NULL AND(page_cursor->>'revision'IS DISTINCT FROM revision OR NOT cursor_exists)THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 PERFORM nexo.directory_actor(association);IF permissions IS DISTINCT FROM nexo.directory_permissions()THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 RETURN jsonb_build_object('items',items,'total',total,'limit',page_size,'nextCursor',CASE WHEN more THEN jsonb_build_object('v',1,'scope',scope_key,'permissions',permissions,'revision',revision,'size',page_size,'key',tail)ELSE NULL END);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.driver_access_pending(uuid,uuid),nexo.driver_admin_lock(uuid),nexo.driver_admin_revision(uuid,uuid),nexo.driver_admin_history_rows(uuid,uuid),
 nexo.web_driver_admin_context(uuid,uuid),nexo.web_driver_admin_command(text,uuid,uuid,boolean,text,text,boolean),nexo.web_driver_admin_history(uuid,uuid,integer,jsonb)FROM PUBLIC,nexo_app;
GRANT EXECUTE ON FUNCTION nexo.web_driver_admin_context(uuid,uuid),nexo.web_driver_admin_command(text,uuid,uuid,boolean,text,text,boolean),nexo.web_driver_admin_history(uuid,uuid,integer,jsonb)TO nexo_app;
