import { assertRuntime } from './runtime.mjs';
export function createMaintenance(pool) {
  return Object.freeze({
    run: async ({ cutoff, batchSize = 100, dryRun = true } = {}) => {
      if (typeof cutoff !== 'string' || !Number.isFinite(Date.parse(cutoff)) || !Number.isInteger(batchSize) ||
        batchSize < 1 || batchSize > 1000 || typeof dryRun !== 'boolean') throw new Error('INVALID_MAINTENANCE');
      const c=await pool.connect();
      try {
        await assertRuntime(c,'nexo_maintenance',{localTest:true});
        await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await c.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
        const {rows:[r]}=await c.query('SELECT nexo.maintain_identity($1,$2,$3) AS result',[cutoff,batchSize,dryRun]);
        await c.query('COMMIT');
        return r.result;
      } catch(e) {await c.query('ROLLBACK'); throw e;} finally {c.release();}
    }
  });
}
