-- Fresh, isolated database only. This supersedes the unexecuted conceptual DDL.
CREATE SCHEMA nexo;
REVOKE ALL ON SCHEMA nexo FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='nexo_app') THEN
    CREATE ROLE nexo_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='nexo_app' AND
    (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Unsafe pre-existing nexo_app role';
  END IF;
END $$;
GRANT USAGE ON SCHEMA nexo TO nexo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA nexo REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE nexo.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL
);
-- Provisioned by a trusted identity adapter; no public token issuance function.
CREATE TABLE nexo.sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES nexo.users,
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE nexo.associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED'))
);
CREATE TABLE nexo.memberships (
  association_id uuid NOT NULL REFERENCES nexo.associations,
  user_id uuid NOT NULL REFERENCES nexo.users,
  role text NOT NULL CHECK(role IN ('ASSOCIATION_ADMIN','DRIVER')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(association_id,user_id,role)
);
CREATE TABLE nexo.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL REFERENCES nexo.associations,
  name text NOT NULL, direction text NOT NULL CHECK(direction IN ('OUT','IN')),
  version integer NOT NULL CHECK(version>0), stop_count integer NOT NULL CHECK(stop_count>=2),
  UNIQUE(association_id,id)
);
CREATE TABLE nexo.stops (
  association_id uuid NOT NULL, route_id uuid NOT NULL, stop_index integer NOT NULL CHECK(stop_index>=0),
  name text NOT NULL, boarding_allowed boolean NOT NULL DEFAULT true,
  alighting_allowed boolean NOT NULL DEFAULT true,
  PRIMARY KEY(association_id,route_id,stop_index),
  FOREIGN KEY(association_id,route_id) REFERENCES nexo.routes(association_id,id)
);
CREATE TABLE nexo.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL REFERENCES nexo.associations,
  label text NOT NULL, capacity integer NOT NULL DEFAULT 6 CHECK(capacity=6),
  UNIQUE(association_id,id)
);
CREATE TABLE nexo.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL,
  route_id uuid NOT NULL, vehicle_id uuid NOT NULL, driver_id uuid NOT NULL,
  driver_role text NOT NULL DEFAULT 'DRIVER' CHECK(driver_role='DRIVER'),
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','IN_TRANSIT','COMPLETED')),
  position_no bigint NOT NULL CHECK(position_no>0), current_stop integer NOT NULL DEFAULT 0 CHECK(current_stop>=0),
  departed_at timestamptz, completed_at timestamptz,
  UNIQUE(association_id,id,route_id),
  FOREIGN KEY(association_id,route_id) REFERENCES nexo.routes(association_id,id),
  FOREIGN KEY(association_id,vehicle_id) REFERENCES nexo.vehicles(association_id,id),
  FOREIGN KEY(association_id,driver_id,driver_role) REFERENCES nexo.memberships(association_id,user_id,role)
);
CREATE UNIQUE INDEX one_active_vehicle ON nexo.trips(vehicle_id) WHERE status<>'COMPLETED';
CREATE UNIQUE INDEX one_active_driver ON nexo.trips(driver_id) WHERE status<>'COMPLETED';
CREATE UNIQUE INDEX queue_position ON nexo.trips(association_id,route_id,position_no) WHERE status='QUEUED';
CREATE TABLE nexo.fares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, route_id uuid NOT NULL,
  from_stop integer NOT NULL, to_stop integer NOT NULL, express boolean NOT NULL DEFAULT false,
  version integer NOT NULL CHECK(version>0), amount_bob numeric(12,2) NOT NULL CHECK(amount_bob>=0),
  valid_from timestamptz NOT NULL, valid_until timestamptz,
  UNIQUE(association_id,id,route_id),
  FOREIGN KEY(association_id,route_id,from_stop) REFERENCES nexo.stops,
  FOREIGN KEY(association_id,route_id,to_stop) REFERENCES nexo.stops,
  CHECK(to_stop>from_stop), CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE TABLE nexo.actions (
  actor_id uuid NOT NULL REFERENCES nexo.users, action_key text NOT NULL CHECK(length(action_key) BETWEEN 1 AND 128),
  payload jsonb NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(actor_id,action_key)
);
CREATE TABLE nexo.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, trip_id uuid NOT NULL,
  route_id uuid NOT NULL, passenger_id uuid REFERENCES nexo.users, created_by uuid NOT NULL REFERENCES nexo.users,
  group_id uuid NOT NULL, source text NOT NULL CHECK(source IN ('APP','WALK_IN')),
  seats integer NOT NULL CHECK(seats BETWEEN 1 AND 6), express boolean NOT NULL DEFAULT false,
  from_stop integer NOT NULL, to_stop integer NOT NULL, fare_id uuid NOT NULL,
  price_bob numeric(12,2) NOT NULL CHECK(price_bob>=0), fare_version integer NOT NULL,
  status text NOT NULL CHECK(status IN ('HELD','CONFIRMED','CANCELLED','REJECTED','EXPIRED','COMPLETED')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(association_id,id),
  FOREIGN KEY(association_id,trip_id,route_id) REFERENCES nexo.trips(association_id,id,route_id),
  FOREIGN KEY(association_id,route_id,from_stop) REFERENCES nexo.stops,
  FOREIGN KEY(association_id,route_id,to_stop) REFERENCES nexo.stops,
  FOREIGN KEY(association_id,fare_id,route_id) REFERENCES nexo.fares(association_id,id,route_id),
  CHECK(to_stop>from_stop), CHECK(NOT express OR seats=6),
  CHECK(source<>'APP' OR passenger_id IS NOT NULL)
);
CREATE INDEX inventory ON nexo.bookings(trip_id,from_stop,to_stop) WHERE status IN ('HELD','CONFIRMED');
CREATE INDEX linked_bookings ON nexo.bookings(group_id);
CREATE TABLE nexo.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL REFERENCES nexo.associations,
  actor_id uuid NOT NULL REFERENCES nexo.users, action text NOT NULL,
  entity_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- Identity is derived from a revocable opaque token, never from client user/tenant GUCs.
