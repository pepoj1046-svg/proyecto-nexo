-- Stable logical runs, explicit withdrawal of the empty substitute's queue entry.
ALTER TABLE nexo.trips DROP CONSTRAINT trips_status_check;
ALTER TABLE nexo.trips ADD CONSTRAINT trips_status_check CHECK(status IN ('QUEUED','IN_TRANSIT','COMPLETED','WITHDRAWN'));
DROP INDEX nexo.one_active_vehicle;
DROP INDEX nexo.one_active_driver;
CREATE UNIQUE INDEX one_active_vehicle ON nexo.trips(vehicle_id) WHERE status IN ('QUEUED','IN_TRANSIT');
CREATE UNIQUE INDEX one_active_driver ON nexo.trips(driver_id) WHERE status IN ('QUEUED','IN_TRANSIT');
CREATE TABLE nexo.urban_runs (
 association_id uuid NOT NULL, trip_id uuid PRIMARY KEY, main_stop integer NOT NULL CHECK(main_stop>0),
 phase text NOT NULL CHECK(phase IN ('URBAN_COLLECTION','BREAKDOWN_REPORTED','AWAITING_REPLACEMENT','RESCUE','MAIN_TRIP','COMPLETED')),
 version integer NOT NULL DEFAULT 1, exclusive boolean NOT NULL DEFAULT false,
 urban_started_at timestamptz NOT NULL DEFAULT clock_timestamp(), main_started_at timestamptz,
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id)
);
CREATE TABLE nexo.fleet_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, trip_id uuid NOT NULL,
 original_vehicle uuid NOT NULL, reported_by uuid NOT NULL REFERENCES nexo.users,
 state text NOT NULL CHECK(state IN ('REPORTED','CONFIRMED','ASSIGNED','TRANSFERRED','CLEARED')),
 context text NOT NULL DEFAULT 'URBAN' CHECK(context IN ('URBAN','TERMINAL')),
 reason text NOT NULL DEFAULT 'MECHANICAL_FAILURE' CHECK(reason IN ('MECHANICAL_FAILURE','EMERGENCY_DECLARED','OPERATIONAL_BARRIER')),
 replacement_queue_trip uuid, replacement_vehicle uuid, onboard_at_assignment integer CHECK(onboard_at_assignment BETWEEN 0 AND 6),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,original_vehicle) REFERENCES nexo.vehicles(association_id,id),
 FOREIGN KEY(association_id,replacement_vehicle) REFERENCES nexo.vehicles(association_id,id),
 FOREIGN KEY(association_id,replacement_queue_trip) REFERENCES nexo.trips(association_id,id)
);
CREATE UNIQUE INDEX one_unresolved_incident ON nexo.fleet_incidents(trip_id) WHERE state NOT IN ('TRANSFERRED','CLEARED');
CREATE TABLE nexo.vehicle_blocks (
 association_id uuid NOT NULL, vehicle_id uuid PRIMARY KEY, incident_id uuid NOT NULL REFERENCES nexo.fleet_incidents,
 blocked boolean NOT NULL DEFAULT true,
 FOREIGN KEY(association_id,vehicle_id) REFERENCES nexo.vehicles(association_id,id)
);
CREATE TABLE nexo.fleet_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), association_id uuid NOT NULL, trip_id uuid NOT NULL,
 incident_id uuid REFERENCES nexo.fleet_incidents, actor_id uuid NOT NULL REFERENCES nexo.users,
 kind text NOT NULL CHECK(kind IN ('URBAN_STARTED','BREAKDOWN_REPORTED','BREAKDOWN_CONFIRMED','REPLACEMENT_ASSIGNED','SAFE_TRANSFER_RECORDED','MAIN_TRIP_STARTED','VEHICLE_RESTORED','PROGRESS')),
 vehicle_id uuid NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,trip_id) REFERENCES nexo.trips(association_id,id),
 FOREIGN KEY(association_id,vehicle_id) REFERENCES nexo.vehicles(association_id,id)
);
CREATE INDEX trip_vehicle_history ON nexo.trips(vehicle_id,id);
CREATE INDEX fleet_incident_trip ON nexo.fleet_incidents(trip_id,created_at,id);
CREATE INDEX fleet_events_trip ON nexo.fleet_events(trip_id,created_at,id);
CREATE INDEX fleet_incident_vehicle ON nexo.fleet_incidents(original_vehicle,created_at,id);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['urban_runs','fleet_incidents','fleet_events'] LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY operational_read ON nexo.%I FOR SELECT USING(nexo.has_role(association_id,''ASSOCIATION_ADMIN'') OR nexo.drives(trip_id) OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=%I.trip_id AND (b.passenger_id=nexo.actor() OR b.created_by=nexo.actor() OR nexo.is_responsible(b.id))))',t,t);
  EXECUTE format('GRANT SELECT ON nexo.%I TO nexo_app',t);
 END LOOP;
