-- Keep the native RPC, receipt payload, signature, OID and private helper ACL.
-- A reviewer revoked while waiting for route/action work must not approve or
-- replay a receipt using authority observed before the wait.
CREATE OR REPLACE FUNCTION nexo.review_authorization_internal(k text, authorization_id uuid, decision text, reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); a nexo.route_authorizations; p jsonb; cached jsonb; expiry timestamptz;
BEGIN
 IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 p:=jsonb_build_object('op','review_authorization','id',authorization_id,'decision',decision,'reason',reason);
 cached:=nexo.action_start(k,p);
 SELECT * INTO a FROM nexo.route_authorizations WHERE id=authorization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_AUTHORIZATION'; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=a.route_id FOR UPDATE;
 SELECT * INTO a FROM nexo.route_authorizations WHERE id=authorization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_AUTHORIZATION';END IF;
 -- Trusted provisioning uses this same scope lock. Acquire it after the route
 -- wait, so revocation can commit while the operation is still waiting.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('admin-scope:'||u::text,0));
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u FOR SHARE;
 SELECT expires_at INTO expiry FROM nexo.sessions WHERE user_id=u AND revoked_at IS NULL
  AND token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex') FOR SHARE;
 IF NOT FOUND OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM nexo.operation_reviewers WHERE user_id=u FOR SHARE;
 PERFORM nexo.require_actor();
 IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF a.requested_by=u THEN RAISE EXCEPTION 'FORBIDDEN_SELF_REVIEW' USING ERRCODE='42501'; END IF;
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF decision IS NULL OR reason IS NULL OR length(trim(reason))=0 OR NOT
  ((a.status='PENDING' AND decision IN('VERIFIED','REJECTED')) OR(a.status='VERIFIED' AND decision='REVOKED')) THEN
  RAISE EXCEPTION 'INVALID_AUTHORIZATION_TRANSITION';
 END IF;
 UPDATE nexo.route_authorizations SET status=decision,reviewed_by=u,review_reason=reason WHERE id=authorization_id;
 RETURN nexo.action_finish(k,p,jsonb_build_object('authorizationId',authorization_id,'status',decision));
END $$;
REVOKE ALL ON FUNCTION nexo.review_authorization_internal(text,uuid,text,text) FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;

-- The offline LAB association review has the same native receipt boundary.
CREATE OR REPLACE FUNCTION nexo.review_association(k text,association uuid,state text,confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();p jsonb;cached jsonb;expiry timestamptz;
BEGIN
 IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF confirmed IS DISTINCT FROM true OR state IS NULL OR state NOT IN('PENDING','ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'INVALID_ASSOCIATION_STATE';END IF;
 p:=jsonb_build_object('op','review_association','association',association,'state',state);cached:=nexo.action_start(k,p);
 PERFORM 1 FROM nexo.routes WHERE association_id=association ORDER BY id FOR UPDATE;
 PERFORM 1 FROM nexo.associations WHERE id=association FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ASSOCIATION';END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('admin-scope:'||u::text,0));
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u FOR SHARE;
 SELECT expires_at INTO expiry FROM nexo.sessions WHERE user_id=u AND revoked_at IS NULL
  AND token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex') FOR SHARE;
 IF NOT FOUND OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM nexo.operation_reviewers WHERE user_id=u FOR SHARE;
 PERFORM nexo.require_actor();IF NOT nexo.is_operation_reviewer() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 UPDATE nexo.associations SET adherence_status=CASE WHEN state='PENDING' THEN 'PENDING' ELSE 'ADHERED' END,operating_status=CASE WHEN state='ACTIVE' THEN 'OPERATING' ELSE 'SUSPENDED' END WHERE id=association;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ASSOCIATION';END IF;
 PERFORM nexo.audit(association,'ASSOCIATION_'||state,association);RETURN nexo.action_finish(k,p,jsonb_build_object('state',state,'legalVerification',false,'simulated',true));
END $$;
REVOKE ALL ON FUNCTION nexo.review_association(text,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.review_association(text,uuid,text,boolean) TO nexo_app;
