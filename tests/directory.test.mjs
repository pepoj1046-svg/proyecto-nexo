import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directoryRequest} from '../src/db/web-directory-service.mjs';
const associationId='00000000-0000-4000-8000-000000000001';
test('4A1: directory input has a closed read-only vocabulary and bounded pages',()=>{
 assert.deepEqual(directoryRequest({section:'ASSOCIATIONS'}),{section:'ASSOCIATIONS',associationId:null,limit:50,cursor:null});
 for(const section of['DRIVERS','VEHICLES','ROUTES','POINTS','FARES'])assert.equal(directoryRequest({section,associationId}).section,section);
 for(const b of[{section:'SQL',associationId},{section:'DRIVERS'},{section:'ASSOCIATIONS',associationId},{section:'ROUTES',associationId,limit:0},{section:'ROUTES',associationId,limit:101},{section:'ROUTES',associationId,role:'ADMIN'},{section:'ROUTES',associationId,actorId:associationId},{section:'ROUTES',associationId,command:'CREATE'}])assert.throws(()=>directoryRequest(b));
});
test('4A1: directory cursor requires exact fields and is bound to page size',()=>{
 const cursor={v:1,scope:'a'.repeat(64),permissions:'b'.repeat(64),revision:'c'.repeat(64),size:50,key:associationId};
 assert.deepEqual(directoryRequest({section:'ROUTES',associationId,cursor}).cursor,cursor);
 for(const bad of[{...cursor,v:'1'},{...cursor,permissions:null},{...cursor,key:7},{...cursor,extra:true},{...cursor,size:10},{...cursor,revision:'x'},{...cursor,key:'x'.repeat(65)}])assert.throws(()=>directoryRequest({section:'ROUTES',associationId,cursor:bad}),/INVALID_/);
});
