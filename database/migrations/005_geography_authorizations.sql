-- Versioned geography. No official national dataset is fabricated or seeded.
CREATE TABLE nexo.geo_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, version text NOT NULL,
  source text NOT NULL, data_kind text NOT NULL CHECK(data_kind IN ('SYNTHETIC','VERIFIED')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
  UNIQUE(name,version)
);
CREATE TABLE nexo.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid NOT NULL REFERENCES nexo.geo_catalogs,
  code text NOT NULL, name text NOT NULL, UNIQUE(catalog_id,id), UNIQUE(catalog_id,code)
);
CREATE TABLE nexo.provinces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid NOT NULL, department_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, UNIQUE(catalog_id,id), UNIQUE(catalog_id,code),
  FOREIGN KEY(catalog_id,department_id) REFERENCES nexo.departments(catalog_id,id)
);
CREATE INDEX province_parent ON nexo.provinces(catalog_id,department_id);
CREATE TABLE nexo.municipalities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid NOT NULL, province_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, UNIQUE(catalog_id,id), UNIQUE(catalog_id,code),
  FOREIGN KEY(catalog_id,province_id) REFERENCES nexo.provinces(catalog_id,id)
);
CREATE INDEX municipality_parent ON nexo.municipalities(catalog_id,province_id);
CREATE TABLE nexo.localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid NOT NULL, municipality_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, UNIQUE(catalog_id,id), UNIQUE(catalog_id,code),
  FOREIGN KEY(catalog_id,municipality_id) REFERENCES nexo.municipalities(catalog_id,id)
);
CREATE INDEX locality_parent ON nexo.localities(catalog_id,municipality_id);

COMMENT ON COLUMN nexo.associations.status IS
  'Acceso comercial/visibilidad en la plataforma; no acredita permiso de transporte. Sin automatizacion de cobros/licencias.';
ALTER TABLE nexo.associations ADD COLUMN adherence_status text NOT NULL DEFAULT 'PENDING'
  CHECK(adherence_status IN ('PENDING','ADHERED','WITHDRAWN'));
ALTER TABLE nexo.associations ADD COLUMN operating_status text NOT NULL DEFAULT 'SUSPENDED'
  CHECK(operating_status IN ('OPERATING','SUSPENDED'));

-- Legacy rows remain unconfigured; preserve history instead of inventing permits.
ALTER TABLE nexo.routes ADD COLUMN catalog_id uuid REFERENCES nexo.geo_catalogs;
ALTER TABLE nexo.routes ADD COLUMN origin_locality_id uuid;
ALTER TABLE nexo.routes ADD COLUMN destination_locality_id uuid;
ALTER TABLE nexo.routes ADD CONSTRAINT route_geography_pair CHECK (
  (catalog_id IS NULL AND origin_locality_id IS NULL AND destination_locality_id IS NULL) OR
  (catalog_id IS NOT NULL AND origin_locality_id IS NOT NULL AND destination_locality_id IS NOT NULL
    AND origin_locality_id<>destination_locality_id));
ALTER TABLE nexo.routes ADD CONSTRAINT route_origin FOREIGN KEY(catalog_id,origin_locality_id) REFERENCES nexo.localities(catalog_id,id);
ALTER TABLE nexo.routes ADD CONSTRAINT route_destination FOREIGN KEY(catalog_id,destination_locality_id) REFERENCES nexo.localities(catalog_id,id);
ALTER TABLE nexo.routes ADD CONSTRAINT route_geo_identity UNIQUE(association_id,id,catalog_id);
CREATE INDEX route_geo_origin ON nexo.routes(catalog_id,origin_locality_id);
CREATE INDEX route_geo_destination ON nexo.routes(catalog_id,destination_locality_id);
ALTER TABLE nexo.stops ADD COLUMN catalog_id uuid;
ALTER TABLE nexo.stops ADD COLUMN locality_id uuid;
ALTER TABLE nexo.stops ADD CONSTRAINT stop_geography_pair CHECK ((catalog_id IS NULL)=(locality_id IS NULL));
ALTER TABLE nexo.stops ADD CONSTRAINT stop_geo_route FOREIGN KEY(association_id,route_id,catalog_id)
  REFERENCES nexo.routes(association_id,id,catalog_id);
ALTER TABLE nexo.stops ADD CONSTRAINT stop_locality FOREIGN KEY(catalog_id,locality_id) REFERENCES nexo.localities(catalog_id,id);
CREATE INDEX search_stop_locality ON nexo.stops(locality_id,route_id,stop_index);

CREATE TABLE nexo.operation_reviewers (user_id uuid PRIMARY KEY REFERENCES nexo.users);
CREATE TABLE nexo.route_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, route_id uuid NOT NULL,
  issuer text NOT NULL CHECK(length(issuer) BETWEEN 1 AND 200),
  reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REJECTED','REVOKED')),
  valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL CHECK(valid_until>valid_from),
  requested_by uuid NOT NULL REFERENCES nexo.users, reviewed_by uuid REFERENCES nexo.users,
  review_reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(association_id,id), FOREIGN KEY(association_id,route_id) REFERENCES nexo.routes(association_id,id),
  CHECK(status='PENDING' OR (reviewed_by IS NOT NULL AND length(review_reason)>0))
);
CREATE INDEX route_authorization_lookup ON nexo.route_authorizations(route_id,valid_until) WHERE status='VERIFIED';
CREATE INDEX route_authorization_owner ON nexo.route_authorizations(association_id,route_id);
CREATE TABLE nexo.authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, authorization_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES nexo.users, previous_status text, status text NOT NULL,
  reason text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(association_id,authorization_id) REFERENCES nexo.route_authorizations(association_id,id)
);
CREATE INDEX authorization_event_owner ON nexo.authorization_events(association_id,authorization_id);
CREATE TRIGGER immutable_authorization_events BEFORE UPDATE OR DELETE ON nexo.authorization_events
  FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['geo_catalogs','departments','provinces','municipalities','localities',
    'operation_reviewers','route_authorizations','authorization_events'] LOOP
    EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
