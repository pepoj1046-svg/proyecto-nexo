-- Etapa 8A: lab health without secrets. Reports only that PostgreSQL answers, how many
-- migrations are applied and the latest one. Additive; 001-047 untouched.
CREATE FUNCTION nexo.lab_health()RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,nexo,pg_temp AS $$
 SELECT jsonb_build_object('database','up','migrations',(SELECT count(*)FROM public.nexo_migrations),
  'latestMigration',(SELECT max(name)FROM public.nexo_migrations),'serverTime',clock_timestamp())
$$;
REVOKE ALL ON FUNCTION nexo.lab_health()FROM PUBLIC,nexo_app,nexo_identity,nexo_provisioner,nexo_maintenance;
GRANT EXECUTE ON FUNCTION nexo.lab_health()TO nexo_app;
