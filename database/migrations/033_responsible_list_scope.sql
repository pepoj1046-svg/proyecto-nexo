-- Final audit: preserve 001–032 and all historical rows. Apply the same scope
-- boundary to count, items and next cursor, serialized with offline scope changes.
CREATE OR REPLACE FUNCTION nexo.care_responsible_list(page_size integer,cursor uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE items jsonb;next_id uuid;total integer;
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('admin-scope:'||nexo.require_actor()::text,0));
 PERFORM nexo.require_actor();IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 SELECT count(*)INTO total FROM nexo.bookings b WHERE b.source='WALK_IN'AND nexo.is_responsible(b.id)AND nexo.scope_allows(b.route_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('bookingId',x.id,'tripId',x.trip_id,'seats',x.seats,'status',x.status,'priceBOB',x.price_bob::text,'vehicle',x.vehicle)ORDER BY x.id),'[]')INTO items FROM(
 SELECT b.*,v.label AS vehicle FROM nexo.bookings b JOIN nexo.trips t ON t.id=b.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id WHERE b.source='WALK_IN'AND nexo.is_responsible(b.id)AND nexo.scope_allows(b.route_id)AND(cursor IS NULL OR b.id>cursor)ORDER BY b.id LIMIT page_size)x;
 IF jsonb_array_length(items)=page_size THEN next_id:=(items->(page_size-1)->>'bookingId')::uuid;IF NOT EXISTS(SELECT FROM nexo.bookings b WHERE b.source='WALK_IN'AND nexo.is_responsible(b.id)AND nexo.scope_allows(b.route_id)AND b.id>next_id)THEN next_id:=NULL;END IF;END IF;
 RETURN jsonb_build_object('bookings',items,'total',total,'nextCursor',next_id,'limit',page_size);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.care_responsible_list(integer,uuid)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.care_responsible_list(integer,uuid)TO nexo_app;
