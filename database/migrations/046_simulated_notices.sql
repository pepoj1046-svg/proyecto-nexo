-- Etapa 6A: avisos dentro de la app, generados por hechos reales del viaje (decisiones
-- provisionales P-6A-1 a P-6A-5). Nothing leaves the system: the only channel is
-- IN_APP_SIMULATED. Triggers only INSERT into a separate table; they never change a
-- booking, trip, queue or custody. Tracking stays discrete (stops), without GPS.
-- Additive; 001-045 untouched.

CREATE TABLE nexo.notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES nexo.users,
 booking_id uuid NOT NULL REFERENCES nexo.bookings,
 trip_id uuid NOT NULL REFERENCES nexo.trips,
 kind text NOT NULL CHECK(kind IN('RESERVA_CONFIRMADA','RESERVA_CANCELADA','RESERVA_VENCIDA','VIAJE_SALIO','TRUFI_SE_ACERCA','TRUFI_EN_TU_PARADA','VIAJE_TERMINADO')),
 stop_index integer,
 channel text NOT NULL DEFAULT 'IN_APP_SIMULATED' CHECK(channel='IN_APP_SIMULATED'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 read_at timestamptz,
 CHECK(expires_at>created_at)
);
-- One notice per booking, kind and stop: a retried or replayed operation adds nothing.
CREATE UNIQUE INDEX notices_once ON nexo.notices(booking_id,kind,coalesce(stop_index,-1));
CREATE INDEX notices_user ON nexo.notices(user_id,created_at DESC);
ALTER TABLE nexo.notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexo.notices FROM PUBLIC;

-- Only read_at may change (once, from NULL), and only expired notices may be deleted.
CREATE FUNCTION nexo.guard_notice_change()RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.expires_at>clock_timestamp()THEN RAISE EXCEPTION 'NOTICE_NOT_EXPIRED';END IF;RETURN OLD;END IF;
 IF(to_jsonb(NEW)-'read_at')<>(to_jsonb(OLD)-'read_at')OR OLD.read_at IS NOT NULL OR NEW.read_at IS NULL THEN RAISE EXCEPTION 'IMMUTABLE_NOTICE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_notice_change BEFORE UPDATE OR DELETE ON nexo.notices FOR EACH ROW EXECUTE FUNCTION nexo.guard_notice_change();

CREATE FUNCTION nexo.add_notice(b nexo.bookings,k text,stop integer)RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 INSERT INTO nexo.notices(user_id,booking_id,trip_id,kind,stop_index)
 SELECT b.passenger_id,b.id,b.trip_id,k,stop WHERE b.passenger_id IS NOT NULL AND b.source='APP'
 ON CONFLICT DO NOTHING
$$;

CREATE FUNCTION nexo.notice_from_booking()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  CASE NEW.status
   WHEN 'CONFIRMED' THEN PERFORM nexo.add_notice(NEW,'RESERVA_CONFIRMADA',NULL);
   WHEN 'CANCELLED' THEN PERFORM nexo.add_notice(NEW,'RESERVA_CANCELADA',NULL);
   WHEN 'REJECTED' THEN PERFORM nexo.add_notice(NEW,'RESERVA_CANCELADA',NULL);
   WHEN 'EXPIRED' THEN PERFORM nexo.add_notice(NEW,'RESERVA_VENCIDA',NULL);
   WHEN 'COMPLETED' THEN PERFORM nexo.add_notice(NEW,'VIAJE_TERMINADO',NULL);
   ELSE NULL;
  END CASE;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER notice_from_booking AFTER INSERT OR UPDATE OF status ON nexo.bookings FOR EACH ROW EXECUTE FUNCTION nexo.notice_from_booking();

CREATE FUNCTION nexo.notice_from_trip()RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;
BEGIN
 IF NEW.status='IN_TRANSIT' AND OLD.status IS DISTINCT FROM 'IN_TRANSIT' THEN
  FOR b IN SELECT * FROM nexo.bookings WHERE trip_id=NEW.id AND status='CONFIRMED' LOOP PERFORM nexo.add_notice(b,'VIAJE_SALIO',NULL);END LOOP;
 END IF;
 IF NEW.status='IN_TRANSIT' AND NEW.current_stop IS DISTINCT FROM OLD.current_stop THEN
  FOR b IN SELECT * FROM nexo.bookings WHERE trip_id=NEW.id AND status='CONFIRMED' AND from_stop IN(NEW.current_stop,NEW.current_stop+1)LOOP
   PERFORM nexo.add_notice(b,CASE WHEN b.from_stop=NEW.current_stop THEN 'TRUFI_EN_TU_PARADA' ELSE 'TRUFI_SE_ACERCA' END,b.from_stop);
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER notice_from_trip AFTER UPDATE OF status,current_stop ON nexo.trips FOR EACH ROW EXECUTE FUNCTION nexo.notice_from_trip();

-- Passenger: his unexpired notices, newest first, with route and stop names.
CREATE FUNCTION nexo.web_my_notices()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();items jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(x.entry ORDER BY x.created_at DESC,x.id),'[]'::jsonb)INTO items FROM(
  SELECT n.id,n.created_at,jsonb_build_object('id',n.id,'kind',n.kind,'route',r.name,'stop',s.name,'createdAt',n.created_at,'expiresAt',n.expires_at,'read',n.read_at IS NOT NULL,'channel',n.channel)AS entry
  FROM nexo.notices n JOIN nexo.trips t ON t.id=n.trip_id JOIN nexo.routes r ON r.id=t.route_id
  LEFT JOIN nexo.stops s ON s.route_id=t.route_id AND s.stop_index=n.stop_index
  WHERE n.user_id=u AND n.expires_at>clock_timestamp()ORDER BY n.created_at DESC,n.id LIMIT 50)x;
 IF nexo.actor() IS DISTINCT FROM u THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 RETURN jsonb_build_object('items',items,'unread',(SELECT count(*)FROM nexo.notices WHERE user_id=u AND read_at IS NULL AND expires_at>clock_timestamp()));
END $$;

-- Passenger: mark his own notices as read. Foreign or unknown ids are ignored, never revealed.
CREATE FUNCTION nexo.web_mark_notices_read(ids uuid[])RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();n integer;
BEGIN
 IF ids IS NULL OR cardinality(ids)>50 THEN RAISE EXCEPTION 'INVALID_NOTICES';END IF;
 UPDATE nexo.notices SET read_at=clock_timestamp()WHERE id=ANY(ids)AND user_id=u AND read_at IS NULL AND expires_at>clock_timestamp();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('marked',n);
END $$;

-- Maintenance: delete expired notices (retention, P-6A-3).
CREATE FUNCTION nexo.purge_expired_notices()RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE n integer;
BEGIN DELETE FROM nexo.notices WHERE expires_at<=clock_timestamp();GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END $$;

REVOKE ALL ON FUNCTION nexo.guard_notice_change(),nexo.add_notice(nexo.bookings,text,integer),nexo.notice_from_booking(),nexo.notice_from_trip(),
 nexo.web_my_notices(),nexo.web_mark_notices_read(uuid[]),nexo.purge_expired_notices()FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_my_notices(),nexo.web_mark_notices_read(uuid[])TO nexo_app;
GRANT EXECUTE ON FUNCTION nexo.purge_expired_notices()TO nexo_maintenance;
