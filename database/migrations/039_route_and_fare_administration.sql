-- 4A.5: drafts are process metadata; native routes/stops/fares remain authoritative.
CREATE TABLE nexo.config_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL REFERENCES nexo.associations,
 kind text NOT NULL CHECK(kind IN('ROUTE','FARE')),source_route_id uuid,route_id uuid,fare_id uuid,
 family_id uuid NOT NULL DEFAULT gen_random_uuid(),spec jsonb NOT NULL CHECK(jsonb_typeof(spec)='object'),
 status text NOT NULL DEFAULT 'DRAFT'CHECK(status IN('DRAFT','VALIDATED','PUBLISHED','RETIRED')),
 validation_hash text,validation_report jsonb NOT NULL DEFAULT '[]',revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(association_id,id),UNIQUE(route_id,kind,fare_id),
 FOREIGN KEY(association_id,source_route_id)REFERENCES nexo.routes(association_id,id),
 FOREIGN KEY(association_id,route_id)REFERENCES nexo.routes(association_id,id),
 FOREIGN KEY(association_id,fare_id,route_id)REFERENCES nexo.fares(association_id,id,route_id)
);
CREATE UNIQUE INDEX config_route_publication ON nexo.config_drafts(route_id)WHERE kind='ROUTE';
CREATE TABLE nexo.config_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),association_id uuid NOT NULL REFERENCES nexo.associations,
 draft_id uuid,route_id uuid,entity_kind text NOT NULL CHECK(entity_kind IN('ROUTE','FARE')),
 actor_id uuid NOT NULL REFERENCES nexo.users,action text NOT NULL,reason text NOT NULL CHECK(length(trim(reason))BETWEEN 1 AND 200),
 details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,draft_id)REFERENCES nexo.config_drafts(association_id,id),
 FOREIGN KEY(association_id,route_id)REFERENCES nexo.routes(association_id,id)
);
CREATE INDEX config_drafts_owner ON nexo.config_drafts(association_id,kind,id);
CREATE INDEX config_events_owner ON nexo.config_events(association_id,id);
CREATE TRIGGER immutable_config_events BEFORE UPDATE OR DELETE ON nexo.config_events FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
CREATE TABLE nexo.fare_selection_ends (
 fare_id uuid PRIMARY KEY,association_id uuid NOT NULL,route_id uuid NOT NULL,selected_until timestamptz NOT NULL CHECK(isfinite(selected_until)),
 FOREIGN KEY(association_id,fare_id,route_id)REFERENCES nexo.fares(association_id,id,route_id)
);
CREATE TABLE nexo.route_config_retirements (
 route_id uuid PRIMARY KEY,association_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES nexo.users,
 reason text NOT NULL CHECK(length(trim(reason))BETWEEN 1 AND 200),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,route_id)REFERENCES nexo.routes(association_id,id)
);
CREATE TRIGGER immutable_route_retirement BEFORE UPDATE OR DELETE ON nexo.route_config_retirements FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['config_drafts','config_events','fare_selection_ends','route_config_retirements']LOOP
 EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON nexo.%I FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance',t);
 END LOOP;
END$$;
-- This sidecar exposes only a technical selection end for already visible fares.
GRANT SELECT ON nexo.fare_selection_ends TO nexo_app;
CREATE POLICY visible_selection_end ON nexo.fare_selection_ends FOR SELECT USING(EXISTS(SELECT FROM nexo.fares f WHERE f.id=fare_id));
CREATE VIEW nexo.new_request_fares WITH(security_invoker=true,security_barrier=true)AS
 SELECT f.id,f.association_id,f.route_id,f.from_stop,f.to_stop,f.express,f.version,f.amount_bob,f.valid_from,
 least(f.valid_until,e.selected_until)AS valid_until FROM nexo.fares f LEFT JOIN nexo.fare_selection_ends e ON e.fare_id=f.id;
GRANT SELECT ON nexo.new_request_fares TO nexo_app;
CREATE POLICY scoped_native_routes ON nexo.routes AS RESTRICTIVE FOR SELECT USING(nexo.scope_allows(id));
CREATE FUNCTION nexo.guard_selection_end()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE'OR NEW.fare_id IS DISTINCT FROM OLD.fare_id OR NEW.association_id IS DISTINCT FROM OLD.association_id OR NEW.route_id IS DISTINCT FROM OLD.route_id OR NEW.selected_until>OLD.selected_until THEN RAISE EXCEPTION 'IMMUTABLE_FARE_SELECTION';END IF;RETURN NEW;
END$$;
CREATE TRIGGER monotonic_selection_end BEFORE UPDATE OR DELETE ON nexo.fare_selection_ends FOR EACH ROW EXECUTE FUNCTION nexo.guard_selection_end();
CREATE FUNCTION nexo.guard_config_native_history()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='fares'THEN
  IF EXISTS(SELECT FROM nexo.fare_selection_ends WHERE fare_id=OLD.id)OR EXISTS(SELECT FROM nexo.config_drafts WHERE fare_id=OLD.id)OR EXISTS(SELECT FROM nexo.config_events WHERE details->>'fareId'=OLD.id::text)THEN RAISE EXCEPTION 'IMMUTABLE_CONFIG_FARE';END IF;
 ELSE
  IF TG_TABLE_NAME='routes'THEN target:=OLD.id;ELSE target:=CASE WHEN TG_OP='INSERT'THEN NEW.route_id ELSE OLD.route_id END;END IF;
  IF EXISTS(SELECT FROM nexo.config_drafts WHERE kind='ROUTE'AND route_id=target AND status IN('PUBLISHED','RETIRED'))THEN RAISE EXCEPTION 'IMMUTABLE_CONFIG_ROUTE';END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE'THEN OLD ELSE NEW END;
END$$;
CREATE TRIGGER immutable_config_fare BEFORE UPDATE OR DELETE ON nexo.fares FOR EACH ROW EXECUTE FUNCTION nexo.guard_config_native_history();
CREATE TRIGGER immutable_config_route BEFORE UPDATE OR DELETE ON nexo.routes FOR EACH ROW EXECUTE FUNCTION nexo.guard_config_native_history();
CREATE TRIGGER immutable_config_stop BEFORE INSERT OR UPDATE OR DELETE ON nexo.stops FOR EACH ROW EXECUTE FUNCTION nexo.guard_config_native_history();
CREATE TRIGGER immutable_config_profile BEFORE INSERT OR UPDATE OR DELETE ON nexo.web_point_profiles FOR EACH ROW EXECUTE FUNCTION nexo.guard_config_native_history();
-- Keep the original OID/ACL, so stored callers also honor retirement.
DO $$DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('nexo.route_eligible_017(uuid)'::regprocedure)INTO definition;
 definition:=replace(definition,'route_eligible_017(route uuid)','config_route_eligible_core(route uuid)');
 IF position('config_route_eligible_core'in definition)=0 THEN RAISE EXCEPTION 'CONFIG_MIGRATION_SIGNATURE';END IF;EXECUTE definition;
