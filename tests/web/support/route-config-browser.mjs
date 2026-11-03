import {expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {login,api} from './operation-browser.mjs';
export async function configOpen(page,routeId=null){
 await login(page,'admin','/administracion');const panel=page.locator('.administrative-directory');await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();
 if(routeId){await panel.getByRole('button',{name:'Rutas y sentidos',exact:true}).click();await expect(panel.getByRole('navigation',{name:'Paginación de Rutas y sentidos'}).getByRole('status')).toContainText('Página 1');let row;for(let i=0;i<4;i++){row=panel.locator('[data-directory-id="'+routeId+'"]');if(await row.count())break;await panel.getByRole('button',{name:'Siguiente página de Rutas y sentidos',exact:true}).click();await expect(panel.getByRole('navigation',{name:'Paginación de Rutas y sentidos'}).getByRole('status')).toContainText('Página '+(i+2));}await row.getByRole('button',{name:/^Configurar ruta /}).click();}
 else await panel.getByRole('button',{name:'Gestionar rutas y tarifas',exact:true}).click();
 const form=panel.locator('.route-configuration');await form.getByRole('button',{name:'Consultar configuración actual',exact:true}).click();await expect(form.getByLabel('Motivo de configuración ficticia',{exact:true})).toBeVisible();return {panel,form};
}
export async function configConfirm(form){await form.getByLabel('Motivo de configuración ficticia',{exact:true}).fill('Revisión administrativa ficticia');await form.getByLabel('Confirmo esta configuración y su auditoría, sin cambiar reservas anteriores.',{exact:true}).check();}
export async function configAct(form,label){await configConfirm(form);const response=form.page().waitForResponse(r=>r.url().endsWith('/api/route-config/command'));await form.getByRole('button',{name:label,exact:true}).click();const r=await response;expect(r.status()).toBe(200);await expect(form).toHaveAttribute('aria-busy','false');await expect(form).toContainText('Configuración confirmada y auditada.');return r.json();}
export async function configTab(form,label){await form.getByRole('button',{name:label,exact:true}).click();await expect(form.getByRole('heading',{name:label,exact:true})).toBeVisible();await expect(form.getByLabel('Motivo de configuración ficticia',{exact:true})).toBeVisible();}
export async function configCommand(page,associationId,kind,more={}){const context=await(await api(page,'/api/route-config/context',{associationId})).json();const r=await api(page,'/api/route-config/command',{kind,associationId,revision:context.revision,reason:'Preparación ficticia mediante API autorizada',confirmed:true,...more},randomUUID());expect(r.status()).toBe(200);return r.json();}
export async function configRouteForm(form,page,name,direction='OUT'){
 await form.getByRole('button',{name:'Preparar ruta dirigida nueva',exact:true}).click();await form.getByLabel('Nombre técnico de ruta',{exact:true}).fill(name);await form.getByLabel('Sentido del recorrido',{exact:true}).selectOption(direction);
 for(const [i,city]of (direction==='OUT'?['Yacuiba','Villa Montes']:['Villa Montes','Yacuiba']).entries()){await form.getByRole('combobox',{name:'Localidad del punto '+i,exact:true}).fill(city);await form.getByRole('option',{name:new RegExp('^'+city)}).first().click();await form.getByLabel('Perfil del punto '+i,{exact:true}).selectOption('TERMINAL');}
}
export async function configCapture(form,info,state){await mkdir('.local/4a5-evidence',{recursive:true});await form.screenshot({path:'.local/4a5-evidence/'+info.project.name+'-'+state+'.png',scale:'css'});}
