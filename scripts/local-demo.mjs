import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './migrate.mjs';
import { startTestRuntime } from '../src/http/test-runtime.mjs';
import { startBusinessRuntime } from '../src/http/business-api.mjs';

// Called only by the fresh-cluster runner. No environment DATABASE_URL is read.
export async function launchLocalDemo(config) {
  if(config.host!=='127.0.0.1' || !/^nexo_test_[a-f0-9]+$/.test(config.database)) throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  const setup=new pg.Client(config);await setup.connect();
  const pools=[];let api,business;
  try {
    await migrate(setup);
    for(const [name,group] of [['nexo_demo_app','nexo_app'],['nexo_demo_identity','nexo_identity']]) {
      const password=randomBytes(32).toString('hex');
      await setup.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
        GRANT ${group} TO ${name}`);
      pools.push(new pg.Pool({...config,user:name,password,max:6,connectionTimeoutMillis:2000}));
    }
    api=await startTestRuntime(...pools);
    business=await startBusinessRuntime(pools[0]);
    return {url:api.url,businessUrl:business.url,close:async()=>{await api.close();await business.close();await Promise.all(pools.map(p=>p.end()));}};
  } catch(e) {if(api)await api.close();if(business)await business.close();await Promise.all(pools.map(p=>p.end()));throw e;}
  finally {await setup.end();}
}