CREATE FUNCTION nexo.actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo AS $$
  SELECT user_id FROM nexo.sessions
  WHERE token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')
    AND revoked_at IS NULL AND expires_at>statement_timestamp()
$$;
CREATE FUNCTION nexo.has_role(a uuid, r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo AS $$
  SELECT EXISTS(SELECT FROM nexo.memberships WHERE association_id=a AND user_id=nexo.actor() AND role=r AND active)
$$;
CREATE FUNCTION nexo.drives(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo AS $$
  SELECT EXISTS(SELECT FROM nexo.trips WHERE id=t AND driver_id=nexo.actor()
    AND nexo.has_role(association_id,'DRIVER'))
$$;
CREATE FUNCTION nexo.require_actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.actor();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  RETURN u;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','associations','memberships','routes','stops','vehicles','trips','fares','actions','bookings','audit_events'] LOOP
    EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
CREATE POLICY association_read ON nexo.associations FOR SELECT USING (
  nexo.actor() IS NOT NULL AND (status='ACTIVE' OR nexo.has_role(id,'ASSOCIATION_ADMIN') OR nexo.has_role(id,'DRIVER')));
CREATE POLICY own_memberships ON nexo.memberships FOR SELECT USING (user_id=nexo.actor() OR nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
CREATE POLICY route_read ON nexo.routes FOR SELECT USING (nexo.actor() IS NOT NULL AND EXISTS(
  SELECT FROM nexo.associations a WHERE a.id=association_id));
CREATE POLICY stop_read ON nexo.stops FOR SELECT USING (EXISTS(SELECT FROM nexo.routes r WHERE r.id=route_id));
CREATE POLICY fare_read ON nexo.fares FOR SELECT USING (EXISTS(SELECT FROM nexo.routes r WHERE r.id=route_id));
CREATE POLICY vehicle_read ON nexo.vehicles FOR SELECT USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN') OR EXISTS(
  SELECT FROM nexo.trips t WHERE t.vehicle_id=vehicles.id AND nexo.drives(t.id)));
CREATE POLICY trip_read ON nexo.trips FOR SELECT USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN') OR nexo.drives(id));
CREATE POLICY booking_read ON nexo.bookings FOR SELECT USING (
  passenger_id=nexo.actor() OR created_by=nexo.actor() OR nexo.has_role(association_id,'ASSOCIATION_ADMIN') OR nexo.drives(trip_id));
CREATE POLICY audit_read ON nexo.audit_events FOR SELECT USING (nexo.has_role(association_id,'ASSOCIATION_ADMIN'));
-- No INSERT/UPDATE/DELETE grants or policies: all mutations use checked functions.
GRANT SELECT ON nexo.associations,nexo.memberships,nexo.routes,nexo.stops,nexo.fares,
  nexo.vehicles,nexo.trips,nexo.bookings,nexo.audit_events TO nexo_app;
GRANT EXECUTE ON FUNCTION nexo.actor(),nexo.has_role(uuid,text),nexo.drives(uuid) TO nexo_app;

CREATE FUNCTION nexo.guard_trip() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM nexo.memberships WHERE association_id=NEW.association_id
    AND user_id=NEW.driver_id AND role='DRIVER' AND active) THEN
    RAISE EXCEPTION 'INACTIVE_DRIVER' USING ERRCODE='23514';
  END IF;
  IF NEW.current_stop >= (SELECT stop_count FROM nexo.routes WHERE id=NEW.route_id) THEN
    RAISE EXCEPTION 'INVALID_PROGRESS' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_trip BEFORE INSERT OR UPDATE ON nexo.trips FOR EACH ROW EXECUTE FUNCTION nexo.guard_trip();
