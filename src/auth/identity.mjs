// Server-only local module; no HTTP endpoint or identity provider is deployed.
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, validatePassword } from './passwords.mjs';
import { assertRuntime } from '../db/runtime.mjs';
import { withPasswordWork as derive } from './work-limit.mjs';
const digest = token => createHash('sha256').update(token).digest('hex');
export function validateLogin(login) {
  if (typeof login !== 'string' || login.length > 64) throw new Error('INVALID_IDENTITY');
  const trimmed = login.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{2,63}$/.test(trimmed)) throw new Error('INVALID_IDENTITY');
  return trimmed.toLowerCase();
}
function credentials(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
    Object.keys(request).some(k => !['login','password'].includes(k))) throw new Error('INVALID_IDENTITY');
  return { login: validateLogin(request.login), password: validatePassword(request.password) };
}
export function createIdentity(pool) {
  let dummyHash;
  async function call(name, placeholders, values) {
    const c = await pool.connect();
    try {
      await assertRuntime(c,'nexo_identity');
      // Each call commits. Failed verifications cannot roll back abuse counters.
      await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await c.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
      const result=(await c.query(`SELECT nexo.${name}(${placeholders}) AS result`, values)).rows[0].result;
      await c.query('COMMIT');
      return result;
    } catch(e) {await c.query('ROLLBACK');throw e;
    } finally { c.release(); }
  }
  async function attempt(login, purpose='LOGIN') {
    const a = await call('identity_attempt','$1::text,$2::text',[login,purpose]);
    if (!a.allowed) throw Object.assign(new Error('INVALID_CREDENTIALS'),{rateLimited:true});
    return a;
  }
  return Object.freeze({
    register: async request => {
      const {login,password} = credentials(request);
      await attempt(login,'REGISTER');
      const hash = await derive(()=>hashPassword(password));
      try { await call('register_identity','$1::text,$2::text',[login,hash]); }
      catch (e) { if (e.code !== '23505') throw e; }
      // Identical response for duplicate/created accounts, no implicit session.
      return { status: 'REGISTRATION_RECEIVED' };
    },
    login: async request => {
      const {login,password} = credentials(request);
      const a = await attempt(login);
      const valid = await derive(async()=> {
        const fallback=await (dummyHash ??= hashPassword(randomBytes(32).toString('hex')));
        return verifyPassword(password,a.hash ?? fallback);
      });
      if (!valid || !a.userId) {
        await call('record_identity_failure','$1::text,$2::text',[login,'LOGIN']);
        throw new Error('INVALID_CREDENTIALS');
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = await call('issue_identity_session','$1::uuid,$2::integer,$3::text',[a.userId,a.version,digest(token)]);
      return { token, expiresAt };
    },
    recover: async request => {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(k => !['code','password'].includes(k)) ||
        typeof request.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.code)) throw new Error('INVALID_RECOVERY');
      validatePassword(request.password);
      const recoveryKey=digest(request.code);
      await attempt(recoveryKey,'RECOVERY'); // Per-code budget, no raw recovery secret in SQL.
      const hash = await derive(()=>hashPassword(request.password));
      if (!await call('recover_identity','$1::text,$2::text',[recoveryKey,hash])) {
        await call('record_identity_failure','$1::text,$2::text',[recoveryKey,'RECOVERY']);
        throw new Error('INVALID_RECOVERY');
      }
      return { status: 'RECOVERED' };
    }
  });
}
