-- The route lock protocol requires fresh snapshots after a waiting writer.
-- Reject direct RPC callers using a transaction with a fixed older snapshot.
CREATE OR REPLACE FUNCTION nexo.require_actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.actor();
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'UNSUPPORTED_ISOLATION_USE_READ_COMMITTED' USING ERRCODE='25001';
  END IF;
  IF u IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  RETURN u;
END $$;
