import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './migrate.mjs';
import { seedWebDemo } from './seed-web-demo.mjs';
import { startWebGateway } from '../src/http/web-gateway.mjs';
export async function launchWebDemo(config) {
  if(config.host!=='127.0.0.1'||!/^nexo_test_[a-f0-9]+$/.test(config.database))throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  const setup=new pg.Client(config);await setup.connect();let pool,web;
  try{
    await migrate(setup);const password=randomBytes(32).toString('hex');
    await setup.query(`CREATE ROLE nexo_web_app LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;GRANT nexo_app TO nexo_web_app`);
    pool=new pg.Pool({...config,user:'nexo_web_app',password,max:6,connectionTimeoutMillis:2000});
    const {catalogToken}=await seedWebDemo(setup,pool);
    // Close setup before accepting any browser request. No identity/provisioner pool.
    await setup.end();web=await startWebGateway({pool,catalogToken,localTest:true});
    return {url:web.url,close:async()=>{await web.close();await pool.end();}};
  }catch(e){if(web)await web.close();if(pool)await pool.end();try{await setup.end();}catch{}throw e;}
}
