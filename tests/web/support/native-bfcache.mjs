import{chromium,expect}from'@playwright/test';
import{mkdir,writeFile}from'node:fs/promises';

// Experimental browser policy, isolated to a loopback test profile. Application
// Cache-Control/SQL/session policies are NEVER changed. See the audit report.
const experiments=[
 'BackForwardCache',
 'CacheControlNoStoreEnterBackForwardCache:level/restore-unless-cookie-change',
 'BackForwardCacheCCNSAllowlist:BackForwardCacheCCNSAllowedDomains/127.0.0.1',
 'BackForwardCacheCCNSIgnoreUnchangedCookies'
];
export async function nativeLab(baseURL,info){
 if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''))throw Error('LOCAL_NATIVE_BFCACHE_ONLY');
 // The test runner already calibrated the Windows arguments. Recalibrating
 // inside a test would inherit its ignoreDefaultArgs but replace its args.
 // Use full Chrome for Testing (new headless), not the default headless shell.
 const options={...(info.project.use.launchOptions??{}),channel:'chromium',...(process.env.NEXO_BROWSER_EXECUTABLE?{executablePath:process.env.NEXO_BROWSER_EXECUTABLE}:{})};
 // Preserve the installed Playwright/Windows defaults via public CDP, including
 // its existing disable-features policy. Never append a replacement blind list.
 const probe=await chromium.launch({...options,args:[...(options.args??[]),'--enable-automation']});let argumentsList;
 try{const cdp=await probe.newBrowserCDPSession();argumentsList=(await cdp.send('Browser.getBrowserCommandLine')).arguments;}finally{await probe.close();}
 const enabled=argumentsList.filter(a=>a.startsWith('--enable-features='));
 if(enabled.length>1)throw Error('AMBIGUOUS_BROWSER_FEATURES');
 const browser=await chromium.launch({...options,ignoreDefaultArgs:[...(options.ignoreDefaultArgs??[]),'--disable-back-forward-cache',...enabled],args:[...(options.args??[]),'--enable-features='+[...(enabled[0]?.slice('--enable-features='.length).split(',')??[]),...experiments].join(',')]});
 console.log('NATIVE_LAB_BROWSER '+JSON.stringify({version:browser.version(),channel:'chromium',experimentalLoopbackProfile:true}));
 const{viewport,isMobile,hasTouch,userAgent}=info.project.use;
 const context=await browser.newContext({baseURL,viewport,isMobile,hasTouch,userAgent});
 // Establish an anonymous container before loading the document under audit;
 // changing the cookie VALUE still evicts no-store pages in this profile.
 const bootstrap=await context.request.get('/api/session');expect(bootstrap.status()).toBe(200);expect((await bootstrap.json()).authenticated).toBe(false);
 await context.addInitScript(()=>{
  window.nexoNativeAudit={instance:crypto.randomUUID(),events:[]};
  for(const name of ['pagehide','pageshow'])addEventListener(name,e=>{
   const element=document.getElementById('document-content');
   window.nexoNativeAudit.events.push({name,trusted:e.isTrusted,persisted:e.persisted,hidden:element?.hidden,rects:element?.getClientRects().length});
  });
 });
 return{browser,context,experiments,close:async()=>{try{await context.close();}finally{await browser.close();}}};
}
export async function trackNative(page){
 const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
 const navigation=[],notUsed=[],headers=[],origin=new URL(process.env.NEXO_WEB_TEST_URL).origin;
 cdp.on('Page.frameNavigated',e=>navigation.push(e.type));cdp.on('Page.backForwardCacheNotUsed',e=>notUsed.push(e.notRestoredExplanations));
 page.on('response',r=>{if(new URL(r.url()).origin===origin)headers.push({path:new URL(r.url()).pathname,resource:r.request().resourceType(),cacheControl:r.headers()['cache-control']});});
 return{navigation,notUsed,headers};
}
export async function restoreNative(page,track,info,name){
 const instance=await page.evaluate(()=>window.nexoNativeAudit.instance);
 page.on('dialog',async dialog=>{expect(dialog.type()).toBe('beforeunload');await dialog.accept();});
 await page.goto('/');
 return async()=>{
  // bfcache emits no new load event. Waiting for load would falsely time out.
  await page.goBack({waitUntil:'commit'});
  const gate=page.getByRole('region',{name:'Reautenticación tras restaurar la página'});await expect(gate).toBeVisible();
  const state=await page.evaluate(()=>window.nexoNativeAudit);
  expect(state.instance).toBe(instance);expect(state.events.at(-1)).toMatchObject({name:'pageshow',trusted:true,persisted:true,hidden:true,rects:0});
  expect(track.navigation).toContain('BackForwardCacheRestore');
  const painted=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const el=document.getElementById('document-content');resolve({hidden:el.hidden,rects:el.getClientRects().length});}))));
  expect(painted).toEqual({hidden:true,rects:0});
  expect(track.headers.some(h=>h.resource==='document')).toBe(true);
  expect(track.headers.every(h=>h.cacheControl==='no-store')).toBe(true);
  await mkdir('.local/5a4-b1-evidence',{recursive:true});
  await writeFile(`.local/5a4-b1-evidence/${info.project.name}-native-${name}.json`,JSON.stringify({native:true,experimentalLoopbackProfile:true,browser:page.context().browser().version(),state,painted,navigation:track.navigation,notUsed:track.notUsed,headers:track.headers},null,2));
  await page.screenshot({path:`.local/5a4-b1-evidence/${info.project.name}-native-${name}-locked.png`,fullPage:true});
  console.log('NATIVE_BFCACHE '+JSON.stringify({browser:page.context().browser().version(),trusted:true,persisted:true,sameDocument:true,privateHiddenBeforeAuthentication:true,experimentalLoopbackProfile:true}));
  return gate;
 };
}
