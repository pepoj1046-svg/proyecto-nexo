import {expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const accounts=JSON.parse(await readFile(process.env.NEXO_WEB_CREDENTIALS_FILE,'utf8')).accounts;
export async function login(page,label,path){
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
