-- Preserve 018-020 already published for review. Close less obvious legacy reads
-- and fix own-route advancement for a restricted terminal administrator.
CREATE POLICY limited_admin_read ON nexo.authorization_events AS RESTRICTIVE FOR SELECT USING(
 nexo.scope_allows(NULL) OR EXISTS(SELECT FROM nexo.route_authorizations a WHERE a.id=authorization_id AND nexo.scope_allows(a.route_id))
);
CREATE POLICY limited_admin_read ON nexo.identity_events AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(NULL) OR subject_id=nexo.actor());
DROP POLICY limited_admin_read ON nexo.operational_notices;
CREATE POLICY limited_admin_read ON nexo.operational_notices AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows((SELECT route_id FROM nexo.trips t WHERE t.id=trip_id)));
CREATE OR REPLACE FUNCTION nexo.advancement_candidates(target uuid) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.check_scope((SELECT route_id FROM nexo.trips WHERE id=target));
 RETURN QUERY SELECT * FROM nexo.scope_core_advancement_candidates(target);
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
