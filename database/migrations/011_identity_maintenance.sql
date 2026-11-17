DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='nexo_maintenance') THEN
    CREATE ROLE nexo_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='nexo_maintenance' AND
    (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN RAISE EXCEPTION 'UNSAFE_MAINTENANCE_ROLE'; END IF;
END $$;
GRANT USAGE ON SCHEMA nexo TO nexo_maintenance;
CREATE INDEX session_expiry ON nexo.sessions(expires_at,token_hash);
CREATE INDEX session_revocation ON nexo.sessions(revoked_at,token_hash) WHERE revoked_at IS NOT NULL;
CREATE INDEX recovery_expiry ON nexo.identity_recovery(expires_at,token_hash);
CREATE INDEX attempt_expiry ON nexo.identity_attempts(started_at,bucket);
CREATE FUNCTION nexo.maintain_identity(cutoff timestamptz, batch_size integer DEFAULT 100, dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE sessions_count integer; recovery_count integer; attempts_count integer; result jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'UNSUPPORTED_ISOLATION_USE_READ_COMMITTED'; END IF;
  IF cutoff IS NULL OR cutoff>clock_timestamp() OR batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 1000 OR dry_run IS NULL THEN
    RAISE EXCEPTION 'INVALID_MAINTENANCE';
  END IF;
  IF dry_run THEN
    SELECT count(*) INTO sessions_count FROM (SELECT 1 FROM nexo.sessions WHERE expires_at<=cutoff OR revoked_at<=cutoff LIMIT batch_size) s;
    SELECT count(*) INTO recovery_count FROM (SELECT 1 FROM nexo.identity_recovery WHERE expires_at<=cutoff OR consumed_at<=cutoff LIMIT batch_size) r;
    SELECT count(*) INTO attempts_count FROM (SELECT 1 FROM nexo.identity_attempts WHERE started_at<=cutoff
      AND started_at<=clock_timestamp()-interval '15 minutes' LIMIT batch_size) a;
  ELSE
    WITH candidates AS (SELECT token_hash FROM nexo.sessions WHERE expires_at<=cutoff OR revoked_at<=cutoff
      ORDER BY token_hash LIMIT batch_size FOR UPDATE SKIP LOCKED), deleted AS (
      DELETE FROM nexo.sessions s USING candidates c WHERE s.token_hash=c.token_hash RETURNING 1)
    SELECT count(*) INTO sessions_count FROM deleted;
    WITH candidates AS (SELECT token_hash FROM nexo.identity_recovery WHERE expires_at<=cutoff OR consumed_at<=cutoff
      ORDER BY token_hash LIMIT batch_size FOR UPDATE SKIP LOCKED), deleted AS (
      DELETE FROM nexo.identity_recovery r USING candidates c WHERE r.token_hash=c.token_hash RETURNING 1)
    SELECT count(*) INTO recovery_count FROM deleted;
    WITH candidates AS (SELECT bucket FROM nexo.identity_attempts WHERE started_at<=cutoff
      AND started_at<=clock_timestamp()-interval '15 minutes' ORDER BY bucket LIMIT batch_size FOR UPDATE SKIP LOCKED), deleted AS (
      DELETE FROM nexo.identity_attempts a USING candidates c WHERE a.bucket=c.bucket RETURNING 1)
    SELECT count(*) INTO attempts_count FROM deleted;
  END IF;
  result:=jsonb_build_object('sessions',sessions_count,'recovery',recovery_count,'attempts',attempts_count,'dryRun',dry_run);
  IF NOT dry_run THEN INSERT INTO nexo.security_events(event,counts) VALUES('MAINTENANCE',result); END IF;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION nexo.maintain_identity(timestamptz,integer,boolean) TO nexo_maintenance;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