END$$;
CREATE OR REPLACE FUNCTION nexo.route_eligible_017(route uuid)RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT nexo.config_route_eligible_core(route)AND NOT EXISTS(SELECT FROM nexo.route_config_retirements WHERE route_id=route)
$$;

CREATE FUNCTION nexo.config_actor(association uuid,route uuid DEFAULT NULL,full_required boolean DEFAULT false)RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.directory_actor(association);
BEGIN
 IF association IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF full_required AND NOT nexo.scope_allows(NULL)THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 IF route IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.routes r WHERE r.id=route AND r.association_id=association AND nexo.manage_route(r.id))THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;RETURN u;
END$$;
CREATE FUNCTION nexo.config_lock(association uuid,route uuid,full_required boolean)RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('platform-administration:036',0))THEN RAISE EXCEPTION 'CONFIG_BUSY';END IF;
 PERFORM nexo.platform_mutex();u:=nexo.config_actor(association,route,full_required);
 BEGIN PERFORM 1 FROM nexo.routes WHERE association_id=association ORDER BY id FOR UPDATE NOWAIT;EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'CONFIG_BUSY';END;
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u AND active FOR SHARE;
 PERFORM 1 FROM nexo.sessions s WHERE s.user_id=u AND s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')AND revoked_at IS NULL AND expires_at>clock_timestamp()FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=association AND user_id=u AND role='ASSOCIATION_ADMIN'AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;RETURN nexo.config_actor(association,route,full_required);
END$$;
CREATE FUNCTION nexo.config_revision(association uuid)RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(nexo.directory_permissions(),nexo.actor(),encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex'),
 (SELECT jsonb_build_array(active,version)FROM nexo.identity_accounts WHERE user_id=nexo.actor()),
 (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]')FROM nexo.identity_events WHERE subject_id=nexo.actor()AND event IN('IDENTITY_DISABLED','IDENTITY_ENABLED','RECOVERED','LOGOUT_ALL')),
 (SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY id),'[]')FROM nexo.config_drafts x WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]')FROM nexo.config_events WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY id),'[]')FROM nexo.routes x WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY route_id,stop_index),'[]')FROM nexo.stops x WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY route_id,stop_index),'[]')FROM nexo.web_point_profiles x WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY id),'[]')FROM nexo.fares x WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(to_jsonb(x)ORDER BY fare_id),'[]')FROM nexo.fare_selection_ends x WHERE association_id=association),
 (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]')FROM nexo.audit_events WHERE association_id=association)
 )::text,'UTF8')),'hex')
