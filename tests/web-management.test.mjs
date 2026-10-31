import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cursorPage,managementCommand} from '../src/db/web-management-service.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('management commands require a reason/version, explicit confirmation and closed authority fields',()=>{
 const b={kind:'ADMIN_CANCEL',bookingId:id,tripId:id,episode:0,reason:'OPERATOR_ERROR',confirmed:true};assert.equal(managementCommand(b),b);
 for(const x of [{...b,reason:''},{...b,confirmed:false},{...b,episode:-1},{...b,actorId:id},{...b,reason:'NO_SHOW_PENALTY'},{kind:'REVIEW_CONDITION',bookingId:id,revision:0,confirmed:true},{kind:'REVIEW_CONDITION',bookingId:id,revision:1,decision:'ACCEPT',confirmed:true}])assert.throws(()=>managementCommand(x),/INVALID_/);
});
test('cursor contracts reject arbitrary offsets, authority fields, oversized pages and malformed cursors',()=>{
 assert.deepEqual(cursorPage({}),{limit:50,cursor:null});
 const cursor={v:1,size:50,scope:'a'.repeat(64),revision:'b'.repeat(64),createdAt:'2026-01-01T00:00:00+00:00',id};assert.equal(cursorPage({cursor}).cursor,cursor);
 for(const b of [{offset:10001},{limit:101},{limit:'50'},{cursor:[]},{cursor:{...cursor,actorId:id}},{cursor:{...cursor,size:1}},{cursor:{...cursor,createdAt:'yesterday'}},{cursor:{...cursor,scope:null}}])assert.throws(()=>cursorPage(b),/INVALID_/);
});
