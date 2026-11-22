-- 5A.7 Valoraciones de laboratorio (decisiones provisionales P-5A7-1 a P-5A7-6).
-- A passenger rates, once, an APP booking of his that the trip completed: a 1-5 score
-- plus optional predefined tags, no free text. Administrators of the association see the
-- ratings of the routes they manage, without the passenger's identity. Ratings have no
-- effect on inventory, fares, queue, custody or sanctions. Additive; 001-044 untouched.

CREATE TABLE nexo.service_ratings (
 booking_id uuid PRIMARY KEY REFERENCES nexo.bookings,
 association_id uuid NOT NULL REFERENCES nexo.associations,
 route_id uuid NOT NULL REFERENCES nexo.routes,
 trip_id uuid NOT NULL REFERENCES nexo.trips,
 score smallint NOT NULL CHECK(score BETWEEN 1 AND 5),
 tags text[] NOT NULL DEFAULT '{}' CHECK(cardinality(tags)<=4 AND tags<@ARRAY['PUNTUALIDAD','TRATO','LIMPIEZA','CONDUCCION_SEGURA']::text[]),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A rating is a fact: never edited or deleted (P-5A7-4).
CREATE TRIGGER immutable_service_ratings BEFORE UPDATE OR DELETE ON nexo.service_ratings
 FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
ALTER TABLE nexo.service_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexo.service_ratings FROM PUBLIC;

-- Passenger: his completed APP bookings of the last 30 days and whether each is rated.
CREATE FUNCTION nexo.web_ratable_bookings()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();items jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(x.entry ORDER BY x.created_at DESC,x.id),'[]'::jsonb)INTO items FROM(
  SELECT b.id,b.created_at,jsonb_build_object('bookingId',b.id,'route',r.name,'createdAt',b.created_at,'seats',b.seats,
   'rated',sr.booking_id IS NOT NULL,'score',sr.score,'tags',coalesce(to_jsonb(sr.tags),'[]'::jsonb))AS entry
  FROM nexo.bookings b JOIN nexo.routes r ON r.id=b.route_id LEFT JOIN nexo.service_ratings sr ON sr.booking_id=b.id
  WHERE b.passenger_id=u AND b.source='APP' AND b.status='COMPLETED' AND b.created_at>clock_timestamp()-interval '30 days'
  ORDER BY b.created_at DESC,b.id LIMIT 20)x;
 IF nexo.actor() IS DISTINCT FROM u THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 RETURN jsonb_build_object('items',items);
END $$;

-- Passenger: rate once. Idempotent by action key; a second key for the same booking is
-- refused (ALREADY_RATED). The booking row is locked FOR SHARE so its status cannot change
-- under the check.
CREATE FUNCTION nexo.web_rate_service(k text,booking uuid,score integer,tags jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();p jsonb;cached jsonb;b nexo.bookings;t text[];
BEGIN
 p:=jsonb_build_object('op','web_rate_service','booking',booking,'score',score,'tags',tags);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF booking IS NULL OR score IS NULL OR score NOT BETWEEN 1 AND 5 OR tags IS NULL OR jsonb_typeof(tags)<>'array' OR jsonb_array_length(tags)>4
  OR EXISTS(SELECT FROM jsonb_array_elements(tags)x WHERE jsonb_typeof(x)<>'string' OR NOT(x#>>'{}'=ANY(ARRAY['PUNTUALIDAD','TRATO','LIMPIEZA','CONDUCCION_SEGURA'])))
  OR(SELECT count(DISTINCT x#>>'{}')FROM jsonb_array_elements(tags)x)<>jsonb_array_length(tags)THEN RAISE EXCEPTION 'INVALID_RATING';END IF;
 SELECT * INTO b FROM nexo.bookings WHERE id=booking FOR SHARE;
 -- One answer for "not yours", "not completed" and "not APP": nothing about others leaks.
 IF b.id IS NULL OR b.passenger_id IS DISTINCT FROM u OR b.source<>'APP' OR b.status<>'COMPLETED' THEN RAISE EXCEPTION 'NOT_RATABLE';END IF;
 SELECT coalesce(array_agg(x ORDER BY x),'{}')INTO t FROM jsonb_array_elements_text(tags)x;
 INSERT INTO nexo.service_ratings(booking_id,association_id,route_id,trip_id,score,tags)VALUES(b.id,b.association_id,b.route_id,b.trip_id,score,t)
  ON CONFLICT(booking_id)DO NOTHING;
 IF NOT FOUND THEN RAISE EXCEPTION 'ALREADY_RATED';END IF;
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'score',score,'tags',to_jsonb(t),'rated',true));
END $$;

-- Administration: ratings of the routes the actor manages, newest first, with no
-- passenger or booking identifier, plus a per-route summary.
CREATE FUNCTION nexo.web_service_ratings(page_size integer,page_offset integer)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();items jsonb;summary jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM nexo.memberships WHERE user_id=u AND role='ASSOCIATION_ADMIN' AND active)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 WITH visible AS(
  SELECT a.name association,r.name route,v.label vehicle,(sr.created_at AT TIME ZONE 'America/La_Paz')::date AS day,sr.score,sr.tags,sr.created_at,sr.booking_id
  FROM nexo.service_ratings sr JOIN nexo.associations a ON a.id=sr.association_id JOIN nexo.routes r ON r.id=sr.route_id
  JOIN nexo.trips t ON t.id=sr.trip_id JOIN nexo.vehicles v ON v.id=t.vehicle_id
  WHERE nexo.has_role(sr.association_id,'ASSOCIATION_ADMIN') AND nexo.manage_route(sr.route_id)),
 page AS(SELECT * FROM visible ORDER BY created_at DESC,booking_id LIMIT page_size+1 OFFSET page_offset),
 totals AS(SELECT association,route,count(*)n,round(avg(score),2)::text avg FROM visible GROUP BY association,route)
 SELECT(SELECT coalesce(jsonb_agg(jsonb_build_object('association',x.association,'route',x.route,'vehicle',x.vehicle,'day',x.day,'score',x.score,'tags',to_jsonb(x.tags))ORDER BY x.created_at DESC,x.booking_id),'[]'::jsonb)FROM page x),
  (SELECT coalesce(jsonb_agg(jsonb_build_object('association',s.association,'route',s.route,'count',s.n,'average',s.avg)ORDER BY s.association,s.route),'[]'::jsonb)FROM totals s)
 INTO items,summary;
 RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(items)>page_size THEN items-page_size ELSE items END,'summary',summary,
  'limit',page_size,'offset',page_offset,'hasMore',jsonb_array_length(items)>page_size);
END $$;

REVOKE ALL ON FUNCTION nexo.web_ratable_bookings(),nexo.web_rate_service(text,uuid,integer,jsonb),nexo.web_service_ratings(integer,integer)
 FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_ratable_bookings(),nexo.web_rate_service(text,uuid,integer,jsonb),nexo.web_service_ratings(integer,integer)TO nexo_app;
