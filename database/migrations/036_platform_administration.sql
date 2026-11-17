-- 4A.3: closed platform authority; no operational role, RLS or inventory bypass.
CREATE TABLE nexo.platform_bootstrap (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 user_id uuid NOT NULL UNIQUE REFERENCES nexo.identity_accounts(user_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.platform_verifications (
 user_id uuid PRIMARY KEY REFERENCES nexo.identity_accounts(user_id),
 lab_code text UNIQUE NOT NULL CHECK(lab_code ~ '^LAB-[A-Z0-9_-]{1,40}$'),
 identity_version integer NOT NULL, reason text NOT NULL CHECK(length(trim(reason))BETWEEN 1 AND 200),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.platform_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES nexo.users,
 association_id uuid REFERENCES nexo.associations,subject_id uuid REFERENCES nexo.users,
 event text NOT NULL,reason text NOT NULL CHECK(length(trim(reason))BETWEEN 1 AND 200),
 details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.platform_associations (
 association_id uuid PRIMARY KEY REFERENCES nexo.associations,
 lab_code text UNIQUE NOT NULL CHECK(lab_code ~ '^LAB-[A-Z0-9_-]{1,40}$')
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_bootstrap','platform_verifications','platform_events','platform_associations']LOOP
 EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END$$;
CREATE TRIGGER immutable_platform_events BEFORE UPDATE OR DELETE ON nexo.platform_events FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
CREATE TRIGGER irreversible_platform_bootstrap BEFORE UPDATE OR DELETE ON nexo.platform_bootstrap FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
CREATE INDEX platform_event_association ON nexo.platform_events(association_id,id);

CREATE FUNCTION nexo.platform_mutex()RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'UNSUPPORTED_ISOLATION_USE_READ_COMMITTED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('platform-administration:036',0));
END$$;
CREATE FUNCTION nexo.platform_actor()RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'THEN RAISE EXCEPTION 'UNSUPPORTED_ISOLATION_USE_READ_COMMITTED';END IF;
 SELECT s.user_id INTO u FROM nexo.sessions s JOIN nexo.identity_accounts i ON i.user_id=s.user_id AND i.active
 WHERE s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp();
 IF u IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 IF NOT EXISTS(SELECT FROM nexo.platform_bootstrap b WHERE b.user_id=u)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN u;
END$$;
CREATE FUNCTION nexo.platform_actor_lock()RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.platform_actor();
BEGIN
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u AND active FOR SHARE;
 PERFORM 1 FROM nexo.sessions WHERE token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')FOR SHARE;
 RETURN nexo.platform_actor();
END$$;
-- Offline-only attestation, never a browser claim or official identity check.
CREATE FUNCTION nexo.platform_verify_identity(subject uuid,code text,reason text,confirmed boolean)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE v integer;
BEGIN
 IF confirmed IS DISTINCT FROM true OR code IS NULL OR code!~'^LAB-[A-Z0-9_-]{1,40}$'OR reason IS NULL OR length(trim(reason))NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_PLATFORM_IDENTITY';END IF;
 PERFORM nexo.platform_mutex();SELECT version INTO v FROM nexo.identity_accounts WHERE user_id=subject AND active FOR SHARE;
 IF v IS NULL THEN RAISE EXCEPTION 'INVALID_PLATFORM_IDENTITY';END IF;
 INSERT INTO nexo.platform_verifications(user_id,lab_code,identity_version,reason)VALUES(subject,code,v,reason)
 ON CONFLICT(user_id)DO UPDATE SET lab_code=excluded.lab_code,identity_version=excluded.identity_version,reason=excluded.reason,verified_at=clock_timestamp();
 INSERT INTO nexo.identity_events(subject_id,event,reason)VALUES(subject,'PLATFORM_LAB_ATTESTED',reason);
 RETURN true;
END$$;
CREATE FUNCTION nexo.bootstrap_platform(login text,password_hash text,reason text,confirmed boolean)RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE subject uuid;
BEGIN
 IF confirmed IS DISTINCT FROM true OR reason IS NULL OR length(trim(reason))NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_PLATFORM_BOOTSTRAP';END IF;
 PERFORM nexo.platform_mutex();
 IF EXISTS(SELECT FROM nexo.platform_bootstrap)THEN RAISE EXCEPTION 'BOOTSTRAP_CLOSED';END IF;
 subject:=nexo.register_identity(login,password_hash);
 PERFORM nexo.platform_verify_identity(subject,'LAB-PLATFORM-OWNER',reason,true);
 INSERT INTO nexo.platform_bootstrap(user_id)VALUES(subject);
 INSERT INTO nexo.platform_events(actor_id,subject_id,event,reason)VALUES(subject,subject,'PLATFORM_BOOTSTRAPPED',reason);
 RETURN subject;
END$$;

-- Full scope is conservative across the whole account, as scope_allows already is.
-- Legacy rows without a managed login never count as a recoverable alternative.
CREATE FUNCTION nexo.platform_effective_admins(association uuid)RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT count(*)FROM nexo.memberships m JOIN nexo.identity_accounts a ON a.user_id=m.user_id
 WHERE m.association_id=association AND m.role='ASSOCIATION_ADMIN'AND m.active AND a.active
 AND NOT EXISTS(SELECT FROM nexo.admin_limits l WHERE l.user_id=m.user_id)
$$;
CREATE FUNCTION nexo.platform_protected_associations(subject uuid)RETURNS uuid[] LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(array_agg(m.association_id ORDER BY m.association_id),'{}'::uuid[])FROM nexo.memberships m
 WHERE m.user_id=subject AND m.role='ASSOCIATION_ADMIN'AND m.active AND nexo.platform_effective_admins(m.association_id)>0
$$;
CREATE FUNCTION nexo.platform_check_last(associations uuid[])RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT FROM unnest(associations)a WHERE nexo.platform_effective_admins(a)=0)THEN RAISE EXCEPTION 'LAST_ADMIN_PROTECTED';END IF;
END$$;
-- Preserve trusted signatures/ACL; even offline contracts cannot silently orphan admins.
ALTER FUNCTION nexo.provision_role(uuid,uuid,text,boolean,text)RENAME TO platform_core_provision_role;
REVOKE ALL ON FUNCTION nexo.platform_core_provision_role(uuid,uuid,text,boolean,text)FROM PUBLIC,nexo_app,nexo_provisioner;
CREATE FUNCTION nexo.provision_role(subject uuid,association uuid,requested_role text,enabled boolean,reason text)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE protected uuid[];r boolean;
BEGIN
 PERFORM nexo.platform_mutex();PERFORM pg_advisory_xact_lock(hashtextextended('admin-scope:'||subject::text,0));
 protected:=nexo.platform_protected_associations(subject);
 r:=nexo.platform_core_provision_role(subject,association,requested_role,enabled,reason);
 PERFORM nexo.platform_check_last(protected);RETURN r;
END$$;
ALTER FUNCTION nexo.configure_admin_scope(uuid,uuid,uuid[],boolean)RENAME TO platform_core_configure_admin_scope;
REVOKE ALL ON FUNCTION nexo.platform_core_configure_admin_scope(uuid,uuid,uuid[],boolean)FROM PUBLIC,nexo_app,nexo_provisioner;
CREATE FUNCTION nexo.configure_admin_scope(subject uuid,association uuid,routes uuid[],restricted boolean)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE protected uuid[];r boolean;
BEGIN
 PERFORM nexo.platform_mutex();PERFORM pg_advisory_xact_lock(hashtextextended('admin-scope:'||subject::text,0));protected:=nexo.platform_protected_associations(subject);
 r:=nexo.platform_core_configure_admin_scope(subject,association,routes,restricted);PERFORM nexo.platform_check_last(protected);RETURN r;
END$$;
ALTER FUNCTION nexo.set_identity_active(uuid,boolean,text)RENAME TO platform_core_set_identity_active;
REVOKE ALL ON FUNCTION nexo.platform_core_set_identity_active(uuid,boolean,text)FROM PUBLIC,nexo_app,nexo_provisioner;
CREATE FUNCTION nexo.set_identity_active(subject uuid,enabled boolean,reason text)RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE protected uuid[];r boolean;
BEGIN
 PERFORM nexo.platform_mutex();PERFORM pg_advisory_xact_lock(hashtextextended('admin-scope:'||subject::text,0));
 IF enabled IS DISTINCT FROM true AND EXISTS(SELECT FROM nexo.platform_bootstrap WHERE user_id=subject)THEN RAISE EXCEPTION 'LAST_PLATFORM_ADMIN_PROTECTED';END IF;
 protected:=nexo.platform_protected_associations(subject);r:=nexo.platform_core_set_identity_active(subject,enabled,reason);
 PERFORM nexo.platform_check_last(protected);RETURN r;
END$$;
GRANT EXECUTE ON FUNCTION nexo.provision_role(uuid,uuid,text,boolean,text),nexo.configure_admin_scope(uuid,uuid,uuid[],boolean),nexo.set_identity_active(uuid,boolean,text),
 nexo.platform_verify_identity(uuid,text,text,boolean),nexo.bootstrap_platform(text,text,text,boolean)TO nexo_provisioner;

CREATE FUNCTION nexo.platform_revision(association uuid)RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
 (SELECT to_jsonb(a)FROM nexo.associations a WHERE a.id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY m.user_id),'[]')FROM nexo.memberships m WHERE m.association_id=association AND m.role='ASSOCIATION_ADMIN'),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.user_id,a.active,a.version)ORDER BY a.user_id),'[]')FROM nexo.identity_accounts a WHERE EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=association AND m.user_id=a.user_id AND m.role='ASSOCIATION_ADMIN')),
 (SELECT coalesce(jsonb_agg(to_jsonb(l)ORDER BY l.association_id,l.user_id),'[]')FROM nexo.admin_limits l WHERE EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=association AND m.user_id=l.user_id AND m.role='ASSOCIATION_ADMIN')),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id),'[]')FROM nexo.platform_events e WHERE e.association_id=association),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id),'[]')FROM nexo.identity_events e WHERE e.subject_id IN(SELECT m.user_id FROM nexo.memberships m WHERE m.association_id=association AND m.role='ASSOCIATION_ADMIN')AND(e.event LIKE 'ASSOCIATION_ADMIN_%'OR e.event LIKE 'ADMIN_SCOPE_%'OR e.event LIKE 'ADMIN_ROUTE_%'))
 )::text,'UTF8')),'hex')
