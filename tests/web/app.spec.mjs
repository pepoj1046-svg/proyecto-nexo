import {test,expect}from'@playwright/test';
import AxeBuilder from'@axe-core/playwright';
import{mkdir}from'node:fs/promises';
const sample=async page=>{await page.goto('/');await page.getByRole('button',{name:'Probar Yacuiba'}).click();await expect(page.getByRole('heading',{name:'Yacuiba → Villa Montes',exact:true})).toBeVisible();};
const locality=async(page,label,query,name)=>{const input=page.getByRole('combobox',{name:label,exact:true});await input.fill(query);await page.getByRole('option',{name:new RegExp('^'+name+' ')}).first().click();};
test('búsqueda por nombres y teclado conserva origen/destino y agrupa asociaciones',async({page})=>{
 await page.goto('/');const origin=page.getByRole('combobox',{name:'Origen',exact:true});await origin.fill('Yac');await expect(page.getByRole('option')).toHaveCount(1);await origin.press('ArrowDown');await origin.press('Enter');
 await locality(page,'Destino','Villa','Villa Montes');await page.getByRole('button',{name:'Buscar viajes',exact:true}).click();await expect(page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true})).toBeVisible();await expect(page.locator('.association-card')).toHaveCount(3);
 await expect(page.getByRole('combobox')).toHaveCount(2);await expect(page.getByText('Interdepartamental',{exact:true})).toHaveCount(0);
});
test('sugerencias distinguen localidades homónimas por municipio',async({page})=>{
 await page.goto('/');await page.getByRole('combobox',{name:'Origen',exact:true}).fill('San José');await expect(page.getByRole('option')).toHaveCount(2);await expect(page.getByRole('option').first()).toContainText('Villa Montes');await expect(page.getByRole('option').last()).toContainText('Yacuiba');
});
test('estados NORMAL, DESVIO y SUSPENDIDA muestran condiciones y bloquean selección suspendida',async({page})=>{
 await sample(page);await expect(page.getByText('Operación normal',{exact:true})).toBeVisible();await expect(page.getByText('Desvío informado',{exact:true})).toBeVisible();const suspended=page.getByRole('article',{name:'Camino del Valle · ficticia',exact:true});await expect(suspended.getByRole('button',{name:'Salidas suspendidas'})).toBeDisabled();await expect(suspended).toContainText('LAB-TERMINAL-2');await expect(suspended.getByRole('img',{name:'0 confirmadas, 0 retenidas y 0 libres y 6 no habilitadas de seis plazas'})).toBeVisible();
 await page.getByRole('button',{name:'Con plazas'}).click();await expect(page.locator('.association-card')).toHaveCount(2);
});
test('capacidad real por segmento no confunde plazas de tramos distintos',async({page})=>{
 await sample(page);const second=page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true}).getByRole('region',{name:'Trufi 2',exact:true});
 await second.locator('summary').click();await expect(second.locator('.segment-row').first()).toContainText('2 confirmadas · 0 retenidas · 4 libres');await expect(second.locator('.segment-row').last()).toContainText('4 confirmadas · 0 retenidas · 2 libres');await expect(second).toContainText('2 plazas disponibles para tu recorrido');
});
test('consulta sin rutas devuelve estado vacío y no fabrica disponibilidad',async({page})=>{
 await page.goto('/');await locality(page,'Origen','Yacuiba','Yacuiba');await locality(page,'Destino','Tarija','Tarija');await page.getByRole('button',{name:'Buscar viajes',exact:true}).click();await expect(page.getByRole('heading',{name:'No encontramos rutas para ese recorrido'})).toBeVisible();await expect(page.locator('.association-card')).toHaveCount(0);
});
test('reserva demostrativa reconsulta servidor y no ejecuta escrituras ni persistencia local',async({page})=>{
 const calls=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))calls.push(new URL(r.url()).pathname);});
 await sample(page);await page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true}).getByRole('button',{name:'Elegir viaje',exact:true}).first().click();await expect(page).toHaveURL(/\/reservar$/);await page.getByRole('button',{name:'Añadir una plaza'}).click();await expect(page.getByLabel('¿Cuántas plazas necesitas?')).toHaveValue('2');await expect(page.getByRole('button',{name:'Añadir una plaza'})).toBeDisabled();await page.getByRole('button',{name:'Ver resumen de ejemplo'}).click();await expect(page.getByRole('status')).toContainText('No se registró una reserva');expect(calls.filter(p=>p==='/api/availability')).toHaveLength(2);expect(calls.every(p=>['/api/availability','/api/localities','/api/points'].includes(p))).toBeTruthy();expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookies:document.cookie}))).toEqual({local:0,session:0,cookies:''});
 await page.reload();await expect(page.getByRole('heading',{name:'Primero, encuentra tu recorrido'})).toBeVisible();
});
test('navegación responsive y enlaces profundos de paneles no revelan datos operativos',async({page},info)=>{
 await page.goto('/');if(info.project.name==='mobile')await page.getByRole('button',{name:'Abrir navegación'}).click();await page.getByRole('link',{name:'Administración',exact:true}).click();await expect(page).toHaveURL(/\/administracion$/);await expect(page.getByRole('status')).toContainText('sesión requerida');await expect(page.getByRole('heading',{name:'Asociaciones autorizadas'})).toBeVisible();await expect(page.getByText('Pendiente de conexión',{exact:true})).toHaveCount(4);
 await page.goto('/chofer');await expect(page.getByRole('heading',{name:'Tu recorrido, con claridad.'})).toBeVisible();await page.goto('/pasajero');await expect(page.getByRole('heading',{name:'Tus viajes, en un solo lugar.'})).toBeVisible();await expect(page.getByRole('heading',{name:'Ya llegué',exact:true})).toBeVisible();
});
test('servidor protege rutas administrativas e ignora roles inventados en el navegador',async({page,request,baseURL})=>{
 await page.goto('/administracion');for(const role of ['admin','passenger','driver']){const r=await request.get('/api/'+role+'/overview');expect(r.status()).toBe(401);expect(await r.json()).toEqual({error:'AUTHENTICATION_REQUIRED'});}
 const result=await request.post('/api/localities',{data:{query:'Ya',role:'ASSOCIATION_ADMIN'},headers:{Origin:baseURL}});expect(result.status()).toBe(400);
 const forged=await request.get('/api/admin/overview',{headers:{'X-Role':'ASSOCIATION_ADMIN'}});expect(forged.status()).toBe(401);
});
test('recogidas futuras incluyen unidades en recorrido sin ofrecer origen ya sobrepasado',async({page})=>{
 await sample(page);await expect(page.getByText('En recorrido · punto no sobrepasado',{exact:true})).toHaveCount(0);
 await locality(page,'Origen','Palmar','Palmar de prueba');await page.getByRole('button',{name:'Buscar viajes',exact:true}).click();await expect(page.getByText('En recorrido · punto no sobrepasado',{exact:true})).toBeVisible();
});
test('conexión lenta, error y reintento muestran información honesta sin datos residuales',async({page})=>{
 await page.goto('/');let failed=true;await page.route('**/api/availability',async route=>{if(failed){await new Promise(r=>setTimeout(r,400));await route.fulfill({status:503,contentType:'application/json',body:'{"error":"CATALOG_UNAVAILABLE"}'});}else await route.continue();});
 await page.getByRole('button',{name:'Probar Yacuiba'}).click();await expect(page.getByRole('status')).toContainText('Consultando plazas');await expect(page.getByRole('alert')).toContainText('No pudimos consultar');await expect(page.locator('.association-card')).toHaveCount(0);failed=false;await page.getByRole('button',{name:'Reintentar',exact:true}).click();await expect(page.locator('.association-card')).toHaveCount(3);
});
test('cambiar destino invalida resultados anteriores, responde atrás y mantiene foco accesible',async({page})=>{
 await sample(page);await page.getByRole('combobox',{name:'Destino',exact:true}).fill('Tar');await expect(page.locator('.association-card')).toHaveCount(0);await page.getByRole('option',{name:/^Tarija /}).click();await page.getByRole('button',{name:'Intercambiar origen y destino'}).click();await expect(page.getByRole('combobox',{name:'Origen',exact:true})).toHaveValue('Tarija');
 await page.goto('/');await page.getByRole('button',{name:'Probar Yacuiba'}).click();await expect(page.locator('.association-card')).toHaveCount(3);await page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true}).getByRole('button',{name:'Elegir viaje',exact:true}).first().click();await page.goBack();await expect(page.locator('.association-card')).toHaveCount(3);
});
test('diseño sin desbordamiento, recursos propios y accesibilidad WCAG en resultados y panel',async({page},info)=>{
 const external=[];page.on('request',r=>{if(new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});await sample(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();const viewport=page.viewportSize();await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.setViewportSize(viewport);expect(external).toEqual([]);
 const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations).toEqual([]);
 await mkdir('.local/screenshots',{recursive:true});await page.evaluate(()=>{window.scrollTo(0,0);(document.activeElement instanceof HTMLElement)&&document.activeElement.blur();});await page.screenshot({path:`.local/screenshots/busqueda-${info.project.name}.png`,fullPage:true,scale:'css'});
 await page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true}).getByRole('button',{name:'Elegir viaje',exact:true}).first().click();await page.screenshot({path:`.local/screenshots/reserva-${info.project.name}.png`,fullPage:true,scale:'css'});
 await page.goto('/administracion');await expect(page.getByRole('status')).toContainText('sesión requerida');expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.screenshot({path:`.local/screenshots/administracion-${info.project.name}.png`,fullPage:true,scale:'css'});
});
test('respuestas lentas de localidades no reemplazan una búsqueda más reciente',async({page})=>{
 await page.goto('/');let delayed;const started=new Promise(r=>{delayed=r;});
 await page.route('**/api/localities',async route=>{const q=route.request().postDataJSON().query;if(q==='Yac'){delayed();await new Promise(r=>setTimeout(r,650));}try{await route.continue();}catch{}});
 const origin=page.getByRole('combobox',{name:'Origen',exact:true});await origin.fill('Yac');await started;await origin.fill('Tar');await expect(page.getByRole('option',{name:/^Tarija /})).toBeVisible();await page.waitForTimeout(750);await expect(page.getByRole('option')).toHaveCount(1);await expect(page.getByRole('option')).toContainText('Tarija');
});
test('un cupo que cambia al revisar el ejemplo impide mostrar una confirmación ficticia',async({page})=>{
 await sample(page);await page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true}).getByRole('button',{name:'Elegir viaje',exact:true}).first().click();
 await page.route('**/api/availability',async route=>{const response=await route.fetch();const body=await response.json();for(const s of body.services){s.newReservationsAllowed=false;s.availableSeats=0;for(const segment of s.segments)segment.available=0;}await route.fulfill({response,json:body});});
 await page.getByRole('button',{name:'Ver resumen de ejemplo'}).click();await expect(page.getByRole('alert')).toContainText('La disponibilidad cambió');await expect(page.getByText('Resumen demostrativo preparado.',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Ver resumen de ejemplo'})).toBeDisabled();
});
