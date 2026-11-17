import{test,expect}from'@playwright/test';
import{randomUUID}from'node:crypto';
import{prepare,login}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
import{namespace,stored,traffic,lostReply,reloadToGate,restore,reference,hold}from'./support/recovery-panel.mjs';
// 5A.4-B3: uncertainty, sessions, late answers and local storage faults. Real gateway and
// PostgreSQL; the only interventions are lost replies and held (then delivered) responses.
// Split from recovery-panel-sessions.spec.mjs: each suite gets its own gateway, so the
// unchanged global limit of 120 requests/minute is never the cause of a failure.
test('B3 T16/T19: tickets of another account are never shown; a reference from another epoch is Inválida and does not block',async({page})=>{
 const t=traffic(page);await lostReply(page,'viajero5',{commit:false});
 await reloadToGate(page);await login(page,'viajero6');await expect(page.getByRole('heading',{name:'Operación anterior'})).toHaveCount(0);expect(await stored(page)).toBeNull();expect(t.receipts).toBe(0);
 // Same tab after a gateway epoch change (D2-B): the stored reference keeps its old environmentId.
 const other=await page.context().newPage();try{
  const ticket=await lostReply(other,'viajero7',{commit:false});await other.evaluate(([n,env])=>{const v=JSON.parse(sessionStorage.getItem(n));v.tickets[0].environmentId=env;sessionStorage.setItem(n,JSON.stringify(v));},[namespace,randomUUID()]);
  const o=traffic(other),panel=await restore(other,'viajero7'),ref=reference(panel);
  await expect(ref.getByRole('status')).toContainText('corresponde a otra ejecución. No se canceló ninguna operación');await expect(ref.getByRole('button',{name:'Consultar resultado'})).toHaveCount(0);expect(o.receipts).toBe(0);expect(await stored(other)).toBeNull();
  await ref.getByRole('button',{name:'Cerrar',exact:true}).click();await expect(panel).toHaveCount(0);
  const form=await prepare(other,'viajero7');await expect(form.getByRole('button',{name:'Registrar solicitud',exact:true})).toBeEnabled();await expect(form.locator('#restored-block')).toHaveCount(0);expect(ticket.key).toBeTruthy();
 }finally{await other.close();}
});
test('B3 T21: a corrupt namespace is reported after the gate only, without requests, and can be acknowledged',async({page})=>{
 await lostReply(page,'viajero8',{commit:false});await page.evaluate(n=>sessionStorage.setItem(n,'{"v":1,"tickets":[{"v":1'),namespace);
 const t=traffic(page);await reloadToGate(page);await expect(page.getByText('No se pudo leer la referencia temporal')).toHaveCount(0);
 await login(page,'viajero8');const panel=page.getByRole('region',{name:'Operación anterior',exact:true});await expect(panel.getByRole('alert')).toContainText('No se pudo leer la referencia temporal');await expect(panel.getByRole('alert')).toContainText('no demuestra');
 expect(t.receipts).toBe(0);await panel.getByRole('button',{name:'Entendido',exact:true}).click();await expect(panel).toHaveCount(0);
});
