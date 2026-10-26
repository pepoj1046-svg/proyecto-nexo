import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalHttpApi } from '../src/http/local-api.mjs';
import { postJson } from './helpers/http.mjs';
const token='t'.repeat(43);
const fake=()=>({localTest:true,identity:{register:async()=>({status:'REGISTRATION_RECEIVED'}),login:async()=>({token}),recover:async()=>({status:'RECOVERED'})},
  service:{logout:async()=>true,logoutAll:async()=>true,suggestLocalities:async()=>[],search:async()=>({status:'NO_DIRECT_SERVICE',results:[]})}});
test('HTTP cannot start without explicit local test mode or with unbounded limits',async()=>{
  for(const options of [{},{...fake(),localTest:false},{...fake(),rateLimit:61},{...fake(),maxInflight:5}])
    await assert.rejects(startLocalHttpApi(options),/LOCAL_TEST_ONLY/);
});
test('HTTP enforces loopback Host, Origin, JSON and browser request controls before adapters',async()=>{
  let calls=0;const config=fake();config.identity.register=async()=>{calls++;return {};};
  const api=await startLocalHttpApi(config);
  try {
    for(const headers of [{Host:'evil.example'},{Origin:'https://evil.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':''},
      {'X-Nexo-Local-Test':''},{'Content-Type':'text/plain'},{'Content-Encoding':'gzip'}]) {
      assert.ok([403,415].includes((await postJson(api.url,'/v1/register',{},headers)).status));
    }
    assert.equal((await postJson(api.url,'/v1/register',{}, {},{method:'GET'})).status,405);
    assert.equal((await postJson(api.url,'/v1/provision-role',{})).status,404);
    assert.equal((await postJson(api.url,'/v1/login?token=forged',{})).status,404);
    assert.equal(calls,0);
    const r=await postJson(api.url,'/v1/register',{});
    assert.equal(r.status,202);assert.equal(r.headers['cache-control'],'no-store');
    assert.equal(r.headers['access-control-allow-origin'],undefined);assert.equal(r.headers['set-cookie'],undefined);
  } finally {await api.close();}
});
test('HTTP rejects invalid JSON, invalid UTF-8, arrays, oversized chunks and ambiguous headers',async()=>{
  const api=await startLocalHttpApi(fake());
  try {
    for(const raw of ['{','[]','null',Buffer.from([0xc3,0x28])])
      assert.equal((await postJson(api.url,'/v1/register',{}, {},{raw})).status,400);
    assert.equal((await postJson(api.url,'/v1/register',{}, {},{raw:'x'.repeat(4097)})).status,413);
    assert.equal((await postJson(api.url,'/v1/register',{}, {},{raw:'x'.repeat(4097),chunked:true})).status,413);
    assert.equal((await postJson(api.url,'/v1/login',{}, {'X-Nexo-Local-Test':['1','1']})).status,400);
  } finally {await api.close();}
});
test('HTTP requires bounded Bearer tokens, empty logout payload and sanitized failures',async()=>{
  const options=fake();options.service.suggestLocalities=async()=>{throw new Error('postgresql://private:secret@server SQL detail');};
  const api=await startLocalHttpApi(options);
  try {
    for(const Authorization of ['', 'Basic forged','Bearer '+token.repeat(4)])
      assert.equal((await postJson(api.url,'/v1/logout',{}, {Authorization})).status,401);
    assert.equal((await postJson(api.url,'/v1/logout',{userId:'forged'},{Authorization:'Bearer '+token})).status,400);
    const result=await postJson(api.url,'/v1/localities/suggest',{query:'San'},{Authorization:'Bearer '+token});
    assert.equal(result.status,503);assert.deepEqual(result.body,{error:'SERVICE_UNAVAILABLE'});
    assert.ok(!JSON.stringify(result).includes('private'));
  } finally {await api.close();}
});
test('HTTP rate windows and concurrent operations are bounded without a request queue',async()=>{
  let time=0;const limited=await startLocalHttpApi({...fake(),rateLimit:1,now:()=>time});
  try {
    assert.equal((await postJson(limited.url,'/v1/register')).status,202);
    const denied=await postJson(limited.url,'/v1/register');assert.equal(denied.status,429);assert.equal(denied.headers['retry-after'],'60');
    time=60000;assert.equal((await postJson(limited.url,'/v1/register')).status,202);
  } finally {await limited.close();}
  let entered,release;
  const ready=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  const config=fake();config.identity.login=async()=>{entered();await gate;return {token};};
  const api=await startLocalHttpApi({...config,maxInflight:1});let first;
  try {
    first=postJson(api.url,'/v1/login');await ready;
    assert.equal((await postJson(api.url,'/v1/login')).status,429);
    release();assert.equal((await first).status,200);
  } finally {release();if(first)await first;await api.close();}
});
