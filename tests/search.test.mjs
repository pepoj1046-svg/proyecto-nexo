import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSearch } from '../src/domain/search.mjs';
const originLocalityId='10000000-0000-4000-8000-000000000001';
const destinationLocalityId='10000000-0000-4000-8000-000000000002';
test('search requires only origin/destination and derives defaults without category',()=>{
  assert.deepEqual(validateSearch({originLocalityId,destinationLocalityId}),{originLocalityId,destinationLocalityId,seats:1,express:false});
});
test('search rejects category selector, association filter and invalid geographic identity',()=>{
  for(const extra of [{coverage:'INTERMUNICIPAL'},{associationId:originLocalityId}])
    assert.throws(()=>validateSearch({originLocalityId,destinationLocalityId,...extra}),/INVALID_SEARCH/);
  for(const id of ['Yacuiba',null,originLocalityId])
    assert.throws(()=>validateSearch({originLocalityId,destinationLocalityId:id}),/INVALID_LOCALITIES/);
});
test('search preserves six-seat and express contract',()=>{
  for(const seats of [0,7,1.5,'2']) assert.throws(()=>validateSearch({originLocalityId,destinationLocalityId,seats}),/INVALID_SEATS/);
  assert.throws(()=>validateSearch({originLocalityId,destinationLocalityId,express:true}),/INVALID_SEATS/);
  assert.equal(validateSearch({originLocalityId,destinationLocalityId,seats:6,express:true}).seats,6);
});