$$;
CREATE FUNCTION nexo.web_platform_context(association uuid DEFAULT NULL)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.platform_actor();a jsonb;members jsonb;
BEGIN
 IF association IS NOT NULL THEN
 SELECT jsonb_build_object('id',id,'name',name,'commercialStatus',status,'adherenceStatus',adherence_status,'operatingStatus',operating_status,'revision',nexo.platform_revision(id))INTO a FROM nexo.associations WHERE id=association;
 IF a IS NULL THEN RAISE EXCEPTION 'INVALID_ASSOCIATION';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('userRef',m.user_id,'label',x.label,'identityCode',(SELECT v.lab_code FROM nexo.platform_verifications v WHERE v.user_id=m.user_id),'active',m.active,'identityActive',coalesce(i.active,true),'fullScope',NOT EXISTS(SELECT FROM nexo.admin_limits l WHERE l.user_id=m.user_id))ORDER BY m.user_id),'[]')INTO members FROM nexo.memberships m JOIN nexo.users x ON x.id=m.user_id LEFT JOIN nexo.identity_accounts i ON i.user_id=m.user_id WHERE m.association_id=association AND m.role='ASSOCIATION_ADMIN';
 END IF;
 PERFORM nexo.platform_actor();RETURN jsonb_build_object('authority','GENERAL_ADMIN','accountRef',u,'association',a,'administrators',coalesce(members,'[]'),'legalVerification',false,'stateActivationEnabled',false);
