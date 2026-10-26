-- TRUFIS BOLIVIA / PROYECTO-NEXO
-- Diseño mínimo PostgreSQL para revisión. NO desplegar automáticamente.
-- Extensión para UUID aleatorio (PostgreSQL reciente).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  legal_name text,
  public_contact text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  association_id uuid NOT NULL REFERENCES associations(id),
  role text NOT NULL CHECK(role IN ('ASSOCIATION_ADMIN','DRIVER')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','REVOKED')),
  UNIQUE(user_id,association_id,role)
);
-- La función de administrador general se gestiona separadamente de asociaciones.
CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY REFERENCES users(id)
);
CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  origin_name text NOT NULL,
  destination_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, association_id)
);
CREATE TABLE stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id),
  name text NOT NULL,
  route_order integer NOT NULL CHECK(route_order >= 0),
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_boarding_allowed boolean NOT NULL DEFAULT true,
  is_alighting_allowed boolean NOT NULL DEFAULT true,
  UNIQUE(route_id,route_order),
  UNIQUE(id,route_id),
  CHECK ((latitude IS NULL AND longitude IS NULL) OR
    (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  plate text NOT NULL UNIQUE,
  passenger_capacity integer NOT NULL DEFAULT 6 CHECK(passenger_capacity BETWEEN 1 AND 6),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','QUEUED','ON_TRIP','INACTIVE')),
  UNIQUE(id,association_id)
);
CREATE TABLE driver_vehicle_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  driver_id uuid NOT NULL REFERENCES users(id),
  vehicle_id uuid NOT NULL,
  route_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  FOREIGN KEY(vehicle_id,association_id) REFERENCES vehicles(id,association_id),
  FOREIGN KEY(route_id,association_id) REFERENCES routes(id,association_id),
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  route_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  position_no bigint NOT NULL CHECK(position_no > 0),
  left_at timestamptz,
  FOREIGN KEY(route_id,association_id) REFERENCES routes(id,association_id),
  FOREIGN KEY(vehicle_id,association_id) REFERENCES vehicles(id,association_id),
  CHECK(left_at IS NULL OR left_at >= joined_at)
);
CREATE UNIQUE INDEX one_active_queue_per_vehicle ON queue_entries(vehicle_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX active_queue_position ON queue_entries(route_id,position_no) WHERE left_at IS NULL;

CREATE TABLE fare_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  route_id uuid NOT NULL,
  from_stop_id uuid NOT NULL,
  to_stop_id uuid NOT NULL,
  service_type text NOT NULL CHECK(service_type IN ('ORDINARY','EXPRESS')),
  price_bob numeric(12,2) NOT NULL CHECK(price_bob >= 0),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  FOREIGN KEY(route_id,association_id) REFERENCES routes(id,association_id),
  FOREIGN KEY(from_stop_id,route_id) REFERENCES stops(id,route_id),
  FOREIGN KEY(to_stop_id,route_id) REFERENCES stops(id,route_id),
  CHECK(from_stop_id <> to_stop_id),
  CHECK(valid_until IS NULL OR valid_until > valid_from)
);
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  route_id uuid NOT NULL,
  passenger_id uuid REFERENCES users(id),
  source text NOT NULL CHECK(source IN ('APP','WALK_IN')),
  seats integer NOT NULL CHECK(seats BETWEEN 1 AND 6),
  is_express boolean NOT NULL DEFAULT false,
  from_stop_id uuid NOT NULL,
  to_stop_id uuid NOT NULL,
  price_bob numeric(12,2) NOT NULL CHECK(price_bob >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','ASSIGNED','CANCELLED','COMPLETED')),
  requested_departure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(route_id,association_id) REFERENCES routes(id,association_id),
  FOREIGN KEY(from_stop_id,route_id) REFERENCES stops(id,route_id),
  FOREIGN KEY(to_stop_id,route_id) REFERENCES stops(id,route_id),
  CHECK(from_stop_id <> to_stop_id),
  CHECK((source='APP' AND passenger_id IS NOT NULL) OR source='WALK_IN')
);
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  association_id uuid NOT NULL REFERENCES associations(id),
  vehicle_id uuid NOT NULL,
  driver_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('OFFERED','ACCEPTED','REJECTED','EXPIRED','RELEASED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(vehicle_id,association_id) REFERENCES vehicles(id,association_id)
);
CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  route_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  driver_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK(status IN ('ASSIGNED','TO_PICKUP','PICKED_UP','IN_TRANSIT','ARRIVED','COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(route_id,association_id) REFERENCES routes(id,association_id),
  FOREIGN KEY(vehicle_id,association_id) REFERENCES vehicles(id,association_id)
);
CREATE TABLE trip_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id),
  booking_id uuid REFERENCES bookings(id),
  actor_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  actual_boarded integer CHECK(actual_boarded IS NULL OR actual_boarded >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  UNIQUE(trip_id,idempotency_key)
);
CREATE TABLE payment_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  method text NOT NULL CHECK(method IN ('CASH','QR')),
  amount_bob numeric(12,2) NOT NULL CHECK(amount_bob > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REPORTED','VERIFIED','FAILED','REFUNDED')),
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(method,provider_reference)
);
CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_part_id uuid NOT NULL REFERENCES payment_parts(id),
  association_id uuid NOT NULL REFERENCES associations(id),
  amount_bob numeric(12,2) NOT NULL CHECK(amount_bob > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','REVIEW','COMPLETED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid NOT NULL REFERENCES associations(id),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('ACTIVE','GRACE','FROZEN','UNDER_REVIEW','SUSPENDED','EXPIRED')),
  fixed_fee_bob numeric(12,2) NOT NULL CHECK(fixed_fee_bob >= 0),
  CHECK(expires_at > starts_at)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid REFERENCES associations(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- ETAPA 1: faltan aislamiento RLS, garantías para asociación cruzada en assignments,
-- eventos de ofertas, disponibilidad segmentada transaccional y migraciones con herramienta.
-- Este SQL es un primer borrador, NO esquema listo para producción.
