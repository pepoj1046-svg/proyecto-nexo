import{test,expect}from'@playwright/test';
import{randomUUID}from'node:crypto';
import{prepare,login}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
import{namespace,stored,traffic,lostReply,reloadToGate,restore,reference,hold,measureRequests}from'./support/recovery-panel.mjs';
measureRequests(test);

// 5A.4-B3: uncertainty, sessions, late answers and local storage faults. Real gateway and
// PostgreSQL; the only interventions are lost replies and held (then delivered) responses.
// Split for margin: one gateway per suite keeps every suite well below the unchanged
// global limit of 120 /api/ requests per minute (see docs/REPORTES/ETAPA_5A4_B3.md).
test('B3 T15/T20: a late receipt after logout and another login is dropped; discard while in flight removes only local aid',async({page})=>{
 const audit=await reservationEvidence();try{
  const ticket=await lostReply(page,'viajero2'),before=await audit.snapshot(ticket.key),t=traffic(page),panel=await restore(page,'viajero2');
  const held=hold(page,'/api/recovery/receipt');await reference(panel).getByRole('button',{name:'Consultar resultado',exact:true}).click();await held.reached;
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(page.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();expect(await stored(page)).toBeNull();
  await login(page,'viajero3');held.release();await page.waitForTimeout(400);
  await expect(page.getByRole('heading',{name:'Operación anterior'})).toHaveCount(0);await expect(page.getByText(before.bookings[0].id)).toHaveCount(0);await expect(page.getByText('Registro histórico')).toHaveCount(0);
  expect(t.reservations).toBe(0);expect(await audit.snapshot(ticket.key)).toEqual(before);
 }finally{await audit.close();}
 // T20: discard with the request in flight (separate tab state, uncertain reference).
 const other=await page.context().newPage();try{
  await lostReply(other,'viajero4',{commit:false});const panel=await restore(other,'viajero4'),ref=reference(panel),t=traffic(other),held=hold(other,'/api/recovery/receipt');
  await ref.getByRole('button',{name:'Consultar resultado',exact:true}).click();await held.reached;
  await ref.getByRole('button',{name:'Eliminar referencia',exact:true}).click();await ref.getByRole('button',{name:'Eliminar solo la ayuda local',exact:true}).click();
  await expect(panel).toHaveCount(0);expect(await stored(other)).toBeNull();const pages=t.pages;held.release();await other.waitForTimeout(400);
  await expect(other.getByRole('heading',{name:'Operación anterior'})).toHaveCount(0);expect(t.pages).toBe(pages);expect(t.reservations).toBe(0);
 }finally{await other.close();}
});
