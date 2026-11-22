import{test}from'node:test';import assert from'node:assert/strict';
import{inventory,STRONG_COPYLEFT}from'../scripts/license-inventory.mjs';
// Etapa 10A: every dependency declares a license and nothing in production is strong copyleft.
test('10A-U1: all locked dependencies declare a license; production has no strong copyleft',async()=>{
 const rows=await inventory();
 assert.ok(rows.length>0);
 assert.deepEqual(rows.filter(r=>!r.license).map(r=>r.name),[]);
 assert.deepEqual(rows.filter(r=>r.scope==='producción'&&STRONG_COPYLEFT.test(r.license)).map(r=>r.name),[]);
 for(const name of['pg','react','react-dom'])assert.ok(rows.some(r=>r.name===name&&r.scope==='producción'),name);
});
