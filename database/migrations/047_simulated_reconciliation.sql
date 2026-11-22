-- Etapa 7A: conciliación diaria simulada (decisiones provisionales P-7A-1 a P-7A-6).
-- Money is never real. The expected amount of a day is the sum of the simulated payment
-- marks (016) whose latest state per group is VERIFIED_SIMULATED and was recorded that day
-- in America/La_Paz. A full administrator declares the counted amount once; the closing
-- stores expected, declared, difference and status and is immutable. No effect on
-- bookings, fares, queue or custody. Additive; 001-046 untouched.

CREATE TABLE nexo.cash_closings (
 association_id uuid NOT NULL REFERENCES nexo.associations,
 day date NOT NULL,
 groups integer NOT NULL CHECK(groups>=0),
 expected_bob numeric(12,2) NOT NULL CHECK(expected_bob>=0),
 declared_bob numeric(12,2) NOT NULL CHECK(declared_bob>=0),
 difference_bob numeric(12,2) NOT NULL,
 status text NOT NULL CHECK(status IN('CUADRA','DISCREPANCIA')),
 note text CHECK(note IS NULL OR char_length(note) BETWEEN 5 AND 200),
 actor_id uuid NOT NULL REFERENCES nexo.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(association_id,day),
 CHECK(difference_bob=declared_bob-expected_bob),
 CHECK((status='CUADRA')=(difference_bob=0)),
 CHECK(status='CUADRA' OR note IS NOT NULL)
);
CREATE TRIGGER immutable_cash_closings BEFORE UPDATE OR DELETE ON nexo.cash_closings FOR EACH ROW EXECUTE FUNCTION nexo.immutable_audit();
ALTER TABLE nexo.cash_closings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexo.cash_closings FROM PUBLIC;

-- Reconciliation is association-wide money: only an unrestricted administrator (P-7A-4).
CREATE FUNCTION nexo.full_admin(association uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT association IS NOT NULL AND nexo.has_role(association,'ASSOCIATION_ADMIN')
  AND NOT EXISTS(SELECT FROM nexo.admin_limits l WHERE l.association_id=association AND l.user_id=nexo.actor())
$$;

-- Latest simulated mark per group whose latest state is VERIFIED and was made on that day.
CREATE FUNCTION nexo.expected_cash(association uuid,d date)RETURNS TABLE(group_id uuid,route text,amount_bob numeric)LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 WITH latest AS(SELECT DISTINCT ON(sp.group_id)sp.group_id,sp.kind,sp.amount_bob,sp.created_at,sp.booking_id
  FROM nexo.simulated_payments sp WHERE sp.association_id=association ORDER BY sp.group_id,sp.serial DESC)
 SELECT l.group_id,r.name,l.amount_bob FROM latest l JOIN nexo.bookings b ON b.id=l.booking_id JOIN nexo.routes r ON r.id=b.route_id
 WHERE l.kind='VERIFIED_SIMULATED' AND(l.created_at AT TIME ZONE 'America/La_Paz')::date=d
$$;

CREATE FUNCTION nexo.cash_day_ok(d date)RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT d IS NOT NULL AND d<=(clock_timestamp() AT TIME ZONE 'America/La_Paz')::date AND d>=(clock_timestamp() AT TIME ZONE 'America/La_Paz')::date-31
$$;

-- Associations the actor may reconcile.
CREATE FUNCTION nexo.web_reconciliation_associations()RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();
BEGIN
 RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('associationId',a.id,'name',a.name)ORDER BY a.name)
  FROM nexo.associations a WHERE nexo.full_admin(a.id)),'[]'::jsonb),'today',(clock_timestamp() AT TIME ZONE 'America/La_Paz')::date);
END $$;

