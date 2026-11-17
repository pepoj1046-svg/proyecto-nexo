CREATE TABLE nexo.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES nexo.users,
  event text NOT NULL CHECK(event IN ('INVALID_CREDENTIALS','INVALID_RECOVERY','THROTTLED','MAINTENANCE')),
  bucket_hash text CHECK(bucket_hash ~ '^[a-f0-9]{64}$'),
  counts jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  performed_by name NOT NULL DEFAULT session_user
);
ALTER TABLE nexo.security_events ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_security_events BEFORE UPDATE OR DELETE ON nexo.security_events
  FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
-- No SELECT/DML grant to application, identity or provisioning connections.
CREATE INDEX security_event_time ON nexo.security_events(created_at,id);

CREATE OR REPLACE FUNCTION nexo.identity_attempt(login text, purpose text DEFAULT 'LOGIN') RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE bucket_key text; count integer; threshold integer; a nexo.identity_accounts;
BEGIN
  IF login IS NULL OR login !~ '^[a-z0-9][a-z0-9.-]{2,63}$' OR purpose IS NULL OR purpose NOT IN ('LOGIN','REGISTER','RECOVERY') THEN
    RAISE EXCEPTION 'INVALID_IDENTITY';
  END IF;
  FOREACH bucket_key IN ARRAY ARRAY['global:'||purpose,encode(sha256(convert_to(purpose||':'||login,'UTF8')),'hex')] LOOP
    threshold:=CASE WHEN bucket_key LIKE 'global:%' THEN 1000 ELSE 5 END;
    INSERT INTO nexo.identity_attempts AS t VALUES(bucket_key,clock_timestamp(),1)
    ON CONFLICT(bucket) DO UPDATE SET
      started_at=CASE WHEN t.started_at<=clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE t.started_at END,
      attempts=CASE WHEN t.started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE least(t.attempts+1,threshold+2) END
    RETURNING attempts INTO count;
    IF count>threshold THEN
      -- One event on the threshold crossing; denied global attempts allocate no per-login bucket.
      IF count=threshold+1 THEN
        INSERT INTO nexo.security_events(event,bucket_hash) VALUES('THROTTLED',encode(sha256(convert_to(bucket_key,'UTF8')),'hex'));
      END IF;
      RETURN jsonb_build_object('allowed',false);
    END IF;
  END LOOP;
  SELECT * INTO a FROM nexo.identity_accounts WHERE login_key=login AND active AND purpose='LOGIN';
  RETURN jsonb_build_object('allowed',true,'userId',a.user_id,'hash',a.password_hash,'version',a.version);
END $$;
CREATE FUNCTION nexo.record_identity_failure(login text, purpose text) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE subject uuid;
BEGIN
  IF login IS NULL OR login !~ '^[a-z0-9][a-z0-9.-]{2,63}$' OR purpose IS NULL OR purpose NOT IN ('LOGIN','RECOVERY') THEN
    RAISE EXCEPTION 'INVALID_IDENTITY';
  END IF;
  IF purpose='LOGIN' THEN SELECT user_id INTO subject FROM nexo.identity_accounts WHERE login_key=login; END IF;
  INSERT INTO nexo.security_events(subject_id,event,bucket_hash) VALUES(subject,
    CASE WHEN purpose='LOGIN' THEN 'INVALID_CREDENTIALS' ELSE 'INVALID_RECOVERY' END,
    encode(sha256(convert_to(purpose||':'||login,'UTF8')),'hex'));
END $$;
GRANT EXECUTE ON FUNCTION nexo.record_identity_failure(text,text) TO nexo_identity;

CREATE OR REPLACE FUNCTION nexo.issue_identity_session(subject uuid, expected_version integer, digest text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE a nexo.identity_accounts; expiry timestamptz;
BEGIN
  SELECT * INTO a FROM nexo.identity_accounts WHERE user_id=subject FOR UPDATE;
  IF NOT FOUND OR NOT a.active OR a.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION 'INVALID_CREDENTIALS' USING ERRCODE='42501';
  END IF;
  IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  -- Lifetime starts after the account lock, never before a potentially long wait.
  expiry:=clock_timestamp()+interval '1 hour';
  INSERT INTO nexo.sessions VALUES(digest,subject,expiry,NULL);
  INSERT INTO nexo.identity_events(subject_id,event,reason) VALUES(subject,'SESSION_ISSUED','Inicio de sesión local');
  RETURN expiry;
END $$;
CREATE OR REPLACE FUNCTION nexo.logout() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
  UPDATE nexo.sessions SET revoked_at=clock_timestamp() WHERE user_id=u AND revoked_at IS NULL AND
    token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex');
  IF FOUND THEN
    INSERT INTO nexo.identity_events(actor_id,subject_id,event,reason) VALUES(u,u,'LOGOUT','Cierre de sesión');
  END IF;
  RETURN true;
END $$;

-- pg_temp is explicit and last, including on all pre-existing helper functions.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='nexo' LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,nexo,pg_temp',f.signature);
  END LOOP;
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