$$;
CREATE FUNCTION nexo.config_shape(kind text,s jsonb)RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE p jsonb;k text;v text;
BEGIN
 IF jsonb_typeof(s)IS DISTINCT FROM'object'THEN RETURN false;END IF;
 IF kind='ROUTE'THEN
  IF NOT(s?&ARRAY['name','direction','originId','destinationId','points'])OR EXISTS(SELECT FROM jsonb_object_keys(s)x WHERE x NOT IN('name','direction','originId','destinationId','points'))OR jsonb_typeof(s->'name')IS DISTINCT FROM'string'OR length(trim(s->>'name'))NOT BETWEEN 1 AND 100 OR (s->>'name')~'[[:cntrl:]]'OR s->>'direction'IS NULL OR s->>'direction'NOT IN('OUT','IN')OR jsonb_typeof(s->'points')IS DISTINCT FROM'array'THEN RETURN false;END IF;
  IF jsonb_array_length(s->'points')>64 THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['originId','destinationId']LOOP IF s->k<>'null'::jsonb AND(jsonb_typeof(s->k)<>'string'OR s->>k!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')THEN RETURN false;END IF;END LOOP;
  FOR p IN SELECT value FROM jsonb_array_elements(s->'points')LOOP
   IF jsonb_typeof(p)IS DISTINCT FROM'object'OR NOT(p?&ARRAY['index','name','localityId','kind','boardingAllowed','alightingAllowed','mainDeparture'])OR EXISTS(SELECT FROM jsonb_object_keys(p)x WHERE x NOT IN('index','name','localityId','kind','boardingAllowed','alightingAllowed','mainDeparture'))OR jsonb_typeof(p->'index')IS DISTINCT FROM'number'OR p->>'index'!~'^[0-9]{1,2}$'OR jsonb_typeof(p->'name')IS DISTINCT FROM'string'OR length(p->>'name')>100 OR p->>'name'~'[[:cntrl:]]'OR p->>'kind'IS NULL OR p->>'kind'NOT IN('TERMINAL','URBAN','ROAD','UNCLASSIFIED')THEN RETURN false;END IF;
   IF p->'localityId'<>'null'::jsonb AND(jsonb_typeof(p->'localityId')<>'string'OR p->>'localityId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')THEN RETURN false;END IF;
   FOREACH k IN ARRAY ARRAY['boardingAllowed','alightingAllowed','mainDeparture']LOOP IF jsonb_typeof(p->k)IS DISTINCT FROM'boolean'THEN RETURN false;END IF;END LOOP;
  END LOOP;RETURN true;
 ELSIF kind='FARE'THEN
  IF NOT(s?&ARRAY['from','to','express','amountBOB','validFrom','validUntil','replaceFareId'])OR EXISTS(SELECT FROM jsonb_object_keys(s)x WHERE x NOT IN('from','to','express','amountBOB','validFrom','validUntil','replaceFareId'))OR jsonb_typeof(s->'from')IS DISTINCT FROM'number'OR s->>'from'!~'^[0-9]{1,6}$'OR jsonb_typeof(s->'to')IS DISTINCT FROM'number'OR s->>'to'!~'^[0-9]{1,6}$'OR jsonb_typeof(s->'express')IS DISTINCT FROM'boolean'OR jsonb_typeof(s->'amountBOB')IS DISTINCT FROM'string'OR s->>'amountBOB'!~'^[0-9]{1,10}\.[0-9]{2}$'THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['validFrom','validUntil']LOOP IF s->k<>'null'::jsonb AND(jsonb_typeof(s->k)<>'string'OR s->>k!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$')THEN RETURN false;END IF;END LOOP;
  IF s->'replaceFareId'<>'null'::jsonb AND(jsonb_typeof(s->'replaceFareId')<>'string'OR s->>'replaceFareId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')THEN RETURN false;END IF;RETURN true;
 END IF;RETURN false;
END$$;
CREATE FUNCTION nexo.config_validate(d nexo.config_drafts)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE s jsonb:=d.spec;p jsonb;ordinal bigint;n integer;origin uuid;destination uuid;catalog uuid;loc uuid;seen uuid[]:='{}';last_loc uuid;names text[]:='{}';mains integer:=0;last_urban integer:=-1;main_index integer:=-1;r nexo.routes;starts timestamptz;ends timestamptz;matched_fares uuid[];prior uuid;
BEGIN
 IF NOT nexo.config_shape(d.kind,s)THEN RETURN '["INVALID_CONFIG_SPEC"]';END IF;
 IF d.kind='ROUTE'THEN
  n:=jsonb_array_length(s->'points');IF n<2 THEN RETURN '["CONFIG_POINTS_REQUIRED"]';END IF;
  origin:=(s->>'originId')::uuid;destination:=(s->>'destinationId')::uuid;
  SELECT l.catalog_id INTO catalog FROM nexo.localities l JOIN nexo.geo_catalogs c ON c.id=l.catalog_id AND c.status='ACTIVE'WHERE l.id=origin FOR SHARE OF l,c;
  PERFORM 1 FROM nexo.localities WHERE id IN(SELECT(value->>'localityId')::uuid FROM jsonb_array_elements(s->'points'))ORDER BY id FOR SHARE;
  IF catalog IS NULL OR origin IS NOT DISTINCT FROM destination OR NOT EXISTS(SELECT FROM nexo.localities WHERE id=destination AND catalog_id=catalog)THEN RETURN '["CONFIG_GEOGRAPHY_INVALID"]';END IF;
  IF nexo.classify_journey(origin,destination)IS NULL THEN RETURN '["CONFIG_INTRAMUNICIPAL_REVIEW"]';END IF;
  IF d.source_route_id IS NOT NULL AND NOT EXISTS(SELECT FROM nexo.routes WHERE id=d.source_route_id AND association_id=d.association_id AND direction=s->>'direction')THEN RETURN '["CONFIG_DIRECTION_INVALID"]';END IF;
  FOR p,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(s->'points')WITH ORDINALITY LOOP
   IF(p->>'index')::integer<>ordinal-1 OR length(trim(p->>'name'))=0 OR upper(trim(p->>'name'))=ANY(names)THEN RETURN '["CONFIG_POINT_ORDER_OR_DUPLICATE"]';END IF;names:=array_append(names,upper(trim(p->>'name')));
   loc:=(p->>'localityId')::uuid;IF loc IS NULL OR NOT EXISTS(SELECT FROM nexo.localities WHERE id=loc AND catalog_id=catalog)THEN RETURN '["CONFIG_POINT_GEOGRAPHY"]';END IF;
   IF loc IS DISTINCT FROM last_loc THEN IF loc=ANY(seen)THEN RETURN '["CONFIG_BACKTRACK_REVIEW"]';END IF;seen:=array_append(seen,loc);last_loc:=loc;END IF;
   IF(ordinal=1 AND(loc<>origin OR(p->>'boardingAllowed')::boolean IS DISTINCT FROM true OR(p->>'alightingAllowed')::boolean))OR(ordinal=n AND(loc<>destination OR(p->>'alightingAllowed')::boolean IS DISTINCT FROM true OR(p->>'boardingAllowed')::boolean))THEN RETURN '["CONFIG_ENDPOINT_INVALID"]';END IF;
   IF p->>'kind'='UNCLASSIFIED'AND((p->>'boardingAllowed')::boolean OR(p->>'alightingAllowed')::boolean)THEN RETURN '["CONFIG_PROFILE_REVIEW_REQUIRED"]';END IF;
   IF p->>'kind'='URBAN'THEN IF loc<>origin THEN RETURN '["CONFIG_URBAN_REVIEW_REQUIRED"]';END IF;last_urban:=ordinal-1;END IF;
   IF(p->>'mainDeparture')::boolean THEN mains:=mains+1;main_index:=ordinal-1;IF p->>'kind'<>'URBAN'THEN RETURN '["CONFIG_MAIN_DEPARTURE_INVALID"]';END IF;END IF;
  END LOOP;
  IF(last_urban>=0 AND(mains<>1 OR main_index<>last_urban OR main_index>=n-1))OR(last_urban<0 AND mains<>0)THEN RETURN '["CONFIG_MAIN_DEPARTURE_INVALID"]';END IF;
 ELSE
  SELECT * INTO r FROM nexo.routes WHERE id=d.route_id AND association_id=d.association_id;
  IF r.id IS NULL OR EXISTS(SELECT FROM nexo.route_config_retirements WHERE route_id=r.id)THEN RETURN '["CONFIG_ROUTE_RETIRED"]';END IF;
  IF(s->>'from')::integer>=(s->>'to')::integer OR(s->>'to')::integer>=r.stop_count OR NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=r.id AND stop_index=(s->>'from')::integer AND boarding_allowed)OR NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=r.id AND stop_index=(s->>'to')::integer AND alighting_allowed)THEN RETURN '["CONFIG_FARE_SEGMENT_INVALID"]';END IF;
  starts:=coalesce((s->>'validFrom')::timestamptz,clock_timestamp());ends:=(s->>'validUntil')::timestamptz;prior:=(s->>'replaceFareId')::uuid;
  IF NOT isfinite(starts)OR(ends IS NOT NULL AND(NOT isfinite(ends)OR ends<=starts))OR(s->>'validFrom'IS NOT NULL AND starts<clock_timestamp())THEN RETURN '["CONFIG_FARE_WINDOW_INVALID"]';END IF;
  SELECT coalesce(array_agg(f.id),'{}')INTO matched_fares FROM nexo.new_request_fares f WHERE f.route_id=r.id AND f.from_stop=(s->>'from')::integer AND f.to_stop=(s->>'to')::integer AND f.express=(s->>'express')::boolean AND(f.valid_until IS NULL OR f.valid_until>f.valid_from)AND f.valid_from<coalesce(ends,'infinity'::timestamptz)AND coalesce(f.valid_until,'infinity'::timestamptz)>starts;
  IF cardinality(matched_fares)>1 THEN RETURN '["CONFIG_FARE_OVERLAP"]';END IF;
  IF prior IS NOT NULL AND(cardinality(matched_fares)<>1 OR prior<>matched_fares[1])THEN RETURN '["CONFIG_FARE_PREDECESSOR_CHANGED"]';END IF;
  IF cardinality(matched_fares)=1 AND prior IS NULL THEN RETURN '["CONFIG_FARE_OVERLAP"]';END IF;
 END IF;RETURN '[]';
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN '["INVALID_CONFIG_SPEC"]';
END$$;
CREATE FUNCTION nexo.config_dependency(d nexo.config_drafts)RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(d.spec,
 (SELECT to_jsonb(r)FROM nexo.routes r WHERE id=coalesce(d.source_route_id,d.route_id)),
 (SELECT coalesce(jsonb_agg(to_jsonb(s)ORDER BY stop_index),'[]')FROM nexo.stops s WHERE route_id=coalesce(d.source_route_id,d.route_id)),
 (SELECT coalesce(jsonb_agg(to_jsonb(f)ORDER BY id),'[]')FROM nexo.new_request_fares f WHERE route_id=d.route_id),
 (SELECT coalesce(jsonb_agg(to_jsonb(c)ORDER BY id),'[]')FROM nexo.geo_catalogs c WHERE c.id=(SELECT catalog_id FROM nexo.localities WHERE id=(CASE WHEN d.kind='ROUTE'THEN d.spec->>'originId'ELSE NULL END)::uuid))
 )::text,'UTF8')),'hex')
