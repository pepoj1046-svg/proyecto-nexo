import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Trusted migration connection only. Never use the runtime role here.
export async function migrate(client, directory = new URL('../database/migrations/', import.meta.url)) {
  await client.query('SELECT pg_advisory_lock(746281930)');
  const applied = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.nexo_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    ); REVOKE ALL ON public.nexo_migrations FROM PUBLIC`);
    const files = (await readdir(directory)).filter(f => /^\d+_[a-z0-9_]+\.sql$/.test(f)).sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM public.nexo_migrations WHERE name=$1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.nexo_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        error.message = name + ': ' + error.message;
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(746281930)');
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL required');
  const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try { console.log({ applied: await migrate(client) }); }
  finally { await client.end(); }
}
