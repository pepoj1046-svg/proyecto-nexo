import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {login,api} from './support/operation-browser.mjs';

// Independent security scenario: keep the real 120/minute transport budget.
test('4A3: independent unprivileged sessions and CSRF cannot impersonate platform authority',async({page,browser,baseURL})=>{
 for(const label of['admin','reviewer','driver5','operativo0']){const ctx=await browser.newContext({baseURL});try{const p=await ctx.newPage();await login(p,label,'/plataforma');const r=await api(p,'/api/platform/context',{});expect(r.status()).toBe(403);expect(await r.json()).toEqual({error:'FORBIDDEN'});}finally{await ctx.close();}}
 await login(page,'platform','/plataforma');const denied=await page.request.post('/api/platform/command',{headers:{Origin:baseURL},data:{kind:'REGISTER',name:'LAB-FORJADA'}});expect(denied.status()).toBe(403);const r=await api(page,'/api/platform/command',{kind:'REGISTER',labCode:'LAB-ESCALADO',name:'LAB-ESCALADO',reason:'Ficticio',confirmed:true,role:'GENERAL_ADMIN'},randomUUID());expect(r.status()).toBe(400);
});
