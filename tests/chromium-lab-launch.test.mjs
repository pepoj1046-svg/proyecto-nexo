import test from 'node:test';import assert from 'node:assert/strict';
import {windowsChromiumFeatures,chromiumLabLaunch} from '../scripts/chromium-lab-launch.mjs';
test('Windows laboratory keeps every discovered Playwright feature and rejects ambiguous defaults',()=>{
 const original='--disable-features=BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,ThirdPartyStoragePartitioning';
 const merged=windowsChromiumFeatures(['--headless',original,'--enable-automation']);assert.deepEqual(merged.ignoreDefaultArgs,[original]);assert.deepEqual(merged.args,[original+',TcpPortRandomizationWin']);assert.deepEqual(windowsChromiumFeatures(merged.args).args,merged.args);
 for(const args of[[],['--disable-features=A','--disable-features=B'],['--disable-features='],['--disable-features=A,'],['--disable-features=A;invalid'],[null]])assert.throws(()=>windowsChromiumFeatures(args),/CHROMIUM_DEFAULT_/);
});
test('Windows default discovery closes its probe on success and failure; other platforms never launch it',async()=>{
 let closed=0,launched=0;const chromium={async launch(options){launched++;assert.deepEqual(options,{executablePath:'LAB-BROWSER',args:['--enable-automation']});return {async newBrowserCDPSession(){return {async send(command){assert.equal(command,'Browser.getBrowserCommandLine');return {arguments:['--disable-features=OriginalDefault']};}};},async close(){closed++;}};}};
 assert.deepEqual(await chromiumLabLaunch(chromium,{platform:'linux'}),{});assert.deepEqual(await chromiumLabLaunch(chromium,{platform:'darwin',executablePath:'LAB-BROWSER'}),{executablePath:'LAB-BROWSER'});assert.equal(launched,0);
 assert.deepEqual(await chromiumLabLaunch(chromium,{platform:'win32',executablePath:'LAB-BROWSER'}),{executablePath:'LAB-BROWSER',ignoreDefaultArgs:['--disable-features=OriginalDefault'],args:['--disable-features=OriginalDefault,TcpPortRandomizationWin']});assert.equal(closed,1);
 await assert.rejects(chromiumLabLaunch({async launch(){return {async newBrowserCDPSession(){throw Error('CDP_FAILED');},async close(){closed++;}};}},{platform:'win32'}),/CDP_FAILED/);assert.equal(closed,2);
});