$$;
CREATE FUNCTION nexo.config_route_pending(association uuid,route uuid)RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT EXISTS(SELECT FROM nexo.trips t WHERE t.route_id=route AND(t.status IN('QUEUED','IN_TRANSIT')OR nexo.observed_onboard(t.id)>0 OR nexo.physical_onboard(t.id)>0))
 OR EXISTS(SELECT FROM nexo.bookings b WHERE b.route_id=route AND nexo.live(b))
 OR EXISTS(SELECT FROM nexo.fleet_incidents WHERE association_id=association AND state NOT IN('TRANSFERRED','CLEARED'))
 OR EXISTS(SELECT FROM nexo.terminal_handoffs h WHERE h.association_id=association AND NOT EXISTS(SELECT FROM nexo.terminal_handoff_confirmations c WHERE c.handoff_id=h.id))
 OR EXISTS(SELECT FROM nexo.road_rescues WHERE association_id=association AND phase<>'TRANSFERRED')
$$;
-- Caller already holds the route lock. Never take platform mutex after a native route.
CREATE FUNCTION nexo.config_publish_fare(route uuid,first_stop integer,last_stop integer,is_express boolean,amount numeric,starts timestamptz,ends timestamptz,predecessor uuid,reason text)RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r nexo.routes;id uuid;v integer;u uuid:=nexo.require_actor();
BEGIN
 SELECT * INTO r FROM nexo.routes WHERE nexo.routes.id=route FOR UPDATE;
 IF r.id IS NULL OR NOT nexo.manage_route(route)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF amount IS NULL OR amount<0 OR amount>9999999999.99 OR amount<>round(amount,2)THEN RAISE EXCEPTION 'INVALID_CONFIG_FARE';END IF;
 -- Timestamp syntax canonicalization is only a transport concern; effective
 -- publication checks use typed instants and exclude empty predecessor windows.
 IF starts IS NULL THEN starts:=clock_timestamp();END IF;
 IF ends IS NOT NULL AND ends<=starts THEN RAISE EXCEPTION 'INVALID_CONFIG_FARE';END IF;
 IF NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=route AND stop_index=first_stop AND boarding_allowed)OR NOT EXISTS(SELECT FROM nexo.stops WHERE route_id=route AND stop_index=last_stop AND alighting_allowed)OR first_stop>=last_stop THEN RAISE EXCEPTION 'INVALID_CONFIG_FARE';END IF;
 IF EXISTS(SELECT FROM nexo.route_config_retirements WHERE route_id=route)THEN RAISE EXCEPTION 'CONFIG_ROUTE_RETIRED';END IF;
 IF EXISTS(SELECT FROM nexo.new_request_fares f WHERE f.route_id=route AND f.from_stop=first_stop AND f.to_stop=last_stop AND f.express=is_express AND(f.valid_until IS NULL OR f.valid_until>f.valid_from)AND f.valid_from<coalesce(ends,'infinity'::timestamptz)AND coalesce(f.valid_until,'infinity'::timestamptz)>starts AND f.id IS DISTINCT FROM predecessor)THEN RAISE EXCEPTION 'CONFIG_FARE_OVERLAP';END IF;
 IF predecessor IS NOT NULL THEN
  IF NOT EXISTS(SELECT FROM nexo.new_request_fares f WHERE f.id=predecessor AND f.route_id=route AND f.from_stop=first_stop AND f.to_stop=last_stop AND f.express=is_express AND(f.valid_until IS NULL OR f.valid_until>f.valid_from)AND f.valid_from<coalesce(ends,'infinity'::timestamptz)AND coalesce(f.valid_until,'infinity'::timestamptz)>starts)THEN RAISE EXCEPTION 'CONFIG_FARE_PREDECESSOR_CHANGED';END IF;
  INSERT INTO nexo.fare_selection_ends(fare_id,association_id,route_id,selected_until)VALUES(predecessor,r.association_id,route,starts)ON CONFLICT(fare_id)DO UPDATE SET selected_until=least(nexo.fare_selection_ends.selected_until,excluded.selected_until);
 END IF;
 SELECT coalesce(max(version),0)+1 INTO v FROM nexo.fares f WHERE f.route_id=route AND f.from_stop=first_stop AND f.to_stop=last_stop AND f.express=is_express;
 INSERT INTO nexo.fares(association_id,route_id,from_stop,to_stop,express,version,amount_bob,valid_from,valid_until)VALUES(r.association_id,route,first_stop,last_stop,is_express,v,amount,starts,ends)RETURNING nexo.fares.id INTO id;
 INSERT INTO nexo.config_events(association_id,route_id,entity_kind,actor_id,action,reason,details)VALUES(r.association_id,route,'FARE',u,'FARE_PUBLISHED',reason,jsonb_build_object('fareId',id,'version',v,'predecessorId',predecessor,'amountBOB',amount::numeric(12,2)::text,'selectionFrom',starts,'selectionUntil',ends,'historicalFareUnchanged',true));
 RETURN id;
