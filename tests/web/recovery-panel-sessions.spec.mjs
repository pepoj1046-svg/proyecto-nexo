import{test,expect}from'@playwright/test';
import{randomUUID}from'node:crypto';
import{prepare,login}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
import{namespace,stored,traffic,lostReply,reloadToGate,restore,reference,hold,measureRequests}from'./support/recovery-panel.mjs';
measureRequests(test);

// 5A.4-B3: uncertainty, sessions, late answers and local storage faults. Real gateway and
// PostgreSQL; the only interventions are lost replies and held (then delivered) responses.
test('B3 T13: reload after the ticket and before the send stays uncertain; nothing is rebuilt or sent',async({page})=>{
 const audit=await reservationEvidence();try{
  const ticket=await lostReply(page,'viajero0',{commit:false}),t=traffic(page),panel=await restore(page,'viajero0'),ref=reference(panel);
  for(let i=0;i<2;i++){await ref.getByRole('button',{name:'Consultar resultado',exact:true}).click();await expect(ref.getByRole('status')).toContainText('La operación pudo ejecutarse o seguir pendiente');await expect(ref.getByRole('button',{name:'Consultar resultado',exact:true})).toBeEnabled();}
  await expect(ref.getByRole('button',{name:/Reservar/})).toHaveCount(0);expect(t.receipts).toBe(2);expect(t.reservations).toBe(0);
  expect((await stored(page)).tickets.map(x=>x.key)).toEqual([ticket.key]);expect((await audit.snapshot(ticket.key)).actions).toEqual([]);
 }finally{await audit.close();}
});
test('B3 T23: double click and repeated events produce one consultation at a time, without storms',async({page})=>{
 await lostReply(page,'viajero1',{commit:false});const t=traffic(page),panel=await restore(page,'viajero1'),ref=reference(panel),held=hold(page,'/api/recovery/receipt');
 await ref.getByRole('button',{name:'Consultar resultado',exact:true}).dblclick();await held.reached;
 await expect(ref).toHaveAttribute('aria-busy','true');await expect(ref.getByRole('button',{name:'Consultando…',exact:true})).toHaveAttribute('aria-disabled','true');
 await page.evaluate(()=>{for(let i=0;i<5;i++){window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));}});await page.waitForTimeout(300);expect(t.receipts).toBe(1);
 held.release();await expect(ref.getByRole('status')).toContainText('Todavía no se observó');expect(t.receipts).toBe(1);expect(t.reservations).toBe(0);
 // No polling: five idle seconds with the reference still uncertain, plus every browser event
 // that could plausibly trigger a query, produce zero /api/ requests.
 const idle=t.api;await page.evaluate(()=>{for(const e of['online','focus','pageshow'])window.dispatchEvent(new Event(e));document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(5000);expect(t.api-idle).toBe(0);
});
