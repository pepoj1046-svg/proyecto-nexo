// Windows Chromium SO_RANDOMIZE_PORT can fail with Winsock10055 even at low
// occupancy: microsoft/playwright#43545; chromium issue572515601.
// Do NOT append a second --disable-features: Chromium keeps the last one and
// would discard Playwright's redirect/interception defaults (#43557).
export function windowsChromiumFeatures(argumentsList){
 if(!Array.isArray(argumentsList)||argumentsList.some(x=>typeof x!=='string'))throw Error('CHROMIUM_DEFAULT_ARGUMENTS_REQUIRED');
 const defaults=argumentsList.filter(x=>x.startsWith('--disable-features='));
 if(defaults.length!==1)throw Error('CHROMIUM_DEFAULT_FEATURES_AMBIGUOUS');
 const features=defaults[0].slice('--disable-features='.length).split(',');
 if(!features.length||features.some(x=>! /^[A-Za-z][A-Za-z0-9_.-]*$/.test(x)))throw Error('CHROMIUM_DEFAULT_FEATURES_INVALID');
 return {ignoreDefaultArgs:[defaults[0]],args:['--disable-features='+[...new Set([...features,'TcpPortRandomizationWin'])].join(',')]};
}
export async function chromiumLabLaunch(chromium,{platform=process.platform,executablePath}={}){
 const options=executablePath?{executablePath}:{};
 if(platform!=='win32')return options;
 // Public CDP discovers this installed browser's actual defaults. No copied
 // private Playwright list, eval, dependency patch or lost flags on an upgrade.
 // The empty probe makes no application requests and closes before the suite.
 // Browser.getBrowserCommandLine requires this flag on current Chromium;
 // it applies only to the empty probe, not to the application browser.
 const probe=await chromium.launch({...options,args:['--enable-automation']});
 try{const cdp=await probe.newBrowserCDPSession();const result=await cdp.send('Browser.getBrowserCommandLine');return {...options,...windowsChromiumFeatures(result.arguments)};}
 finally{await probe.close();}
}