END$$;
CREATE FUNCTION nexo.web_config_command(k text,body jsonb)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE association uuid;op text:=body->>'kind';u uuid:=nexo.require_actor();d nexo.config_drafts;target uuid;full_required boolean;p jsonb;cached jsonb;issues jsonb:='[]';blocked boolean:=false;native uuid;family uuid;catalog uuid;version integer;point jsonb;fare_row nexo.fares;result jsonb;
BEGIN
 IF jsonb_typeof(body)IS DISTINCT FROM'object'OR body->'confirmed'IS DISTINCT FROM'true'::jsonb OR op IS NULL OR op NOT IN('CREATE_ROUTE','CREATE_FARE','EDIT','VALIDATE','PUBLISH','RETIRE_ROUTE','RETIRE_FARE')OR jsonb_typeof(body->'reason')IS DISTINCT FROM'string'OR length(trim(body->>'reason'))NOT BETWEEN 1 AND 200 OR body->>'revision'IS NULL OR body->>'revision'!~'^[a-f0-9]{64}$'OR EXISTS(SELECT FROM jsonb_object_keys(body)x WHERE x NOT IN('kind','associationId','revision','reason','confirmed','draftId','routeId','sourceRouteId','fareId','spec'))THEN RAISE EXCEPTION 'INVALID_CONFIG_COMMAND';END IF;
 association:=(body->>'associationId')::uuid;IF association IS NULL OR NOT nexo.has_role(association,'ASSOCIATION_ADMIN')THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF op IN('EDIT','VALIDATE','PUBLISH')THEN
  IF body?'routeId'OR body?'sourceRouteId'OR body?'fareId'OR(op<>'EDIT'AND body?'spec')THEN RAISE EXCEPTION 'INVALID_CONFIG_COMMAND';END IF;
  SELECT * INTO d FROM nexo.config_drafts WHERE id=(body->>'draftId')::uuid AND association_id=association;
  IF d.id IS NULL THEN RAISE EXCEPTION 'INVALID_CONFIG_DRAFT';END IF;target:=CASE WHEN d.kind='FARE'THEN d.route_id ELSE d.source_route_id END;full_required:=d.kind='ROUTE';
 ELSIF op IN('CREATE_ROUTE','CREATE_FARE')THEN
  IF body?'draftId'OR body?'fareId'OR(op='CREATE_ROUTE'AND body?'routeId')OR(op='CREATE_FARE'AND body?'sourceRouteId')THEN RAISE EXCEPTION 'INVALID_CONFIG_COMMAND';END IF;
  d.kind:=CASE WHEN op='CREATE_ROUTE'THEN'ROUTE'ELSE'FARE'END;target:=CASE WHEN d.kind='FARE'THEN(body->>'routeId')::uuid ELSE(body->>'sourceRouteId')::uuid END;full_required:=d.kind='ROUTE';
 ELSE
  IF body?'draftId'OR body?'sourceRouteId'OR body?'spec'OR(op='RETIRE_ROUTE'AND body?'fareId')THEN RAISE EXCEPTION 'INVALID_CONFIG_COMMAND';END IF;
  target:=(body->>'routeId')::uuid;full_required:=op='RETIRE_ROUTE';
 END IF;
 IF d.kind='FARE'AND target IS NULL OR op IN('RETIRE_ROUTE','RETIRE_FARE')AND target IS NULL THEN RAISE EXCEPTION 'INVALID_CONFIG_ROUTE';END IF;
 p:=jsonb_build_object('op','route_and_fare_config','body',body);cached:=nexo.action_start(k,p);u:=nexo.config_lock(association,target,full_required);
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF body->>'revision'IS DISTINCT FROM nexo.config_revision(association)THEN RAISE EXCEPTION 'STALE_CONFIG';END IF;
 IF op IN('CREATE_ROUTE','CREATE_FARE','EDIT')AND NOT nexo.config_shape(d.kind,body->'spec')THEN RAISE EXCEPTION 'INVALID_CONFIG_SPEC';END IF;
 IF op IN('CREATE_ROUTE','CREATE_FARE')THEN
  family:=gen_random_uuid();IF op='CREATE_ROUTE'AND target IS NOT NULL THEN SELECT coalesce((SELECT family_id FROM nexo.config_drafts WHERE kind='ROUTE'AND route_id=target),target)INTO family;END IF;
  INSERT INTO nexo.config_drafts(association_id,kind,source_route_id,route_id,family_id,spec,created_by)VALUES(association,d.kind,CASE WHEN d.kind='ROUTE'THEN target ELSE NULL END,CASE WHEN d.kind='FARE'THEN target ELSE NULL END,family,body->'spec',u)RETURNING * INTO d;
 ELSIF op IN('EDIT','VALIDATE','PUBLISH')THEN
  SELECT * INTO d FROM nexo.config_drafts WHERE id=d.id FOR UPDATE;
  IF d.status IN('PUBLISHED','RETIRED')THEN RAISE EXCEPTION 'CONFIG_STATE_CONFLICT';END IF;
  IF op='EDIT'THEN UPDATE nexo.config_drafts SET spec=body->'spec',status='DRAFT',validation_hash=NULL,validation_report='[]',revision=revision+1 WHERE id=d.id RETURNING * INTO d;
  ELSE
   issues:=nexo.config_validate(d);blocked:=issues<>'[]'::jsonb;
   IF op='PUBLISH'AND d.status<>'VALIDATED'THEN RAISE EXCEPTION 'CONFIG_VALIDATION_REQUIRED';END IF;
   IF op='PUBLISH'AND NOT blocked AND d.validation_hash IS DISTINCT FROM nexo.config_dependency(d)THEN RAISE EXCEPTION 'STALE_CONFIG_VALIDATION';END IF;
   IF op='VALIDATE'OR blocked THEN
    UPDATE nexo.config_drafts SET status=CASE WHEN blocked THEN'DRAFT'ELSE'VALIDATED'END,validation_report=issues,validation_hash=CASE WHEN blocked THEN NULL ELSE nexo.config_dependency(d)END,revision=revision+1 WHERE id=d.id RETURNING * INTO d;
   ELSIF d.kind='ROUTE'THEN
    IF d.source_route_id IS NULL AND EXISTS(SELECT FROM nexo.routes WHERE association_id=association AND lower(trim(name))=lower(trim(d.spec->>'name'))AND direction=d.spec->>'direction')THEN RAISE EXCEPTION 'CONFIG_ROUTE_CONFLICT';END IF;
    SELECT coalesce(max(r.version),0)+1 INTO version FROM nexo.routes r WHERE r.id=d.source_route_id OR EXISTS(SELECT FROM nexo.config_drafts x WHERE x.kind='ROUTE'AND x.family_id=d.family_id AND x.route_id=r.id);
    SELECT catalog_id INTO catalog FROM nexo.localities WHERE id=(d.spec->>'originId')::uuid;
    INSERT INTO nexo.routes(association_id,name,direction,version,stop_count,catalog_id,origin_locality_id,destination_locality_id)VALUES(association,trim(d.spec->>'name'),d.spec->>'direction',version,jsonb_array_length(d.spec->'points'),catalog,(d.spec->>'originId')::uuid,(d.spec->>'destinationId')::uuid)RETURNING id INTO native;
    FOR point IN SELECT value FROM jsonb_array_elements(d.spec->'points')LOOP
     INSERT INTO nexo.stops(association_id,route_id,stop_index,name,boarding_allowed,alighting_allowed,catalog_id,locality_id)VALUES(association,native,(point->>'index')::integer,trim(point->>'name'),(point->>'boardingAllowed')::boolean,(point->>'alightingAllowed')::boolean,catalog,(point->>'localityId')::uuid);
     IF point->>'kind'<>'UNCLASSIFIED'THEN INSERT INTO nexo.web_point_profiles VALUES(association,native,(point->>'index')::integer,point->>'kind',(point->>'mainDeparture')::boolean);END IF;
    END LOOP;
    UPDATE nexo.config_drafts SET route_id=native,status='PUBLISHED',revision=revision+1 WHERE id=d.id RETURNING * INTO d;
   ELSE
    native:=nexo.config_publish_fare(d.route_id,(d.spec->>'from')::integer,(d.spec->>'to')::integer,(d.spec->>'express')::boolean,(d.spec->>'amountBOB')::numeric,(d.spec->>'validFrom')::timestamptz,(d.spec->>'validUntil')::timestamptz,(d.spec->>'replaceFareId')::uuid,body->>'reason');
    UPDATE nexo.config_drafts SET fare_id=native,status='PUBLISHED',revision=revision+1 WHERE id=d.id RETURNING * INTO d;
   END IF;
  END IF;
 ELSIF op='RETIRE_ROUTE'THEN
  IF EXISTS(SELECT FROM nexo.route_config_retirements WHERE route_id=target)THEN RAISE EXCEPTION 'CONFIG_STATE_CONFLICT';END IF;
  blocked:=nexo.config_route_pending(association,target);
  IF NOT blocked THEN INSERT INTO nexo.route_config_retirements VALUES(target,association,u,body->>'reason',clock_timestamp());UPDATE nexo.config_drafts SET status='RETIRED',revision=revision+1 WHERE kind='ROUTE'AND route_id=target;ELSE issues:='["CONFIG_ROUTE_OPERATION_REVIEW"]';END IF;
 ELSE
  SELECT * INTO fare_row FROM nexo.fares WHERE id=(body->>'fareId')::uuid AND route_id=target AND association_id=association FOR SHARE;
  IF fare_row.id IS NULL THEN RAISE EXCEPTION 'INVALID_CONFIG_FARE';END IF;
  IF EXISTS(SELECT FROM nexo.fare_selection_ends WHERE fare_id=fare_row.id AND selected_until<=clock_timestamp())THEN RAISE EXCEPTION 'CONFIG_STATE_CONFLICT';END IF;
  INSERT INTO nexo.fare_selection_ends VALUES(fare_row.id,association,target,clock_timestamp())ON CONFLICT(fare_id)DO UPDATE SET selected_until=least(nexo.fare_selection_ends.selected_until,excluded.selected_until);
  UPDATE nexo.config_drafts SET status='RETIRED',revision=revision+1 WHERE fare_id=fare_row.id;
 END IF;
 PERFORM nexo.config_actor(association,target,full_required);
 INSERT INTO nexo.config_events(association_id,draft_id,route_id,entity_kind,actor_id,action,reason,details)VALUES(association,d.id,coalesce(d.route_id,target),CASE WHEN op='RETIRE_ROUTE'THEN'ROUTE'WHEN op='RETIRE_FARE'THEN'FARE'ELSE d.kind END,u,op||CASE WHEN blocked THEN'_REVIEW_REQUIRED'ELSE''END,body->>'reason',jsonb_build_object('draftId',d.id,'routeId',coalesce(d.route_id,target),'fareId',coalesce(d.fare_id,fare_row.id),'status',d.status,'applied',NOT blocked,'issues',issues));
 PERFORM nexo.audit(association,'CONFIG_'||op||CASE WHEN blocked THEN'_REVIEW_REQUIRED'ELSE''END,coalesce(d.id,target));
 result:=jsonb_build_object('draftId',d.id,'routeId',coalesce(d.route_id,target),'fareId',coalesce(d.fare_id,fare_row.id),'status',d.status,'applied',NOT blocked,'reviewRequired',blocked,'issues',issues,'legalAuthorization',false);
 RETURN nexo.action_finish(k,p,result);
