-- A committed receipt is an authorized read, not another administrative writer.
-- Do not make an identical retry depend on a trylock held by unrelated work or
-- on the order in which a completed transaction releases its different locks.
CREATE FUNCTION nexo.admin_receipt_actor(association uuid,route uuid,full_required boolean)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.config_actor(association,route,full_required);expiry timestamptz;
BEGIN
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u FOR SHARE;
 SELECT expires_at INTO expiry FROM nexo.sessions WHERE user_id=u AND revoked_at IS NULL
  AND token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')FOR SHARE;
 IF NOT FOUND OR expiry<=clock_timestamp()THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=association AND user_id=u AND role='ASSOCIATION_ADMIN'AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN nexo.config_actor(association,route,full_required);
END$$;
REVOKE ALL ON FUNCTION nexo.admin_receipt_actor(uuid,uuid,boolean)FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;

-- Change only the receipt branch of the existing functions. Preserve signatures,
-- OIDs/ACLs, body validation, action payloads and the fail-fast writer lock order.
DO $$DECLARE definition text;needle text;replacement text;
BEGIN
 definition:=pg_get_functiondef('nexo.web_fleet_command(text,jsonb)'::regprocedure);
 needle:='cached:=nexo.action_start(k,p);';
 replacement:=needle||E'\n IF cached IS NOT NULL THEN PERFORM nexo.admin_receipt_actor(association,NULL,true);RETURN cached;END IF;';
 IF(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'UNEXPECTED_FLEET_RECEIPT_DEFINITION';END IF;
 EXECUTE replace(definition,needle,replacement);
 definition:=pg_get_functiondef('nexo.web_config_command(text,jsonb)'::regprocedure);
 needle:='cached:=nexo.action_start(k,p);';
 replacement:=needle||E'\n IF cached IS NOT NULL THEN PERFORM nexo.admin_receipt_actor(association,target,full_required);RETURN cached;END IF;';
 IF(length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'UNEXPECTED_CONFIG_RECEIPT_DEFINITION';END IF;
 EXECUTE replace(definition,needle,replacement);
END$$;