END$$;
CREATE FUNCTION nexo.web_platform_command(k text,body jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.platform_actor();op text:=body->>'kind';association uuid;subject uuid;cached jsonb;r jsonb;active_now boolean;
BEGIN
 IF jsonb_typeof(body)<>'object'OR body->'confirmed'IS DISTINCT FROM'true'::jsonb OR body->>'reason'IS NULL OR length(trim(body->>'reason'))NOT BETWEEN 1 AND 200 OR op IS NULL OR op NOT IN('REGISTER','DELEGATE','REVOKE','STATE_REVIEW')THEN RAISE EXCEPTION 'INVALID_PLATFORM_COMMAND';END IF;
 IF EXISTS(SELECT FROM jsonb_object_keys(body)x WHERE x NOT IN('kind','associationId','labCode','name','identityCode','revision','reason','confirmed'))THEN RAISE EXCEPTION 'INVALID_PLATFORM_COMMAND';END IF;
 cached:=nexo.action_start(k,jsonb_build_object('op','platform_admin','body',body));
 PERFORM nexo.platform_mutex();u:=nexo.platform_actor_lock();
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF op='REGISTER'THEN
 IF body->>'labCode'IS NULL OR body->>'labCode'!~'^LAB-[A-Z0-9_-]{1,40}$'OR body->>'name'IS NULL OR body->>'name'!~'^LAB-[A-Z0-9 _-]{1,80}$'OR body?'associationId'OR body?'identityCode'OR body?'revision'THEN RAISE EXCEPTION 'INVALID_PLATFORM_ASSOCIATION';END IF;
 IF EXISTS(SELECT FROM nexo.platform_associations WHERE lab_code=body->>'labCode')THEN RAISE EXCEPTION 'ASSOCIATION_CODE_CONFLICT';END IF;
 INSERT INTO nexo.associations(name,status,adherence_status,operating_status)VALUES(body->>'name','SUSPENDED','PENDING','SUSPENDED')RETURNING id INTO association;
 INSERT INTO nexo.platform_associations VALUES(association,body->>'labCode');
 ELSE
 IF body?'labCode'OR body?'name'OR(op='STATE_REVIEW'AND body?'identityCode')THEN RAISE EXCEPTION 'INVALID_PLATFORM_COMMAND';END IF;
 association:=(body->>'associationId')::uuid;
 IF association IS NULL OR body->>'revision'IS DISTINCT FROM nexo.platform_revision(association)THEN RAISE EXCEPTION 'STALE_PLATFORM_STATE';END IF;
 IF NOT EXISTS(SELECT FROM nexo.associations WHERE id=association)THEN RAISE EXCEPTION 'INVALID_ASSOCIATION';END IF;
 IF op IN('DELEGATE','REVOKE')THEN
 SELECT v.user_id INTO subject FROM nexo.platform_verifications v JOIN nexo.identity_accounts a ON a.user_id=v.user_id AND(op='REVOKE'OR(a.active AND a.version=v.identity_version))WHERE v.lab_code=body->>'identityCode';
 IF subject IS NULL OR subject=u OR EXISTS(SELECT FROM nexo.platform_bootstrap WHERE user_id=subject)THEN RAISE EXCEPTION 'INVALID_PLATFORM_IDENTITY';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-scope:'||subject::text,0));
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=subject AND active FOR SHARE;
 IF NOT EXISTS(SELECT FROM nexo.platform_verifications v JOIN nexo.identity_accounts a ON a.user_id=v.user_id AND(op='REVOKE'OR(a.active AND a.version=v.identity_version))WHERE v.user_id=subject AND v.lab_code=body->>'identityCode')THEN RAISE EXCEPTION 'INVALID_PLATFORM_IDENTITY';END IF;
 PERFORM nexo.platform_actor();
 IF body->>'revision'IS DISTINCT FROM nexo.platform_revision(association)THEN RAISE EXCEPTION 'STALE_PLATFORM_STATE';END IF;
 IF op='DELEGATE'AND EXISTS(SELECT FROM nexo.admin_limits WHERE user_id=subject)THEN RAISE EXCEPTION 'ADMIN_SCOPE_REVIEW_REQUIRED';END IF;
 SELECT active INTO active_now FROM nexo.memberships WHERE association_id=association AND user_id=subject AND role='ASSOCIATION_ADMIN';
 IF coalesce(active_now,false)=(op='DELEGATE')THEN RAISE EXCEPTION 'ADMIN_DECISION_CONFLICT';END IF;
 PERFORM nexo.provision_role(subject,association,'ASSOCIATION_ADMIN',op='DELEGATE',body->>'reason');
 END IF;
 END IF;
 -- No state activation: review records do not mutate commercial/operational facts.
 INSERT INTO nexo.platform_events(actor_id,association_id,subject_id,event,reason,details)VALUES(u,association,subject,'PLATFORM_'||op,body->>'reason',jsonb_build_object('applied',op<>'STATE_REVIEW','reviewRequired',op='STATE_REVIEW'));
 PERFORM nexo.platform_actor();r:=jsonb_build_object('associationId',association,'subjectRef',subject,'kind',op,'applied',op<>'STATE_REVIEW','reviewRequired',op='STATE_REVIEW','legalVerification',false);
 RETURN nexo.action_finish(k,jsonb_build_object('op','platform_admin','body',body),r);
END$$;

CREATE FUNCTION nexo.platform_rows(association uuid,section text)RETURNS TABLE(key text,item jsonb)LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF section='ASSOCIATIONS'THEN RETURN QUERY SELECT a.id::text,jsonb_build_object('id',a.id,'name',a.name,'commercialStatus',a.status,'adherenceStatus',a.adherence_status,'operatingStatus',a.operating_status)FROM nexo.associations a;
 ELSIF section='CANDIDATES'THEN RETURN QUERY SELECT v.lab_code,jsonb_build_object('code',v.lab_code,'label',u.label)FROM nexo.platform_verifications v JOIN nexo.identity_accounts a ON a.user_id=v.user_id AND a.active AND a.version=v.identity_version JOIN nexo.users u ON u.id=v.user_id WHERE NOT EXISTS(SELECT FROM nexo.platform_bootstrap b WHERE b.user_id=v.user_id);
 ELSIF section='HISTORY'THEN RETURN QUERY SELECT e.id::text,jsonb_build_object('id',e.id,'actorRef',e.actor_id,'associationId',e.association_id,'subjectRef',e.subject_id,'event',e.event,'reason',e.reason,'details',e.details,'createdAt',e.created_at)FROM nexo.platform_events e WHERE association IS NULL OR e.association_id=association;
 END IF;
END$$;
CREATE FUNCTION nexo.web_platform_page(association uuid,section text,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL)RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.platform_actor();scope_key text;revision text;total bigint;items jsonb;tail text;more boolean;cursor_exists boolean;
BEGIN
 IF section IS NULL OR section NOT IN('ASSOCIATIONS','CANDIDATES','HISTORY')OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR(section<>'HISTORY'AND association IS NOT NULL)THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 scope_key:=encode(sha256(convert_to(u::text||':'||current_setting('nexo.session_token',true)||':'||coalesce(association::text,'ALL')||':'||section||':'||page_size,'UTF8')),'hex');
 IF page_cursor IS NOT NULL AND(jsonb_typeof(page_cursor)<>'object'OR(SELECT count(*)FROM jsonb_object_keys(page_cursor))<>5 OR NOT(page_cursor?&ARRAY['v','scope','revision','size','key'])OR page_cursor->'v'IS DISTINCT FROM'1'::jsonb OR page_cursor->'size'IS DISTINCT FROM to_jsonb(page_size)OR page_cursor->>'scope'IS DISTINCT FROM scope_key OR jsonb_typeof(page_cursor->'key')<>'string'OR length(page_cursor->>'key')NOT BETWEEN 1 AND 64 OR jsonb_typeof(page_cursor->'revision')<>'string')THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
 WITH all_rows AS MATERIALIZED(SELECT * FROM nexo.platform_rows(association,section)),page AS MATERIALIZED(SELECT * FROM all_rows WHERE page_cursor IS NULL OR key>page_cursor->>'key'ORDER BY key LIMIT page_size+1),numbered AS(SELECT *,row_number()OVER(ORDER BY key)n FROM page)
 SELECT(SELECT count(*)FROM all_rows),(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(key,item)ORDER BY key),'[]')::text,'UTF8')),'hex')FROM all_rows),coalesce(jsonb_agg(item ORDER BY key)FILTER(WHERE n<=page_size),'[]'),max(key)FILTER(WHERE n<=page_size),count(*)>page_size,CASE WHEN page_cursor IS NULL THEN true ELSE EXISTS(SELECT FROM all_rows WHERE key=page_cursor->>'key')END INTO total,revision,items,tail,more,cursor_exists FROM numbered;
 IF page_cursor IS NOT NULL AND(page_cursor->>'revision'IS DISTINCT FROM revision OR NOT cursor_exists)THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 PERFORM nexo.platform_actor();RETURN jsonb_build_object('items',items,'total',total,'limit',page_size,'nextCursor',CASE WHEN more THEN jsonb_build_object('v',1,'scope',scope_key,'revision',revision,'size',page_size,'key',tail)ELSE NULL END);
END$$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.web_platform_context(uuid),nexo.web_platform_page(uuid,text,integer,jsonb),nexo.web_platform_command(text,jsonb)TO nexo_app;
