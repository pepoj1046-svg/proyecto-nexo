// Server-only local module; no HTTP endpoint or identity provider is deployed.
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, validatePassword } from './passwords.mjs';
const digest = token => createHash('sha256').update(token).digest('hex');
export function validateLogin(login) {
  if (typeof login !== 'string' || login.length > 64) throw new Error('INVALID_IDENTITY');
  const normalized = login.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(normalized)) throw new Error('INVALID_IDENTITY');
  return normalized;
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
      const { rows: [r] } = await c.query(`SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,
        pg_has_role(current_user,'nexo_identity','USAGE') AS runtime,
        (SELECT pg_has_role(current_user,nspowner,'MEMBER') FROM pg_namespace WHERE nspname='nexo') AS owner
        FROM pg_roles WHERE rolname=current_user`);
      if (!r?.runtime || r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb || r.owner)
        throw new Error('UNSAFE_IDENTITY_RUNTIME_ROLE');
      // Each call commits. Failed verifications cannot roll back abuse counters.
      return (await c.query(`SELECT nexo.${name}(${placeholders}) AS result`, values)).rows[0].result;
    } finally { c.release(); }
  }
  async function attempt(login, purpose='LOGIN') {
    const a = await call('identity_attempt','$1::text,$2::text',[login,purpose]);
    if (!a.allowed) throw new Error('INVALID_CREDENTIALS');
    return a;
  }
  return Object.freeze({
    register: async request => {
      const {login,password} = credentials(request);
      await attempt(login);
      const hash = await hashPassword(password);
      try { await call('register_identity','$1::text,$2::text',[login,hash]); }
      catch (e) { if (e.code !== '23505') throw e; }
      // Identical response for duplicate/created accounts, no implicit session.
      return { status: 'REGISTRATION_RECEIVED' };
    },
    login: async request => {
      const {login,password} = credentials(request);
      const a = await attempt(login);
      dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
      const valid = await verifyPassword(password,a.hash ?? await dummyHash);
      if (!valid || !a.userId) throw new Error('INVALID_CREDENTIALS');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = await call('issue_identity_session','$1::uuid,$2::integer,$3::text',[a.userId,a.version,digest(token)]);
      return { token, expiresAt };
    },
    recover: async request => {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(k => !['code','password'].includes(k)) ||
        typeof request.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.code)) throw new Error('INVALID_RECOVERY');
      validatePassword(request.password);
      await attempt('recovery','RECOVERY'); // Separate shared budget, persisted before scrypt.
      const hash = await hashPassword(request.password);
      if (!await call('recover_identity','$1::text,$2::text',[digest(request.code),hash])) throw new Error('INVALID_RECOVERY');
      return { status: 'RECOVERED' };
    }
  });
}
