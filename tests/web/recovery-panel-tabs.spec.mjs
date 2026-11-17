import{test,expect}from'@playwright/test';
import{randomUUID}from'node:crypto';
import{prepare,login}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
import{namespace,stored,traffic,lostReply,reloadToGate,restore,reference,hold,measureRequests}from'./support/recovery-panel.mjs';
measureRequests(test);

// 5A.4-B3: uncertainty, sessions, late answers and local storage faults. Real gateway and
// PostgreSQL; the only interventions are lost replies and held (then delivered) responses.
// Split from recovery-panel-sessions.spec.mjs: each suite gets its own gateway, so the
// unchanged global limit of 120 requests/minute is never the cause of a failure.
test('B3 T18: a duplicated tab gets a copy; consulting there retires only its own copy and never mutates the original',async({page})=>{
 const audit=await reservationEvidence();try{
  const ticket=await lostReply(page,'viajero9');const[dup]=await Promise.all([page.context().waitForEvent('page'),page.evaluate(()=>window.open('/pasajero','_blank'))]);
  try{await dup.waitForLoadState();const copy=await stored(dup);test.skip(copy===null,'Chromium did not copy sessionStorage to the opened tab; recorded as not reproducible');
   await login(dup,'viajero9');const panel=dup.getByRole('region',{name:'Operación anterior',exact:true});await reference(panel).getByRole('button',{name:'Consultar resultado',exact:true}).click();
   await expect(reference(panel).getByRole('status')).toContainText('Abajo se muestra su estado actual');expect(await stored(dup)).toBeNull();
   expect((await stored(page)).tickets.map(x=>x.key)).toEqual([ticket.key],'original tab keeps its own reference');
   expect((await audit.snapshot(ticket.key)).actions).toHaveLength(1);
  }finally{await dup.close();}
 }finally{await audit.close();}
});
