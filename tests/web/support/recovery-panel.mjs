import{expect}from'@playwright/test';
import{prepare,login}from'./reservation-browser.mjs';
// 5A.4-B3 helpers. A reply is lost either after the real COMMIT (commit:true) or before
// the request reaches the gateway (commit:false). Nothing here sends a reservation itself.
export const namespace='nexo.lab.recovery.v1';
export const stored=page=>page.evaluate(n=>{const raw=sessionStorage.getItem(n);return raw===null?null:JSON.parse(raw);},namespace);
export function traffic(page){const t={reservations:0,receipts:0,pages:0};page.on('request',r=>{const p=new URL(r.url()).pathname;if(p==='/api/reservations')t.reservations++;if(p==='/api/recovery/receipt')t.receipts++;if(p==='/api/reservations/page')t.pages++;});return t;}
export async function lostReply(page,user,{commit=true}={}){
 const form=await prepare(page,user);
 await page.route('**/api/reservations',async r=>{if(commit)expect((await r.fetch()).status()).toBe(200);await r.abort('failed');},{times:1});
 await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');
 const s=await stored(page);expect(s.tickets).toHaveLength(1);return s.tickets[0];
}
// Reload (RAM body lost), open «Mis reservas» anonymously and check the gate hides everything.
export async function reloadToGate(page){
 await page.reload();await page.goto('/pasajero');await expect(page.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Operación anterior'})).toHaveCount(0);await expect(page.getByText('Referencia temporal')).toHaveCount(0);
}
export async function restore(page,user){await reloadToGate(page);await login(page,user);const panel=page.getByRole('region',{name:'Operación anterior',exact:true});await expect(panel).toBeVisible();return panel;}
export const reference=(panel,n=1)=>panel.getByRole('article',{name:new RegExp('^Referencia temporal '+n+'\\b')});
export function hold(page,path){let held,release;const reached=new Promise(r=>{held=r;}),gate=new Promise(r=>{release=r;});
 page.route('**'+path,async r=>{const response=await r.fetch();held();await gate;await r.fulfill({response}).catch(()=>{});},{times:1});return{reached,release:()=>release()};}
