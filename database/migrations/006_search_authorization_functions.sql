CREATE FUNCTION nexo.classify_journey(origin uuid,destination uuid) RETURNS text LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT CASE WHEN po.department_id<>pd.department_id THEN 'INTERDEPARTAMENTAL'
    WHEN mo.province_id<>md.province_id THEN 'INTERPROVINCIAL'
    WHEN o.municipality_id<>d.municipality_id THEN 'INTERMUNICIPAL' END
  FROM nexo.localities o JOIN nexo.localities d ON d.id=destination AND d.catalog_id=o.catalog_id
  JOIN nexo.municipalities mo ON mo.id=o.municipality_id JOIN nexo.municipalities md ON md.id=d.municipality_id
  JOIN nexo.provinces po ON po.id=mo.province_id JOIN nexo.provinces pd ON pd.id=md.province_id
  WHERE o.id=origin
$$;
CREATE FUNCTION nexo.route_eligible(route uuid) RETURNS boolean LANGUAGE sql VOLATILE
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
  SELECT EXISTS(SELECT FROM nexo.routes r JOIN nexo.associations a ON a.id=r.association_id
    JOIN nexo.geo_catalogs c ON c.id=r.catalog_id
    WHERE r.id=route AND a.status='ACTIVE' AND a.adherence_status='ADHERED' AND a.operating_status='OPERATING'
    AND c.status='ACTIVE' AND nexo.classify_journey(r.origin_locality_id,r.destination_locality_id) IS NOT NULL
    AND (SELECT count(*) FROM nexo.stops s WHERE s.route_id=r.id AND s.catalog_id=r.catalog_id AND s.locality_id IS NOT NULL
      AND s.stop_index>=0 AND s.stop_index<r.stop_count)=r.stop_count
    AND EXISTS(SELECT FROM nexo.stops s WHERE s.route_id=r.id AND s.stop_index=0 AND s.locality_id=r.origin_locality_id)
    AND EXISTS(SELECT FROM nexo.stops s WHERE s.route_id=r.id AND s.stop_index=r.stop_count-1 AND s.locality_id=r.destination_locality_id)
    AND EXISTS(SELECT FROM nexo.route_authorizations x WHERE x.route_id=r.id AND x.association_id=r.association_id
      AND x.status='VERIFIED' AND x.valid_from<=clock_timestamp() AND x.valid_until>clock_timestamp()))
$$;
CREATE FUNCTION nexo.require_eligible_route(route uuid) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE r nexo.routes; commercial_status text;
BEGIN
  SELECT * INTO r FROM nexo.routes WHERE id=route FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_ROUTE'; END IF;
  SELECT status INTO commercial_status FROM nexo.associations WHERE id=r.association_id FOR SHARE;
  IF commercial_status<>'ACTIVE' THEN RAISE EXCEPTION 'ASSOCIATION_SUSPENDED'; END IF;
  PERFORM 1 FROM nexo.geo_catalogs WHERE id=r.catalog_id FOR SHARE;
  IF NOT nexo.route_eligible(route) THEN RAISE EXCEPTION 'ROUTE_NOT_ELIGIBLE'; END IF;
END $$;
CREATE FUNCTION nexo.authorization_change() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,nexo AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.association_id,NEW.route_id,NEW.issuer,NEW.reference,NEW.valid_from,NEW.valid_until,NEW.requested_by)
    IS DISTINCT FROM (OLD.association_id,OLD.route_id,OLD.issuer,OLD.reference,OLD.valid_from,OLD.valid_until,OLD.requested_by) THEN
    RAISE EXCEPTION 'AUTHORIZATION_DETAILS_IMMUTABLE';
  END IF;
  -- All mutations of permits serialize through the route. Reservers do not
  -- acquire permit-row locks, preventing inversion with UPDATE's row lock.
  PERFORM 1 FROM nexo.routes WHERE id=NEW.route_id FOR UPDATE;
  RETURN NEW;
