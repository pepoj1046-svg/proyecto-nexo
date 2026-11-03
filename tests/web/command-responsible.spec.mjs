import {test,expect} from '@playwright/test';
import {login} from './support/operation-browser.mjs';
import {revoke,loginApi,login as recoverLogin} from './support/reservation-browser.mjs';

test('5A3: a late private linking receipt stays hidden from another account and recovers without minting again',async({page})=>{
 await login(page,'terminal0','/pasajero');const mine=page.locator('.responsible-reservations'),sent=[];
 await page.route('**/api/care/code',async route=>{
  sent.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
  const response=await route.fetch();expect(response.status()).toBe(200);
  await revoke(page);await loginApi(page,'operativo0');await route.fulfill({response});
 },{times:1});
 await mine.getByLabel('Autorizo generar un código de un uso').check();await mine.getByRole('button',{name:'Generar código para mi cuenta',exact:true}).click();
 const gate=page.getByRole('region',{name:'Recuperar intento administrativo',exact:true});await expect(gate).toBeVisible();await expect(mine).toBeHidden();
 await expect(page.getByLabel('Código de vinculación ficticio',{exact:true})).toHaveCount(0);
 await recoverLogin(gate,'operativo0');await expect(page.getByRole('alert').filter({hasText:'Esta cuenta no corresponde'})).toBeVisible();await expect(mine).toBeHidden();
 await recoverLogin(gate,'terminal0');await expect(gate).toHaveCount(0);
 const recovery=mine.getByRole('region',{name:'Recuperar actuación pendiente',exact:true});await expect(recovery).toContainText('Recibo recibido');
 await recovery.getByRole('button',{name:'Actualizar consulta sin repetir actuación',exact:true}).click();await expect(recovery).toHaveCount(0);
 expect(sent).toHaveLength(1);await expect(mine.getByLabel('Código de vinculación ficticio',{exact:true})).toHaveValue(/^[a-f0-9]{64}$/);
 await expect(mine.getByRole('status')).toContainText('Una nueva sesión no lo renueva');
 // This is the original receipt. Its code was bound to the revoked session;
 // displaying it does not claim it is a newly issued/usable capability.
});
