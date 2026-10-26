// Server-side adapter. Never accept actorId/associationId as authentication.
// The identity provider must issue random opaque sessions via a trusted connection.
export function createService(pool) {
  async function transaction(token, work) {
    if (typeof token !== 'string' || token.length < 32) throw new Error('UNAUTHENTICATED');
    const client = await pool.connect();
    try {
      const { rows: [role] } = await client.query(`SELECT rolsuper,rolbypassrls,
        pg_has_role(current_user,'nexo_app','USAGE') AS runtime FROM pg_roles WHERE rolname=current_user`);
      if (!role?.runtime || role.rolsuper || role.rolbypassrls) throw new Error('UNSAFE_RUNTIME_ROLE');
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SELECT set_config('nexo.session_token',$1,true)", [token]);
      await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='15s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  const call = (name, placeholders) => (token, ...values) => transaction(token, async client => {
    const { rows } = await client.query(`SELECT nexo.${name}(${placeholders}) AS result`, values);
    return rows[0].result;
  });
  return Object.freeze({
    reserve: call('reserve', '$1::text,$2::jsonb'),
    respond: call('respond_offer', '$1::text,$2::uuid,$3::boolean'),
    cancel: call('cancel', '$1::text,$2::uuid'),
    depart: call('depart', '$1::text,$2::uuid'),
    progress: call('progress', '$1::text,$2::uuid,$3::integer'),
    requestQueue: call('request_queue', '$1::text,$2::uuid,$3::uuid'),
    // Read-only access remains subject to RLS using the same revocable session.
    bookings: token => transaction(token, async client => (await client.query(
      'SELECT * FROM nexo.bookings ORDER BY created_at,id')).rows)
  });
}
