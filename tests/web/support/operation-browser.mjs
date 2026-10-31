import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const accounts=JSON.parse(await readFile(process.env.NEXO_WEB_CREDENTIALS_FILE,'utf8')).accounts;
// Safe failure diagnostics: no request bodies, credentials, cookies or CSRF values.
const diagnosticPages=new Map();
function watch(page){
 if(diagnosticPages.has(page))return;
 const events=[];diagnosticPages.set(page,events);const record=e=>{events.push(e);if(events.length>40)events.shift();};
 page.on('requestfailed',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))record({path:u.pathname,network:r.failure()?.errorText??'REQUEST_FAILED'});});
 page.on('response',async r=>{
  const path=new URL(r.url()).pathname;if(!path.startsWith('/api/'))return;
  const interesting=!r.ok()||['/api/session','/api/login','/api/logout','/api/operations/overview','/api/operations/snapshot'].includes(path);if(!interesting)return;
  const event={path,status:r.status()};record(event);
  try{const b=await r.json();if(!r.ok())event.error=typeof b.error==='string'&&/^[A-Z_]+$/.test(b.error)?b.error:'REQUEST_REJECTED';
   else if(path==='/api/operations/snapshot')Object.assign(event,{tripId:b.tripId,state:b.status,phase:b.phase,operationAllowed:b.operationAllowed,departureEligible:b.departureEligible,bookings:b.bookings?.length});
   else if(path==='/api/operations/overview')event.trips=b.trips?.map(t=>({tripId:t.tripId,state:t.status}));
   else event.authenticated=b.authenticated;
  }catch{event.response='UNREADABLE_RESPONSE';}
 });
}
test.afterEach(async({},info)=>{
 if(info.status!==info.expectedStatus){for(const[page,events]of diagnosticPages){let ui={closed:page.isClosed()};if(!ui.closed)try{ui={closed:false,alerts:await page.locator('[role=alert]').allTextContents(),tripHeadings:await page.locator('.trip-operations h2').allTextContents(),loginForms:await page.locator('.lab-login').count()};}catch{ui.unavailable=true;}console.log('SAFE_WEB_FAILURE_DIAGNOSTIC '+JSON.stringify({path:new URL(page.url()).pathname,events,ui}));}}
 diagnosticPages.clear();
});
export async function login(page,label,path){
 watch(page);
 const failures=[];const listen=async r=>{if(r.url().includes('/api/')&&!r.ok()){let error='UNREADABLE_RESPONSE';try{error=(await r.json()).error??'REQUEST_REJECTED';}catch{}failures.push({path:new URL(r.url()).pathname,status:r.status(),error});}};
 page.on('response',listen);
 try{await page.goto(path);await page.getByLabel('Usuario ficticio',{exact:true}).fill(accounts[label].login);await page.getByLabel('Contraseña de prueba',{exact:true}).fill(accounts[label].password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();}
 catch(e){e.message+='\nLOGIN_HTTP_DIAGNOSTIC '+JSON.stringify(failures)+' '+JSON.stringify(await page.locator('.lab-login [role=alert]').allTextContents());throw e;}
 finally{page.off('response',listen);}
}
export async function operational(page,label,path,vehicle='FICTICIO-OPERATIVO'){await login(page,label,path);const select=page.getByLabel('Vehículo autorizado',{exact:true});const value=await select.locator('option').filter({hasText:vehicle}).getAttribute('value');await select.selectOption(value);await expect(page.locator('.trip-operations')).toBeVisible();}
// POSTs below use the real cookies/CSRF of each independent browser context.
// These adversarial requests deliberately bypass disabled UI controls, never SQL.
const csrf=new WeakMap();
export async function api(page,path,body,key){
 if(!csrf.has(page)){const r=await page.request.get('/api/session');expect(r.status()).toBe(200);csrf.set(page,(await r.json()).csrf);}
 return page.request.post(path,{headers:{Origin:new URL(page.url()).origin,'Content-Type':'application/json','X-CSRF-Token':csrf.get(page),...(key?{'Idempotency-Key':key}:{})},data:body});
}
export async function rejected(page,path,body,error,status=403){const r=await api(page,path,body,randomUUID());expect(await r.json()).toEqual({error});expect(r.status()).toBe(status);}
