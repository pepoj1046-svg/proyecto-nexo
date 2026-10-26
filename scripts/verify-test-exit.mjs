import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const probe=spawnSync(process.execPath,['scripts/test-postgres.mjs','--verify-failure'],{
  stdio:'inherit',windowsHide:true
});
if(probe.error) throw probe.error;
assert.equal(probe.status,9,'Runner must propagate the deliberately invalid child option');
console.log('Runner failure propagation: child exit 9 preserved; PostgreSQL stopped.');
