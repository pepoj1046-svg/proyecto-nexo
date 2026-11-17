import{test,expect}from'@playwright/test';
import AxeBuilder from'@axe-core/playwright';
import{mkdir,writeFile}from'node:fs/promises';
import{prepare}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
import{stored,traffic,lostReply,restore,reference,measureRequests}from'./support/recovery-panel.mjs';
measureRequests(test);

// 5A.4-B3: «Operación anterior» against the real gateway and PostgreSQL. The witness is an
// independent read-only SQL connection; no gateway response is simulated except lost replies.
const evidence=async(page,info,name,data)=>{await mkdir('.local/5a4-b3-evidence',{recursive:true});await page.screenshot({path:`.local/5a4-b3-evidence/${info.project.name}-${name}.png`,fullPage:true});if(data)await writeFile(`.local/5a4-b3-evidence/${info.project.name}-${name}.json`,JSON.stringify(data,null,2));};
// Split for margin: one gateway per suite keeps every suite well below the unchanged
// global limit of 120 /api/ requests per minute (see docs/REPORTES/ETAPA_5A4_B3.md).
test('B3 D3: a new APP reservation waits until the restored reference is consulted once; then it proceeds normally',async({page})=>{
 const audit=await reservationEvidence();try{
  const ticket=await lostReply(page,'viajero2',{commit:false});expect((await audit.snapshot(ticket.key)).actions).toEqual([]);await page.reload();
  const t=traffic(page),form=await prepare(page,'viajero2'),panel=page.getByRole('region',{name:'Operación anterior',exact:true}),register=form.getByRole('button',{name:'Registrar solicitud',exact:true});
  await expect(panel).toBeVisible();await expect(register).toBeDisabled();await expect(form.locator('#restored-block')).toContainText('consulta la operación anterior');
  await reference(panel).getByRole('button',{name:'Consultar resultado',exact:true}).click();await expect(reference(panel).getByRole('status')).toContainText('Todavía no se observó un recibo');
  await expect(reference(panel).getByRole('button',{name:/Reservar/})).toHaveCount(0);await expect(register).toBeEnabled();expect(t.reservations).toBe(0);
  await register.click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(t.reservations).toBe(1);
  expect((await audit.snapshot(ticket.key)).actions).toEqual([],'the uncertain reference was never sent nor rebuilt');
 }finally{await audit.close();}
});
test('B3 T25: panel is keyboard operable, keeps focus, passes axe at 320 px and at 200 % layout zoom',async({page},info)=>{
 await lostReply(page,'viajero3',{commit:false});const panel=await restore(page,'viajero3'),ref=reference(panel);
 const check=async name=>{expect((await new AxeBuilder({page}).include('.previous-operation').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await evidence(page,info,'t25-'+name);};
 await check('default');await page.setViewportSize({width:320,height:800});await check('320');
 await page.setViewportSize({width:640,height:1000});await page.evaluate(()=>document.documentElement.style.zoom='2');await check('zoom200');await page.evaluate(()=>document.documentElement.style.zoom='1');
 const consult=ref.getByRole('button',{name:'Consultar resultado',exact:true});await consult.focus();await page.keyboard.press('Enter');await expect(ref.getByRole('status')).toContainText('Todavía no se observó');await expect(consult).toBeFocused();
 await ref.getByRole('button',{name:'Eliminar referencia',exact:true}).focus();await page.keyboard.press('Enter');const keep=ref.getByRole('button',{name:'Eliminar solo la ayuda local',exact:true});await expect(keep).toBeFocused();await expect(ref.getByRole('group')).toContainText('No demuestra que la operación haya fallado ni cancela reservas');
 await page.keyboard.press('Enter');await expect(panel).toHaveCount(0);expect(await stored(page)).toBeNull();
});
