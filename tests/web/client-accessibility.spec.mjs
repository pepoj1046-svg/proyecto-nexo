import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';

async function accessibleLayout(page,info,label){
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 expect.soft(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
 const overflow=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
  elements:[...document.querySelectorAll('main *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1;}).slice(0,8).map(e=>({tag:e.tagName,class:e.className}))}));
 expect.soft(overflow,JSON.stringify(overflow)).toMatchObject({scroll:overflow.width});
 expect(await page.locator('[tabindex]').evaluateAll(nodes=>nodes.filter(e=>Number(e.getAttribute('tabindex'))>0).length)).toBe(0);
 await mkdir('.local/5a3-evidence',{recursive:true});
 await page.screenshot({path:`.local/5a3-evidence/${info.project.name}-${label}.png`,fullPage:true,scale:'css'});
 await writeFile(`.local/5a3-evidence/${info.project.name}-${label}.json`,JSON.stringify({project:info.project.name,case:label,viewport:page.viewportSize(),zoom:await page.evaluate(()=>document.documentElement.style.zoom||'1'),violations:result.violations.map(v=>v.id),overflow},null,2));
}
async function tabTo(page,target){
 for(let n=0;n<60;n++){await page.keyboard.press('Tab');if(await target.evaluate(e=>e===document.activeElement))return;}
 throw Error('Keyboard could not reach the expected control in DOM order');
}
for(const role of ['passenger','driver','admin'])test(`5A3: ${role} operates at 320px and 200% layout zoom`,async({page},info)=>{
 await page.setViewportSize({width:320,height:900});
 const label=role==='passenger'?'operativo0':role==='driver'?'driver5':'adminH',path=role==='passenger'?'/pasajero':role==='driver'?'/chofer':'/administracion';
 const account=JSON.parse(await readFile(process.env.NEXO_WEB_CREDENTIALS_FILE,'utf8')).accounts[label];
 await page.goto(path);const user=page.getByLabel('Usuario ficticio',{exact:true});await expect(user).toBeVisible();
 await tabTo(page,user);await page.keyboard.type(account.login);await page.keyboard.press('Tab');await expect(page.getByLabel('Contraseña de prueba',{exact:true})).toBeFocused();await page.keyboard.type(account.password);
 await page.keyboard.press('Tab');const submit=page.getByRole('button',{name:'Iniciar sesión',exact:true});await expect(submit).toBeFocused();await expect(submit).toBeEnabled();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();
 if(role==='passenger'){
  await page.getByRole('button',{name:'Consultar presencia y viaje',exact:true}).click();
 }else{const select=page.getByLabel('Vehículo autorizado',{exact:true}),value=await select.locator('option').filter({hasText:'FICTICIO-OPERATIVO'}).getAttribute('value');await select.selectOption(value);await expect(page.locator('.trip-operations')).toBeVisible();}
 await accessibleLayout(page,info,role+'-320');
 // Chromium CSS zoom exercises reflow at double scale; no claim of physical-device certification.
 await page.setViewportSize({width:640,height:1000});
 await page.evaluate(()=>document.documentElement.style.zoom='2');
 await accessibleLayout(page,info,role+'-zoom200');
});
test('5A3: keyboard opens and dismisses narrow navigation and returns focus',async({page})=>{
 await page.setViewportSize({width:320,height:900});await page.goto('/');
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Saltar al contenido'})).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('#contenido')).toBeFocused();
 const menu=page.getByRole('button',{name:'Abrir navegación',exact:true});await menu.focus();await page.keyboard.press('Enter');
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Buscar viaje',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false');
 await expect(menu).toHaveCSS('outline-style','solid');
 await page.keyboard.press('Enter');await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-expanded','false');await expect(menu).toBeFocused();
});
