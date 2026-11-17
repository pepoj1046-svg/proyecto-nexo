-- Run-level rescue snapshots contain other groups' technical IDs and prices.
-- Passengers read only the authorized operational_status projection, not raw manifests.
DROP POLICY operational_read ON nexo.road_rescues;
CREATE POLICY operational_read ON nexo.road_rescues FOR SELECT USING(
 nexo.manage_route((SELECT route_id FROM nexo.trips WHERE id=trip_id)) OR nexo.drives(trip_id)
);
DROP POLICY operational_read ON nexo.journey_events;
CREATE POLICY operational_read ON nexo.journey_events FOR SELECT USING(
 nexo.manage_route((SELECT route_id FROM nexo.trips WHERE id=trip_id)) OR nexo.drives(trip_id)
);
