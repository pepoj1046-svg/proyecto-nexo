import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{transform}from'esbuild';
// 5A.6: local help content is complete, closed and never promises what the lab lacks.
const code=(await transform(await readFile('apps/web/src/help-content.ts','utf8'),{loader:'ts',format:'esm'})).code;
const h=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const routes=new Set(['/','/pasajero','/chofer','/administracion','/cuenta','/ayuda','/reservar','/plataforma','/operador']);

test('5A6-U1: every topic is well formed, unique, internal-only and versioned',()=>{
 assert.match(h.HELP_VERSION,/^\d{4}-\d{2}-\d{2}\.\d+$/);
 const ids=new Set();
 for(const t of h.helpTopics){
  assert.match(t.id,/^[a-z0-9-]+$/);assert.ok(!ids.has(t.id),t.id);ids.add(t.id);
  assert.ok(t.role in h.roleLabels&&t.kind in h.kindLabels,t.id);
  assert.ok(t.title.length>3&&t.steps.length>0&&t.steps.every(s=>typeof s==='string'&&s.length>3),t.id);
  if(t.link)assert.ok(routes.has(t.link.href),t.id+' links only to existing pages');
  assert.ok(!/https?:|www\.|<script|javascript:/i.test(JSON.stringify(t)),t.id+' has no external links or scripts');
 }
 for(const role of['PASAJERO','CHOFER','ADMINISTRACION','GENERAL'])assert.ok(h.helpTopics.some(t=>t.role===role),role);
 for(const kind of['INFORMACION','INCIDENCIA','REVISION'])assert.ok(h.helpTopics.some(t=>t.kind===kind),kind);
});

test('5A6-U2: the help never promises messages, calls, times or assistance the lab does not have',()=>{
 const all=h.helpTopics.flatMap(t=>[t.title,...t.steps,t.note??'']).join('\n').toLowerCase();
 for(const promise of[/te (llamaremos|avisaremos|enviaremos)/,/recibir[aá]s un (sms|correo|mensaje)/,/en \d+ (minutos|horas)/,/garantiza/,/soporte 24/,/l[ií]nea de atenci[oó]n/])assert.ok(!promise.test(all),String(promise));
 // Mentions of SMS/correo/llamadas only appear as things the lab does NOT do.
 for(const line of all.split('\n').filter(l=>/sms|correo|llamad/.test(l)))assert.match(line,/\bno\b/,line);
});

test('5A6-U3: filtering by role and accent-insensitive search, and help by page',()=>{
 assert.ok(h.filterTopics(h.helpTopics,'CHOFER','').every(t=>t.role==='CHOFER'));
 assert.equal(h.filterTopics(h.helpTopics,'TODOS','').length,h.helpTopics.length);
 assert.ok(h.filterTopics(h.helpTopics,'TODOS','falla mecanica').some(t=>t.id==='chofer-falla'));
 assert.ok(h.filterTopics(h.helpTopics,'TODOS','  GRUPO ').some(t=>t.id==='grupo'));
 assert.deepEqual(h.filterTopics(h.helpTopics,'TODOS','zzzz-no-existe'),[]);
 assert.deepEqual(h.rolesForPath('/pasajero'),['PASAJERO','GENERAL']);assert.deepEqual(h.rolesForPath('/chofer'),['CHOFER','GENERAL']);
 assert.deepEqual(h.rolesForPath('/administracion'),['ADMINISTRACION','GENERAL']);assert.deepEqual(h.rolesForPath('/x'),['GENERAL']);
});
