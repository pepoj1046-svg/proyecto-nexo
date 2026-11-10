import{test}from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{transform}from'esbuild';
const source=(await transform(await readFile('apps/web/src/reservation-attempt.ts','utf8'),{loader:'ts',format:'esm'})).code;
const{ReservationAttempt}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const bookingId='11111111-1111-4111-8111-111111111111',tripId='22222222-2222-4222-8222-222222222222';
const receipt=()=>({storage:'EPHEMERAL_LAB',moneyProcessed:false,bookings:[{bookingId,tripId,status:'CONFIRMED',effectiveStatus:'CONFIRMED',seats:2,priceBOB:'70.00'}]});
const page=()=>({bookings:[{bookingId,status:'CONFIRMED'}],total:1,nextCursor:null});
function fixture(overrides={}){
 let view,locked=false;const writes=[],auth=[];
 const deps={issue:async s=>({v:1,app:'proyecto-nexo/lab',environmentId:s.environmentId,accountRef:s.accountRef,family:'RESERVATION_APP',key:crypto.randomUUID(),createdAt:1000,expiresAt:1801000,seal:'x'.repeat(43)}),persist:()=>{},retire:()=>{},session:async()=>({authenticated:true,accountRef:'original',csrf:'fresh'}),write:async(a,s)=>{writes.push({a,s});return receipt();},read:async()=>page(),changed:v=>{view=v;},protect:p=>{locked=p;},authenticate:a=>auth.push(a),frozen:()=>{},...overrides};
 return{machine:new ReservationAttempt(deps),deps,writes,auth,get view(){return view;},get locked(){return locked;}};
}
test('lost post-COMMIT reply retains frozen body/account/key; manual replay cannot recalculate intent',async()=>{
 const f=fixture(),body={quote:{totalBOB:'70.00'},parts:[{tripId,seats:2}]};let calls=0;
 f.deps.write=async(a,s)=>{f.writes.push({a,s});if(!calls++)throw Error('Lost reply after COMMIT');return receipt();};
 await f.machine.submit('original',()=>body);assert.equal(f.view.phase,'UNCERTAIN');assert.equal(f.locked,true);
 body.quote.totalBOB='999.00';body.parts[0].seats=6;
 await f.machine.submit('original',()=>{throw Error('MUST_NOT_REBUILD');});
 assert.equal(f.view.phase,'UPDATED');assert.equal(f.writes.length,2);assert.equal(f.writes[0].a,f.writes[1].a);
 assert.equal(f.writes[1].a.body.quote.totalBOB,'70.00');assert.equal(f.writes[1].a.body.parts[0].seats,2);
 assert.throws(()=>{f.writes[1].a.body.parts[0].seats=3;},TypeError);assert.equal(f.locked,false);
});
test('known receipt survives failed refresh and consult repeats only the authorized read',async()=>{
 const f=fixture();let reads=0;f.deps.read=async()=>{if(!reads++)throw Error('Read unavailable');return page();};
 await f.machine.submit('original',()=>({seats:2}));assert.equal(f.view.phase,'REFRESH_FAILED');assert.equal(f.view.receipt.bookings[0].bookingId,bookingId);assert.equal(f.locked,true);
 await f.machine.submit('original',()=>({seats:6}));assert.equal(f.writes.length,1);
 await f.machine.consult();assert.equal(f.view.phase,'UPDATED');assert.equal(reads,2);assert.equal(f.writes.length,1);
});
test('revoked session and another account cannot replay; original session uses fresh CSRF and unchanged key',async()=>{
 const f=fixture();let account='original',csrf='old';f.deps.session=async()=>({authenticated:!!account,accountRef:account,csrf});
 f.deps.write=async(a,s)=>{f.writes.push({a,s});if(f.writes.length===1){account=null;throw Error('Session revoked');}return receipt();};
 await f.machine.submit('original',()=>({seats:2}));assert.equal(f.view.phase,'AUTH_REQUIRED');assert.equal(f.view.receipt,null);
 account='other';await f.machine.submit('original',()=>({seats:6}));assert.equal(f.writes.length,1);assert.equal(f.view.current,null);
 account='original';csrf='renewed';await f.machine.submit('original',()=>({}));assert.equal(f.view.phase,'UPDATED');assert.equal(f.writes.length,2);assert.equal(f.writes[1].a.key,f.writes[0].a.key);assert.equal(f.writes[1].s.csrf,'renewed');assert.ok(f.auth.every(x=>x==='original'));
});
test('late receipt and read never populate the view of a different account',async()=>{
 const f=fixture();let account='original';f.deps.session=async()=>({authenticated:true,accountRef:account,csrf:'csrf'});
 f.deps.read=async()=>{account='other';return page();};await f.machine.submit('original',()=>({seats:2}));
 assert.equal(f.view.phase,'AUTH_REQUIRED');assert.equal(f.view.receipt,null);assert.equal(f.view.current,null);assert.equal(f.machine.hasReceipt,true);
 account='original';f.deps.read=async()=>page();await f.machine.consult();assert.equal(f.writes.length,1);assert.equal(f.view.phase,'UPDATED');
});
test('double click serializes writes and a matching own list never confirms an uncertain attempt',async()=>{
 const f=fixture();let release;const gate=new Promise(r=>{release=r;});f.deps.write=async(a,s)=>{f.writes.push({a,s});await gate;throw Error('Unknown result');};
 const first=f.machine.submit('original',()=>({seats:2}));await f.machine.submit('original',()=>({seats:6}));release();await first;assert.equal(f.writes.length,1);
 await f.machine.consult();assert.equal(f.view.phase,'UNCERTAIN');assert.equal(f.view.receipt,null);assert.equal(f.view.current.total,1);assert.equal(f.locked,true);
});
test('malformed HTTP 200 and HTTP errors cannot prove rollback or retire the uncertain key',async()=>{
 for(const response of[{},null,{...receipt(),bookings:[]},new Error('QUOTE_CHANGED'),new Error('FORBIDDEN')]){
  const f=fixture();f.deps.write=async(a,s)=>{f.writes.push({a,s});if(response instanceof Error)throw response;return response;};
  await f.machine.submit('original',()=>({seats:2}));assert.equal(f.view.phase,'UNCERTAIN');assert.equal(f.view.receipt,null);assert.equal(f.locked,true);
  const key=f.writes[0].a.key;await f.machine.submit('original',()=>({seats:6}));assert.equal(f.writes[1].a.key,key);
 }
});
test('network loss during the identity check retains a known receipt privately for read-only recovery',async()=>{
 const f=fixture();let failures=0;f.deps.session=async()=>{if(f.writes.length>0&&failures++<2)throw Error('Network unavailable');return{authenticated:true,accountRef:'original',csrf:'fresh'};};
 await f.machine.submit('original',()=>({seats:2}));assert.equal(f.view.phase,'REFRESH_FAILED');assert.equal(f.view.receipt,null);assert.equal(f.machine.hasReceipt,true);
 await f.machine.consult();assert.equal(f.writes.length,1);assert.equal(f.view.phase,'UPDATED');
});
test('a malformed refresh cannot erase the receipt or be presented as an updated query',async()=>{
 const f=fixture();f.deps.read=async()=>({});await f.machine.submit('original',()=>({seats:2}));
 assert.equal(f.view.phase,'REFRESH_FAILED');assert.equal(f.view.receipt.bookings[0].bookingId,bookingId);assert.equal(f.view.current,null);
 f.deps.read=async()=>page();await f.machine.consult();assert.equal(f.writes.length,1);assert.equal(f.view.phase,'UPDATED');
});
test('confirmation freezes the quote before a delayed identity check, and no POST precedes authorization',async()=>{
 const f=fixture(),body={seats:2,quote:{totalBOB:'70.00'}};let release,started;
 const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{started=r;});let first=true;
 f.deps.session=async()=>{if(first){first=false;started();await gate;}return{authenticated:true,accountRef:'original',csrf:'fresh'};};
 const pending=f.machine.submit('original',()=>body);await ready;body.seats=6;body.quote.totalBOB='999.00';
 assert.equal(f.writes.length,0);assert.equal(f.locked,true);release();await pending;
 assert.equal(f.writes[0].a.body.seats,2);assert.equal(f.writes[0].a.body.quote.totalBOB,'70.00');assert.equal(f.view.phase,'UPDATED');
});

