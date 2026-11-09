import {expect} from '@playwright/test';
// Test-only RAM observation of the actual per-document HTTP handshake. Never
// read application globals or expose proof through production instrumentation.
const proofs=new WeakMap(),watched=new WeakSet();
export function watchDocument(page){if(watched.has(page))return;watched.add(page);page.on('response',async r=>{const path=new URL(r.url()).pathname;if(!['/api/session','/api/login','/api/logout'].includes(path)||!r.ok())return;try{if(path==='/api/logout')proofs.delete(page);else{const s=await r.json();if(s.documentId)proofs.set(page,s);}}catch{}});}
export const rememberDocument=(page,s)=>proofs.set(page,s);
export const documentProof=page=>proofs.get(page);
export function proofHeaders(page){const s=proofs.get(page);expect(s,'real document handshake required').toBeTruthy();return{'X-Nexo-Document':s.documentId,'X-Nexo-Generation':String(s.generation),'X-CSRF-Token':s.csrf};}
export const privateGet=(page,path)=>page.request.get(path,{headers:proofHeaders(page)});
export async function rawBootstrap(page){const r=await page.request.get('/api/session');expect(r.status()).toBe(200);const s=await r.json();rememberDocument(page,s);return s;}
