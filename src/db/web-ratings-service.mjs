import{assertRuntime}from'./runtime.mjs';
import{object,id,actionKey}from'../domain/business.mjs';

// 5A.7 Valoraciones de laboratorio. PostgreSQL decides eligibility, uniqueness and
// visibility; this adapter only closes the request shapes. Ratings never touch
// inventory, fares, queue, custody or sanctions.
export const RATING_TAGS=Object.freeze(['PUNTUALIDAD','TRATO','LIMPIEZA','CONDUCCION_SEGURA']);
export function validateRating(b){
 object(b,['bookingId','score','tags']);id(b.bookingId);
 if(!Number.isInteger(b.score)||b.score<1||b.score>5||!Array.isArray(b.tags)||b.tags.length>4||b.tags.some(t=>!RATING_TAGS.includes(t))||new Set(b.tags).size!==b.tags.length)throw new Error('INVALID_RATING');
 return{bookingId:b.bookingId,score:b.score,tags:[...b.tags]};
}
export function validatePage(b){
 object(b,['limit','offset']);
 if(!Number.isInteger(b.limit)||b.limit<1||b.limit>50||!Number.isInteger(b.offset)||b.offset<0||b.offset>10000)throw new Error('INVALID_PAGE');
 return b;
}
export function createWebRatingsService(pool){
 async function tx(token,readOnly,work){
  const c=await pool.connect();
  try{
   await assertRuntime(c,'nexo_app');await c.query(readOnly?'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY':'BEGIN');
   await c.query("SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='15s'");
   await c.query("SELECT set_config('nexo.session_token',$1,true)",[token]);
   const before=(await c.query('SELECT nexo.actor()AS actor')).rows[0].actor;if(!before)throw new Error('UNAUTHENTICATED');
   const result=await work(c);
   if((await c.query('SELECT nexo.actor()AS actor')).rows[0].actor!==before)throw new Error('UNAUTHENTICATED');
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 const one=async(c,query,values=[])=>(await c.query(query,values)).rows[0].r;
 return Object.freeze({
  mine:async(token,b)=>{object(b??{},[]);return tx(token,true,c=>one(c,'SELECT nexo.web_ratable_bookings()AS r'));},
  rate:async(token,key,b)=>{actionKey(key);const q=validateRating(b);return tx(token,false,c=>one(c,'SELECT nexo.web_rate_service($1,$2,$3,$4)AS r',[key,q.bookingId,q.score,JSON.stringify(q.tags)]));},
  admin:async(token,b)=>{const q=validatePage(b);return tx(token,true,c=>one(c,'SELECT nexo.web_service_ratings($1,$2)AS r',[q.limit,q.offset]));},
 });
}