END$$;
CREATE FUNCTION nexo.config_rows(association uuid,section text,route uuid)RETURNS TABLE(key text,item jsonb)LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF section IN('ROUTE_DRAFTS','FARE_DRAFTS')THEN
 RETURN QUERY SELECT d.id::text,jsonb_build_object('id',d.id,'kind',d.kind,'name',CASE WHEN d.kind='ROUTE'THEN d.spec->>'name'ELSE'BOB '||(d.spec->>'amountBOB')END,'status',d.status,'sourceRouteId',d.source_route_id,'routeId',d.route_id,'fareId',d.fare_id,'version',d.revision,'issues',d.validation_report,'createdAt',d.created_at)
 FROM nexo.config_drafts d WHERE d.association_id=association AND d.kind=CASE WHEN section='ROUTE_DRAFTS'THEN'ROUTE'ELSE'FARE'END AND(route IS NULL OR coalesce(d.route_id,d.source_route_id)=route)AND(nexo.scope_allows(NULL)OR(d.kind='FARE'AND nexo.manage_route(d.route_id)));
 ELSIF section='FARES'THEN
 RETURN QUERY SELECT f.id::text,jsonb_build_object('id',f.id,'routeId',f.route_id,'routeName',r.name,'from',f.from_stop,'to',f.to_stop,'express',f.express,'amountBOB',f.amount_bob::text,'version',f.version,'validFrom',f.valid_from,'originalValidUntil',f.valid_until,'selectionUntil',v.valid_until,'selectedNow',v.valid_from<=clock_timestamp()AND(v.valid_until IS NULL OR v.valid_until>clock_timestamp()),'boarding',s.name,'alighting',z.name)
 FROM nexo.fares f JOIN nexo.new_request_fares v ON v.id=f.id JOIN nexo.routes r ON r.id=f.route_id JOIN nexo.stops s ON s.route_id=f.route_id AND s.stop_index=f.from_stop JOIN nexo.stops z ON z.route_id=f.route_id AND z.stop_index=f.to_stop WHERE f.association_id=association AND(route IS NULL OR f.route_id=route)AND nexo.manage_route(f.route_id);
 ELSIF section='HISTORY'THEN
 RETURN QUERY SELECT e.id::text,jsonb_build_object('id',e.id,'draftId',e.draft_id,'routeId',e.route_id,'kind',e.entity_kind,'action',e.action,'actorRef',e.actor_id,'reason',e.reason,'details',e.details,'createdAt',e.created_at)FROM nexo.config_events e WHERE e.association_id=association AND(route IS NULL OR e.route_id=route)AND(nexo.scope_allows(NULL)OR(e.entity_kind='FARE'AND nexo.manage_route(e.route_id)));
 ELSE RAISE EXCEPTION 'INVALID_CONFIG_SECTION';END IF;
