import{test,expect}from'@playwright/test';
import{prepare,revoke,loginApi,intentions}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';

test('5A2: an A-B-A cookie change cannot substitute another account own-query for the original attempt',async({page})=>{
 const audit=await reservationEvidence();try{
  const form=await prepare(page,'viajero6'),sent=intentions(page);let foreign=[],protectedStatus;
  await page.route(/\/api\/(passenger\/bookings|reservations\/page)$/,async route=>{
   await revoke(page);await loginApi(page,'terminal0');
   const control=await page.request.get('/api/passenger/bookings');expect(control.status()).toBe(200);foreign=(await control.json()).bookings.map(b=>b.bookingId);expect(foreign.length).toBeGreaterThan(0);
   const cookies=await page.context().cookies(),cookie=cookies.filter(c=>c.name.startsWith('trufis_lab_')).map(c=>c.name+'='+c.value).join('; ');
   const actual=await route.fetch({headers:{...route.request().headers(),cookie}});protectedStatus=actual.status();
   await revoke(page);await loginApi(page,'viajero6');await route.fulfill({response:actual});
  },{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();
  await expect(form.getByRole('button',{name:'Consultar mis reservas sin reenviar',exact:true})).toBeEnabled();
  expect(protectedStatus).toBe(403);
  for(const id of foreign)await expect(form.getByText(id,{exact:true})).toHaveCount(0);
  await expect(form.getByRole('status')).toContainText('Fallo de actualización');await expect(form.getByRole('status')).toContainText('Solicitud registrada');
  const before=await audit.snapshot(sent[0].key);await form.getByRole('button',{name:'Consultar mis reservas sin reenviar',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(1);expect(await audit.snapshot(sent[0].key)).toEqual(before);
  for(const id of foreign)await expect(form.getByText(id,{exact:true})).toHaveCount(0);
 }finally{await audit.close();}
});