END $$;
CREATE TRIGGER authorization_change BEFORE INSERT OR UPDATE ON nexo.route_authorizations
  FOR EACH ROW EXECUTE FUNCTION nexo.authorization_change();
CREATE FUNCTION nexo.authorization_history() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,nexo AS $$
BEGIN
  INSERT INTO nexo.authorization_events(association_id,authorization_id,actor_id,previous_status,status,reason)
    VALUES(NEW.association_id,NEW.id,coalesce(nexo.actor(),NEW.reviewed_by,NEW.requested_by),
      CASE WHEN TG_OP='UPDATE' THEN OLD.status END,NEW.status,NEW.review_reason);
  RETURN NEW;
END $$;
CREATE TRIGGER authorization_history AFTER INSERT OR UPDATE ON nexo.route_authorizations
  FOR EACH ROW EXECUTE FUNCTION nexo.authorization_history();

CREATE FUNCTION nexo.submit_authorization(k text, route uuid, issuer text, reference text,
  starts timestamptz, ends timestamptz) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); r nexo.routes; p jsonb; cached jsonb; auth uuid;
BEGIN
  p:=jsonb_build_object('op','submit_authorization','route',route,'issuer',issuer,'reference',reference,'from',starts,'until',ends);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO r FROM nexo.routes WHERE id=route FOR UPDATE;
  IF NOT FOUND OR NOT nexo.has_role(r.association_id,'ASSOCIATION_ADMIN') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF r.catalog_id IS NULL OR
    (SELECT count(*) FROM nexo.stops WHERE route_id=r.id AND catalog_id=r.catalog_id AND locality_id IS NOT NULL)<>r.stop_count THEN
    RAISE EXCEPTION 'GEOGRAPHY_NOT_CONFIGURED';
  END IF;
  INSERT INTO nexo.route_authorizations(association_id,route_id,issuer,reference,valid_from,valid_until,requested_by)
    VALUES(r.association_id,route,issuer,reference,starts,ends,u) RETURNING id INTO auth;
  RETURN nexo.action_finish(k,p,jsonb_build_object('authorizationId',auth,'status','PENDING'));
END $$;
CREATE FUNCTION nexo.review_authorization(k text, authorization_id uuid, decision text, reason text) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); a nexo.route_authorizations; p jsonb; cached jsonb;
BEGIN
  IF NOT EXISTS(SELECT FROM nexo.operation_reviewers WHERE user_id=u) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  p:=jsonb_build_object('op','review_authorization','id',authorization_id,'decision',decision,'reason',reason);
  cached:=nexo.action_start(k,p); IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT * INTO a FROM nexo.route_authorizations WHERE id=authorization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_AUTHORIZATION'; END IF;
  PERFORM 1 FROM nexo.routes WHERE id=a.route_id FOR UPDATE;
  SELECT * INTO a FROM nexo.route_authorizations WHERE id=authorization_id FOR UPDATE;
  IF decision IS NULL OR reason IS NULL OR length(trim(reason))=0 OR NOT
    ((a.status='PENDING' AND decision IN ('VERIFIED','REJECTED')) OR (a.status='VERIFIED' AND decision='REVOKED')) THEN
    RAISE EXCEPTION 'INVALID_AUTHORIZATION_TRANSITION';
  END IF;
  UPDATE nexo.route_authorizations SET status=decision,reviewed_by=u,review_reason=reason WHERE id=authorization_id;
  RETURN nexo.action_finish(k,p,jsonb_build_object('authorizationId',authorization_id,'status',decision));
END $$;

