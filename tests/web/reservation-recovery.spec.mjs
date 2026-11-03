import{test,expect}from'@playwright/test';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
import{prepare,login,revoke,loginApi,intentions,capture}from'./support/reservation-browser.mjs';
import AxeBuilder from'@axe-core/playwright';
import{navigate}from'./support/navigation.mjs';
test('5A2: lost committed reply, blocked navigation, read-only consultation and manual retry preserve exactly one booking',async({page},info)=>{
 const audit=await reservationEvidence();try{
  const form=await prepare(page,'viajero0'),sent=intentions(page);
  await page.route('**/api/reservations',async r=>{expect((await r.fetch()).status()).toBe(200);await r.abort('failed');},{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');
  const before=await audit.snapshot(sent[0].key);expect(before.bookings).toHaveLength(1);expect(before.actions).toHaveLength(1);expect(before.overCapacity).toEqual([]);expect(before.movements).toEqual([]);expect(before.trips[0].departed_at).toBeNull();expect(before.bookings[0].price_bob).toBe(sent[0].body.quote.totalBOB);expect(before.bookings[0].fare_version).toBe(sent[0].body.quote.fareVersion);
  await capture(page,info,'incierto',before);await navigate(page,'Mis reservas');await expect(page).toHaveURL(/\/reservar$/);await expect(page.getByRole('alert').filter({hasText:'Resuelve la solicitud'})).toContainText('solicitud de reserva pendiente');await page.goBack();await expect(page).toHaveURL(/\/reservar$/);await expect(form.getByRole('status')).toContainText('Resultado incierto');
  await form.getByRole('button',{name:'Consultar mis reservas sin reenviar',exact:true}).click();await expect(form.getByRole('region',{name:'Consulta autorizada de mis reservas'})).toContainText(before.bookings[0].id);await expect(form.getByRole('status')).toContainText('Resultado incierto');await expect(form.getByText('Solicitud registrada en el laboratorio.',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});expect(sent).toHaveLength(1);
  await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(2);expect(sent[0]).toEqual(sent[1]);expect(await audit.snapshot(sent[0].key)).toEqual(before);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect((await new AxeBuilder({page}).include('.checkout').analyze()).violations).toEqual([]);await capture(page,info,'recuperado',before);
 }finally{await audit.close();}
});
test('5A2: transport cut before POST cannot prove rollback; the same manual intent creates the single reservation',async({page})=>{
 const audit=await reservationEvidence();try{const form=await prepare(page,'viajero1'),sent=intentions(page);await page.route('**/api/reservations',r=>r.abort('failed'),{times:1});await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');expect((await audit.snapshot(sent[0].key)).actions).toEqual([]);await form.getByRole('button',{name:'Consultar mis reservas sin reenviar',exact:true}).click();await expect(form.getByRole('region',{name:'Consulta autorizada de mis reservas'})).toContainText('0 de 0');await expect(form.getByRole('status')).toContainText('Resultado incierto');await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent[1]).toEqual(sent[0]);const state=await audit.snapshot(sent[0].key);expect(state.bookings).toHaveLength(1);expect(state.overCapacity).toEqual([]);}finally{await audit.close();}
});
