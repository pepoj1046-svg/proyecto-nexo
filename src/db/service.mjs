// Server-side adapter. Never accept actorId/associationId as authentication.
// The identity provider must issue random opaque sessions via a trusted connection.
import { validateSearch } from '../domain/search.mjs';
import { validateLocalityQuery } from '../domain/localities.mjs';
import { assertRuntime } from './runtime.mjs';
export function createService(pool) {
  async function transaction(token, work) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('UNAUTHENTICATED');
    const client = await pool.connect();
    try {
      await assertRuntime(client,'nexo_app');
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
    suggestLocalities: (token,request) => {
      const q=validateLocalityQuery(request);
      return call('suggest_localities','$1::text,$2::integer')(token,q.query,q.limit);
    },
    logout: call('logout',''),
    logoutAll: call('logout_all',''),
    setDriverMembership: call('set_driver_membership','$1::uuid,$2::uuid,$3::boolean,$4::text'),
    search: (token,request) => {
      const q=validateSearch(request);
      return call('search_services','$1::uuid,$2::uuid,$3::integer,$4::boolean')(
        token,q.originLocalityId,q.destinationLocalityId,q.seats,q.express);
    },
    submitAuthorization: call('submit_authorization','$1::text,$2::uuid,$3::text,$4::text,$5::timestamptz,$6::timestamptz'),
    reviewAuthorization: call('review_authorization','$1::text,$2::uuid,$3::text,$4::text'),
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
