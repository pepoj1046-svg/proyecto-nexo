// pg-pool.end() can resolve before client.end callbacks / socket termination.
// Install before first use; PostgreSQL may stop only after every client emits end.
export function trackLocalPool(pool){
 const pending=new Set();let fault=false,closing;
 pool.on('connect',client=>{let finish;const ended=new Promise(resolve=>{finish=resolve;});pending.add(ended);client.once('end',()=>{pending.delete(ended);finish();});});
 // The default unhandled Pool error contains err.client (connection internals).
 // Preserve failure without logging that object or treating it as success.
 pool.on('error',()=>{fault=true;});
 return()=>closing??=(async()=>{
  await pool.end();let timer;
  try{if(pending.size)await Promise.race([Promise.all([...pending]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('LOCAL_POOL_CLOSE_TIMEOUT')),5000);})]);}
  finally{clearTimeout(timer);}
  if(fault)throw new Error('LOCAL_POOL_CONNECTION_FAILED');
 })();
}
