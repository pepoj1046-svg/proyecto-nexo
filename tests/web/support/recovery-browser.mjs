import {expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
export {login,operational,api,rejected} from './operation-browser.mjs';
export const deviceContext=(page,baseURL,info)=>({baseURL,viewport:page.viewportSize(),userAgent:info.project.use.userAgent,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
export async function commandClick(page,button,path='/api/recovery/command'){
 const[r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(path)&&r.request().method()==='POST'),button.click()]);expect(r.status(),await r.text()).toBe(200);return{body:r.request().postDataJSON(),key:r.request().headers()['idempotency-key'],result:await r.json()};
}
export async function consoleIncident(page,vehicle){
 await page.getByRole('button',{name:'Consultar incidencias',exact:true}).click();const select=page.getByLabel('Incidencia a gestionar',{exact:true});
 const value=await select.locator('option').filter({hasText:vehicle}).getAttribute('value');await select.selectOption(value);await expect(page.locator('.recovery-detail')).toBeVisible();return value;
}
export async function updateConsole(page){
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/recovery/detail'));await page.getByRole('button',{name:'Actualizar incidencias',exact:true}).click();expect((await pending).status()).toBe(200);await expect(page.locator('.recovery-detail')).toBeVisible();
}
export async function confirmIncident(page){await commandClick(page,page.getByRole('button',{name:'Confirmar incidencia reportada',exact:true}),'/api/operations/command');await expect(page.locator('.trip-operations')).toContainText('confirmada o pendiente de resolución');}
export async function recordEvidence(scenario,project,label,state,page){
 await mkdir('.local/e2e-incremento-4',{recursive:true});await writeFile(`.local/e2e-incremento-4/${scenario}-${label}-${project}.json`,JSON.stringify(state,null,2));
 if(page)await page.screenshot({path:`.local/e2e-incremento-4/${scenario}-${label}-${project}.png`,fullPage:true,scale:'css'});
}
export const bookingContract=s=>s.bookings.filter(b=>['CONFIRMED','COMPLETED'].includes(b.status)).map(({trip_id,status,...contract})=>contract);
