import { assertRuntime } from '../db/runtime.mjs';
import { createService } from '../db/service.mjs';
import { createIdentity } from '../auth/identity.mjs';
import { startLocalHttpApi } from './local-api.mjs';
export async function startTestRuntime(appPool,identityPool) {
  const connections=[];
  try {
    for(const [pool,group] of [[appPool,'nexo_app'],[identityPool,'nexo_identity']]) {
      const c=await pool.connect();connections.push(c);
      await assertRuntime(c,group,{localTest:true});
    }
    const [app,identity]=connections.map(c=>c.connectionParameters);
    if(app.port!==identity.port || app.database!==identity.database || app.user===identity.user)
      throw new Error('SEPARATE_LOCAL_POOLS_REQUIRED');
    return await startLocalHttpApi({localTest:true,service:createService(appPool),identity:createIdentity(identityPool)});
  } finally {for(const c of connections)c.release();}
}