END$$;
CREATE FUNCTION nexo.web_config_context(association uuid,route uuid DEFAULT NULL)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE r jsonb;
BEGIN
 PERFORM nexo.config_actor(association,route);
 IF route IS NOT NULL THEN
 SELECT jsonb_build_object('id',x.id,'name',x.name,'direction',x.direction,'version',x.version,'originId',x.origin_locality_id,'destinationId',x.destination_locality_id,'retired',EXISTS(SELECT FROM nexo.route_config_retirements WHERE route_id=x.id),'operationReviewRequired',nexo.config_route_pending(association,x.id),'eligibleForNewBookings',nexo.route_eligible(x.id),
 'points',CASE WHEN x.stop_count<=64 THEN(SELECT jsonb_agg(jsonb_build_object('index',s.stop_index,'name',s.name,'localityId',s.locality_id,'localityName',l.name,'kind',coalesce(p.kind,'UNCLASSIFIED'),'boardingAllowed',s.boarding_allowed,'alightingAllowed',s.alighting_allowed,'mainDeparture',coalesce(p.main_departure,false))ORDER BY s.stop_index)FROM nexo.stops s LEFT JOIN nexo.web_point_profiles p ON p.route_id=s.route_id AND p.stop_index=s.stop_index LEFT JOIN nexo.localities l ON l.id=s.locality_id WHERE s.route_id=x.id)ELSE NULL END,'pointCount',x.stop_count)INTO r FROM nexo.routes x WHERE x.id=route;
 END IF;
 PERFORM nexo.config_actor(association,route);RETURN jsonb_build_object('associationId',association,'revision',nexo.config_revision(association),'fullScope',nexo.scope_allows(NULL),'route',r,'legalAuthorization',false);
END$$;
CREATE FUNCTION nexo.web_config_detail(association uuid,draft uuid)RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE d nexo.config_drafts;
BEGIN
 PERFORM nexo.config_actor(association);SELECT * INTO d FROM nexo.config_drafts WHERE id=draft AND association_id=association;
 IF d.id IS NULL THEN RAISE EXCEPTION 'INVALID_CONFIG_DRAFT';END IF;
 PERFORM nexo.config_actor(association,CASE WHEN d.kind='FARE'THEN d.route_id ELSE d.source_route_id END,d.kind='ROUTE');
 RETURN jsonb_build_object('id',d.id,'kind',d.kind,'status',d.status,'spec',d.spec,'routeId',d.route_id,'sourceRouteId',d.source_route_id,'fareId',d.fare_id,'version',d.revision,'issues',d.validation_report,'pointLocalities',CASE WHEN d.kind='ROUTE'THEN(SELECT coalesce(jsonb_object_agg(l.id::text,l.name),'{}')FROM nexo.localities l WHERE l.id IN(SELECT(value->>'localityId')::uuid FROM jsonb_array_elements(d.spec->'points')))ELSE'{}'::jsonb END,'revision',nexo.config_revision(association));
END$$;

CREATE FUNCTION nexo.web_config_page(association uuid,section text,route uuid DEFAULT NULL,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL)RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;scope_key text;permissions text;revision text;total bigint;items jsonb;tail text;more boolean;cursor_exists boolean;
BEGIN
 u:=nexo.config_actor(association,route);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 permissions:=nexo.directory_permissions();scope_key:=encode(sha256(convert_to(u::text||':'||current_setting('nexo.session_token',true)||':'||association||':'||section||':'||coalesce(route::text,'ALL')||':CONFIG:'||page_size,'UTF8')),'hex');
 IF page_cursor IS NOT NULL THEN
  IF jsonb_typeof(page_cursor)<>'object'OR(SELECT count(*)FROM jsonb_object_keys(page_cursor))<>6 OR NOT(page_cursor?&ARRAY['v','scope','permissions','revision','size','key'])
   OR page_cursor->>'v'IS DISTINCT FROM'1'OR page_cursor->>'size'IS DISTINCT FROM page_size::text OR page_cursor->>'scope'IS DISTINCT FROM scope_key
   OR jsonb_typeof(page_cursor->'v')<>'number'OR jsonb_typeof(page_cursor->'size')<>'number'OR jsonb_typeof(page_cursor->'key')<>'string'
   OR jsonb_typeof(page_cursor->'revision')<>'string'OR jsonb_typeof(page_cursor->'permissions')<>'string'OR length(page_cursor->>'key')NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
  IF page_cursor->>'permissions'IS DISTINCT FROM permissions THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 END IF;
 WITH all_rows AS MATERIALIZED(SELECT * FROM nexo.config_rows(association,section,route)),
 page AS MATERIALIZED(SELECT * FROM all_rows WHERE page_cursor IS NULL OR key>page_cursor->>'key'ORDER BY key LIMIT page_size+1),
 numbered AS(SELECT *,row_number()OVER(ORDER BY key)n FROM page)
 SELECT(SELECT count(*)FROM all_rows),(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(key,item)ORDER BY key),'[]')::text,'UTF8')),'hex')FROM all_rows),
 coalesce(jsonb_agg(item ORDER BY key)FILTER(WHERE n<=page_size),'[]'),max(key)FILTER(WHERE n<=page_size),count(*)>page_size,
 CASE WHEN page_cursor IS NULL THEN true ELSE EXISTS(SELECT FROM all_rows WHERE key=page_cursor->>'key')END
 INTO total,revision,items,tail,more,cursor_exists FROM numbered;
 IF page_cursor IS NOT NULL AND(page_cursor->>'revision'IS DISTINCT FROM revision OR NOT cursor_exists)THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 PERFORM nexo.config_actor(association,route);IF permissions IS DISTINCT FROM nexo.directory_permissions()THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 RETURN jsonb_build_object('items',items,'total',total,'limit',page_size,'nextCursor',CASE WHEN more THEN jsonb_build_object('v',1,'scope',scope_key,'permissions',permissions,'revision',revision,'size',page_size,'key',tail)ELSE NULL END);
