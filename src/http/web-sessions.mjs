import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const denied=()=>Object.assign(new Error('AUTHENTICATION_REQUIRED'),{status:401,code:'AUTHENTICATION_REQUIRED'});
const csrfError=()=>Object.assign(new Error('CSRF_REQUIRED'),{status:403,code:'CSRF_REQUIRED'});
// The cookie selects a container, NEVER an actor. Document capabilities live only
// in RAM; selecting a document cannot retrieve its proof or reset its authority.
export function createWebSessions({identity,business,clock=Date.now,max=256}){
 const browsers=new Map(),documents=new Map(),environmentId=randomUUID();
 const prune=()=>{for(const[k,v]of documents)if(v.expires<=clock()||!browsers.has(v.browser))documents.delete(k);for(const[k,v]of browsers)if(v.expires<=clock())browsers.delete(k);};
 function live(c){if(!c?.entry||documents.get(c.id)!==c.entry||browsers.get(c.key)!==c.browser||c.entry.expires<=clock()||c.browser.expires<=clock())throw denied();return c.entry;}
 function get(req,name){
  const raw=req.headers.cookie;let container=null;
  if(raw){const parts=raw.split(';').map(x=>x.trim());if(parts.some(p=>!/^trufis_lab_[0-9]+=/.test(p)&&!p.startsWith(name+'=')))throw Object.assign(new Error('UNEXPECTED_CREDENTIALS'),{status:400,code:'UNEXPECTED_CREDENTIALS'});const matching=parts.filter(p=>p.startsWith(name+'='));if(matching.length>1)throw denied();if(matching.length){const handle=matching[0].slice(name.length+1);if(!/^[A-Za-z0-9_-]{43}$/.test(handle))throw denied();const key=hash(handle),browser=browsers.get(key);if(browser&&browser.expires>clock())container={key,browser,handle};}}
  const id=req.headers['x-nexo-document'],generation=req.headers['x-nexo-generation'];
  if(id===undefined&&generation===undefined)return container;
  if(!container||typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)||typeof generation!=='string'||! /^(0|[1-9][0-9]{0,8})$/.test(generation))throw denied();
  const entry=documents.get(id),c={...container,id,entry};live(c);if(entry.browser!==container.key||entry.generation!==Number(generation))throw denied();return c;
 }
 function csrf(c,value){if(!c?.entry)throw csrfError();live(c);if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||!timingSafeEqual(Buffer.from(c.entry.csrf),Buffer.from(value)))throw csrfError();}
 async function actor(c){const entry=live(c);if(!entry.token)throw denied();try{const me=await business.me(entry.token);live(c);return me;}catch(e){if(/UNAUTHENTICATED|SESSION|INACTIVE/.test(e.message)){if(documents.get(c.id)===entry)documents.delete(c.id);throw denied();}throw e;}}
 const body=(c,me=null)=>({authenticated:!!me,...me,documentId:c.id,generation:c.entry.generation,csrf:c.entry.csrf,environmentId,mode:'LOCAL_LAB',storage:'EPHEMERAL_LAB'});
 return Object.freeze({get,csrf,actor,live,
  session:async(c,proof)=>{
   if(c?.entry){csrf(c,proof);const me=c.entry.token?await actor(c):null;live(c);return{body:body(c,me)};}
   // Unselected GET always creates a NEW anonymous context, even with a cookie.
   prune();if(documents.size>=max||(!c&&browsers.size>=max))throw Object.assign(new Error('RATE_LIMITED'),{status:429,code:'RATE_LIMITED'});
   if(!c){const handle=secret(),key=hash(handle),browser={expires:clock()+3600000};browsers.set(key,browser);c={key,browser,handle};}
   c.browser.expires=clock()+3600000;
   const id=randomUUID(),entry={browser:c.key,token:null,csrf:secret(),generation:0,expires:clock()+15*60000};documents.set(id,entry);
   return{handle:c.handle,body:body({...c,id,entry})};
  },
  login:async(c,b)=>{
   live(c);const session=await identity.login(b);let installed=false;
   try{const me=await business.me(session.token);live(c);const entry={browser:c.key,token:session.token,csrf:secret(),generation:c.entry.generation+1,expires:Math.min(new Date(session.expiresAt).getTime(),clock()+3600000)};
    if(!Number.isFinite(entry.expires)||entry.expires<=clock())throw denied();documents.set(c.id,entry);installed=true;c.browser.expires=clock()+3600000;
    return{handle:c.handle,body:body({...c,entry},me)};
   }finally{if(!installed)await business.logout(session.token).catch(()=>undefined);}
  },
  logout:async c=>{const entry=live(c);if(entry.token)await business.logout(entry.token);if(documents.get(c.id)===entry)documents.delete(c.id);return{authenticated:false};},
  clear:()=>{browsers.clear();documents.clear();}
 });
}
