import{test,expect}from'@playwright/test';
import{prepare,intentions}from'./support/reservation-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
test('B2: unavailable sessionStorage blocks the first business send; a manual retry saves the same issued ticket before dispatch',async({page})=>{
 const audit=await reservationEvidence();try{const form=await prepare(page,'viajero3'),sent=intentions(page),tickets=[];page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/recovery/ticket'&&r.ok())tickets.push(await r.json());});
  const original=await page.evaluateHandle(()=>Storage.prototype.setItem);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('LAB_STORAGE_BLOCKED');};});await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('alert')).toContainText('No se pudo guardar');await expect(form.getByRole('status')).toContainText('No se ha autorizado el envío');expect(sent).toHaveLength(0);expect(tickets).toHaveLength(1);expect((await audit.snapshot(tickets[0].key)).actions).toEqual([]);
  await page.evaluate(fn=>{Storage.prototype.setItem=fn;},original);await original.dispose();await form.getByRole('button',{name:'Reintentar la misma solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('consulta actualizada');expect(sent).toHaveLength(1);expect(sent[0].key).toBe(tickets[0].key);expect(tickets).toHaveLength(1);expect((await audit.snapshot(sent[0].key)).actions).toHaveLength(1);expect(await page.evaluate(()=>localStorage.length)).toBe(0);
 }finally{await audit.close();}
});
