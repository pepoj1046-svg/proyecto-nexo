-- 4A.1: read-only projections. No tables, DML, grants to identity/provisioning,
-- inventory, expiry materialization or backfill. Preserve migrations 001–033.
CREATE FUNCTION nexo.directory_actor(association uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('admin-scope:'||u::text,0));
 PERFORM nexo.require_actor();
 -- actor() uses statement time; expiry may have elapsed while waiting for scope.
 IF NOT EXISTS(SELECT FROM nexo.sessions s WHERE s.user_id=u
   AND s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')
   AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 IF NOT EXISTS(SELECT FROM nexo.memberships m WHERE m.user_id=u AND m.role='ASSOCIATION_ADMIN'
   AND m.active AND(association IS NULL OR m.association_id=association)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN u;
END $$;

CREATE FUNCTION nexo.directory_permissions() RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
  (SELECT coalesce(jsonb_agg(to_jsonb(m)ORDER BY association_id,role),'[]')FROM nexo.memberships m WHERE user_id=nexo.actor()),
  (SELECT coalesce(jsonb_agg(to_jsonb(l)ORDER BY association_id),'[]')FROM nexo.admin_limits l WHERE user_id=nexo.actor()),
  (SELECT coalesce(jsonb_agg(to_jsonb(g)ORDER BY association_id,route_id),'[]')FROM nexo.admin_route_grants g WHERE user_id=nexo.actor()),
  (SELECT coalesce(jsonb_agg(jsonb_build_array(id,event,created_at)ORDER BY created_at,id),'[]')FROM nexo.identity_events
    WHERE subject_id=nexo.actor()AND(event LIKE 'ADMIN_SCOPE_%'OR event LIKE 'ADMIN_ROUTE_%'OR event LIKE 'ASSOCIATION_ADMIN_%'))
 )::text,'UTF8')),'hex')
$$;