CREATE POLICY geo_catalog_read ON nexo.geo_catalogs FOR SELECT USING (nexo.actor() IS NOT NULL AND status='ACTIVE');
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['departments','provinces','municipalities','localities'] LOOP
    EXECUTE format('CREATE POLICY geo_read ON nexo.%I FOR SELECT USING (nexo.actor() IS NOT NULL AND EXISTS(
      SELECT FROM nexo.geo_catalogs c WHERE c.id=catalog_id AND c.status=''ACTIVE''))',t);
  END LOOP;
END $$;
CREATE POLICY authorization_owner_read ON nexo.route_authorizations FOR SELECT USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
CREATE POLICY authorization_event_read ON nexo.authorization_events FOR SELECT USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
GRANT SELECT ON nexo.geo_catalogs,nexo.departments,nexo.provinces,nexo.municipalities,nexo.localities,
  nexo.route_authorizations,nexo.authorization_events TO nexo_app;

CREATE FUNCTION nexo.guard_route_topology() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF (NEW.catalog_id,NEW.origin_locality_id,NEW.destination_locality_id,NEW.stop_count,NEW.direction,NEW.version)
    IS DISTINCT FROM (OLD.catalog_id,OLD.origin_locality_id,OLD.destination_locality_id,OLD.stop_count,OLD.direction,OLD.version)
    AND NOT (OLD.catalog_id IS NULL AND NEW.catalog_id IS NOT NULL
      AND (NEW.stop_count,NEW.direction,NEW.version) IS NOT DISTINCT FROM (OLD.stop_count,OLD.direction,OLD.version)
      AND NOT EXISTS(SELECT FROM nexo.route_authorizations WHERE route_id=OLD.id))
    AND (EXISTS(SELECT FROM nexo.trips WHERE route_id=OLD.id) OR
      EXISTS(SELECT FROM nexo.route_authorizations WHERE route_id=OLD.id)) THEN
    RAISE EXCEPTION 'ROUTE_VERSION_IN_USE';
  END IF;
  IF EXISTS(SELECT FROM nexo.stops WHERE route_id=OLD.id AND stop_index>=NEW.stop_count) THEN
    RAISE EXCEPTION 'INVALID_STOP_COUNT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_route_topology BEFORE UPDATE ON nexo.routes FOR EACH ROW EXECUTE FUNCTION nexo.guard_route_topology();
CREATE FUNCTION nexo.guard_stop_topology() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,nexo AS $$
DECLARE r nexo.routes; route uuid;
BEGIN
  route:=CASE WHEN TG_OP='DELETE' THEN OLD.route_id ELSE NEW.route_id END;
  IF TG_OP='UPDATE' AND (NEW.route_id,NEW.association_id) IS DISTINCT FROM (OLD.route_id,OLD.association_id) THEN
    RAISE EXCEPTION 'STOP_ROUTE_IMMUTABLE';
  END IF;
  SELECT * INTO r FROM nexo.routes WHERE id=route FOR UPDATE;
  IF (TG_OP<>'UPDATE' OR (NEW.stop_index,NEW.catalog_id,NEW.locality_id) IS DISTINCT FROM (OLD.stop_index,OLD.catalog_id,OLD.locality_id))
    AND NOT (TG_OP='UPDATE' AND OLD.catalog_id IS NULL AND NEW.catalog_id IS NOT NULL
      AND NEW.stop_index=OLD.stop_index AND NOT EXISTS(SELECT FROM nexo.route_authorizations WHERE route_id=route))
    AND (EXISTS(SELECT FROM nexo.trips WHERE route_id=route) OR EXISTS(SELECT FROM nexo.route_authorizations WHERE route_id=route)) THEN
    RAISE EXCEPTION 'ROUTE_VERSION_IN_USE';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.stop_index>=r.stop_count THEN RAISE EXCEPTION 'INVALID_STOP_INDEX'; END IF;
  IF NEW.catalog_id IS DISTINCT FROM r.catalog_id THEN RAISE EXCEPTION 'STOP_CATALOG_MISMATCH'; END IF;
  IF r.catalog_id IS NOT NULL AND ((NEW.stop_index=0 AND NEW.locality_id IS DISTINCT FROM r.origin_locality_id)
    OR (NEW.stop_index=r.stop_count-1 AND NEW.locality_id IS DISTINCT FROM r.destination_locality_id)) THEN
    RAISE EXCEPTION 'STOP_ENDPOINT_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_stop_topology BEFORE INSERT OR UPDATE OR DELETE ON nexo.stops
  FOR EACH ROW EXECUTE FUNCTION nexo.guard_stop_topology();

CREATE FUNCTION nexo.freeze_geo_version() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF EXISTS(SELECT FROM nexo.routes WHERE catalog_id=OLD.catalog_id) THEN RAISE EXCEPTION 'GEOGRAPHY_VERSION_IN_USE'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['departments','provinces','municipalities','localities'] LOOP
    EXECUTE format('CREATE TRIGGER freeze_geo BEFORE UPDATE OR DELETE ON nexo.%I
      FOR EACH ROW EXECUTE FUNCTION nexo.freeze_geo_version()',t);
  END LOOP;
END $$;
