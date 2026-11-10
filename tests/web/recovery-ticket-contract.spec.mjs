import{test,expect}from'@playwright/test';
import{mkdir,writeFile}from'node:fs/promises';
import{prepare,login,intentions,loginApi}from'./support/reservation-browser.mjs';
import{proofHeaders}from'./support/document-browser.mjs';
import{reservationEvidence}from'./support/reservation-evidence.mjs';
const path='/api/recovery/receipt',namespace='nexo.lab.recovery.v1';
const read=async(page,ticket)=>page.request.post(path,{headers:{Origin:new URL(page.url()).origin,...proofHeaders(page)},data:{v:1,ticket}});
const stored=page=>page.evaluate(n=>JSON.parse(sessionStorage.getItem(n)).tickets[0],namespace);
test('B2: ticket precedes the lost COMMIT reply; manual read after reload/reauthentication never resends and preserves every business fact',async({page},info)=>{
 const audit=await reservationEvidence();try{
  const form=await prepare(page,'viajero0'),sent=intentions(page);let ticket,queries=0;page.on('request',r=>{if(new URL(r.url()).pathname===path)queries++;});
  await page.route('**/api/reservations',async r=>{ticket=await stored(page);expect(r.request().headers()['idempotency-key']).toBe(ticket.key);expect(JSON.parse(r.request().headers()['x-nexo-recovery-ticket'])).toEqual(ticket);expect((await r.fetch()).status()).toBe(200);await r.abort('failed');},{times:1});
  await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');expect(ticket).toBeTruthy();expect(Object.keys(ticket).sort()).toEqual(['v','app','environmentId','accountRef','family','key','createdAt','expiresAt','seal'].sort());expect(ticket.expiresAt-ticket.createdAt).toBe(1800000);
  const before=await audit.snapshot(sent[0].key);expect(before.actions).toHaveLength(1);expect(before.bookings).toHaveLength(1);expect(before.overCapacity).toEqual([]);expect(before.movements).toEqual([]);
  await page.reload();await expect(page.getByRole('heading',{name:'Primero, encuentra tu recorrido',exact:true})).toBeVisible();await page.goto('/pasajero');await expect(page.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();expect(sent).toHaveLength(1);expect(queries).toBe(0);await expect(page.getByText(before.bookings[0].id,{exact:false})).toHaveCount(0);
  const denied=await read(page,ticket);expect(denied.status()).toBe(401);expect((await denied.json()).error).toBe('REAUTHENTICATION_REQUIRED');
  await login(page,'viajero0');const response=await read(page,ticket);expect(response.status()).toBe(200);const recorded=await response.json();expect(recorded.state).toBe('RECORDED');expect(recorded.receipt.bookingIds).toEqual(before.bookings.map(b=>b.id));expect(Object.keys(recorded.receipt).sort()).toEqual(['operation','groupId','bookingIds','originalStatus'].sort());expect(recorded.key).toBe(ticket.key);expect(sent).toHaveLength(1);expect(await audit.snapshot(ticket.key)).toEqual(before);
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));});expect(sent).toHaveLength(1);expect(queries).toBe(0);
  await mkdir('.local/5a4-b2-evidence',{recursive:true});await page.screenshot({path:'.local/5a4-b2-evidence/'+info.project.name+'-reauthenticated.png',fullPage:true});await writeFile('.local/5a4-b2-evidence/'+info.project.name+'-integrity.json',JSON.stringify({recorded,businessUnchanged:true,bookings:before.bookings,overCapacity:before.overCapacity,movements:before.movements},null,2));
 }finally{await audit.close();}
});
test('B2: four concurrent manual replays retain one group/action; an independent B1 tab/account cannot read the ticket',async({page})=>{
 const audit=await reservationEvidence();try{const form=await prepare(page,'viajero1'),sent=intentions(page);await page.route('**/api/reservations',r=>r.abort('failed'),{times:1});await form.getByRole('button',{name:'Registrar solicitud',exact:true}).click();await expect(form.getByRole('status')).toContainText('Resultado incierto');const ticket=await stored(page);expect((await audit.snapshot(ticket.key)).actions).toEqual([]);
  const rs=await Promise.all(Array.from({length:4},()=>page.request.post('/api/reservations',{headers:{Origin:new URL(page.url()).origin,...proofHeaders(page),'Idempotency-Key':ticket.key,'X-Nexo-Recovery-Ticket':JSON.stringify(ticket)},data:sent[0].body})));for(const r of rs)expect(r.status()).toBe(200);const receipt=await rs[0].json();for(const r of rs)expect(await r.json()).toEqual(receipt);
  const before=await audit.snapshot(ticket.key);expect(before.actions).toHaveLength(1);expect(before.bookings).toHaveLength(1);expect(before.overCapacity).toEqual([]);expect(before.bookings[0].price_bob).toBe(sent[0].body.quote.totalBOB);expect(before.bookings[0].fare_version).toBe(sent[0].body.quote.fareVersion);
  const other=await page.context().newPage();try{await other.goto('/');await loginApi(other,'viajero2');const foreign=await read(other,ticket);expect(foreign.status()).toBe(403);expect(await foreign.json()).toEqual({error:'RECOVERY_UNAVAILABLE'});expect((await read(page,ticket)).status()).toBe(200);expect(await stored(page)).toEqual(ticket);expect(await other.evaluate(n=>sessionStorage.getItem(n),namespace)).toBeNull();}finally{await other.close();}
  const forged=await read(page,{...ticket,key:crypto.randomUUID()});expect(forged.status()).toBe(400);expect(await audit.snapshot(ticket.key)).toEqual(before);
 }finally{await audit.close();}
});
