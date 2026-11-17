let active=0;
// Shared by every identity adapter in this process, with no pending work queue.
export async function withPasswordWork(work) {
  if(active>=6) throw new Error('IDENTITY_BUSY');
  active++;
  try {return await work();} finally {active--;}
}
