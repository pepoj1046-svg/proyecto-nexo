import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// 5A.6 Ayuda: local, filterable by role, readable without network once the page is
// loaded, and it sends nothing.
async function axe(page){expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);}
async function noOverflow(page){const w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(w.scroll).toBe(w.client);}

test('5A6-E1: help filters by role and search and makes no API request',async({page})=>{
 const api=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')&&u.pathname!=='/api/session')api.push(u.pathname);});
 await page.goto('/ayuda');
 await expect(page.getByRole('heading',{name:'¿Cómo podemos ayudarte?',level:1})).toBeVisible();
 await page.getByRole('radio',{name:'Chofer',exact:true}).check();
 await expect(page.getByRole('heading',{name:'Registrar a un pasajero que llega en persona'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Buscar un viaje y elegir plazas'})).toHaveCount(0);
 await page.getByRole('radio',{name:'Todos',exact:true}).check();
 await page.getByLabel('Buscar en la ayuda').fill('reserva se registro');
 await expect(page.getByRole('heading',{name:'Si no sabes si tu reserva se registró'})).toBeVisible();
 await page.getByLabel('Buscar en la ayuda').fill('zzzz');
 await expect(page.getByText('No hay temas que coincidan.',{exact:false})).toBeVisible();
 expect(api).toEqual([]);
 await page.getByLabel('Buscar en la ayuda').fill('');
 await axe(page);await noOverflow(page);
});

test('5A6-E2: contextual link opens help for the role and help still reads offline after load',async({page,context})=>{
 await page.goto('/pasajero');
 await page.getByRole('link',{name:'Ayuda para pasajeros',exact:true}).click();
 await expect(page).toHaveURL(/\/ayuda\?para=pasajero$/);
 await expect(page.getByRole('radio',{name:'Pasajero',exact:true})).toBeChecked();
 await context.setOffline(true);
 try{
  await page.getByRole('radio',{name:'Administración',exact:true}).check();
  await expect(page.getByRole('heading',{name:'Horario sin personal'})).toBeVisible();
  await page.getByRole('link',{name:'Ir a administración'}).first().click();
  await expect(page).toHaveURL(/\/administracion$/);
  await page.goBack();
  await expect(page.getByRole('heading',{name:'¿Cómo podemos ayudarte?',level:1})).toBeVisible();
 }finally{await context.setOffline(false);}
});
