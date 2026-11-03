import{fleetOpen,fleetConfirm,fleetTab}from'./support/fleet-browser.mjs';
import{test,expect}from'@playwright/test';import{randomUUID}from'node:crypto';
import{fleetEvidence}from'./support/fleet-evidence.mjs';import{login,api}from'./support/operation-browser.mjs';
test('4A4: independent forbidden roles and CSRF never gain enrollment authority',async({page,browser,baseURL})=>{
 const audit=await fleetEvidence();try{const a=await audit.association(),before=await audit.snapshot();for(const label of['platform','reviewer','driver5','operativo0']){const ctx=await browser.newContext({baseURL});try{const p=await ctx.newPage();await login(p,label,'/administracion');for(const path of['context','page','command']){const r=await api(p,'/api/fleet-admin/'+path,path==='context'?{associationId:a}:path==='page'?{associationId:a,section:'HISTORY'}:{kind:'REQUEST_DRIVER',associationId:a,identityCode:'LAB-ADMIN-UNO',revision:'a'.repeat(64),reason:'Ficticio',confirmed:true},randomUUID());expect(r.status()).toBe(403);}}finally{await ctx.close();}}
 await login(page,'admin','/administracion');expect((await page.request.post('/api/fleet-admin/command',{headers:{Origin:baseURL},data:{}})).status()).toBe(403);expect(await audit.snapshot()).toEqual(before);
 }finally{await audit.close();}
});
test('4A4: an operationally blocked assignment has a visible audited review without changing the service',async({page})=>{
 const audit=await fleetEvidence();try{const{form}=await fleetOpen(page),before=await audit.snapshot(),d=await audit.operatingDriver();await fleetTab(form,'Asignaciones base');await form.getByLabel('Referencia técnica del vehículo',{exact:true}).fill(d.vehicle_id);await form.getByLabel('Referencia técnica del chofer',{exact:true}).fill(d.driver_id);await fleetConfirm(form);await form.getByRole('button',{name:'Guardar asignación base',exact:true}).click();await expect(form).toContainText('Revisión operativa requerida y auditada. No se cambió el recurso');expect(await audit.base(d.vehicle_id)).toBeUndefined();await fleetTab(form,'Historial de altas y asignaciones');await expect(form).toContainText('Asignación bloqueada: revisión operativa');await expect(form).toContainText('Revisión operativa requerida; sin cambios en los recursos ni servicios.');expect(await audit.snapshot()).toEqual(before);
 }finally{await audit.close();}
});
