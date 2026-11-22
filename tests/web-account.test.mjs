import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{transform}from'esbuild';
import{shapeAccount}from'../src/db/web-account-service.mjs';
// 5A.5: the account projection is closed and the preferences never break the page.
const code=(await transform(await readFile('apps/web/src/preferences.ts','utf8'),{loader:'ts',format:'esm'})).code;
const prefs=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

test('5A5-U1: account projection keeps only label and known role fields, never ids or extra data',()=>{
 const r=shapeAccount({label:'Ana',userId:'x',roles:[{association:'A',role:'DRIVER',restricted:false,id:'y'},{association:'B',role:'ROOT',restricted:'yes'},null,{role:'DRIVER'}],editableFields:['label']});
 assert.deepEqual(r,{label:'Ana',editableFields:[],roles:[{association:'A',role:'DRIVER',restricted:false},{association:'B',role:'OTHER',restricted:false}]});
 assert.throws(()=>shapeAccount(null),/ACCOUNT_UNAVAILABLE/);assert.throws(()=>shapeAccount({label:1,roles:[]}),/ACCOUNT_UNAVAILABLE/);
 assert.equal(shapeAccount({label:'x'.repeat(500),roles:[]}).label.length,120);
});

test('5A5-U2: preferences parse only known booleans and fall back to defaults on corrupt storage',()=>{
 assert.deepEqual(prefs.parsePreferences(null),prefs.defaults);
 assert.deepEqual(prefs.parsePreferences('{oops'),prefs.defaults);
 assert.deepEqual(prefs.parsePreferences('[true]'),prefs.defaults);
 assert.deepEqual(prefs.parsePreferences('{"largeText":true,"highContrast":"yes","reduceMotion":1,"token":"x"}'),{largeText:true,highContrast:false,reduceMotion:false});
});

test('5A5-U3: applying preferences toggles exactly the three interface classes',()=>{
 const seen=new Map();const root={classList:{toggle:(c,on)=>seen.set(c,on)}};
 prefs.applyPreferences({largeText:true,highContrast:false,reduceMotion:true},root);
 assert.deepEqual(Object.fromEntries(seen),{'pref-large-text':true,'pref-high-contrast':false,'pref-reduce-motion':true});
});
