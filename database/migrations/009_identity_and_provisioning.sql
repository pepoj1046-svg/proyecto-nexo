-- Local identity module. These are group roles, never runtime owner connections.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['nexo_identity','nexo_provisioner'] LOOP
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',r);
    END IF;
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=r AND
      (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin)) THEN
      RAISE EXCEPTION 'UNSAFE_IDENTITY_ROLE';
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA nexo TO %I',r);
  END LOOP;
END $$;
CREATE TABLE nexo.identity_accounts (
  user_id uuid PRIMARY KEY REFERENCES nexo.users,
  login_key text UNIQUE NOT NULL CHECK(login_key ~ '^[a-z0-9][a-z0-9.-]{2,63}$'),
  password_hash text NOT NULL CHECK(length(password_hash) BETWEEN 80 AND 256),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE nexo.identity_attempts (
  bucket text PRIMARY KEY, started_at timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts>0)
);
CREATE TABLE nexo.identity_recovery (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES nexo.identity_accounts, expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX identity_recovery_user ON nexo.identity_recovery(user_id);
CREATE TABLE nexo.identity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES nexo.users,
  subject_id uuid NOT NULL REFERENCES nexo.users, association_id uuid REFERENCES nexo.associations,
  event text NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(), performed_by name NOT NULL DEFAULT session_user
);
CREATE TRIGGER immutable_identity_events BEFORE UPDATE OR DELETE ON nexo.identity_events
  FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['identity_accounts','identity_attempts','identity_recovery','identity_events'] LOOP
    EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
CREATE POLICY identity_event_read ON nexo.identity_events FOR SELECT USING (
  (SELECT nexo.actor()) IS NOT NULL AND (subject_id=(SELECT nexo.actor()) OR
    (association_id IS NOT NULL AND nexo.has_role(association_id,'ASSOCIATION_ADMIN'))));
GRANT SELECT ON nexo.identity_events TO nexo_app;

-- Legacy sessions survive additive migration; disabled managed identities do not.
CREATE OR REPLACE FUNCTION nexo.actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo AS $$
  SELECT s.user_id FROM nexo.sessions s LEFT JOIN nexo.identity_accounts a ON a.user_id=s.user_id
  WHERE s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')
    AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND coalesce(a.active,true)
$$;

-- Attempts commit even when the Node verifier rejects a password. Fixed windows
-- are shared across processes. No raw login, password or token in attempt rows.
CREATE FUNCTION nexo.identity_attempt(login text, purpose text DEFAULT 'LOGIN') RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE bucket_key text; count integer; allowed boolean:=true; a nexo.identity_accounts;
BEGIN
  IF login IS NULL OR login !~ '^[a-z0-9][a-z0-9.-]{2,63}$' OR purpose IS NULL OR purpose NOT IN ('LOGIN','RECOVERY') THEN
    RAISE EXCEPTION 'INVALID_IDENTITY';
  END IF;
  FOREACH bucket_key IN ARRAY ARRAY['global',encode(sha256(convert_to(purpose||':'||login,'UTF8')),'hex')] LOOP
    INSERT INTO nexo.identity_attempts AS t VALUES(bucket_key,clock_timestamp(),1)
    ON CONFLICT(bucket) DO UPDATE SET
      started_at=CASE WHEN t.started_at<clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE t.started_at END,
      attempts=CASE WHEN t.started_at<clock_timestamp()-interval '15 minutes' THEN 1 ELSE least(t.attempts+1,1001) END
    RETURNING attempts INTO count;
    IF count>(CASE WHEN bucket_key='global' THEN 1000 ELSE 5 END) THEN allowed:=false; END IF;
  END LOOP;
  IF NOT allowed THEN RETURN jsonb_build_object('allowed',false); END IF;
  SELECT * INTO a FROM nexo.identity_accounts WHERE login_key=login AND active AND purpose='LOGIN';
  RETURN jsonb_build_object('allowed',true,'userId',a.user_id,'hash',a.password_hash,'version',a.version);
