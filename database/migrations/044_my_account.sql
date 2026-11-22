-- 5A.5 "Mi cuenta": read-only view of the actor's own account. Additive; 001-043 are
-- not edited. No table, no write: identity, roles and associations stay managed by
-- the existing provisioning and administration flows.

-- The actor comes from the session, never from a parameter. Only active memberships
-- are listed, with the association name and whether the administrator is restricted.
CREATE FUNCTION nexo.web_my_account()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();me nexo.users;roles jsonb;
BEGIN
 SELECT * INTO me FROM nexo.users WHERE id=u;
 IF me.id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('association',a.name,'role',m.role,
   'restricted',m.role='ASSOCIATION_ADMIN' AND EXISTS(SELECT FROM nexo.admin_limits l WHERE l.association_id=m.association_id AND l.user_id=u))
   ORDER BY a.name,m.role),'[]'::jsonb)INTO roles
  FROM nexo.memberships m JOIN nexo.associations a ON a.id=m.association_id
  WHERE m.user_id=u AND m.active;
 -- Re-read the actor: a revocation committed meanwhile must not leak an answer.
 IF nexo.actor() IS DISTINCT FROM u THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 RETURN jsonb_build_object('label',me.label,'roles',roles,'editableFields','[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION nexo.web_my_account()FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_my_account()TO nexo_app;