CREATE FUNCTION nexo.search_services(origin uuid,destination uuid,seats integer DEFAULT 1,express boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo AS $$
DECLARE u uuid:=nexo.require_actor(); results jsonb; catalog uuid;
BEGIN
  IF seats IS NULL OR seats NOT BETWEEN 1 AND 6 OR express IS NULL OR (express AND seats<>6) THEN RAISE EXCEPTION 'INVALID_SEATS'; END IF;
  SELECT o.catalog_id INTO catalog FROM nexo.localities o JOIN nexo.localities d ON d.id=destination AND d.catalog_id=o.catalog_id
    JOIN nexo.geo_catalogs c ON c.id=o.catalog_id AND c.status='ACTIVE' WHERE o.id=origin AND origin<>destination;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_LOCALITIES'; END IF;
  SELECT coalesce(jsonb_agg(result ORDER BY result->>'associationId',result->>'routeId',(result->>'from')::integer),'[]'::jsonb) INTO results
  FROM (
    SELECT jsonb_build_object('associationId',a.id,'associationName',a.name,'routeId',r.id,'routeVersion',r.version,
      'coverage',nexo.classify_journey(r.origin_locality_id,r.destination_locality_id),'from',s.stop_index,'to',d.stop_index,
      'originLocalityId',origin,'destinationLocalityId',destination,'boardingName',s.name,'alightingName',d.name,
      'seats',seats,'availableSeats',inventory.free,'priceBOB',CASE WHEN express THEN fare.amount_bob ELSE fare.amount_bob*seats END,
      'currency','BOB','fareVersion',fare.version,'express',express) AS result
    FROM nexo.stops s JOIN nexo.stops d ON d.route_id=s.route_id AND d.stop_index>s.stop_index
    JOIN nexo.routes r ON r.id=s.route_id JOIN nexo.associations a ON a.id=r.association_id
    JOIN LATERAL (SELECT f.amount_bob,f.version FROM nexo.fares f WHERE f.route_id=r.id AND f.from_stop=s.stop_index
      AND f.to_stop=d.stop_index AND f.express=search_services.express AND f.valid_from<=clock_timestamp()
      AND (f.valid_until IS NULL OR f.valid_until>clock_timestamp())
      AND (SELECT count(*) FROM nexo.fares ff WHERE ff.route_id=r.id AND ff.from_stop=s.stop_index AND ff.to_stop=d.stop_index
        AND ff.express=search_services.express AND ff.valid_from<=clock_timestamp() AND (ff.valid_until IS NULL OR ff.valid_until>clock_timestamp()))=1) fare ON true
    JOIN LATERAL (SELECT t.id FROM nexo.trips t JOIN nexo.memberships m ON m.association_id=t.association_id
      AND m.user_id=t.driver_id AND m.role='DRIVER' AND m.active
      WHERE t.route_id=r.id AND t.status='QUEUED' AND t.current_stop<=s.stop_index AND nexo.fits(t.id,s.stop_index,d.stop_index,seats)
      ORDER BY t.position_no,t.id LIMIT 1) candidate ON true
    JOIN LATERAL (SELECT min(6-coalesce((SELECT sum(b.seats) FROM nexo.bookings b WHERE b.trip_id=candidate.id
      AND nexo.live(b) AND b.from_stop<=segment AND b.to_stop>segment),0)) AS free
      FROM generate_series(s.stop_index,d.stop_index-1) segment) inventory ON true
    WHERE s.locality_id=origin AND d.locality_id=destination AND s.boarding_allowed AND d.alighting_allowed
      AND r.catalog_id=catalog AND nexo.route_eligible(r.id)
  ) options;
  RETURN jsonb_build_object('status',CASE WHEN jsonb_array_length(results)=0 THEN 'NO_DIRECT_SERVICE' ELSE 'FOUND' END,
    'coverage',nexo.classify_journey(origin,destination),'results',results);
END $$;
GRANT EXECUTE ON FUNCTION nexo.search_services(uuid,uuid,integer,boolean),
  nexo.submit_authorization(text,uuid,text,text,timestamptz,timestamptz),nexo.review_authorization(text,uuid,text,text) TO nexo_app;