END $$;
CREATE FUNCTION nexo.register_identity(login text, password_hash text) RETURNS uuid LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid;
BEGIN
  INSERT INTO nexo.users(label) VALUES('Pasajero') RETURNING id INTO u;
  INSERT INTO nexo.identity_accounts(user_id,login_key,password_hash) VALUES(u,login,password_hash);
  INSERT INTO nexo.identity_events(subject_id,event,reason) VALUES(u,'REGISTERED','Registro local de pasajero');
  RETURN u;
END $$;
CREATE FUNCTION nexo.issue_identity_session(subject uuid, expected_version integer, digest text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE a nexo.identity_accounts; expiry timestamptz:=clock_timestamp()+interval '1 hour';
BEGIN
  SELECT * INTO a FROM nexo.identity_accounts WHERE user_id=subject FOR UPDATE;
  IF NOT FOUND OR NOT a.active OR a.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS' USING ERRCODE='42501';
  END IF;
  IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  INSERT INTO nexo.sessions VALUES(digest,subject,expiry,NULL);
  INSERT INTO nexo.identity_events(subject_id,event,reason) VALUES(subject,'SESSION_ISSUED','Inicio de sesión local');
  RETURN expiry;
END $$;
CREATE FUNCTION nexo.logout() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
  UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=u AND
    token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex');
  INSERT INTO nexo.identity_events(actor_id,subject_id,event,reason) VALUES(u,u,'LOGOUT','Cierre de sesión');
  RETURN true;
END $$;
CREATE FUNCTION nexo.logout_all() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
  -- Serialize against issuance so an already-verified stale login cannot survive.
  UPDATE nexo.identity_accounts SET version=version+1 WHERE user_id=u;
  UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=u AND revoked_at IS NULL;
  INSERT INTO nexo.identity_events(actor_id,subject_id,event,reason) VALUES(u,u,'LOGOUT_ALL','Cierre de todas las sesiones');
  RETURN true;
END $$;
CREATE FUNCTION nexo.provision_recovery(subject uuid, digest text, reason text) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INVALID_RECOVERY';
  END IF;
  PERFORM 1 FROM nexo.identity_accounts WHERE user_id=subject AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_RECOVERY'; END IF;
  UPDATE nexo.identity_recovery SET consumed_at=clock_timestamp() WHERE user_id=subject AND consumed_at IS NULL;
  INSERT INTO nexo.identity_recovery VALUES(digest,subject,clock_timestamp()+interval '15 minutes',NULL);
  INSERT INTO nexo.identity_events(subject_id,event,reason) VALUES(subject,'RECOVERY_PROVISIONED',reason);
END $$;
CREATE FUNCTION nexo.recover_identity(digest text, new_hash text) RETURNS boolean LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE subject uuid;
BEGIN
  SELECT user_id INTO subject FROM nexo.identity_recovery WHERE token_hash=digest;
  IF subject IS NULL THEN RETURN false; END IF;
  -- Account before recovery row, same order as provisioning and session issuance.
  PERFORM 1 FROM nexo.identity_accounts WHERE user_id=subject AND active FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE nexo.identity_recovery SET consumed_at=clock_timestamp() WHERE token_hash=digest
    AND consumed_at IS NULL AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE nexo.identity_accounts SET password_hash=new_hash,version=version+1 WHERE user_id=subject;
  UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=subject AND revoked_at IS NULL;
  UPDATE nexo.identity_recovery SET consumed_at=clock_timestamp() WHERE user_id=subject AND consumed_at IS NULL;
  INSERT INTO nexo.identity_events(subject_id,event,reason) VALUES(subject,'RECOVERED','Recuperación local verificada');
  RETURN true;
END $$;

CREATE FUNCTION nexo.set_driver_membership(association uuid, subject uuid, enabled boolean, reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
  IF NOT nexo.has_role(association,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF enabled IS NULL OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_MEMBERSHIP'; END IF;
  INSERT INTO nexo.memberships VALUES(association,subject,'DRIVER',enabled)
    ON CONFLICT(association_id,user_id,role) DO UPDATE SET active=enabled;
  INSERT INTO nexo.identity_events(actor_id,subject_id,association_id,event,reason)
    VALUES(u,subject,association,CASE WHEN enabled THEN 'DRIVER_ENABLED' ELSE 'DRIVER_DISABLED' END,reason);
  RETURN true;
END $$;
-- Offline, trusted process only. This authority is not an end-user role.
CREATE FUNCTION nexo.provision_role(subject uuid, association uuid, requested_role text, enabled boolean, reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF enabled IS NULL OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 1 AND 200 OR requested_role IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROVISIONING';
  END IF;
  IF requested_role='REVIEWER' AND association IS NULL THEN
    IF enabled THEN INSERT INTO nexo.operation_reviewers VALUES(subject) ON CONFLICT DO NOTHING;
    ELSE DELETE FROM nexo.operation_reviewers WHERE user_id=subject; END IF;
  ELSIF requested_role='ASSOCIATION_ADMIN' AND association IS NOT NULL THEN
    INSERT INTO nexo.memberships VALUES(association,subject,'ASSOCIATION_ADMIN',enabled)
      ON CONFLICT(association_id,user_id,role) DO UPDATE SET active=enabled;
  ELSE RAISE EXCEPTION 'INVALID_PROVISIONING'; END IF;
  INSERT INTO nexo.identity_events(subject_id,association_id,event,reason)
    VALUES(subject,association,requested_role||CASE WHEN enabled THEN '_ENABLED' ELSE '_DISABLED' END,reason);
  RETURN true;
END $$;
CREATE FUNCTION nexo.set_identity_active(subject uuid, enabled boolean, reason text) RETURNS boolean LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF enabled IS NULL OR reason IS NULL OR length(trim(reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_PROVISIONING'; END IF;
  UPDATE nexo.identity_accounts SET active=enabled,version=version+1 WHERE user_id=subject;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_IDENTITY'; END IF;
  UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=subject AND revoked_at IS NULL;
  UPDATE nexo.identity_recovery SET consumed_at=clock_timestamp() WHERE user_id=subject AND consumed_at IS NULL;
  INSERT INTO nexo.identity_events(subject_id,event,reason) VALUES(subject,CASE WHEN enabled THEN 'IDENTITY_ENABLED' ELSE 'IDENTITY_DISABLED' END,reason);
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION nexo.identity_attempt(text,text),nexo.register_identity(text,text),
  nexo.issue_identity_session(uuid,integer,text),nexo.recover_identity(text,text) TO nexo_identity;
GRANT EXECUTE ON FUNCTION nexo.provision_role(uuid,uuid,text,boolean,text),
  nexo.provision_recovery(uuid,text,text),nexo.set_identity_active(uuid,boolean,text) TO nexo_provisioner;
GRANT EXECUTE ON FUNCTION nexo.logout(),nexo.logout_all(),nexo.set_driver_membership(uuid,uuid,boolean,text) TO nexo_app;

-- Having two trusted roles never permits reviewing one's own submission.
ALTER FUNCTION nexo.review_authorization(text,uuid,text,text) RENAME TO review_authorization_internal;
REVOKE EXECUTE ON FUNCTION nexo.review_authorization_internal(text,uuid,text,text) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.review_authorization(k text, authorization_id uuid, decision text, reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); requester uuid;
BEGIN
  IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT requested_by INTO requester FROM nexo.route_authorizations WHERE id=authorization_id;
  IF requester=u THEN RAISE EXCEPTION 'FORBIDDEN_SELF_REVIEW' USING ERRCODE='42501'; END IF;
  RETURN nexo.review_authorization_internal(k,authorization_id,decision,reason);
END $$;
GRANT EXECUTE ON FUNCTION nexo.review_authorization(text,uuid,text,text) TO nexo_app;
-- Explicit in addition to 001's owner-specific default privileges.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