CREATE FUNCTION nexo.directory_rows(association uuid,section text) RETURNS TABLE(key text,item jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF section='ASSOCIATIONS' THEN
  RETURN QUERY SELECT a.id::text,jsonb_build_object('id',a.id,'name',a.name,'commercialStatus',a.status,
   'adherenceStatus',a.adherence_status,'operatingStatus',a.operating_status)
  FROM nexo.associations a WHERE nexo.has_role(a.id,'ASSOCIATION_ADMIN');
 ELSIF section='DRIVERS' THEN
  RETURN QUERY SELECT m.user_id::text,jsonb_build_object('id',m.user_id,'label',u.label,'membershipActive',m.active,
   'authorization',CASE WHEN m.active THEN 'MEMBERSHIP_ACTIVE'ELSE'MEMBERSHIP_INACTIVE'END)
  FROM nexo.memberships m JOIN nexo.users u ON u.id=m.user_id WHERE m.association_id=association AND m.role='DRIVER';
 ELSIF section='VEHICLES' THEN
  RETURN QUERY SELECT v.id::text,jsonb_build_object('id',v.id,'label',v.label,'capacity',v.capacity,
   'blocked',EXISTS(SELECT FROM nexo.vehicle_blocks b WHERE b.vehicle_id=v.id AND b.blocked),
   'availability',CASE WHEN EXISTS(SELECT FROM nexo.vehicle_blocks b WHERE b.vehicle_id=v.id AND b.blocked)THEN'BLOCKED'
    WHEN EXISTS(SELECT FROM nexo.trips t WHERE t.vehicle_id=v.id AND t.status='IN_TRANSIT')THEN'IN_SERVICE'
    WHEN EXISTS(SELECT FROM nexo.trips t WHERE t.vehicle_id=v.id AND t.status='QUEUED')THEN'QUEUED'ELSE'NO_ACTIVE_TRIP'END)
  FROM nexo.vehicles v WHERE v.association_id=association;
 ELSIF section='ROUTES' THEN
  RETURN QUERY SELECT r.id::text,jsonb_build_object('id',r.id,'name',r.name,'direction',r.direction,'version',r.version,
   'origin',o.name,'destination',d.name,'eligibleForNewBookings',nexo.route_eligible(r.id),
   'authorization',CASE WHEN EXISTS(SELECT FROM nexo.route_authorizations p WHERE p.route_id=r.id AND p.status='VERIFIED'
    AND p.valid_from<=clock_timestamp()AND(p.valid_until IS NULL OR p.valid_until>clock_timestamp()))THEN'VERIFIED_CURRENT'ELSE'NOT_CURRENT'END)
  FROM nexo.routes r LEFT JOIN nexo.localities o ON o.id=r.origin_locality_id LEFT JOIN nexo.localities d ON d.id=r.destination_locality_id
  WHERE r.association_id=association AND nexo.manage_route(r.id);
 ELSIF section='POINTS' THEN
  RETURN QUERY SELECT s.route_id::text||':'||lpad(s.stop_index::text,10,'0'),jsonb_build_object('id',s.route_id::text||':'||s.stop_index,
   'routeId',s.route_id,'route',r.name,'direction',r.direction,'index',s.stop_index,'name',s.name,
   'kind',coalesce(p.kind,'UNCLASSIFIED'),'locality',l.name,'boardingAllowed',s.boarding_allowed,'alightingAllowed',s.alighting_allowed)
  FROM nexo.stops s JOIN nexo.routes r ON r.id=s.route_id LEFT JOIN nexo.web_point_profiles p ON p.route_id=s.route_id AND p.stop_index=s.stop_index
  LEFT JOIN nexo.localities l ON l.id=s.locality_id WHERE s.association_id=association AND nexo.manage_route(s.route_id);
 ELSIF section='FARES' THEN
  RETURN QUERY SELECT f.id::text,jsonb_build_object('id',f.id,'routeId',f.route_id,'route',r.name,'direction',r.direction,
   'from',f.from_stop,'to',f.to_stop,'boarding',s.name,'alighting',d.name,'express',f.express,'amountBOB',f.amount_bob::text,
   'version',f.version,'validFrom',f.valid_from,'validUntil',f.valid_until,
   'validity',CASE WHEN f.valid_from>clock_timestamp()THEN'FUTURE'WHEN f.valid_until<=clock_timestamp()THEN'EXPIRED'ELSE'CURRENT'END)
  FROM nexo.fares f JOIN nexo.routes r ON r.id=f.route_id JOIN nexo.stops s ON s.route_id=f.route_id AND s.stop_index=f.from_stop
  JOIN nexo.stops d ON d.route_id=f.route_id AND d.stop_index=f.to_stop
  WHERE f.association_id=association AND nexo.manage_route(f.route_id);
 END IF;
END $$;

CREATE FUNCTION nexo.web_admin_directory(association uuid,section text,page_size integer DEFAULT 50,page_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid;scope_key text;permissions text;revision text;total bigint;items jsonb;tail text;more boolean;meta jsonb;full_scope boolean;cursor_exists boolean;
BEGIN
 u:=nexo.directory_actor(association);
 IF section IS NULL OR section NOT IN('ASSOCIATIONS','DRIVERS','VEHICLES','ROUTES','POINTS','FARES')OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100
  OR(section='ASSOCIATIONS')<>(association IS NULL)THEN RAISE EXCEPTION 'INVALID_PAGE';END IF;
 full_scope:=nexo.scope_allows(NULL);
 IF section IN('DRIVERS','VEHICLES')AND NOT full_scope THEN RAISE EXCEPTION 'FORBIDDEN_SCOPE';END IF;
 permissions:=nexo.directory_permissions();
 scope_key:=encode(sha256(convert_to(u::text||':'||current_setting('nexo.session_token',true)||':'||coalesce(association::text,'')||':'||section||':'||page_size,'UTF8')),'hex');
 IF page_cursor IS NOT NULL THEN
  IF jsonb_typeof(page_cursor)<>'object'OR(SELECT count(*)FROM jsonb_object_keys(page_cursor))<>6
   OR NOT(page_cursor ?& ARRAY['v','scope','permissions','revision','size','key'])
   OR jsonb_typeof(page_cursor->'v')<>'number'OR jsonb_typeof(page_cursor->'size')<>'number'
   OR jsonb_typeof(page_cursor->'revision')<>'string'OR jsonb_typeof(page_cursor->'permissions')<>'string'
   OR page_cursor->>'v'IS DISTINCT FROM'1'OR page_cursor->>'size'IS DISTINCT FROM page_size::text
   OR page_cursor->>'scope'IS DISTINCT FROM scope_key OR jsonb_typeof(page_cursor->'key')<>'string'
   OR length(page_cursor->>'key')NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'INVALID_CURSOR';END IF;
  IF page_cursor->>'permissions'IS DISTINCT FROM permissions THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 END IF;
 WITH all_rows AS MATERIALIZED(SELECT * FROM nexo.directory_rows(association,section)),
 page AS MATERIALIZED(SELECT * FROM all_rows WHERE page_cursor IS NULL OR key>page_cursor->>'key'ORDER BY key LIMIT page_size+1),
 numbered AS(SELECT *,row_number()OVER(ORDER BY key)n FROM page)
 SELECT (SELECT count(*)FROM all_rows),
  (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(key,item)ORDER BY key),'[]')::text,'UTF8')),'hex')FROM all_rows),
  coalesce(jsonb_agg(item ORDER BY key)FILTER(WHERE n<=page_size),'[]'),max(key)FILTER(WHERE n<=page_size),count(*)>page_size,
  CASE WHEN page_cursor IS NULL THEN true ELSE EXISTS(SELECT FROM all_rows WHERE key=page_cursor->>'key')END
 INTO total,revision,items,tail,more,cursor_exists FROM numbered;
 IF page_cursor IS NOT NULL AND(page_cursor->>'revision'IS DISTINCT FROM revision OR NOT cursor_exists)THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 PERFORM nexo.directory_actor(association);
 IF permissions IS DISTINCT FROM nexo.directory_permissions()THEN RAISE EXCEPTION 'PAGE_CHANGED';END IF;
 SELECT jsonb_build_object('id',a.id,'name',a.name,'commercialStatus',a.status,'adherenceStatus',a.adherence_status,'operatingStatus',a.operating_status)
 INTO meta FROM nexo.associations a WHERE a.id=association;
 RETURN jsonb_build_object('association',meta,'section',section,'scope',CASE WHEN nexo.scope_allows(NULL)THEN'FULL_ASSOCIATION'ELSE'AUTHORIZED_ROUTES'END,
  'items',items,'total',total,'limit',page_size,'readOnly',true,'snapshotOnly',true,
  'nextCursor',CASE WHEN more THEN jsonb_build_object('v',1,'scope',scope_key,'permissions',permissions,'revision',revision,'size',page_size,'key',tail)ELSE NULL END);
END $$;
REVOKE EXECUTE ON FUNCTION nexo.directory_actor(uuid),nexo.directory_permissions(),nexo.directory_rows(uuid,text),nexo.web_admin_directory(uuid,text,integer,jsonb)FROM PUBLIC,nexo_app;
GRANT EXECUTE ON FUNCTION nexo.web_admin_directory(uuid,text,integer,jsonb)TO nexo_app;
