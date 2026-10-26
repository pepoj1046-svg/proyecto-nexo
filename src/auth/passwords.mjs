import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export function validatePassword(password) {
  if (typeof password !== 'string' || !password.isWellFormed() || [...password].length < 12 || Buffer.byteLength(password) > 128)
    throw new Error('INVALID_PASSWORD');
  return password; // Passwords are never trimmed or Unicode-normalized.
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, options);
  return `scrypt:32768:8:3:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || !password.isWellFormed() || Buffer.byteLength(password) > 128) return false;
  const parts = typeof encoded === 'string' ? encoded.split(':') : [];
  if (parts.length !== 6 || parts.slice(0,4).join(':') !== 'scrypt:32768:8:3' ||
    !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const hash = await scrypt(password, parts[4], 64, options);
  return timingSafeEqual(hash, Buffer.from(parts[5], 'hex'));
}
