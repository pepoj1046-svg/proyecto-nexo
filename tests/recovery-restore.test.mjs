import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{transform}from'esbuild';
// 5A.4-B3: reading restored tickets after the document gate. A fresh module per test
// models a fresh document (RAM state is per document, sessionStorage per tab).
const code=(await transform(await readFile('apps/web/src/recovery-ticket.ts','utf8'),{loader:'ts',format:'esm'})).code;
let n=0;const fresh=()=>import('data:text/javascript;base64,'+Buffer.from(code+`\n//${n++}`).toString('base64'));
const namespace='nexo.lab.recovery.v1',A='a'.repeat(32),B='b'.repeat(32),env='11111111-1111-4111-8111-111111111111',env2='33333333-3333-4333-8333-333333333333';
const ticket=(i,o={})=>({v:1,app:'proyecto-nexo/lab',environmentId:env,accountRef:A,family:'RESERVATION_APP',key:'22222222-2222-4222-8222-'+String(i).padStart(12,'0'),createdAt:1000,expiresAt:1801000,seal:'x'.repeat(43),...o});
const sessionA={authenticated:true,accountRef:A,environmentId:env},sessionB={...sessionA,accountRef:B};
function store(initial){const map=new Map([['unrelated','preserve']]);if(initial!==undefined)map.set(namespace,typeof initial==='string'?initial:JSON.stringify({v:1,tickets:initial}));let reads=0;return{map,get reads(){return reads;},getItem:k=>{reads++;return map.get(k)??null;},setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}};}
async function withStore(s,f){const old=globalThis.sessionStorage;globalThis.sessionStorage=s;try{return await f(await fresh());}finally{globalThis.sessionStorage=old;}}

test('B3 read: nothing is read or published before the document authenticates',()=>withStore(store([ticket(1)]),m=>{
 const s=globalThis.sessionStorage;
 for(const session of [null,{authenticated:false,environmentId:env},{authenticated:true,environmentId:env}])assert.deepEqual(m.readRecoveryTickets(session,2000),{valid:[],expired:[],invalid:[],fault:false});
 assert.equal(s.reads,0,'anonymous/locked documents must not even read the namespace');
}));
test('B3 read: only the authenticated account and environment; foreign accounts discarded silently',()=>withStore(store([ticket(1),ticket(2,{accountRef:B}),ticket(3,{environmentId:env2})]),m=>{
 const r=m.readRecoveryTickets(sessionA,2000);
 assert.deepEqual(r.valid.map(t=>t.key),[ticket(1).key]);assert.deepEqual(r.invalid,[ticket(3).key]);assert.equal(r.fault,false);
 assert.ok(Object.isFrozen(r.valid[0])&&Object.isFrozen(r.valid));
 assert.deepEqual(JSON.parse(globalThis.sessionStorage.getItem(namespace)).tickets,[ticket(1)],'other account/run removed from storage');
 assert.equal(globalThis.sessionStorage.getItem('unrelated'),'preserve');
 const b=m.readRecoveryTickets(sessionB,2000);assert.deepEqual(b,{valid:[],expired:[],invalid:[],fault:false},'B never sees A metadata, not even as invalid');
}));
test('B3 read: local expiry boundary at exactly thirty minutes; createdAt is not trusted against the client clock',()=>withStore(store([ticket(1),ticket(2,{createdAt:9e9,expiresAt:9e9+1800000})]),m=>{
 assert.deepEqual(m.readRecoveryTickets(sessionA,1800999).valid.map(t=>t.key),[ticket(1).key,ticket(2).key]);
 const r=m.readRecoveryTickets(sessionA,1801000);assert.deepEqual(r.expired,[ticket(1).key]);assert.deepEqual(r.valid.map(t=>t.key),[ticket(2).key]);
}));
test('B3 read: version, extra fields, size and duplicate keys make the whole namespace unreadable (fail closed)',async()=>{
 for(const raw of[JSON.stringify({v:2,tickets:[ticket(1)]}),JSON.stringify({v:1,tickets:[{...ticket(1),body:{seats:1}}]}),JSON.stringify({v:1,tickets:[ticket(1,{v:2})]}),JSON.stringify({v:1,tickets:[ticket(1),ticket(1)]}),JSON.stringify({v:1,tickets:[ticket(1)],extra:1}),'{'+' '.repeat(9000)+'}','not json',JSON.stringify({v:1,tickets:Array.from({length:9},(_,i)=>ticket(i))})])
  await withStore(store(raw),m=>{const r=m.readRecoveryTickets(sessionA,2000);assert.equal(r.fault,true,raw.slice(0,40));assert.equal(r.valid.length,0);});
});
test('B3 read: blocked storage reports a fault after the gate without throwing',()=>withStore({getItem(){throw Error('SecurityError');},setItem(){throw Error('QuotaExceededError');},removeItem(){throw Error('SecurityError');}},m=>{
 assert.deepEqual(m.readRecoveryTickets(sessionA,2000),{valid:[],expired:[],invalid:[],fault:true});
 assert.deepEqual(m.readRecoveryTickets(null,2000),{valid:[],expired:[],invalid:[],fault:false});
}));
test('B3 read: tickets saved by this same document belong to its live attempt and are never shown as restored',()=>withStore(store(),m=>{
 m.saveRecoveryTicket(ticket(1),sessionA);assert.deepEqual(m.readRecoveryTickets(sessionA,2000).valid,[]);
 m.retireRecoveryTicket(ticket(1));assert.equal(globalThis.sessionStorage.getItem(namespace),null);
}));
test('B3 read: login cleanup keeps same-account references of another run as Inválida only in RAM; logout forgets them',()=>withStore(store([ticket(1,{environmentId:env2}),ticket(2,{accountRef:B,environmentId:env2})]),m=>{
 assert.equal(m.cleanRecoveryStorage(A,env),true);assert.equal(globalThis.sessionStorage.getItem(namespace),null);
 assert.deepEqual(m.readRecoveryTickets(sessionA,2000).invalid,[ticket(1).key]);
 m.forgetInvalidRecovery(A,ticket(1).key);assert.deepEqual(m.readRecoveryTickets(sessionA,2000).invalid,[]);
 m.cleanRecoveryStorage(A,env2);globalThis.sessionStorage.setItem(namespace,JSON.stringify({v:1,tickets:[ticket(3,{environmentId:env2})]}));m.cleanRecoveryStorage(A,env);
 m.cleanRecoveryStorage(B,env);assert.deepEqual(m.readRecoveryTickets(sessionA,2000).invalid,[],'another account login drops A RAM metadata');
 globalThis.sessionStorage.setItem(namespace,JSON.stringify({v:1,tickets:[ticket(4,{environmentId:env2})]}));m.cleanRecoveryStorage(A,env);m.cleanRecoveryStorage(null);
 assert.deepEqual(m.readRecoveryTickets(sessionA,2000),{valid:[],expired:[],invalid:[],fault:false});
}));
test('B3 read: a corrupt namespace found at login is reported to that account only',()=>withStore(store('corrupt'),m=>{
 assert.equal(m.cleanRecoveryStorage(A,env),false);assert.equal(m.readRecoveryTickets(sessionA,2000).fault,true);
 assert.equal(m.readRecoveryTickets(sessionB,2000).fault,false);
 m.acknowledgeRecoveryFault(A);assert.equal(m.readRecoveryTickets(sessionA,2000).fault,false);
}));
