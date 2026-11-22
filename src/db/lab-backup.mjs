import{createHash}from'node:crypto';

// Etapa 8A. Reproducible logical backup and restore of the LABORATORY database.
// Trusted migration connection only (superuser in the lab). It never handles secrets
// beyond what the database already holds, and the backup file must be treated as
// sensitive: it contains password hashes and session hashes of fictitious accounts.
// Restore targets a freshly migrated, EMPTY database with the very same migrations.
export const FORMAT='nexo-lab-backup/1';
const sha=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function tables(c){return(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='nexo' ORDER BY tablename")).rows.map(r=>r.tablename);}
async function rowsOf(c,t){return(await c.query(`SELECT to_jsonb(x) AS r FROM nexo.${c.escapeIdentifier(t)} x ORDER BY to_jsonb(x)::text`)).rows.map(r=>r.r);}
async function registry(c){return(await c.query('SELECT name,checksum FROM public.nexo_migrations ORDER BY name')).rows;}

export async function exportDatabase(c){
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const out={format:FORMAT,createdAt:new Date().toISOString(),migrations:await registry(c),tables:{}};
  for(const t of await tables(c)){const rows=await rowsOf(c,t);out.tables[t]={count:rows.length,sha256:sha(rows),rows};}
  await c.query('COMMIT');return out;
 }catch(e){await c.query('ROLLBACK');throw e;}
}

// Per-table checksums of a live database, comparable with a backup manifest.
export async function manifest(c){const m={};for(const t of await tables(c)){const rows=await rowsOf(c,t);m[t]={count:rows.length,sha256:sha(rows)};}return m;}

export function verifyBackupShape(b){
 if(!b||b.format!==FORMAT||!Array.isArray(b.migrations)||!b.tables||typeof b.tables!=='object')throw new Error('INVALID_BACKUP');
 for(const[t,v]of Object.entries(b.tables)){
  if(!/^[a-z_][a-z0-9_]*$/.test(t)||!Array.isArray(v.rows)||v.rows.length!==v.count||sha(v.rows)!==v.sha256)throw new Error('BACKUP_CORRUPT: '+t);
 }
 return b;
}

export async function restoreDatabase(c,backup){
 verifyBackupShape(backup);
 const target=await registry(c);
 if(JSON.stringify(target)!==JSON.stringify(backup.migrations))throw new Error('MIGRATIONS_DIFFER');
 const names=await tables(c);
 if(JSON.stringify(names)!==JSON.stringify(Object.keys(backup.tables).sort()))throw new Error('TABLES_DIFFER');
 for(const t of names)if((await c.query(`SELECT EXISTS(SELECT FROM nexo.${c.escapeIdentifier(t)})AS e`)).rows[0].e)throw new Error('TARGET_NOT_EMPTY: '+t);
 await c.query('BEGIN');
 try{
  // Triggers (immutability, guards, notices) and FK checks are suspended only inside
  // this transaction: the rows come from a consistent snapshot of the same schema.
  await c.query('SET LOCAL session_replication_role=replica');
  for(const t of names){
   const rows=backup.tables[t].rows;if(!rows.length)continue;
   const id=c.escapeIdentifier(t);
   for(let i=0;i<rows.length;i+=500)await c.query(`INSERT INTO nexo.${id} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::nexo.${id},$1::jsonb)`,[JSON.stringify(rows.slice(i,i+500))]);
  }
  // Identity sequences continue after the restored rows.
  for(const s of(await c.query("SELECT table_name t,column_name col FROM information_schema.columns WHERE table_schema='nexo' AND is_identity='YES'")).rows){
   await c.query(`SELECT setval(pg_get_serial_sequence($1,$2),coalesce((SELECT max(${c.escapeIdentifier(s.col)}) FROM nexo.${c.escapeIdentifier(s.t)}),0)+1,false)`,['nexo.'+s.t,s.col]);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}
 const after=await manifest(c);
 for(const t of names)if(after[t].sha256!==backup.tables[t].sha256)throw new Error('RESTORE_MISMATCH: '+t);
 return{tables:names.length,rows:Object.values(after).reduce((n,x)=>n+x.count,0)};
}