test('explicit session 401 keeps the original intent and requires its account instead of losing recovery',async()=>{
 const f=fixture();let expired=false;
 f.deps.session=async()=>{if(expired)throw Object.assign(new Error('AUTHENTICATION_REQUIRED'),{status:401});return{authenticated:true,accountRef:'original',csrf:'fresh'};};
 f.deps.write=async()=>{expired=true;throw Error('Lost response');};
 await f.machine.submit('original',()=>({seats:1}));assert.equal(f.view.phase,'AUTH_REQUIRED');assert.equal(f.machine.pending,true);assert.equal(f.locked,true);assert.deepEqual(f.auth,['original']);
});
test('a failed ticket/storage preflight never sends a reservation and keeps the same issued key on manual retry',async()=>{
 const f=fixture();let issues=0,blocked=true;const issue=f.deps.issue;f.deps.issue=async s=>{issues++;return issue(s);};f.deps.persist=()=>{if(blocked)throw Error('STORAGE_UNAVAILABLE');};
 await f.machine.submit('original',()=>({seats:2}));assert.equal(f.writes.length,0);assert.equal(f.view.phase,'REFERENCE_REQUIRED');assert.equal(f.machine.pending,true);assert.equal(issues,1);
 blocked=false;await f.machine.submit('original',()=>{throw Error('MUST_NOT_REBUILD');});assert.equal(f.view.phase,'UPDATED');assert.equal(issues,1);assert.equal(f.writes.length,1);
});
test('late ticket emission for another account cannot dispatch a frozen intention',async()=>{
 const f=fixture();f.deps.issue=async s=>({...await fixture().deps.issue(s),accountRef:'different'});await f.machine.submit('original',()=>({seats:2}));assert.equal(f.writes.length,0);assert.equal(f.view.phase,'REFERENCE_REQUIRED');
});
