const groups = ['nexo_app','nexo_identity','nexo_provisioner','nexo_maintenance'];
// Check effective authority, including memberships reachable with SET ROLE.
export async function assertRuntime(client, group, { localTest = false } = {}) {
  if (!groups.includes(group)) throw new Error('INVALID_RUNTIME_GROUP');
  const { rows: [r] } = await client.query(`SELECT
    coalesce(pg_has_role(current_user,(SELECT oid FROM pg_roles WHERE rolname=$1),'USAGE'),false) AS expected,
    current_user<>session_user OR has_schema_privilege(current_user,'nexo','CREATE') OR
    EXISTS(SELECT FROM pg_roles p WHERE pg_has_role(current_user,p.oid,'MEMBER') AND
      (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb OR p.rolreplication OR p.rolname LIKE 'pg_%'
        OR (p.rolname=ANY($2::text[]) AND p.rolname<>$1))) OR
    EXISTS(SELECT FROM pg_namespace n WHERE n.nspname='nexo' AND pg_has_role(current_user,n.nspowner,'MEMBER')) OR
    EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nexo'
      AND pg_has_role(current_user,c.relowner,'MEMBER')) OR
    EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nexo'
      AND pg_has_role(current_user,p.proowner,'MEMBER')) AS unsafe`, [group,groups]);
  if (!r?.expected || r.unsafe) throw new Error(group === 'nexo_identity' ? 'UNSAFE_IDENTITY_RUNTIME_ROLE' : 'UNSAFE_RUNTIME_ROLE');
  if (localTest && (client.connectionParameters?.host !== '127.0.0.1' ||
    !/^nexo_test_[a-f0-9]+$/.test(client.connectionParameters?.database ?? '')))
    throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
}
