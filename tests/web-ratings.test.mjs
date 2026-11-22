import{test}from'node:test';import assert from'node:assert/strict';
import{validateRating,validatePage,RATING_TAGS}from'../src/db/web-ratings-service.mjs';
// 5A.7: closed rating and page shapes before anything reaches PostgreSQL.
const id='11111111-1111-4111-8111-111111111111';
test('5A7-U1: a rating is a score 1-5 plus distinct known tags, nothing else',()=>{
 assert.deepEqual(validateRating({bookingId:id,score:5,tags:['TRATO']}),{bookingId:id,score:5,tags:['TRATO']});
 assert.deepEqual(RATING_TAGS,['PUNTUALIDAD','TRATO','LIMPIEZA','CONDUCCION_SEGURA']);
 for(const bad of[{bookingId:id,score:0,tags:[]},{bookingId:id,score:'5',tags:[]},{bookingId:id,score:5,tags:'TRATO'},{bookingId:id,score:5,tags:['X']},{bookingId:id,score:5,tags:['TRATO','TRATO']},{bookingId:id,score:5,tags:[...RATING_TAGS,'TRATO']}])assert.throws(()=>validateRating(bad),/INVALID_RATING/);
 assert.throws(()=>validateRating({bookingId:id,score:5,tags:[],comment:'texto libre'}),/INVALID_REQUEST/);
 assert.throws(()=>validateRating({bookingId:'x',score:5,tags:[]}));
});
test('5A7-U2: administrative pages are bounded',()=>{
 assert.deepEqual(validatePage({limit:20,offset:0}),{limit:20,offset:0});
 for(const bad of[{limit:0,offset:0},{limit:51,offset:0},{limit:10,offset:10001},{limit:10,offset:1.5}])assert.throws(()=>validatePage(bad),/INVALID_PAGE/);
 assert.throws(()=>validatePage({limit:10,offset:0,association:'x'}),/INVALID_REQUEST/);
});
