import {randomBytes,createHash,timingSafeEqual}from'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const denied=()=>Object.assign(new Error('AUTHENTICATION_REQUIRED'),{status:401,code:'AUTHENTICATION_REQUIRED'});
// Opaque browser handles, never PostgreSQL tokens. Memory is bounded and lost on restart.
export function createWebSessions({identity,business,clock=Date.now,max=256}){
 const entries=new Map();
 const remove=key=>{entries.delete(key);};
 const fresh=(token=null,expires=clock()+15*60000)=>{for(const[k,v]of entries)if(v.expires<=clock())remove(k);if(entries.size>=max)throw Object.assign(new Error('RATE_LIMITED'),{status:429,code:'RATE_LIMITED'});const handle=secret(),entry={token,csrf:secret(),expires};entries.set(hash(handle),entry);return{handle,entry};};
 function get(req,name){const raw=req.headers.cookie;if(!raw)return null;const parts=raw.split(';').map(x=>x.trim());if(parts.some(p=>!/^trufis_lab_[0-9]+=/.test(p)&&!p.startsWith(name+'=')))throw Object.assign(new Error('UNEXPECTED_CREDENTIALS'),{status:400,code:'UNEXPECTED_CREDENTIALS'});const matching=parts.filter(p=>p.startsWith(name+'='));if(!matching.length)return null;if(matching.length!==1)throw denied();const handle=matching[0].slice(name.length+1);if(!/^[A-Za-z0-9_-]{43}$/.test(handle))throw denied();const key=hash(handle),entry=entries.get(key);if(!entry||entry.expires<=clock()){remove(key);return null;}return{key,entry};}
 function csrf(context,value){if(!context||typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||!timingSafeEqual(Buffer.from(context.entry.csrf),Buffer.from(value)))throw Object.assign(new Error('CSRF_REQUIRED'),{status:403,code:'CSRF_REQUIRED'});}
 async function actor(context){if(!context?.entry.token)throw denied();try{return await business.me(context.entry.token);}catch(e){if(/UNAUTHENTICATED|SESSION|INACTIVE/.test(e.message)){remove(context.key);throw denied();}throw e;}}
 return Object.freeze({get,csrf,actor,
  session:async(context)=>{if(!context){const f=fresh();return{handle:f.handle,body:{authenticated:false,csrf:f.entry.csrf,mode:'LOCAL_LAB',storage:'EPHEMERAL_LAB'}};}try{const me=context.entry.token?await actor(context):null;return{body:{authenticated:!!me,...me,csrf:context.entry.csrf,mode:'LOCAL_LAB',storage:'EPHEMERAL_LAB'}};}catch(e){if(e.status!==401)throw e;const f=fresh();return{handle:f.handle,body:{authenticated:false,csrf:f.entry.csrf,mode:'LOCAL_LAB',storage:'EPHEMERAL_LAB'}};}},
  login:async(context,b)=>{const session=await identity.login(b);const f=fresh(session.token,Math.min(new Date(session.expiresAt).getTime(),clock()+3600000));if(context)remove(context.key);return{handle:f.handle,body:{authenticated:true,...await business.me(session.token),csrf:f.entry.csrf,mode:'LOCAL_LAB',storage:'EPHEMERAL_LAB'}};},
  logout:async context=>{if(context?.entry.token)await business.logout(context.entry.token);if(context)remove(context.key);return{authenticated:false};},
  clear:()=>entries.clear()
 });
}
