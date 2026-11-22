import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {login} from './support/operation-browser.mjs';

// 5A.7: the rating panels appear for the right roles, explain their limits and pass axe.
async function axe(page){expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);}

test('5A7-E1: a passenger without finished trips sees the rating panel empty and nothing to send',async({page})=>{
 await login(page,'viajero7','/pasajero');
 const panel=page.getByRole('region',{name:'Valora tus viajes terminados'});
 await expect(panel).toBeVisible();
 // On demand: nothing is read until the passenger asks.
 const calls=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/ratings/mine')calls.push(1);});
 await page.waitForTimeout(1500);expect(calls).toEqual([]);
 await panel.getByRole('button',{name:'Consultar viajes para valorar',exact:true}).click();
 await expect(panel.getByText('No tienes viajes terminados en los últimos 30 días.')).toBeVisible();
 await expect(panel.getByRole('button',{name:'Enviar valoración'})).toHaveCount(0);
 await expect(panel.getByText('Tu valoración llega a la asociación sin tu nombre.',{exact:false})).toBeVisible();
 await axe(page);
});

test('5A7-E2: an administrator consults ratings of the managed routes, anonymously',async({page})=>{
 await login(page,'adminH','/administracion');
 const panel=page.getByRole('region',{name:'Valoraciones de pasajeros'});
 await panel.getByRole('button',{name:'Consultar valoraciones',exact:true}).click();
 await expect(panel.getByText('Todavía no hay valoraciones en tus rutas.')).toBeVisible();
 await expect(panel.getByRole('alert')).toHaveCount(0);
});
