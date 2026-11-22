import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {login} from './support/operation-browser.mjs';

// Etapa 6A: the passenger's notices panel explains it is in-app only, reads on demand
// and does not poll.
test('6A-E1: notices panel is in-app only, on demand and without polling',async({page})=>{
 await login(page,'viajero6','/pasajero');
 const panel=page.getByRole('region',{name:/Avisos de tus viajes/});
 await expect(panel).toBeVisible();
 await expect(panel.getByText('el laboratorio no envía SMS, correos ni llamadas',{exact:false})).toBeVisible();
 const calls=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/notices/mine')calls.push(Date.now());});
 await page.waitForTimeout(5000);expect(calls).toEqual([]);
 await panel.getByRole('button',{name:'Consultar avisos',exact:true}).click();
 await expect.poll(()=>calls.length).toBe(1);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
