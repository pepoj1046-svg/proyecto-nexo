import{test,expect}from'@playwright/test';
import{mkdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
import AxeBuilder from'@axe-core/playwright';
import{operational,login,api,rejected,deviceContext,commandClick}from'./support/recovery-browser.mjs';
import{operationEvidence}from'./support/operation-evidence.mjs';
async function declare(page,minutes,description,updateFare=false){
 const form=page.locator('.route-condition-form');await form.getByRole('button',{name:'Consultar declaración de ruta',exact:true}).click();await form.getByLabel('Descripción del cambio',{exact:true}).fill(description);if(minutes!==null)await form.getByLabel('Minutos adicionales estimados',{exact:true}).fill(String(minutes));
 if(updateFare){const select=form.getByRole('combobox',{name:'Tarifa a actualizar para solicitudes nuevas',exact:true}),option=select.locator('option').filter({hasText:/Terminal de Yacuiba.*Terminal Villa Montes.*Normal por plaza/});await select.selectOption(await option.getAttribute('value'));await form.getByLabel('Nuevo importe configurado (BOB)',{exact:true}).fill('45.00');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await form.getByLabel('Confirmo publicar esta declaración').check();return commandClick(page,form.getByRole('button',{name:'Registrar declaración de condiciones',exact:true}),'/api/conditions/declare');
}
test('asociación declara cambio y tarifa; el responsable consulta precio original y acepta la versión explícitamente',async({page,browser,baseURL},info)=>{
 const audit=await operationEvidence(info.project.name),contexts=[];try{
  await operational(page,'adminH','/administracion','FICTICIO-WEB-0-0');const trip=await page.getByLabel('Vehículo autorizado',{exact:true}).inputValue(),before=await audit.read(trip);
  const declared=await declare(page,30,'Desvío ficticio de laboratorio, no certifica transitabilidad.',true);expect(declared.result.additionalMinutes).toBe(30);
  const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);const p=await c.newPage();await login(p,'terminal0','/pasajero');const booking=p.locator('.saved-booking').filter({hasText:'4 plazas juntas'}),id=(await booking.locator('code').first().textContent()).trim();const card=booking.locator('.condition-card');await card.getByRole('button',{name:'Consultar condiciones y decisiones',exact:true}).click();await expect(card).toContainText('Bs 140');await expect(card).toContainText('Bs 45');await expect(card).toContainText('+30 minutos');await expect(card.getByRole('button',{name:'Aceptar cambio',exact:true})).toBeDisabled();await card.getByLabel('Confirmo mi decisión').check();await commandClick(p,card.getByRole('button',{name:'Aceptar cambio',exact:true}),'/api/conditions/command');await expect(card).toContainText('Cambio aceptado');
  await rejected(p,'/api/conditions/declare',declared.body,'FORBIDDEN');await rejected(p,'/api/conditions/context',{bookingId:randomUUID()},'FORBIDDEN');
  const other=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(other);const o=await other.newPage();await login(o,'adminU','/administracion');await rejected(o,'/api/conditions/context',{bookingId:id},'FORBIDDEN');
  const after=await audit.read(trip);expect(after.bookings).toEqual(before.bookings);expect(after.segments).toEqual(before.segments);expect(after.trip.departed_at).toBeNull();
  expect((await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await mkdir('.local/e2e-incremento-7b',{recursive:true});await card.screenshot({path:`.local/e2e-incremento-7b/accept-${info.project.name}.png`,scale:'css'});
 }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
