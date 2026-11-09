import{privateGet,proofHeaders,watchDocument}from'./support/document-browser.mjs';
import {test,expect} from '@playwright/test';
import {login} from './support/operation-browser.mjs';
import {revoke,loginApi,login as recoverLogin} from './support/reservation-browser.mjs';

test('5A3: first own-reservations page cannot show another account during A-B-A',async({page})=>{
 await login(page,'operativo0','/pasajero');const cards=page.locator('.saved-booking');await expect(cards).toHaveCount(1);const original=await cards.locator('code').first().textContent();let protectedStatus,foreign=[];
 await page.route(/\/api\/(passenger\/bookings|reservations\/page)$/,async route=>{
  await revoke(page);await loginApi(page,'operativo1');
  const control=await privateGet(page,'/api/passenger/bookings');expect(control.status()).toBe(200);foreign=(await control.json()).bookings.map(b=>b.bookingId);expect(foreign.length).toBeGreaterThan(0);
  const cookie=(await page.context().cookies()).filter(c=>c.name.startsWith('trufis_lab_')).map(c=>c.name+'='+c.value).join('; ');
  const actual=await route.fetch({headers:{...route.request().headers(),cookie}});protectedStatus=actual.status();
  await revoke(page);await loginApi(page,'operativo0');await route.fulfill({response:actual});
 },{times:1});
 const response=page.waitForResponse(r=>/\/api\/(passenger\/bookings|reservations\/page)$/.test(new URL(r.url()).pathname));
 await page.getByRole('button',{name:'Actualizar mis reservas',exact:true}).click();await response;expect(protectedStatus).toBe(401);await expect(page.getByRole('alert')).toBeVisible();await expect(cards).toHaveCount(0);
 for(const id of foreign)await expect(page.getByText(id,{exact:true})).toHaveCount(0);
 await recoverLogin(page,'operativo0');await expect(cards).toHaveCount(1);await expect(cards.locator('code').first()).toHaveText(original);
});
