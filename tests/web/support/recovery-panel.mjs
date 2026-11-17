import{expect}from'@playwright/test';
import{mkdir,writeFile}from'node:fs/promises';
import{basename}from'node:path';
import{prepare,login}from'./reservation-browser.mjs';
// 5A.4-B3 helpers. A reply is lost either after the real COMMIT (commit:true) or before
// the request reaches the gateway (commit:false). Nothing here sends a reservation itself.
export const namespace='nexo.lab.recovery.v1';
export const stored=page=>page.evaluate(n=>{const raw=sessionStorage.getItem(n);return raw===null?null:JSON.parse(raw);},namespace);
export function traffic(page){const t={api:0,reservations:0,receipts:0,pages:0};page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/'))t.api++;if(p==='/api/reservations')t.reservations++;if(p==='/api/recovery/receipt')t.receipts++;if(p==='/api/reservations/page')t.pages++;});return t;}
export async function lostReply(page,user,{commit=true}={}){
 const form=await prepare(page,user);
 await page.route('**/api/reservations',async r=>{if(commit)expect((await r.fetch()).status()).toBe(200);await r.abort('failed');},{times:1});
 await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');
 const s=await stored(page);expect(s.tickets).toHaveLength(1);return s.tickets[0];
}
// Reload (RAM body lost), open «Mis reservas» anonymously and check the gate hides everything.
export async function reloadToGate(page){
 mark(page,'recovery');await page.reload();await page.goto('/pasajero');await expect(page.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Operación anterior'})).toHaveCount(0);await expect(page.getByText('Referencia temporal')).toHaveCount(0);
}
export async function restore(page,user){await reloadToGate(page);await login(page,user);const panel=page.getByRole('region',{name:'Operación anterior',exact:true});await expect(panel).toBeVisible();mark(page,'panel');return panel;}
export const reference=(panel,n=1)=>panel.getByRole('article',{name:new RegExp('^Referencia temporal '+n+'\\b')});
export function hold(page,path){let held,release;const reached=new Promise(r=>{held=r;}),gate=new Promise(r=>{release=r;});
 page.route('**'+path,async r=>{const response=await r.fetch();held();await gate;await r.fulfill({response}).catch(()=>{});},{times:1});return{reached,release:()=>release()};}
// Request accounting for the B3 report: every /api/ request issued by any page of the test
// context (aborted ones included, so this is an upper bound of what reaches the gateway's
// global limit). Phase marks split setup (search, login, quote, lost send) from recovery.
const logs=new WeakMap();
export function mark(page,label){logs.get(page.context())?.push({at:Date.now(),mark:label});}
export function measureRequests(test){
 test.beforeEach(({context})=>{const log=[];logs.set(context,log);context.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/'))log.push({at:Date.now(),path:p});});});
 test.afterEach(async({context},info)=>{const log=logs.get(context)??[],reqs=log.filter(x=>x.path),byPath={};for(const r of reqs)byPath[r.path]=(byPath[r.path]??0)+1;
  const phases={};let phase='setup';for(const x of log){if(x.mark){phase=x.mark;continue;}phases[phase]=(phases[phase]??0)+1;}
  const start=reqs[0]?.at??Date.now(),end=reqs.at(-1)?.at??start;
  const summary={suite:basename(info.file),title:info.title,project:info.project.name,status:info.status,total:reqs.length,durationMs:end-start,byPath,phases,first:start,last:end};
  await mkdir('.local/5a4-b3-evidence/requests',{recursive:true});await writeFile(`.local/5a4-b3-evidence/requests/${info.project.name}-${info.testId}.json`,JSON.stringify(summary,null,2));
  info.annotations.push({type:'api-requests',description:JSON.stringify({total:summary.total,phases})});});
}
