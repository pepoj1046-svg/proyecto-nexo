import{test,expect}from'@playwright/test';
import AxeBuilder from'@axe-core/playwright';
import{mkdir,writeFile}from'node:fs/promises';
import{operationEvidence}from'./support/operation-evidence.mjs';
import{login,operational,api,rejected,deviceContext,commandClick}from'./support/recovery-browser.mjs';
test('discrepancias de pasajero: cuatro motivos, evidencia, revisión administrativa y tres roles sin efectos automáticos',async({page,browser,baseURL},info)=>{
 const audit=await operationEvidence(info.project.name),contexts=[];
 const context=async()=>{const c=await browser.newContext(deviceContext(page,baseURL,info));contexts.push(c);return c;};
 try{
  await login(page,'operativo0','/pasajero');const booking=page.locator('.saved-booking'),id=(await booking.locator('code').first().textContent()).trim();
  const a=await(await context()).newPage(),d=await(await context()).newPage();await operational(a,'adminH','/administracion');await operational(d,'driver5','/chofer');
  const tripId=await a.getByLabel('Vehículo autorizado').inputValue(),before=await audit.read(tripId);expect(before.onboard).toBe(0);expect(before.trip.departed_at).toBeNull();
  await booking.getByRole('button',{name:'Reportar un problema',exact:true}).click();const review=booking.locator('.safety-review');await expect(review).toContainText('Reportes registrados: 0');
  const b={bookingId:id,episode:0,kind:'NOT_BOARDED',confirmed:true};
  await rejected(d,'/api/safety/report',b,'FORBIDDEN');await rejected(a,'/api/safety/report',b,'FORBIDDEN');
  const csrf=await page.request.post('/api/safety/report',{headers:{Origin:baseURL,'Content-Type':'application/json'},data:b});expect(csrf.status()).toBe(403);
  for(const [n,kind]of['NOT_BOARDED','ALIGHT_INCORRECT','WRONG_REPLACEMENT','OTHER_OPERATIONAL'].entries()){
   await review.getByLabel('Tipo de problema',{exact:true}).selectOption(kind);await review.getByLabel('Confirmo abrir una revisión').check();
   const report=await commandClick(page,review.getByRole('button',{name:'Registrar reporte para revisión',exact:true}),'/api/safety/report');expect(report.result.inventoryChanged).toBe(false);expect(report.result.moneyProcessed).toBe(false);
   expect((await api(page,'/api/safety/report',report.body,report.key)).status()).toBe(200);await expect(review).toContainText(`Reportes registrados: ${n+1}`);
  }
  const after=await audit.read(tripId);for(const field of['trip','bookings','segments','movements','events','fleet','incidents','custody'])expect(after[field]).toEqual(before[field]);
  await a.getByRole('button',{name:'Actualizar operación',exact:true}).click();const row=a.locator('.expected-booking').filter({hasText:id});await expect(row).toContainText('4 discrepancias reportadas');await row.getByRole('button',{name:'Consultar discrepancias de la reserva',exact:true}).click();await expect(row.locator('.safety-review')).toContainText('Reportes registrados: 4');await expect(row.getByRole('button',{name:'Registrar reporte para revisión',exact:true})).toHaveCount(0);
  await d.getByRole('button',{name:'Actualizar operación',exact:true}).click();await expect(d.locator('.trip-facts')).toContainText('6/6');await expect(d.getByRole('button',{name:'Iniciar salida para recogidas',exact:true})).toBeEnabled();
  const foreign=await(await context()).newPage();await login(foreign,'viajero1','/pasajero');await rejected(foreign,'/api/safety/context',{bookingId:id},'FORBIDDEN');await expect(foreign.locator('.saved-booking')).toHaveCount(0);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const selector of['.safety-review','.safety-review fieldset','.safety-review select']){const box=await booking.locator(selector).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);expect(await booking.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);}
  await mkdir('.local/e2e-incremento-8a',{recursive:true});await review.screenshot({path:`.local/e2e-incremento-8a/discrepancias-${info.project.name}.png`,scale:'css'});await a.locator('.trip-operations').screenshot({path:`.local/e2e-incremento-8a/revision-administrativa-${info.project.name}.png`,scale:'css'});await writeFile(`.local/e2e-incremento-8a/sin-efectos-${info.project.name}.json`,JSON.stringify({before,after},null,2));
 }finally{await audit.close();await Promise.all(contexts.map(c=>c.close()));}
});