END $$;
CREATE TRIGGER immutable_fleet_events BEFORE UPDATE OR DELETE ON nexo.fleet_events FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
ALTER TABLE nexo.vehicle_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY operational_read ON nexo.vehicle_blocks FOR SELECT USING(nexo.has_role(association_id,'ASSOCIATION_ADMIN') OR nexo.has_role(association_id,'DRIVER'));
GRANT SELECT ON nexo.vehicle_blocks TO nexo_app;
CREATE OR REPLACE FUNCTION nexo.operational_revision(trip uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$ SELECT coalesce((SELECT version FROM nexo.urban_runs WHERE trip_id=trip),0) $$;
CREATE OR REPLACE FUNCTION nexo.trip_accepts_operations(trip uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.trips t WHERE t.id=trip AND t.status<>'WITHDRAWN'
 AND NOT EXISTS(SELECT FROM nexo.vehicle_blocks v WHERE v.vehicle_id=t.vehicle_id AND v.blocked)
 AND NOT EXISTS(SELECT FROM nexo.urban_runs r WHERE r.trip_id=t.id AND r.phase IN ('BREAKDOWN_REPORTED','AWAITING_REPLACEMENT','RESCUE')))
$$;
CREATE OR REPLACE FUNCTION nexo.capacity_accepts_operations(trip uuid,n integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.trip_accepts_operations(trip) AND (n=0 OR NOT EXISTS(SELECT FROM nexo.urban_runs WHERE trip_id=trip AND exclusive))
 AND NOT EXISTS(SELECT FROM nexo.trips h WHERE h.id<>trip AND h.vehicle_id=(SELECT vehicle_id FROM nexo.trips WHERE id=trip) AND nexo.observed_onboard(h.id)>0)
$$;
CREATE OR REPLACE FUNCTION nexo.fits(t uuid,f integer,e integer,n integer) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.capacity_accepts_operations(t,n) AND NOT EXISTS(SELECT FROM generate_series(f,e-1) s
 WHERE n+coalesce((SELECT sum(b.seats) FROM nexo.bookings b WHERE b.trip_id=t AND nexo.live(b) AND b.from_stop<=s AND b.to_stop>s),0)>6)
$$;
CREATE OR REPLACE FUNCTION nexo.movement_correction_allowed(trip uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.trip_accepts_operations(trip) AND EXISTS(SELECT FROM nexo.trips t WHERE t.id=trip AND t.status IN ('QUEUED','IN_TRANSIT','COMPLETED')
 AND (t.status<>'COMPLETED' OR NOT EXISTS(SELECT FROM nexo.trips later WHERE later.id<>t.id AND later.vehicle_id=t.vehicle_id AND
 (later.status IN ('QUEUED','IN_TRANSIT') OR later.completed_at>t.completed_at))))
$$;
CREATE FUNCTION nexo.guard_vehicle_service() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR (NEW.status IN ('QUEUED','IN_TRANSIT') AND OLD.status NOT IN ('QUEUED','IN_TRANSIT')) THEN
  PERFORM 1 FROM nexo.vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
  IF EXISTS(SELECT FROM nexo.vehicle_blocks WHERE vehicle_id=NEW.vehicle_id AND blocked) THEN RAISE EXCEPTION 'VEHICLE_OUT_OF_SERVICE'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_vehicle_service BEFORE INSERT OR UPDATE ON nexo.trips FOR EACH ROW EXECUTE FUNCTION nexo.guard_vehicle_service();
CREATE FUNCTION nexo.guard_booking_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF NEW.status IN ('HELD','CONFIRMED') AND (TG_OP='INSERT' OR NEW.trip_id IS DISTINCT FROM OLD.trip_id) AND NOT nexo.capacity_accepts_operations(NEW.trip_id,NEW.seats) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_operation BEFORE INSERT OR UPDATE ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.guard_booking_operation();
CREATE FUNCTION nexo.booking_onboard(booking uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(sum(CASE WHEN m.member_id IS NULL THEN b.seats ELSE 1 END),0)::integer FROM nexo.effective_movements m JOIN nexo.bookings b ON b.id=m.booking_id
 WHERE b.id=booking AND m.kind='BOARD' AND NOT EXISTS(SELECT FROM nexo.effective_movements a WHERE a.booking_id=b.id AND a.member_id IS NOT DISTINCT FROM m.member_id AND a.kind='ALIGHT')
$$;
CREATE FUNCTION nexo.operational_status(trip uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;r nexo.urban_runs;i nexo.fleet_incidents;u uuid:=nexo.require_actor();pending integer;
BEGIN
 SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT(nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN') OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND (b.passenger_id=u OR b.created_by=u OR nexo.is_responsible(b.id))) OR EXISTS(SELECT FROM nexo.fleet_incidents f WHERE f.trip_id=t.id AND f.reported_by=u)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO r FROM nexo.urban_runs WHERE trip_id=t.id;
 SELECT * INTO i FROM nexo.fleet_incidents WHERE trip_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT coalesce(sum(greatest(b.seats-nexo.booking_onboard(b.id),0)),0) INTO pending FROM nexo.bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED' AND b.from_stop<=coalesce(r.main_stop,t.current_stop);
 RETURN jsonb_build_object('tripId',t.id,'version',coalesce(r.version,0),'phase',coalesce(r.phase,CASE WHEN i.context='TERMINAL' AND i.state IN ('REPORTED','CONFIRMED') THEN 'OPERATIONAL_INCIDENT' ELSE CASE WHEN t.status='IN_TRANSIT' THEN 'LEGACY_IN_TRANSIT' ELSE t.status END END),
 'vehicleId',t.vehicle_id,'currentStop',t.current_stop,'mainStop',r.main_stop,'mainStartedAt',r.main_started_at,'exclusive',coalesce(r.exclusive,false),
 'observedOnboard',nexo.observed_onboard(t.id),'pendingPickupSeats',pending,'incidentId',i.id,'incidentState',i.state,'incidentReason',i.reason,'originalVehicleId',i.original_vehicle,'replacementVehicleId',i.replacement_vehicle,
 'positionDeclaredNotGPS',true,'delivery','DISABLED');
END $$;
CREATE FUNCTION nexo.free_replacement(incident uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE i nexo.fleet_incidents;t nexo.trips;candidate uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO i FROM nexo.fleet_incidents WHERE id=incident;
 IF NOT FOUND OR NOT nexo.has_role(i.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO t FROM nexo.trips WHERE id=i.trip_id;
 IF i.state<>'CONFIRMED' OR i.context<>'URBAN' OR NOT nexo.can_search_route(t.route_id) THEN RETURN NULL; END IF;
 SELECT tr.id INTO candidate FROM nexo.trips tr JOIN nexo.memberships m ON m.association_id=tr.association_id AND m.user_id=tr.driver_id AND m.role='DRIVER' AND m.active
 WHERE tr.association_id=i.association_id AND tr.route_id=t.route_id AND tr.status='QUEUED' AND tr.current_stop=0 AND tr.id<>t.id
 AND nexo.trip_accepts_operations(tr.id) AND NOT EXISTS(SELECT FROM nexo.urban_runs WHERE trip_id=tr.id)
 AND NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=tr.id AND nexo.live(b))
 AND NOT EXISTS(SELECT FROM nexo.trips h WHERE h.vehicle_id=tr.vehicle_id AND nexo.observed_onboard(h.id)>0)
 ORDER BY tr.position_no,tr.id LIMIT 1;
 RETURN candidate;
END $$;
ALTER FUNCTION nexo.depart(text,uuid) RENAME TO depart_legacy;
ALTER FUNCTION nexo.progress(text,uuid,integer) RENAME TO progress_legacy;
REVOKE EXECUTE ON FUNCTION nexo.depart_legacy(text,uuid),nexo.progress_legacy(text,uuid,integer) FROM nexo_app,PUBLIC;
CREATE FUNCTION nexo.depart(k text,trip uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;p jsonb:=jsonb_build_object('op','depart','trip',trip);cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF NOT nexo.trip_accepts_operations(t.id) OR nexo.physical_onboard(t.id)>nexo.observed_onboard(t.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;
 RETURN nexo.depart_legacy(k,trip);
END $$;
CREATE FUNCTION nexo.progress(k text,trip uuid,stop integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;r nexo.urban_runs;p jsonb:=jsonb_build_object('op','progress','trip',trip,'stop',stop);cached jsonb;result jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;
 SELECT * INTO t FROM nexo.trips WHERE id=trip;SELECT * INTO r FROM nexo.urban_runs WHERE trip_id=t.id;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF NOT nexo.trip_accepts_operations(t.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;
 IF r.phase='URBAN_COLLECTION' AND (stop>r.main_stop OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED' AND b.from_stop<stop AND nexo.booking_onboard(b.id)<b.seats)) THEN RAISE EXCEPTION 'PICKUPS_PENDING'; END IF;
 result:=nexo.progress_legacy(k,trip,stop);
 IF r.trip_id IS NOT NULL THEN
  UPDATE nexo.urban_runs SET version=version+1,phase=CASE WHEN result->>'status'='COMPLETED' THEN 'COMPLETED' ELSE phase END WHERE trip_id=t.id;
  INSERT INTO nexo.fleet_events(association_id,trip_id,actor_id,kind,vehicle_id,payload) VALUES(t.association_id,t.id,nexo.require_actor(),'PROGRESS',t.vehicle_id,jsonb_build_object('stop',stop));
  result:=result||jsonb_build_object('legacyStatus',result->>'status','status',(SELECT phase FROM nexo.urban_runs WHERE trip_id=t.id),'mainStartedAt',(SELECT main_started_at FROM nexo.urban_runs WHERE trip_id=t.id));
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION nexo.begin_urban(k text,trip uuid,main_stop integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;p jsonb;cached jsonb;inner_key text;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR main_stop IS NULL THEN RAISE EXCEPTION 'INVALID_URBAN_CONFIRMATION'; END IF;
 p:=jsonb_build_object('op','begin_urban','trip',trip,'mainStop',main_stop);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 inner_key:='urban:'||encode(sha256(convert_to(k,'UTF8')),'hex');PERFORM nexo.action_start(inner_key,jsonb_build_object('op','depart','trip',trip));
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF t.status<>'QUEUED' OR t.current_stop<>0 OR main_stop<=0 OR main_stop>=(SELECT stop_count-1 FROM nexo.routes WHERE id=t.route_id) OR EXISTS(SELECT FROM nexo.urban_runs WHERE trip_id=t.id) THEN RAISE EXCEPTION 'INVALID_URBAN_STATE'; END IF;
 IF EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED' AND (b.from_stop>main_stop OR b.to_stop<=main_stop)) OR (SELECT coalesce(sum(seats),0) FROM nexo.bookings WHERE trip_id=t.id AND status='CONFIRMED')<>6 THEN RAISE EXCEPTION 'UNSUPPORTED_URBAN_MANIFEST'; END IF;
 PERFORM nexo.require_eligible_route(t.route_id);
 INSERT INTO nexo.urban_runs(association_id,trip_id,main_stop,phase) VALUES(t.association_id,t.id,main_stop,'URBAN_COLLECTION');
 PERFORM nexo.depart(inner_key,t.id);
 INSERT INTO nexo.operational_notices(association_id,trip_id,booking_id,recipient_id,kind) SELECT b.association_id,b.trip_id,b.id,nexo.responsible_user(b.id),'URBAN_STARTED' FROM nexo.bookings b WHERE b.trip_id=t.id AND nexo.responsible_user(b.id) IS NOT NULL;
 INSERT INTO nexo.fleet_events(association_id,trip_id,actor_id,kind,vehicle_id,payload) VALUES(t.association_id,t.id,nexo.require_actor(),'URBAN_STARTED',t.vehicle_id,jsonb_build_object('mainStop',main_stop,'declared',true));
 RETURN nexo.action_finish(k,p,nexo.operational_status(t.id));
END $$;
CREATE FUNCTION nexo.fleet_command(k text,trip uuid,expected integer,command text,target uuid,onboard integer,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;r nexo.urban_runs;i nexo.fleet_incidents;c nexo.trips;p jsonb;cached jsonb;candidate uuid;recipient uuid;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT(nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR command IS NULL OR command NOT IN ('REPORT','CONFIRM','ASSIGN','SAFE_TRANSFER','MAIN_START') THEN RAISE EXCEPTION 'INVALID_FLEET_COMMAND'; END IF;
 p:=jsonb_build_object('op','fleet_command','trip',trip,'version',expected,'command',command,'target',target,'onboard',onboard);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
 SELECT * INTO r FROM nexo.urban_runs WHERE trip_id=trip FOR UPDATE;
 IF NOT(nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF r.trip_id IS NULL OR r.version<>expected THEN RAISE EXCEPTION 'STALE_OPERATION'; END IF;
 IF command IN ('CONFIRM','ASSIGN') AND NOT nexo.has_role(t.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF command IN ('REPORT','MAIN_START') AND NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO i FROM nexo.fleet_incidents WHERE trip_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF command='REPORT' THEN
  IF r.phase<>'URBAN_COLLECTION' OR t.status<>'IN_TRANSIT' OR t.current_stop>=r.main_stop THEN RAISE EXCEPTION 'OUTSIDE_URBAN_SCOPE'; END IF;
  PERFORM 1 FROM nexo.vehicles WHERE id=t.vehicle_id FOR UPDATE;
  INSERT INTO nexo.fleet_incidents(association_id,trip_id,original_vehicle,reported_by,state) VALUES(t.association_id,t.id,t.vehicle_id,nexo.require_actor(),'REPORTED') RETURNING * INTO i;
  INSERT INTO nexo.vehicle_blocks VALUES(t.association_id,t.vehicle_id,i.id,true) ON CONFLICT(vehicle_id) DO UPDATE SET incident_id=excluded.incident_id,blocked=true;
  UPDATE nexo.urban_runs SET phase='BREAKDOWN_REPORTED',version=version+1 WHERE trip_id=t.id;
  INSERT INTO nexo.fleet_events(association_id,trip_id,incident_id,actor_id,kind,vehicle_id) VALUES(t.association_id,t.id,i.id,nexo.require_actor(),'BREAKDOWN_REPORTED',t.vehicle_id);
 ELSIF command='CONFIRM' THEN
  IF r.phase<>'BREAKDOWN_REPORTED' OR i.state<>'REPORTED' THEN RAISE EXCEPTION 'INVALID_FLEET_STATE'; END IF;
  UPDATE nexo.fleet_incidents SET state='CONFIRMED' WHERE id=i.id;
  UPDATE nexo.urban_runs SET phase='AWAITING_REPLACEMENT',version=version+1 WHERE trip_id=t.id;
  INSERT INTO nexo.fleet_events(association_id,trip_id,incident_id,actor_id,kind,vehicle_id) VALUES(t.association_id,t.id,i.id,nexo.require_actor(),'BREAKDOWN_CONFIRMED',t.vehicle_id);
 ELSIF command='ASSIGN' THEN
  IF r.phase<>'AWAITING_REPLACEMENT' OR i.state<>'CONFIRMED' THEN RAISE EXCEPTION 'INVALID_FLEET_STATE'; END IF;
  PERFORM nexo.require_eligible_route(t.route_id);candidate:=nexo.free_replacement(i.id);
  IF candidate IS NULL THEN RAISE EXCEPTION 'NO_FREE_REPLACEMENT'; END IF;
  IF candidate IS DISTINCT FROM target THEN RAISE EXCEPTION 'QUEUE_ORDER'; END IF;
  SELECT * INTO c FROM nexo.trips WHERE id=candidate FOR UPDATE;
  PERFORM 1 FROM nexo.vehicles WHERE id=c.vehicle_id FOR UPDATE;
  PERFORM 1 FROM nexo.memberships WHERE association_id=c.association_id AND user_id=c.driver_id AND role='DRIVER' AND active FOR SHARE;
  IF NOT FOUND OR NOT nexo.trip_accepts_operations(c.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;
  UPDATE nexo.trips SET status='WITHDRAWN' WHERE id=c.id;
  UPDATE nexo.trips SET vehicle_id=c.vehicle_id,driver_id=c.driver_id WHERE id=t.id;
  UPDATE nexo.fleet_incidents SET state='ASSIGNED',replacement_queue_trip=c.id,replacement_vehicle=c.vehicle_id,onboard_at_assignment=nexo.observed_onboard(t.id) WHERE id=i.id;
  UPDATE nexo.urban_runs SET phase='RESCUE',version=version+1,exclusive=true WHERE trip_id=t.id;
  INSERT INTO nexo.fleet_events(association_id,trip_id,incident_id,actor_id,kind,vehicle_id,payload) VALUES(t.association_id,t.id,i.id,nexo.require_actor(),'REPLACEMENT_ASSIGNED',c.vehicle_id,jsonb_build_object('originalVehicle',i.original_vehicle,'withdrawnQueueTrip',c.id));
  INSERT INTO nexo.operational_notices(association_id,trip_id,booking_id,recipient_id,kind) SELECT b.association_id,b.trip_id,b.id,nexo.responsible_user(b.id),'REPLACEMENT_ASSIGNED' FROM nexo.bookings b WHERE b.trip_id=t.id AND nexo.responsible_user(b.id) IS NOT NULL;
  INSERT INTO nexo.operational_notices(association_id,trip_id,recipient_id,kind) VALUES(t.association_id,t.id,c.driver_id,'REPLACEMENT_ASSIGNED');
 ELSIF command='SAFE_TRANSFER' THEN
  IF r.phase<>'RESCUE' OR i.state<>'ASSIGNED' OR onboard IS NULL OR onboard IS DISTINCT FROM i.onboard_at_assignment OR onboard IS DISTINCT FROM nexo.observed_onboard(t.id) THEN RAISE EXCEPTION 'INVALID_SAFE_TRANSFER'; END IF;
  UPDATE nexo.fleet_incidents SET state='TRANSFERRED' WHERE id=i.id;
  UPDATE nexo.urban_runs SET phase='URBAN_COLLECTION',version=version+1 WHERE trip_id=t.id;
  INSERT INTO nexo.fleet_events(association_id,trip_id,incident_id,actor_id,kind,vehicle_id,payload) VALUES(t.association_id,t.id,i.id,nexo.require_actor(),'SAFE_TRANSFER_RECORDED',t.vehicle_id,jsonb_build_object('onboard',onboard,'safePoint','SIMULATED_SAFE_POINT','declared',true));
 ELSIF command='MAIN_START' THEN
  IF r.phase<>'URBAN_COLLECTION' OR t.current_stop<>r.main_stop OR EXISTS(SELECT FROM nexo.bookings b WHERE b.trip_id=t.id AND b.status='CONFIRMED' AND nexo.booking_onboard(b.id)<>b.seats) THEN RAISE EXCEPTION 'PICKUPS_PENDING'; END IF;
  IF NOT nexo.trip_accepts_operations(t.id) THEN RAISE EXCEPTION 'OPERATION_BLOCKED'; END IF;
  INSERT INTO nexo.operational_notices(association_id,trip_id,booking_id,recipient_id,kind) SELECT b.association_id,b.trip_id,b.id,nexo.responsible_user(b.id),'MAIN_TRIP_STARTED' FROM nexo.bookings b WHERE b.trip_id=t.id AND nexo.responsible_user(b.id) IS NOT NULL;
  UPDATE nexo.urban_runs SET phase='MAIN_TRIP',version=version+1,main_started_at=clock_timestamp() WHERE trip_id=t.id;
  INSERT INTO nexo.fleet_events(association_id,trip_id,actor_id,kind,vehicle_id,payload) VALUES(t.association_id,t.id,nexo.require_actor(),'MAIN_TRIP_STARTED',t.vehicle_id,jsonb_build_object('declared',true));
 END IF;
 PERFORM nexo.audit(t.association_id,'FLEET_'||command,t.id);
 RETURN nexo.action_finish(k,p,nexo.operational_status(t.id));
END $$;
CREATE FUNCTION nexo.restore_vehicle(k text,vehicle uuid,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE v nexo.vehicles;i nexo.fleet_incidents;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO v FROM nexo.vehicles WHERE id=vehicle;
 IF NOT FOUND OR NOT nexo.has_role(v.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_CONFIRMATION'; END IF;
 p:=jsonb_build_object('op','restore_vehicle','vehicle',vehicle);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT f.* INTO i FROM nexo.fleet_incidents f JOIN nexo.vehicle_blocks b ON b.incident_id=f.id WHERE b.vehicle_id=v.id AND b.blocked;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_RECOVERY_STATE'; END IF;
 PERFORM 1 FROM nexo.routes WHERE id=(SELECT route_id FROM nexo.trips WHERE id=i.trip_id) FOR UPDATE;
 PERFORM 1 FROM nexo.vehicles WHERE id=v.id FOR UPDATE;
 IF NOT nexo.has_role(v.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO i FROM nexo.fleet_incidents WHERE id=i.id;
 IF i.context='TERMINAL' THEN
  IF NOT EXISTS(SELECT FROM nexo.trips WHERE id=i.trip_id AND vehicle_id=v.id AND status='QUEUED') OR nexo.observed_onboard(i.trip_id)<>0 THEN RAISE EXCEPTION 'INVALID_RECOVERY_STATE'; END IF;
  UPDATE nexo.fleet_incidents SET state='CLEARED' WHERE id=i.id;
 ELSIF i.state<>'TRANSFERRED' THEN RAISE EXCEPTION 'INVALID_RECOVERY_STATE'; END IF;
 IF EXISTS(SELECT FROM nexo.trips WHERE vehicle_id=v.id AND status IN ('QUEUED','IN_TRANSIT') AND NOT(i.context='TERMINAL' AND id=i.trip_id)) THEN RAISE EXCEPTION 'INVALID_RECOVERY_STATE'; END IF;
 UPDATE nexo.vehicle_blocks SET blocked=false WHERE vehicle_id=v.id;
 INSERT INTO nexo.fleet_events(association_id,trip_id,incident_id,actor_id,kind,vehicle_id,payload) VALUES(v.association_id,i.trip_id,i.id,nexo.require_actor(),'VEHICLE_RESTORED',v.id,jsonb_build_object('repairVerifiedSimulated',true));
 PERFORM nexo.audit(v.association_id,'VEHICLE_RESTORED',v.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('vehicleId',v.id,'available',true,'repairVerifiedSimulated',true));
END $$;
CREATE OR REPLACE FUNCTION nexo.request_queue(k text, previous_trip uuid, target_route uuid) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor(); t nexo.trips; source nexo.routes; target nexo.routes;
  p jsonb; cached jsonb; next_position bigint; next_trip uuid;
BEGIN
  p:=jsonb_build_object('op','request_queue','previous',previous_trip,'target',target_route);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO t FROM nexo.trips WHERE id=previous_trip;
  IF NOT FOUND OR NOT nexo.drives(t.id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF t.status<>'COMPLETED' THEN RAISE EXCEPTION 'NOT_AVAILABLE'; END IF;
  PERFORM 1 FROM nexo.routes WHERE id IN (t.route_id,target_route) ORDER BY id FOR UPDATE;
  SELECT * INTO source FROM nexo.routes WHERE id=t.route_id;
  SELECT * INTO target FROM nexo.routes WHERE id=target_route AND association_id=t.association_id;
  IF NOT FOUND OR source.destination_locality_id IS NULL OR target.catalog_id IS DISTINCT FROM source.catalog_id
    OR target.origin_locality_id IS DISTINCT FROM source.destination_locality_id THEN
    RAISE EXCEPTION 'INVALID_DESTINATION_QUEUE';
  END IF;
  IF t.completed_at IS NULL OR EXISTS(SELECT FROM nexo.trips later WHERE
    (later.vehicle_id=t.vehicle_id OR later.driver_id=u) AND later.status='COMPLETED'
    AND later.completed_at>t.completed_at) THEN RAISE EXCEPTION 'STALE_PREVIOUS_TRIP'; END IF;
  IF EXISTS(SELECT FROM nexo.trips WHERE status IN ('QUEUED','IN_TRANSIT') AND (vehicle_id=t.vehicle_id OR driver_id=u)) THEN
    RAISE EXCEPTION 'ALREADY_ACTIVE';
  END IF;
  PERFORM nexo.require_eligible_route(target_route);
  SELECT coalesce(max(position_no),0)+1 INTO next_position FROM nexo.trips WHERE route_id=target.id;
  INSERT INTO nexo.trips(association_id,route_id,vehicle_id,driver_id,position_no)
    VALUES(t.association_id,target.id,t.vehicle_id,u,next_position) RETURNING id INTO next_trip;
  PERFORM nexo.audit(t.association_id,'QUEUE_REQUESTED',next_trip);
  RETURN nexo.action_finish(k,p,jsonb_build_object('tripId',next_trip,'position',next_position));
END $$;
GRANT EXECUTE ON FUNCTION nexo.depart(text,uuid),nexo.progress(text,uuid,integer),nexo.operational_status(uuid),nexo.free_replacement(uuid),nexo.begin_urban(text,uuid,integer,boolean),nexo.fleet_command(text,uuid,integer,text,uuid,integer,boolean),nexo.restore_vehicle(text,uuid,boolean) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;

CREATE FUNCTION nexo.terminal_impediment(k text,trip uuid,command text,reason_code text,confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE t nexo.trips;i nexo.fleet_incidents;p jsonb;cached jsonb;
BEGIN
 PERFORM nexo.require_actor();SELECT * INTO t FROM nexo.trips WHERE id=trip;
 IF NOT FOUND OR NOT(nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF confirmed IS DISTINCT FROM true OR command IS NULL OR command NOT IN ('REPORT','CONFIRM') OR reason_code IS NULL OR reason_code NOT IN ('MECHANICAL_FAILURE','EMERGENCY_DECLARED','OPERATIONAL_BARRIER') THEN RAISE EXCEPTION 'INVALID_INCIDENT'; END IF;
 p:=jsonb_build_object('op','terminal_impediment','trip',trip,'command',command,'reason',reason_code);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=t.route_id FOR UPDATE;SELECT * INTO t FROM nexo.trips WHERE id=trip FOR UPDATE;
 IF NOT(nexo.drives(t.id) OR nexo.has_role(t.association_id,'ASSOCIATION_ADMIN')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF t.status<>'QUEUED' OR t.current_stop<>0 OR EXISTS(SELECT FROM nexo.urban_runs WHERE trip_id=t.id) THEN RAISE EXCEPTION 'OUTSIDE_URBAN_SCOPE'; END IF;
 IF command='REPORT' THEN
  PERFORM 1 FROM nexo.vehicles WHERE id=t.vehicle_id FOR UPDATE;
  IF EXISTS(SELECT FROM nexo.fleet_incidents WHERE trip_id=t.id AND state NOT IN ('TRANSFERRED','CLEARED')) THEN RAISE EXCEPTION 'INVALID_FLEET_STATE'; END IF;
  INSERT INTO nexo.fleet_incidents(association_id,trip_id,original_vehicle,reported_by,state,context,reason) VALUES(t.association_id,t.id,t.vehicle_id,nexo.require_actor(),'REPORTED','TERMINAL',reason_code) RETURNING * INTO i;
  INSERT INTO nexo.vehicle_blocks VALUES(t.association_id,t.vehicle_id,i.id,true) ON CONFLICT(vehicle_id) DO UPDATE SET incident_id=excluded.incident_id,blocked=true;
 ELSE
  IF NOT nexo.has_role(t.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO i FROM nexo.fleet_incidents WHERE trip_id=t.id AND state='REPORTED' AND context='TERMINAL';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_FLEET_STATE'; END IF;
  UPDATE nexo.fleet_incidents SET state='CONFIRMED' WHERE id=i.id;
 END IF;
 INSERT INTO nexo.fleet_events(association_id,trip_id,incident_id,actor_id,kind,vehicle_id,payload) VALUES(t.association_id,t.id,i.id,nexo.require_actor(),CASE WHEN command='REPORT' THEN 'BREAKDOWN_REPORTED' ELSE 'BREAKDOWN_CONFIRMED' END,t.vehicle_id,jsonb_build_object('context','TERMINAL','reason',reason_code,'declared',true));
 PERFORM nexo.audit(t.association_id,'TERMINAL_IMPEDIMENT_'||command,t.id);
 RETURN nexo.action_finish(k,p,nexo.operational_status(t.id));
END $$;
GRANT EXECUTE ON FUNCTION nexo.terminal_impediment(text,uuid,text,text,boolean) TO nexo_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA nexo FROM PUBLIC;
