import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalityQuery } from '../src/domain/localities.mjs';
test('locality query normalizes Spanish Unicode and whitespace with bounded defaults',()=>{
  assert.deepEqual(validateLocalityQuery({query:'  Sa\u0301n   Jose\u0301  '}),{query:'Sán José',limit:10});
  assert.equal(validateLocalityQuery({query:'Ñuflo',limit:20}).limit,20);
});
test('locality query rejects broad, unbounded, wildcard and category requests',()=>{
  for(const q of [null,[],{}, {query:'a'},{query:'%'},{query:'ab_'},{query:'ab\\'},
    {query:'a'.repeat(81)},{query:'San',limit:0},{query:'San',limit:21},{query:'San',limit:1.5},
    {query:'San',coverage:'INTERMUNICIPAL'}]) assert.throws(()=>validateLocalityQuery(q),/INVALID_LOCALITY_QUERY/);
});
