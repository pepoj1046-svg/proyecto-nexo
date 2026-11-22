import{writeFile,readFile}from'node:fs/promises';
import pg from'pg';
import{exportDatabase,restoreDatabase}from'../src/db/lab-backup.mjs';
import{migrate}from'./migrate.mjs';

// Etapa 8A. Usage (laboratory only, trusted migration connection):
//   MIGRATION_DATABASE_URL=... node scripts/lab-backup.mjs backup  <file.json>
//   MIGRATION_DATABASE_URL=... node scripts/lab-backup.mjs restore <file.json>
// restore migrates the EMPTY target database first and verifies every table checksum.
// The backup holds fictitious password and session hashes: keep it out of git and
// share it like a secret. The repository .gitignore already excludes .local/.
const[mode,file]=process.argv.slice(2);
if(!['backup','restore'].includes(mode)||!file)throw new Error('USAGE: lab-backup.mjs backup|restore <file.json>');
if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL required');
const c=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await c.connect();
try{
 if(mode==='backup'){const b=await exportDatabase(c);await writeFile(file,JSON.stringify(b),{mode:0o600,flag:'wx'});console.log({backup:file,tables:Object.keys(b.tables).length,rows:Object.values(b.tables).reduce((n,t)=>n+t.count,0)});}
 else{await migrate(c);console.log({restored:await restoreDatabase(c,JSON.parse(await readFile(file,'utf8')))});}
}finally{await c.end();}
