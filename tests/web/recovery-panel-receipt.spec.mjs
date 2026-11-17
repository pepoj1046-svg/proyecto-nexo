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
test('B3 T12/T24: COMMIT with lost reply, real reload and original login: receipt recovered, zero reservation POST after reload',async({page},info)=>{
 const audit=await reservationEvidence();try{
  const ticket=await lostReply(page,'viajero0'),before=await audit.snapshot(ticket.key);expect(before.actions).toHaveLength(1);expect(before.bookings).toHaveLength(1);
  const raw=await page.evaluate(n=>sessionStorage.getItem(n),'nexo.lab.recovery.v1');expect(Object.keys(JSON.parse(raw).tickets[0]).sort()).toEqual(['accountRef','app','createdAt','environmentId','expiresAt','family','key','seal','v']);for(const f of['quote','seats','password','csrf','tripId','body'])expect(raw).not.toContain(f);
  const t=traffic(page),panel=await restore(page,'viajero0'),ref=reference(panel);
  // Before the manual query the panel shows no receipt data. («Mis reservas» may already list
  // the original account's own bookings after its login: that is the existing B1 view.)
  await expect(ref.getByRole('status')).toContainText('La operación no se repetirá');await expect(panel.getByText(before.bookings[0].id)).toHaveCount(0);await expect(panel.getByText('Registro histórico')).toHaveCount(0);
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(300);expect(t.receipts).toBe(0);
  await ref.getByRole('button',{name:'Consultar resultado',exact:true}).click();
  await expect(ref.getByRole('status')).toContainText('Abajo se muestra su estado actual');await expect(ref).toContainText('Registro histórico');await expect(ref.getByRole('region',{name:'Estado actual autorizado'})).toContainText(before.bookings[0].id);
  expect(t.reservations).toBe(0);expect(t.receipts).toBe(1);expect(await stored(page)).toBeNull();expect(await page.evaluate(()=>localStorage.length)).toBe(0);
  expect(await audit.snapshot(ticket.key)).toEqual(before);
  await evidence(page,info,'t12-updated',{ticket:{key:ticket.key},bookings:before.bookings.map(b=>b.id),reservationPostsAfterReload:t.reservations,receiptQueries:t.receipts,businessUnchanged:true});
  await ref.getByRole('button',{name:'Cerrar',exact:true}).click();await expect(panel).toHaveCount(0);await expect(page.getByRole('heading',{name:'Operación anterior'})).toHaveCount(0);
 }finally{await audit.close();}
});
test('B3 T14: RECORDED with a failing current read keeps the receipt and the ticket (LecturaPendiente); a manual retry completes',async({page})=>{
 const audit=await reservationEvidence();try{
  const ticket=await lostReply(page,'viajero1'),before=await audit.snapshot(ticket.key),t=traffic(page),panel=await restore(page,'viajero1'),ref=reference(panel);
  await page.route('**/api/reservations/page',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SERVICE_UNAVAILABLE'})}),{times:1});
  await ref.getByRole('button',{name:'Consultar resultado',exact:true}).click();
  await expect(ref.getByRole('status')).toContainText('falta consultar su estado actual');await expect(ref.getByRole('alert')).toContainText('sin repetir la reserva');await expect(ref).toContainText('Registro histórico');
  expect((await stored(page)).tickets.map(x=>x.key)).toEqual([ticket.key]);
  await ref.getByRole('button',{name:'Consultar resultado',exact:true}).click();await expect(ref.getByRole('status')).toContainText('Abajo se muestra su estado actual');
  expect(await stored(page)).toBeNull();expect(t.reservations).toBe(0);expect(t.receipts).toBe(2);expect(await audit.snapshot(ticket.key)).toEqual(before);
 }finally{await audit.close();}
});
