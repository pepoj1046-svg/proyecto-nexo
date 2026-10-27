import {defineConfig,devices}from'@playwright/test';
const baseURL=process.env.NEXO_WEB_TEST_URL;
if(process.env.NEXO_WEB_TEST_LOCAL!=='1'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''))throw new Error('Run npm run test:web: fresh loopback laboratory required');
export default defineConfig({testDir:'tests/web',timeout:30000,expect:{timeout:8000},fullyParallel:false,workers:1,retries:0,
  reporter:'line',outputDir:'.local/web-test-results',use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure',
    launchOptions:process.env.NEXO_BROWSER_EXECUTABLE?{executablePath:process.env.NEXO_BROWSER_EXECUTABLE}:{}},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['Pixel 7'],viewport:{width:390,height:844}}}]
});
