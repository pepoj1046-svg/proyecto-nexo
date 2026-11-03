-- 4A.3 correction: keep036 and its function OID; bind administrative intentions
-- to the attested identity mapping, not only the association membership snapshot.
CREATE OR REPLACE FUNCTION nexo.platform_revision(association uuid)RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
 (SELECT to_jsonb(a)FROM nexo.associations a WHERE a.id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY m.user_id),'[]')FROM nexo.memberships m WHERE m.association_id=association AND m.role='ASSOCIATION_ADMIN'),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.user_id,a.active,a.version)ORDER BY a.user_id),'[]')FROM nexo.identity_accounts a WHERE EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=association AND m.user_id=a.user_id AND m.role='ASSOCIATION_ADMIN')),
 (SELECT coalesce(jsonb_agg(to_jsonb(l)ORDER BY l.association_id,l.user_id),'[]')FROM nexo.admin_limits l WHERE EXISTS(SELECT FROM nexo.memberships m WHERE m.association_id=association AND m.user_id=l.user_id AND m.role='ASSOCIATION_ADMIN')),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id),'[]')FROM nexo.platform_events e WHERE e.association_id=association),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id),'[]')FROM nexo.identity_events e WHERE e.subject_id IN(SELECT m.user_id FROM nexo.memberships m WHERE m.association_id=association AND m.role='ASSOCIATION_ADMIN')AND(e.event LIKE 'ASSOCIATION_ADMIN_%'OR e.event LIKE 'ADMIN_SCOPE_%'OR e.event LIKE 'ADMIN_ROUTE_%')),
 -- Candidates may not yet be association members: bind their global attestation
 -- state and immutable history, including renaming/rebinding/ABA of a LAB code.
 (SELECT coalesce(jsonb_agg(to_jsonb(v)ORDER BY v.user_id),'[]')FROM nexo.platform_verifications v),
 (SELECT coalesce(jsonb_agg(e.id ORDER BY e.id),'[]')FROM nexo.identity_events e WHERE e.event='PLATFORM_LAB_ATTESTED')
 )::text,'UTF8')),'hex')
$$;
REVOKE EXECUTE ON FUNCTION nexo.platform_revision(uuid)FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