END $$;

CREATE FUNCTION nexo.config_legacy_lock(route uuid)RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE a uuid;u uuid;
BEGIN
 SELECT association_id INTO a FROM nexo.routes WHERE id=route FOR UPDATE;u:=nexo.config_actor(a,route);
 PERFORM 1 FROM nexo.identity_accounts WHERE user_id=u AND active FOR SHARE;
 PERFORM 1 FROM nexo.sessions s WHERE s.user_id=u AND s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 PERFORM 1 FROM nexo.memberships WHERE association_id=a AND user_id=u AND role='ASSOCIATION_ADMIN'AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;RETURN nexo.config_actor(a,route);
END$$;
-- Only selection relations change. Preserve OID, signatures, return types, ACL,
-- locks, six-seat allocation, quote checks and physical-history consumers.
DO $$DECLARE signature text;expected integer;definition text;actual integer;BEGIN
 FOR signature,expected IN SELECT * FROM(VALUES
 ('nexo.reserve_inventory(text,jsonb)',1),('nexo.scope_core_reserve_enroute(text,uuid,jsonb,jsonb)',1),
 ('nexo.search_services(uuid,uuid,integer,boolean)',2),('nexo.public_availability(uuid,uuid,integer)',1),
 ('nexo.public_segment_availability(uuid,integer,integer)',2),('nexo.web_condition_route(uuid)',1),('nexo.directory_rows(uuid,text)',1))v(s,n)LOOP
  definition:=pg_get_functiondef(signature::regprocedure);actual:=(length(definition)-length(replace(definition,'FROM nexo.fares','')))/length('FROM nexo.fares');
  IF actual<>expected THEN RAISE EXCEPTION 'CONFIG_SELECTION_MIGRATION_MISMATCH % %',signature,actual;END IF;
  definition:=replace(definition,'FROM nexo.fares','FROM nexo.new_request_fares');
  IF signature='nexo.directory_rows(uuid,text)'THEN
   IF position('''validFrom'',f.valid_from,''validUntil'',f.valid_until,'in definition)=0 THEN RAISE EXCEPTION 'CONFIG_DIRECTORY_MIGRATION_MISMATCH';END IF;
   definition:=replace(definition,'''validFrom'',f.valid_from,''validUntil'',f.valid_until,','''validFrom'',f.valid_from,''validUntil'',f.valid_until,''originalValidUntil'',(SELECT original.valid_until FROM nexo.fares original WHERE original.id=f.id),');
  END IF;EXECUTE definition;
 END LOOP;
 definition:=pg_get_functiondef('nexo.scope_core_set_route_condition(text,uuid,text,text,text,integer[],uuid,numeric,boolean)'::regprocedure);
 IF position('UPDATE nexo.fares SET amount_bob=amount,version=version+1'in definition)=0 THEN RAISE EXCEPTION 'CONFIG_LEGACY_MIGRATION_MISMATCH';END IF;
 definition:=replace(definition,'rev integer;entry jsonb;','rev integer;entry jsonb;previous_fare nexo.fares;');
 definition:=replace(definition,'cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;','cached:=nexo.action_start(k,p);PERFORM nexo.config_legacy_lock(route);IF cached IS NOT NULL THEN RETURN cached;END IF;');
 definition:=replace(definition,'UPDATE nexo.fares SET amount_bob=amount,version=version+1 WHERE id=fare AND route_id=r.id;', 'SELECT * INTO previous_fare FROM nexo.fares WHERE id=fare AND route_id=r.id;');
 definition:=replace(definition,'IF NOT FOUND THEN RAISE EXCEPTION ''INVALID_FARE'';END IF;','IF NOT FOUND THEN RAISE EXCEPTION ''INVALID_FARE'';END IF; fare:=nexo.config_publish_fare(r.id,previous_fare.from_stop,previous_fare.to_stop,previous_fare.express,amount,NULL,previous_fare.valid_until,previous_fare.id,''Cambio tarifario desde condiciones: ''||left(description,150));');
 EXECUTE definition;
 definition:=pg_get_functiondef('nexo.web_declare_condition(text,jsonb)'::regprocedure);
 IF position('cached:=nexo.action_start(k,jsonb_build_object(''op'',''web_declare_condition'',''request'',p));IF cached IS NOT NULL THEN RETURN cached;END IF;'in definition)=0 THEN RAISE EXCEPTION 'CONFIG_DECLARE_MIGRATION_MISMATCH';END IF;
 definition:=replace(definition,'cached:=nexo.action_start(k,jsonb_build_object(''op'',''web_declare_condition'',''request'',p));IF cached IS NOT NULL THEN RETURN cached;END IF;','cached:=nexo.action_start(k,jsonb_build_object(''op'',''web_declare_condition'',''request'',p));PERFORM nexo.config_legacy_lock(route);IF cached IS NOT NULL THEN RETURN cached;END IF;');EXECUTE definition;
 definition:=pg_get_functiondef('nexo.web_condition_context_030(uuid)'::regprocedure);
 IF position('FROM nexo.fares WHERE id=b.fare_id'in definition)=0 THEN RAISE EXCEPTION 'CONFIG_CONDITION_MIGRATION_MISMATCH';END IF;
 definition:=replace(definition,'FROM nexo.fares WHERE id=b.fare_id','FROM nexo.new_request_fares WHERE route_id=b.route_id AND from_stop=b.from_stop AND to_stop=b.to_stop AND express=b.express AND valid_from<=clock_timestamp()AND(valid_until IS NULL OR valid_until>clock_timestamp())');
 EXECUTE definition;
END$$;
DO $$DECLARE p record;BEGIN
 FOR p IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='nexo'::regnamespace AND(left(proname,7)='config_'OR left(proname,11)='web_config_'OR proname IN('guard_selection_end','guard_config_native_history'))LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance',p.signature);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION nexo.web_config_context(uuid,uuid),nexo.web_config_detail(uuid,uuid),nexo.web_config_page(uuid,text,uuid,integer,jsonb),nexo.web_config_command(text,jsonb)TO nexo_app;
