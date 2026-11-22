import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {login} from './support/operation-browser.mjs';

// Etapa 7A: the reconciliation panel states it is simulated and a restricted administrator
// (adminH in the web lab) cannot reconcile any association.
test('7A-E1: a restricted administrator sees the simulated notice and no association to reconcile',async({page})=>{
 await login(page,'adminH','/administracion');
 const panel=page.getByRole('region',{name:'Conciliación diaria (simulada)'});
 await expect(panel.getByText('Sin dinero real.')).toBeVisible();
 await panel.getByRole('button',{name:'Abrir conciliación',exact:true}).click();
 await expect(panel.getByText('No administras ninguna asociación sin ámbito limitado.')).toBeVisible();
 await expect(panel.getByRole('button',{name:'Cerrar el día'})).toHaveCount(0);
 expect((await new AxeBuilder({page}).include('#reconciliation-title').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
