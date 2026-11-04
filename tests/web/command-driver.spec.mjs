import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {operational} from './support/operation-browser.mjs';
import {operationEvidence} from './support/operation-evidence.mjs';
import AxeBuilder from '@axe-core/playwright';

test('5A3: lost real boarding reply is recovered manually once, with exact body/key and no invented departure',async({page},info)=>{
 const audit=await operationEvidence(info.project.name),sent=[];
 try{
  await page.setViewportSize({width:320,height:900});
  await operational(page,'driver5','/chofer');
  const tripId=await page.getByLabel('Vehículo autorizado',{exact:true}).inputValue();
  const before=await audit.read(tripId);
  await page.route('**/api/operations/command',async route=>{
   sent.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
   if(sent.length===1){expect((await route.fetch()).status()).toBe(200);await route.abort('failed');}else await route.continue();
  });
  await page.locator('.expected-booking').filter({hasText:'Terminal de Yacuiba (ficticia)'}).getByRole('button',{name:'Registrar abordaje del grupo',exact:true}).click();
  const recovery=page.getByRole('region',{name:'Recuperar actuación pendiente',exact:true});await expect(recovery).toContainText('Resultado incierto');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(width.scroll).toBe(width.client);
  const committed=await audit.read(tripId);expect(committed.onboard).toBe(4);expect(committed.trip.status).toBe('QUEUED');expect(committed.bookings).toEqual(before.bookings);expect(committed.segments).toEqual(before.segments);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));expect(sent).toHaveLength(1);
  await expect(page.getByLabel('Vehículo autorizado',{exact:true})).toBeDisabled();
  await recovery.getByRole('button',{name:'Consultar estado sin repetir actuación',exact:true}).click();
  await expect(page.locator('.trip-facts')).toContainText('4 abordados observados');await expect(recovery).toContainText('Resultado incierto');
  expect(sent).toHaveLength(1);expect(await audit.read(tripId)).toEqual(committed);await expect(page.getByLabel('Vehículo autorizado',{exact:true})).toBeDisabled();
  await recovery.getByRole('button',{name:'Reintentar únicamente la actuación original',exact:true}).click();await expect(recovery).toHaveCount(0);
  expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);expect(await audit.read(tripId)).toEqual(committed);
  await expect(page.locator('.trip-facts')).toContainText('4 abordados observados');
  await mkdir('.local/5a3-evidence',{recursive:true});await page.screenshot({path:`.local/5a3-evidence/${info.project.name}-boarding-recovered.png`,fullPage:true,scale:'css'});
 }finally{await audit.close();}
});
