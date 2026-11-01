-- 8B: an offline fictional responsible person is not a digital account or legal authorization.
CREATE TABLE nexo.care_parties(
 id uuid PRIMARY KEY REFERENCES nexo.users,association_id uuid NOT NULL REFERENCES nexo.associations,
 registered_by uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(association_id,id)
);
CREATE TABLE nexo.care_responsibilities(
 association_id uuid NOT NULL,booking_id uuid NOT NULL,group_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 party_id uuid NOT NULL,account_id uuid REFERENCES nexo.users,kind text NOT NULL CHECK(kind IN('CREATE_OFFLINE','LINK_ACCOUNT','UNLINK_ACCOUNT','REPLACE_OFFLINE','INHERIT_NATIVE')),
 reason text NOT NULL CHECK(reason IN('IN_PERSON_SIMULATED','WRONG_LINK_CONFIRMED','WRONG_RESPONSIBLE_CONFIRMED','NATIVE_RECOVERY')),
 actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(group_id,revision),FOREIGN KEY(association_id,booking_id)REFERENCES nexo.bookings(association_id,id),FOREIGN KEY(association_id,party_id)REFERENCES nexo.care_parties(association_id,id)
);
CREATE TABLE nexo.care_link_codes(
 code_hash text PRIMARY KEY CHECK(code_hash~'^[0-9a-f]{64}$'),account_id uuid NOT NULL REFERENCES nexo.users,
 session_hash text NOT NULL CHECK(session_hash~'^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE nexo.care_code_uses(
 code_hash text PRIMARY KEY REFERENCES nexo.care_link_codes,association_id uuid NOT NULL,booking_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES nexo.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(association_id,booking_id)REFERENCES nexo.bookings(association_id,id)
);
CREATE INDEX care_responsibility_booking ON nexo.care_responsibilities(booking_id,revision DESC);
CREATE INDEX care_responsibility_account ON nexo.care_responsibilities(account_id,group_id,revision DESC);
DO $$DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['care_parties','care_responsibilities','care_link_codes','care_code_uses']LOOP
  EXECUTE format('ALTER TABLE nexo.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON nexo.%I FROM PUBLIC,nexo_app',tab);
  EXECUTE format('CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON nexo.%I FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit()',tab);
 END LOOP;
END $$;
CREATE FUNCTION nexo.care_access(booking uuid,access_mode text)RETURNS nexo.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;u uuid:=nexo.require_actor();
BEGIN
 SELECT * INTO b FROM nexo.bookings WHERE id=booking;PERFORM nexo.check_scope(b.route_id);
 IF b.id IS NULL OR access_mode IS NULL OR access_mode NOT IN('VIEW','STAFF','MANAGE','OWNER')THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT(CASE access_mode WHEN'OWNER'THEN coalesce(nexo.is_responsible(b.id),false)WHEN'MANAGE'THEN nexo.manage_route(b.route_id)WHEN'STAFF'THEN nexo.manage_route(b.route_id)OR nexo.drives(b.trip_id)ELSE coalesce(nexo.is_responsible(b.id),false)OR nexo.manage_route(b.route_id)OR nexo.drives(b.trip_id)END)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN b;
END $$;
CREATE FUNCTION nexo.care_write_access(booking uuid,access_mode text)RETURNS nexo.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;u uuid:=nexo.require_actor();
BEGIN
 b:=nexo.care_access(booking,access_mode);
 IF access_mode<>'VIEW'THEN
  PERFORM 1 FROM nexo.sessions s WHERE s.token_hash=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex')AND s.user_id=u AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 END IF;
 IF access_mode IN('STAFF','MANAGE')THEN
  PERFORM 1 FROM nexo.memberships m WHERE m.association_id=b.association_id AND m.user_id=u AND m.active AND(m.role='ASSOCIATION_ADMIN'AND nexo.manage_route(b.route_id)OR access_mode='STAFF'AND m.role='DRIVER'AND nexo.drives(b.trip_id))FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 END IF;
 RETURN nexo.care_access(booking,access_mode);
END $$;
CREATE FUNCTION nexo.care_responsibility_revision(booking uuid)RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT coalesce(max(r.revision),0)FROM nexo.care_responsibilities r WHERE r.group_id=(SELECT group_id FROM nexo.bookings WHERE id=booking)
$$;
CREATE OR REPLACE FUNCTION nexo.responsible_user(booking uuid)RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT CASE WHEN b.passenger_id IS NOT NULL THEN b.passenger_id WHEN EXISTS(SELECT FROM nexo.care_responsibilities r WHERE r.group_id=b.group_id)
 THEN(SELECT coalesce(r.account_id,r.party_id)FROM nexo.care_responsibilities r WHERE r.group_id=b.group_id ORDER BY revision DESC LIMIT 1)
 ELSE(SELECT r.responsible_id FROM nexo.group_responsibles r WHERE r.group_id=b.group_id)END FROM nexo.bookings b WHERE b.id=booking
$$;
CREATE OR REPLACE FUNCTION nexo.group_snapshot(booking uuid)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT jsonb_agg(jsonb_build_object('bookingId',x.id,'episode',nexo.assignment_episode(x.id),'tripId',x.trip_id,'seats',x.seats,'price',x.price_bob,'status',x.status,'routeId',x.route_id,'from',x.from_stop,'to',x.to_stop,'fareId',x.fare_id,'fareVersion',x.fare_version,'express',x.express,'responsibleId',nexo.responsible_user(x.id))||CASE WHEN nexo.care_responsibility_revision(x.id)>0 THEN jsonb_build_object('responsibleRevision',nexo.care_responsibility_revision(x.id))ELSE'{}'::jsonb END ORDER BY x.id)FROM nexo.bookings x WHERE x.group_id=(SELECT group_id FROM nexo.bookings WHERE id=booking)
$$;
-- Once managed by 8B, a legacy entrypoint cannot establish another binding.
ALTER FUNCTION nexo.register_responsible(text,uuid,uuid,boolean)RENAME TO register_responsible_030;
REVOKE EXECUTE ON FUNCTION nexo.register_responsible_030(text,uuid,uuid,boolean)FROM PUBLIC,nexo_app;
CREATE FUNCTION nexo.register_responsible(k text,booking uuid,responsible uuid,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
BEGIN
 PERFORM nexo.care_access(booking,'MANAGE');
 IF nexo.care_responsibility_revision(booking)>0 THEN RAISE EXCEPTION 'MANAGED_RESPONSIBILITY_REQUIRED';END IF;
 RETURN nexo.register_responsible_030(k,booking,responsible,confirmed);
END $$;
CREATE FUNCTION nexo.care_link_code(k text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();p jsonb:=jsonb_build_object('op','care_link_code');cached jsonb;code text;session_key text;
BEGIN
 IF confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_CONFIRMATION';END IF;
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 session_key:=encode(sha256(convert_to(current_setting('nexo.session_token',true),'UTF8')),'hex');
 PERFORM 1 FROM nexo.sessions s WHERE s.token_hash=session_key AND s.user_id=u AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED';END IF;
 code:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 INSERT INTO nexo.care_link_codes(code_hash,account_id,session_hash)VALUES(encode(sha256(convert_to(code,'UTF8')),'hex'),u,session_key);
 RETURN nexo.action_finish(k,p,jsonb_build_object('code',code,'singleUse',true,'boundToCurrentSession',true,'accessGranted',false));
END $$;
CREATE FUNCTION nexo.care_responsibility(k text,booking uuid,expected integer,command text,link_code text,reason_code text,confirmed boolean)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE b nexo.bookings;r nexo.care_responsibilities;c nexo.care_link_codes;p jsonb;cached jsonb;party uuid;account uuid;version integer;
BEGIN
 b:=nexo.care_access(booking,'MANAGE');
 IF confirmed IS DISTINCT FROM true OR expected IS NULL OR expected<0 OR command IS NULL OR command NOT IN('CREATE_OFFLINE','LINK_ACCOUNT','UNLINK_ACCOUNT','REPLACE_OFFLINE')OR reason_code IS NULL OR reason_code NOT IN('IN_PERSON_SIMULATED','WRONG_LINK_CONFIRMED','WRONG_RESPONSIBLE_CONFIRMED')OR(command='LINK_ACCOUNT')IS DISTINCT FROM(link_code IS NOT NULL)OR link_code IS NOT NULL AND link_code!~'^[0-9a-f]{64}$'THEN RAISE EXCEPTION 'INVALID_RESPONSIBILITY';END IF;
 IF command='UNLINK_ACCOUNT'AND reason_code<>'WRONG_LINK_CONFIRMED'OR command='REPLACE_OFFLINE'AND reason_code<>'WRONG_RESPONSIBLE_CONFIRMED'OR command IN('CREATE_OFFLINE','LINK_ACCOUNT')AND reason_code<>'IN_PERSON_SIMULATED'THEN RAISE EXCEPTION 'INVALID_RESPONSIBILITY';END IF;
 p:=jsonb_build_object('op','care_responsibility','booking',booking,'expected',expected,'command',command,'codeHash',CASE WHEN link_code IS NULL THEN NULL ELSE encode(sha256(convert_to(link_code,'UTF8')),'hex')END,'reason',reason_code);cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM 1 FROM nexo.routes WHERE id=b.route_id FOR UPDATE;b:=nexo.care_write_access(booking,'MANAGE');
 IF b.source<>'WALK_IN'OR b.passenger_id IS NOT NULL OR EXISTS(SELECT FROM nexo.bookings x WHERE x.group_id=b.group_id AND(x.source<>'WALK_IN'OR x.passenger_id IS NOT NULL OR x.association_id<>b.association_id OR x.route_id<>b.route_id))THEN RAISE EXCEPTION 'INVALID_RESPONSIBILITY';END IF;
 version:=nexo.care_responsibility_revision(b.id);IF expected<>version THEN RAISE EXCEPTION 'STALE_RESPONSIBILITY';END IF;
 SELECT * INTO r FROM nexo.care_responsibilities WHERE group_id=b.group_id ORDER BY revision DESC LIMIT 1;party:=r.party_id;account:=r.account_id;
 IF command='CREATE_OFFLINE'AND(version>0 OR EXISTS(SELECT FROM nexo.group_responsibles WHERE group_id=b.group_id))THEN RAISE EXCEPTION 'RESPONSIBLE_ALREADY_REGISTERED';END IF;
 IF command IN('CREATE_OFFLINE','REPLACE_OFFLINE')THEN
  party:=gen_random_uuid();account:=NULL;INSERT INTO nexo.users(id,label)VALUES(party,'FICTICIO-RESPONSABLE-'||left(party::text,8));INSERT INTO nexo.care_parties(id,association_id,registered_by)VALUES(party,b.association_id,nexo.require_actor());
  IF command='CREATE_OFFLINE'THEN PERFORM nexo.register_responsible_030('care-offline:'||encode(sha256(convert_to(k,'UTF8')),'hex'),b.id,party,true);END IF;
 ELSIF party IS NULL THEN RAISE EXCEPTION 'RESPONSIBLE_REVIEW_REQUIRED';
 ELSIF command='UNLINK_ACCOUNT'THEN
  IF account IS NULL THEN RAISE EXCEPTION 'NO_LINKED_ACCOUNT';END IF;account:=NULL;
 ELSIF command='LINK_ACCOUNT'THEN
  IF account IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_ALREADY_LINKED';END IF;
  SELECT * INTO c FROM nexo.care_link_codes WHERE code_hash=encode(sha256(convert_to(link_code,'UTF8')),'hex')FOR UPDATE;
  IF c.code_hash IS NULL OR EXISTS(SELECT FROM nexo.care_code_uses WHERE code_hash=c.code_hash)THEN RAISE EXCEPTION 'INVALID_LINK_CODE';END IF;
  PERFORM 1 FROM nexo.sessions s WHERE s.token_hash=c.session_hash AND s.user_id=c.account_id AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_LINK_CODE';END IF;
  account:=c.account_id;INSERT INTO nexo.care_code_uses(code_hash,association_id,booking_id,actor_id)VALUES(c.code_hash,b.association_id,b.id,nexo.require_actor());
 END IF;
 INSERT INTO nexo.care_responsibilities(association_id,booking_id,group_id,revision,party_id,account_id,kind,reason,actor_id)VALUES(b.association_id,b.id,b.group_id,version+1,party,account,command,reason_code,nexo.require_actor());
 PERFORM nexo.audit(b.association_id,'CARE_RESPONSIBILITY_'||command,b.id);
 RETURN nexo.action_finish(k,p,jsonb_build_object('bookingId',b.id,'revision',version+1,'offlineRef',party,'accountLinked',account IS NOT NULL,'legalVerification',false,'inventoryChanged',false));
END $$;
REVOKE EXECUTE ON FUNCTION nexo.care_access(uuid,text),nexo.care_responsibility_revision(uuid)FROM PUBLIC,nexo_app;
REVOKE EXECUTE ON FUNCTION nexo.register_responsible(text,uuid,uuid,boolean),nexo.care_link_code(text,boolean),nexo.care_responsibility(text,uuid,integer,text,text,text,boolean)FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.register_responsible(text,uuid,uuid,boolean),nexo.care_link_code(text,boolean),nexo.care_responsibility(text,uuid,integer,text,text,text,boolean)TO nexo_app;

REVOKE EXECUTE ON FUNCTION nexo.care_write_access(uuid,text)FROM PUBLIC,nexo_app;