CREATE FUNCTION nexo.web_reconciliation(association uuid,d date)RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE c nexo.cash_closings;
BEGIN
 PERFORM nexo.require_actor();
 IF NOT nexo.full_admin(association)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT nexo.cash_day_ok(d)THEN RAISE EXCEPTION 'INVALID_DAY';END IF;
 SELECT * INTO c FROM nexo.cash_closings WHERE association_id=association AND day=d;
 RETURN jsonb_build_object('associationId',association,'day',d,'simulated',true,'currency','BOB',
  'groups',(SELECT count(*)FROM nexo.expected_cash(association,d)),
  'expectedBOB',(SELECT coalesce(sum(amount_bob),0)::numeric(12,2)::text FROM nexo.expected_cash(association,d)),
  'byRoute',coalesce((SELECT jsonb_agg(jsonb_build_object('route',x.route,'groups',x.n,'amountBOB',x.total::numeric(12,2)::text)ORDER BY x.route)
   FROM(SELECT route,count(*)n,sum(amount_bob)total FROM nexo.expected_cash(association,d)GROUP BY route)x),'[]'::jsonb),
  'closing',CASE WHEN c.association_id IS NULL THEN NULL ELSE jsonb_build_object('groups',c.groups,'expectedBOB',c.expected_bob::text,'declaredBOB',c.declared_bob::text,
   'differenceBOB',c.difference_bob::text,'status',c.status,'note',c.note,'closedAt',c.created_at)END);
END $$;

-- Close a day once. Idempotent by action key; another key for a closed day: ALREADY_CLOSED.
-- The association row is locked so two closings of the same day serialize.
CREATE FUNCTION nexo.web_close_cash_day(k text,association uuid,d date,declared numeric,note text)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
DECLARE u uuid:=nexo.require_actor();p jsonb;cached jsonb;expected numeric;n integer;diff numeric;st text;
BEGIN
 p:=jsonb_build_object('op','web_close_cash_day','association',association,'day',d,'declared',declared,'note',note);
 cached:=nexo.action_start(k,p);IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF declared IS NULL OR declared<0 OR declared>9999999999.99 OR declared<>round(declared,2)THEN RAISE EXCEPTION 'INVALID_AMOUNT';END IF;
 IF NOT nexo.cash_day_ok(d)THEN RAISE EXCEPTION 'INVALID_DAY';END IF;
 PERFORM 1 FROM nexo.associations WHERE id=association FOR UPDATE;
 IF NOT FOUND OR NOT nexo.full_admin(association)THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF EXISTS(SELECT FROM nexo.cash_closings WHERE association_id=association AND day=d)THEN RAISE EXCEPTION 'ALREADY_CLOSED';END IF;
 SELECT coalesce(sum(amount_bob),0),count(*)INTO expected,n FROM nexo.expected_cash(association,d);
 diff:=declared-expected;st:=CASE WHEN diff=0 THEN 'CUADRA' ELSE 'DISCREPANCIA' END;
 IF st='DISCREPANCIA' AND(note IS NULL OR char_length(btrim(note))<5)THEN RAISE EXCEPTION 'NOTE_REQUIRED';END IF;
 IF note IS NOT NULL AND char_length(note)>200 THEN RAISE EXCEPTION 'INVALID_NOTE';END IF;
 INSERT INTO nexo.cash_closings(association_id,day,groups,expected_bob,declared_bob,difference_bob,status,note,actor_id)
  VALUES(association,d,n,expected,declared,diff,st,CASE WHEN note IS NULL OR btrim(note)='' THEN NULL ELSE btrim(note)END,u);
 RETURN nexo.action_finish(k,p,jsonb_build_object('associationId',association,'day',d,'groups',n,'expectedBOB',expected::numeric(12,2)::text,
  'declaredBOB',declared::numeric(12,2)::text,'differenceBOB',diff::numeric(12,2)::text,'status',st,'simulated',true));
END $$;

REVOKE ALL ON FUNCTION nexo.full_admin(uuid),nexo.expected_cash(uuid,date),nexo.cash_day_ok(date),nexo.web_reconciliation_associations(),
 nexo.web_reconciliation(uuid,date),nexo.web_close_cash_day(text,uuid,date,numeric,text)FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.web_reconciliation_associations(),nexo.web_reconciliation(uuid,date),nexo.web_close_cash_day(text,uuid,date,numeric,text)TO nexo_app;
