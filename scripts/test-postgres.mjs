import EmbeddedPostgres from 'embedded-postgres';
import exitHook from 'async-exit-hook';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { launchLocalDemo } from './local-demo.mjs';
import { launchWebDemo } from './web-demo.mjs';

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
// pg_ctl owns this process's cluster, not embedded-postgres.process. Its default
// signal hook exits immediately, racing the async finally below. Own these signals
// for serve modes, including during startup, and keep repeated Ctrl+C idempotent.
const serving=process.argv.includes('--serve-http')||process.argv.includes('--serve-web');
let requestStop;const stopRequested=new Promise(resolve=>{requestStop=resolve;});
const stop=()=>requestStop();const message=value=>{if(value==='stop-local-test')stop();};
if(serving){
  exitHook.unhookEvent('SIGINT');exitHook.unhookEvent('SIGTERM');
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('message',message);
}
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
  if(process.argv.includes('--serve-http')||process.argv.includes('--serve-web')) {
    const isWeb=process.argv.includes('--serve-web');
    const local=await (isWeb?launchWebDemo:launchLocalDemo)({host:'127.0.0.1',port,user:'postgres',password,database});
    try {
      if(isWeb){console.log('Trufis Bolivia web local: '+local.url);process.send?.({type:'web-ready',url:local.url,postgresPort:port});}
      else{console.log('Local test API: '+local.url);console.log('Local business API: '+local.businessUrl);}
      await stopRequested;
    } finally {await local.close();}
  } else {
  const code = await new Promise((resolveCode, reject) => {
    const args = process.argv.includes('--verify-failure')
      ? ['--test','--nexo-invalid-test-option']
      : ['--test','--test-concurrency=1','tests/integration/postgres.test.mjs'];
    const child = spawn(process.execPath, args, {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, NEXO_TEST_LOCAL: '1',
        NEXO_TEST_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}` }
    });
    child.on('error',reject);
    child.on('exit',resolveCode);
  });
  process.exitCode = code ?? 1;
  }
} finally {
  if (started) await control(['stop','-D',databaseDir,'-m','fast','-w','-t','30']);
  if(serving){process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('message',message);}
  if(started && serving) console.log('Local test API stopped; PostgreSQL stopped.');
  // Kept under ignored .local for diagnostics; no recursive deletion of computed paths.
}

// async-exit-hook otherwise maps beforeExit to zero, masking a failing child.
process.exit(process.exitCode ?? 0);
