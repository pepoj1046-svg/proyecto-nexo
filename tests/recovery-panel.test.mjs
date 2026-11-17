import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{transform}from'esbuild';
// 5A.4-B3: restored-reference state machine (design §7). Dependencies are explicit, so
// every network call is counted: the machine has no write dependency at all.
const code=(await transform(await readFile('apps/web/src/recovery-consult.ts','utf8'),{loader:'ts',format:'esm'})).code;
const{RecoveryStore,parseReceipt,MAX_CURRENT_PAGES}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const A='a'.repeat(32),B='b'.repeat(32),env='11111111-1111-4111-8111-111111111111',env2='33333333-3333-4333-8333-333333333333';
const id=n=>'44444444-4444-4444-8444-'+String(n).padStart(12,'0');
const ticket=(i,o={})=>({v:1,app:'proyecto-nexo/lab',environmentId:env,accountRef:A,family:'RESERVATION_APP',key:'22222222-2222-4222-8222-'+String(i).padStart(12,'0'),createdAt:1000,expiresAt:1801000,seal:'x'.repeat(43),...o});
const sA={authenticated:true,accountRef:A,environmentId:env,csrf:'c',documentId:'d',generation:1},sB={...sA,accountRef:B};
const restored=(valid=[],o={})=>({valid,expired:[],invalid:[],fault:false,...o});
const recorded=(t,ids=[id(1),id(2)])=>({state:'RECORDED',family:'RESERVATION_APP',key:t.key,environmentId:t.environmentId,observedAt:5,receipt:{operation:'reserve',groupId:id(90),bookingIds:ids,originalStatus:'HELD'}});
const missing=t=>({state:'NOT_OBSERVED',family:'RESERVATION_APP',key:t.key,environmentId:t.environmentId,observedAt:5});
const fail=(status,code)=>Object.assign(Error(code),{status,code});
function defer(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function harness({session=()=>sA,receipt,page,now=()=>2000}={}){
 const calls={session:0,receipt:0,page:0,retire:[],forget:[],reauth:0,ack:0};
 const store=new RecoveryStore({
  session:async()=>{calls.session++;return typeof session==='function'?session():session;},
  receipt:async(s,t)=>{calls.receipt++;return receipt(s,t);},
  page:async(s,c)=>{calls.page++;return page(s,c);},
  retire:t=>calls.retire.push(t.key),forget:(a,k)=>calls.forget.push(a+':'+k),acknowledge:()=>calls.ack++,reauthenticate:()=>calls.reauth++,now});
 const view=k=>store.snapshot().items.find(x=>x.key===k);
 return{store,calls,view};
}
const page=(bookings,nextCursor=null)=>({bookings,total:bookings.length,nextCursor});
const booking=(n,status='CONFIRMED')=>({bookingId:id(n),status,effectiveStatus:status});

test('B3 machine: before the gate there are no items; after it, valid → Lista, expired/other run → Inválida; another account drops everything',()=>{
 const t=ticket(1),{store,view}=harness();store.sync(null,restored([t]));assert.deepEqual(store.snapshot().items,[]);assert.equal(store.snapshot().account,null);
 store.sync({...sA,authenticated:false},restored([t]));assert.deepEqual(store.snapshot().items,[]);
 store.sync(sA,restored([t],{expired:[ticket(2)],invalid:[ticket(3).key]}));
 assert.equal(view(t.key).phase,'LISTA');assert.equal(view(ticket(2).key).phase,'INVALIDA');assert.equal(view(ticket(3).key).phase,'INVALIDA');
 assert.equal(store.blocksNewReservation(A),true);assert.equal(store.blocksNewReservation(B),false);
 store.sync(sB,restored());assert.deepEqual(store.snapshot().items,[]);assert.equal(store.blocksNewReservation(A),false);
});
test('B3 machine: RECORDED with complete current page → Actualizada, ticket retired once, zero writes, D3 lifted',async()=>{
 const t=ticket(1),h=harness({receipt:()=>recorded(t),page:()=>page([booking(1),booking(2,'HELD'),booking(7)])});h.store.sync(sA,restored([t]));
 assert.equal(h.store.blocksNewReservation(A),true);await h.store.consult(t.key);
 const v=h.view(t.key);assert.equal(v.phase,'ACTUALIZADA');assert.equal(v.receipt.originalStatus,'HELD');assert.deepEqual(v.current.map(b=>b.bookingId),[id(1),id(2)]);
 assert.deepEqual(h.calls.retire,[t.key]);assert.equal(h.calls.receipt,1);assert.equal(h.store.blocksNewReservation(A),false);
 await h.store.consult(t.key);assert.equal(h.calls.receipt,1,'a resolved reference cannot be consulted again');assert.ok(Object.isFrozen(v)&&Object.isFrozen(v.receipt));
 h.store.discard(t.key);assert.equal(h.view(t.key),undefined);assert.deepEqual(h.calls.retire,[t.key],'closing a resolved reference does not retire again');
});
test('B3 machine: NOT_OBSERVED → Incierta (not rollback), counts as consulted for D3, can be consulted again, ticket kept',async()=>{
 const t=ticket(1);let answer=missing(t);const h=harness({receipt:()=>answer,page:()=>page([booking(1),booking(2)])});h.store.sync(sA,restored([t]));
 await h.store.consult(t.key);assert.equal(h.view(t.key).phase,'INCIERTA');assert.equal(h.view(t.key).consulted,true);assert.deepEqual(h.calls.retire,[]);assert.equal(h.store.blocksNewReservation(A),false);
 answer=recorded(t);await h.store.consult(t.key);assert.equal(h.view(t.key).phase,'ACTUALIZADA');assert.equal(h.calls.receipt,2);
});
test('B3 machine (T14): RECORDED then current read fails → LecturaPendiente, receipt kept, ticket kept; manual retry completes',async()=>{
 const t=ticket(1);let broken=true;const h=harness({receipt:()=>recorded(t),page:()=>{if(broken)throw fail(503,'SERVICE_UNAVAILABLE');return page([booking(1),booking(2)]);}});h.store.sync(sA,restored([t]));
 await h.store.consult(t.key);let v=h.view(t.key);assert.equal(v.phase,'LECTURA_PENDIENTE');assert.equal(v.receipt.groupId,id(90));assert.deepEqual(h.calls.retire,[]);assert.match(v.error,/sin repetir la reserva/);
 broken=false;await h.store.consult(t.key);v=h.view(t.key);assert.equal(v.phase,'ACTUALIZADA');assert.deepEqual(h.calls.retire,[t.key]);
});
test('B3 machine (T14): a group outside the first page follows the authorized cursor; a bounded walk ends in LecturaPendiente',async()=>{
 const t=ticket(1),pages=[page([booking(5)],'c1'),page([booking(6)],'c2'),page([booking(1),booking(2)])];const seen=[];
 const h=harness({receipt:()=>recorded(t),page:(_s,c)=>{seen.push(c);return pages[seen.length-1];}});h.store.sync(sA,restored([t]));await h.store.consult(t.key);
 assert.deepEqual(seen,[null,'c1','c2']);assert.equal(h.view(t.key).phase,'ACTUALIZADA');
 const t2=ticket(2);let n=0;const g=harness({receipt:()=>recorded(t2),page:()=>page([booking(50+n++)],'more')});g.store.sync(sA,restored([t2]));await g.store.consult(t2.key);
 assert.equal(g.calls.page,MAX_CURRENT_PAGES);assert.equal(g.view(t2.key).phase,'LECTURA_PENDIENTE');assert.deepEqual(g.calls.retire,[]);
 // Not found after the bounded walk: receipt kept, ticket kept, wording never implies cancellation or rollback.
 const w=g.view(t2.key);assert.equal(w.receipt.groupId,id(90));assert.equal(w.consulted,true);assert.equal(w.busy,false);assert.equal(g.store.blocksNewReservation(A),false);
 assert.match(w.error,/no incluyó todas las reservas del registro/);assert.doesNotMatch(w.error,/cancel|anul|revert|rollback|fall[óo]|liber|no se (registr|realiz)/i);
 await g.store.consult(t2.key);assert.equal(g.calls.receipt,2,'the same ticket can be consulted again manually');assert.deepEqual(g.calls.retire,[]);
});
test('B3 machine: 401 → Autenticar (gate), 403 → Revisión, 410/400 → Inválida with local cleanup, 429/503/transport stay uncertain and keep D3',async()=>{
 const cases=[[fail(401,'REAUTHENTICATION_REQUIRED'),'AUTENTICAR',false],[fail(403,'RECOVERY_UNAVAILABLE'),'REVISION',true],[fail(410,'RECOVERY_TICKET_EXPIRED'),'INVALIDA',true],[fail(410,'ENVIRONMENT_CHANGED'),'INVALIDA',true],[fail(400,'INVALID_RECOVERY_TICKET'),'INVALIDA',true],[fail(429,'RATE_LIMITED'),'INCIERTA',false],[fail(503,'RECOVERY_UNAVAILABLE'),'INCIERTA',false],[new TypeError('Failed to fetch'),'INCIERTA',false],[Object.assign(Error('aborted'),{name:'AbortError'}),'INCIERTA',false]];
 for(const[error,phase,consulted]of cases){const t=ticket(1),h=harness({receipt:()=>{throw error;},page:()=>assert.fail('no current read')});h.store.sync(sA,restored([t]));await h.store.consult(t.key);
  const v=h.view(t.key);assert.equal(v.phase,phase,String(error.code??error.name));assert.equal(v.consulted,consulted);assert.equal(h.store.blocksNewReservation(A),!consulted&&phase!=='REVISION');
  assert.deepEqual(h.calls.retire,phase==='INVALIDA'?[t.key]:[]);assert.equal(h.calls.reauth,phase==='AUTENTICAR'?1:0);}
});
test('B3 machine (T23): double click and repeated consultations run one request at a time per reference',async()=>{
 const t=ticket(1),d=defer(),h=harness({receipt:()=>d.promise,page:()=>page([booking(1),booking(2)])});h.store.sync(sA,restored([t]));
 const first=h.store.consult(t.key);for(let i=0;i<5;i++)void h.store.consult(t.key);await Promise.resolve();await Promise.resolve();
 assert.equal(h.view(t.key).phase,'CONSULTANDO');assert.equal(h.view(t.key).busy,true);assert.equal(h.store.blocksNewReservation(A),true);
 d.resolve(missing(t));await first;assert.equal(h.calls.receipt,1);
});
test('B3 machine (T15/T20): account change, A→B→A and discard while in flight discard late responses without retiring twice',async()=>{
 for(const interrupt of['B','ABA','discard','logout']){const t=ticket(1),d=defer(),h=harness({receipt:()=>d.promise,page:()=>page([booking(1),booking(2)])});h.store.sync(sA,restored([t]));
  const p=h.store.consult(t.key);await Promise.resolve();await Promise.resolve();
  if(interrupt==='B')h.store.sync(sB,restored());if(interrupt==='ABA'){h.store.sync(sB,restored());h.store.sync(sA,restored([t]));}if(interrupt==='discard')h.store.discard(t.key);if(interrupt==='logout')h.store.sync(null,restored());
  d.resolve(recorded(t));await p;
  assert.equal(h.calls.page,0,interrupt+': late receipt must not trigger reads');
  if(interrupt==='ABA'){assert.equal(h.view(t.key).phase,'LISTA');assert.equal(h.view(t.key).receipt,null);}else assert.equal(h.view(t.key),undefined);
  assert.deepEqual(h.calls.retire,interrupt==='discard'?[t.key]:[]);}
});
test('B3 machine: session of another account or environment never sends the ticket; local expiry invalidates without a request',async()=>{
 const t=ticket(1);let h=harness({session:()=>sB,receipt:()=>assert.fail('no receipt for B')});h.store.sync(sA,restored([t]));await h.store.consult(t.key);assert.equal(h.view(t.key).phase,'AUTENTICAR');assert.equal(h.calls.reauth,1);assert.equal(h.calls.receipt,0);
 h=harness({session:()=>({...sA,environmentId:env2}),receipt:()=>assert.fail('no receipt across runs')});h.store.sync(sA,restored([t]));await h.store.consult(t.key);assert.equal(h.view(t.key).phase,'INVALIDA');assert.equal(h.calls.receipt,0);
 h=harness({now:()=>1801000,receipt:()=>assert.fail('expired')});h.store.sync(sA,restored([t]));await h.store.consult(t.key);assert.equal(h.view(t.key).phase,'INVALIDA');assert.equal(h.calls.session,0);assert.deepEqual(h.calls.retire,[t.key]);
});
test('B3 machine: a late current page after a session change is not published (T15)',async()=>{
 const t=ticket(1);let who=sA;const h=harness({session:()=>who,receipt:()=>recorded(t),page:()=>{who=sB;return page([booking(1),booking(2)]);}});h.store.sync(sA,restored([t]));await h.store.consult(t.key);
 const v=h.view(t.key);assert.equal(v.phase,'AUTENTICAR');assert.equal(v.current,null);assert.equal(v.receipt,null);assert.deepEqual(h.calls.retire,[]);
});
test('B3 machine: malformed or mismatched receipts stay uncertain and are not counted as consulted',async()=>{
 const t=ticket(1),bad=[{...recorded(t),key:ticket(2).key},{...recorded(t),environmentId:env2},{...recorded(t),family:'CARE'},{...recorded(t),receipt:{...recorded(t).receipt,code:'X'}},{...recorded(t),receipt:{...recorded(t).receipt,bookingIds:[id(1),id(1)]}},{...missing(t),receipt:{}},{...recorded(t),state:'DONE'},null];
 for(const raw of bad){const h=harness({receipt:()=>raw,page:()=>assert.fail('no read')});h.store.sync(sA,restored([t]));await h.store.consult(t.key);assert.equal(h.view(t.key).phase,'INCIERTA');assert.equal(h.view(t.key).consulted,false);}
 assert.throws(()=>parseReceipt({...recorded(t),receipt:{...recorded(t).receipt,bookingIds:Array.from({length:7},(_,i)=>id(i))}},t));
});
test('B3 machine: discard removes only local aid (ticket and RAM key); fault notice is per account and acknowledgeable',()=>{
 const t=ticket(1),h=harness();h.store.sync(sA,restored([t],{invalid:[ticket(3).key],fault:true}));assert.equal(h.store.snapshot().fault,true);
 h.store.discard(t.key);h.store.discard(ticket(3).key);assert.deepEqual(h.calls.retire,[t.key]);assert.deepEqual(h.calls.forget,[A+':'+t.key,A+':'+ticket(3).key]);assert.equal(h.store.blocksNewReservation(A),false);
 h.store.acknowledgeFault();assert.equal(h.store.snapshot().fault,false);assert.equal(h.calls.ack,1);
});
