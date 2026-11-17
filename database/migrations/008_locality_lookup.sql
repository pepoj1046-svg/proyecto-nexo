-- Prefix lookup: bounded, accent-insensitive Spanish, without extensions.
-- PostgreSQL grants function EXECUTE globally by default. A per-schema REVOKE
-- alone cannot remove that global default. Applies only to this database/creator.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE FUNCTION nexo.locality_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT
SET search_path=pg_catalog AS $$
  SELECT translate(lower(regexp_replace(trim(normalize(value,NFC)), '\s+', ' ', 'g')),
    'áéíóúüÁÉÍÓÚÜÑ','aeiouuaeiouuñ') COLLATE "C"
$$;
CREATE INDEX locality_name_prefix ON nexo.localities(nexo.locality_key(name) text_pattern_ops,catalog_id,id);
CREATE FUNCTION nexo.suggest_localities(query text, max_results integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); q text:=nexo.locality_key(query); results jsonb;
BEGIN
  IF q IS NULL OR length(q) NOT BETWEEN 2 AND 80 OR q !~ '[[:alpha:]ñ]'
    OR q ~ '[%_\\]' OR max_results IS NULL OR max_results NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'INVALID_LOCALITY_QUERY';
  END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY sort_name COLLATE "C",municipality COLLATE "C",
    province COLLATE "C",department COLLATE "C",version COLLATE "C",id),'[]'::jsonb) INTO results
  FROM (
    SELECT l.id,nexo.locality_key(l.name) AS sort_name,m.name AS municipality,
      p.name AS province,d.name AS department,c.version,
      jsonb_build_object('localityId',l.id,'catalogId',c.id,'catalogVersion',c.version,
        'name',l.name,'municipality',m.name,'province',p.name,'department',d.name) AS item
    FROM nexo.localities l JOIN nexo.geo_catalogs c ON c.id=l.catalog_id
    JOIN nexo.municipalities m ON m.id=l.municipality_id AND m.catalog_id=c.id
    JOIN nexo.provinces p ON p.id=m.province_id AND p.catalog_id=c.id
    JOIN nexo.departments d ON d.id=p.department_id AND d.catalog_id=c.id
    WHERE c.status='ACTIVE' AND c.data_kind='VERIFIED' AND nexo.locality_key(l.name) LIKE q||'%'
    ORDER BY nexo.locality_key(l.name) COLLATE "C",m.name COLLATE "C",p.name COLLATE "C",d.name COLLATE "C",c.version COLLATE "C",l.id
    LIMIT max_results
  ) suggestions;
  RETURN results;
END $$;
GRANT EXECUTE ON FUNCTION nexo.suggest_localities(text,integer) TO nexo_app;
-- Raw geography must not expose drafts, retired or unverified sources either.
DROP POLICY geo_catalog_read ON nexo.geo_catalogs;
CREATE POLICY geo_catalog_read ON nexo.geo_catalogs FOR SELECT USING (
  (SELECT nexo.actor()) IS NOT NULL AND status='ACTIVE' AND data_kind='VERIFIED');
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['departments','provinces','municipalities','localities'] LOOP
    EXECUTE format('DROP POLICY geo_read ON nexo.%I',t);
    EXECUTE format('CREATE POLICY geo_read ON nexo.%I FOR SELECT USING ((SELECT nexo.actor()) IS NOT NULL
      AND EXISTS(SELECT FROM nexo.geo_catalogs c WHERE c.id=catalog_id AND c.status=''ACTIVE'' AND c.data_kind=''VERIFIED''))',t);
  END LOOP;
END $$;
CREATE INDEX membership_actor ON nexo.memberships(user_id,association_id,role) WHERE active;
CREATE INDEX booking_passenger ON nexo.bookings(passenger_id,route_id);
CREATE INDEX booking_creator ON nexo.bookings(created_by,route_id);
CREATE INDEX sessions_by_user ON nexo.sessions(user_id);

-- RLS must execute with explicit grants, without publishing the internal
-- eligibility helper (which is also used by privileged transactional functions).
CREATE FUNCTION nexo.can_search_route(route uuid) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT nexo.actor() IS NOT NULL AND nexo.route_eligible(route)
$$;
GRANT EXECUTE ON FUNCTION nexo.can_search_route(uuid) TO nexo_app;
DROP POLICY association_read ON nexo.associations;
CREATE POLICY association_read ON nexo.associations FOR SELECT USING ((SELECT nexo.actor()) IS NOT NULL AND
  (nexo.has_role(id,'ASSOCIATION_ADMIN') OR nexo.has_role(id,'DRIVER') OR
    EXISTS(SELECT FROM nexo.routes r WHERE r.association_id=associations.id AND nexo.can_search_route(r.id))));
DROP POLICY fare_read ON nexo.fares;
CREATE POLICY fare_read ON nexo.fares FOR SELECT USING ((SELECT nexo.actor()) IS NOT NULL AND
  (nexo.owns_route(route_id) OR EXISTS(SELECT FROM nexo.bookings b WHERE b.fare_id=fares.id
    AND (b.passenger_id=(SELECT nexo.actor()) OR b.created_by=(SELECT nexo.actor()))) OR
    (nexo.can_search_route(route_id) AND valid_from<=statement_timestamp()
      AND (valid_until IS NULL OR valid_until>statement_timestamp()))));
