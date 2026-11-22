import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {login} from './support/operation-browser.mjs';

// 5A.5 "Mi cuenta": interface preferences work without a session and persist in this
// browser only; the account view is read-only and shows the actor's own data.
async function axe(page){expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);}
async function noOverflow(page){const w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(w.scroll).toBe(w.client);}

test('5A5-E1: preferences apply at once, survive a reload and never call the server',async({page})=>{
 const api=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/account'))api.push(r.url());});
 await page.goto('/cuenta');
 await expect(page.getByRole('heading',{name:'Tu cuenta y tus preferencias',level:1})).toBeVisible();
 await expect(page.getByLabel('Usuario ficticio',{exact:true})).toBeVisible();
 const large=page.getByRole('checkbox',{name:/Texto más grande/});
 await large.check();
 await expect(page.locator('html')).toHaveClass(/pref-large-text/);
 await expect(page.getByRole('status').filter({hasText:'Preferencia guardada en este navegador.'})).toBeVisible();
 await page.reload();
 await expect(page.locator('html')).toHaveClass(/pref-large-text/);
 await expect(page.getByRole('checkbox',{name:/Texto más grande/})).toBeChecked();
 await page.getByRole('checkbox',{name:/Texto más grande/}).uncheck();
 await expect(page.locator('html')).not.toHaveClass(/pref-large-text/);
 expect(api).toEqual([]);
 await axe(page);await noOverflow(page);
});

test('5A5-E2: the signed-in passenger sees only their own name, no roles and no editable identity fields',async({page})=>{
 await login(page,'viajero9','/cuenta');
 const card=page.getByRole('article',{name:'Datos de la cuenta'});
 await expect(card.getByText('FICTICIO-WEB-viajero9',{exact:true})).toBeVisible();
 await expect(card.getByText('Esta cuenta viaja como pasajero y no tiene roles en ninguna asociación.')).toBeVisible();
 await expect(card.getByRole('textbox')).toHaveCount(0);
 await axe(page);await noOverflow(page);
 await card.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
 await expect(page.getByLabel('Usuario ficticio',{exact:true})).toBeVisible();
});

test('5A5-E3: an administrator sees the administrative role, still read-only',async({page})=>{
 await login(page,'adminH','/cuenta');
 const card=page.getByRole('article',{name:'Datos de la cuenta'});
 await expect(card.getByText('Administración de la asociación').first()).toBeVisible();
 await expect(card.getByText('El nombre y los roles los gestiona la administración. Desde aquí no se pueden modificar.')).toBeVisible();
 await expect(card.getByRole('textbox')).toHaveCount(0);
});
