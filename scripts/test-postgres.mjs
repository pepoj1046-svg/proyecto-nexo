import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import pg from 'pg';

// Always a fresh local cluster. No DATABASE_URL or remote database is consumed.
const root = resolve('.local');
await mkdir(root, { recursive: true });
const clusterDir = await mkdtemp(resolve(root, 'postgres-'));
if (!(await realpath(clusterDir)).startsWith((await realpath(root)) + sep)) throw new Error('UNSAFE_TEST_DIRECTORY');
// initdb must create its own data directory. On elevated Windows runners its
// restricted token cannot chmod a directory pre-created by the administrator.
const databaseDir = resolve(clusterDir,'data');
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
const password = randomBytes(32).toString('hex');
const database = `nexo_test_${randomBytes(8).toString('hex')}`;
const postgres = new EmbeddedPostgres({
  databaseDir, port, user: 'postgres', password, persistent: true,
  authMethod: 'scram-sha-256', createPostgresUser: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h','127.0.0.1','-c','max_connections=80'],
  onLog: () => {}, onError: () => {} // No connection secrets in logs.
});
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const { pg_ctl: pgCtl } = await import(`@embedded-postgres/${platform}-${process.arch}`);
if (!pgCtl) throw new Error('Platform package must provide pg_ctl');
const control = args => new Promise((resolveControl,reject) => {
  const child=spawn(pgCtl,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',data=>{output+=data;});
  child.stderr.on('data',data=>{output+=data;});
  child.on('error',reject);
  child.on('exit',code=>code===0?resolveControl():reject(new Error(`pg_ctl failed (${code}): ${output}`)));
});
let started = false;
try {
  await postgres.initialise();
  // pg_ctl provides graceful cross-platform shutdown, including Windows.
  await control(['start','-D',databaseDir,'-l',resolve(clusterDir,'server.log'),'-w','-t','30',
    '-o',`-p ${port} -h 127.0.0.1 -c max_connections=80`]);
  started = true;
  const setup = new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
  await setup.connect();
  try { await setup.query(`CREATE DATABASE ${setup.escapeIdentifier(database)}`); }
  finally { await setup.end(); }
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, ['--test','--test-concurrency=1','tests/integration/postgres.test.mjs'], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, NEXO_TEST_LOCAL: '1',
        NEXO_TEST_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}` }
    });
    child.on('error',reject);
    child.on('exit',resolveCode);
  });
  process.exitCode = code ?? 1;
} finally {
  if (started) await control(['stop','-D',databaseDir,'-m','fast','-w','-t','30']);
  // Kept under ignored .local for diagnostics; no recursive deletion of computed paths.
}
