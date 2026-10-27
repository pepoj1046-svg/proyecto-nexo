import { randomBytes } from 'node:crypto';
import pg from 'pg';
import{mkdir,writeFile,unlink}from'node:fs/promises';
import{resolve}from'node:path';
import { migrate } from './migrate.mjs';
import { seedWebDemo } from './seed-web-demo.mjs';
import { startWebGateway } from '../src/http/web-gateway.mjs';
export async function launchWebDemo(config) {
  if(config.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(config.database))throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  const setup=new pg.Client(config);await setup.connect();let pool,identityPool,web,credentialsFile;
  try{
    await migrate(setup);const password=randomBytes(32).toString('hex');
    await setup.query(`CREATE ROLE nexo_web_app LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;GRANT nexo_app TO nexo_web_app`);
    pool=new pg.Pool({...config,user:'nexo_web_app',password,max:6,connectionTimeoutMillis:2000});
    const identityPassword=randomBytes(32).toString('hex');
    await setup.query(`CREATE ROLE nexo_web_identity LOGIN PASSWORD '${identityPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;GRANT nexo_identity TO nexo_web_identity`);
    identityPool=new pg.Pool({...config,user:'nexo_web_identity',password:identityPassword,max:2,connectionTimeoutMillis:2000});
    const {catalogToken,accounts}=await seedWebDemo(setup,pool);
    await mkdir('.local',{recursive:true});credentialsFile=resolve('.local/accesos-'+randomBytes(8).toString('hex')+'.json');
    await writeFile(credentialsFile,JSON.stringify({warning:'FICTICIO Y EFÍMERO. Se elimina al detener el laboratorio.',accounts},null,2),{mode:0o600,flag:'wx'});
    console.log('Accesos ficticios locales (archivo privado): '+credentialsFile);
    // Close setup before listening. Identity pool is distinct; no provisioner/owner at runtime.
    await setup.end();web=await startWebGateway({pool,identityPool,catalogToken,localTest:true});
    return {url:web.url,credentialsFile,close:async()=>{await web.close();await pool.end();await identityPool.end();await unlink(credentialsFile);}};
  }catch(e){if(web)await web.close();if(pool)await pool.end();if(identityPool)await identityPool.end();if(credentialsFile)await unlink(credentialsFile).catch(()=>{});try{await setup.end();}catch{}throw e;}
}
