import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
import {login} from './support/operation-browser.mjs';

// 4B.1: a full administrator configures unstaffed hours; then only the driver of the
// trip in turn registers a terminal group, attesting no minors. Times are La Paz.
function windowAroundNow(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/La_Paz',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()-60*60000)).map(p=>[p.type,p.value]));
 const weekday={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[parts.weekday],start=`${parts.hour}:${parts.minute}`,end=`${String((Number(parts.hour)+3)%24).padStart(2,'0')}:${parts.minute}`;
 return {weekday,start,end};
}
async function axe(page){expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);}
async function noOverflow(page){const w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(w.scroll).toBe(w.client);}
async function hours(page){
 await login(page,'admin','/administracion');const panel=page.locator('.administrative-directory');
 await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();
 await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();
 const region=panel.getByRole('region',{name:'Horario sin personal',exact:true});
 await region.getByRole('button',{name:'Consultar horario sin personal',exact:true}).click();return region;
}

// One laboratory per suite; the steps run in order and share its state. Split into short
// steps for timing margin (no larger timeouts or retries).
test.describe.serial('4B1-E1: unstaffed hours, driver in turn and administrative traceability',()=>{
 test('E1a: a full administrator saves an unstaffed window that includes now',async({page})=>{
  const region=await hours(page);
  await expect(region.getByRole('status')).toContainText('Ahora no es horario sin personal');
  const w=windowAroundNow();
  await region.getByRole('button',{name:'Añadir franja',exact:true}).click();
  await region.getByLabel('Día de la franja 1',{exact:true}).selectOption(String(w.weekday));
  await region.getByLabel('Inicio de la franja 1',{exact:true}).fill(w.start);await region.getByLabel('Fin de la franja 1',{exact:true}).fill(w.end);
  const save=region.getByRole('button',{name:'Guardar horario',exact:true});await expect(save).toBeDisabled();
  await region.getByRole('checkbox',{name:/Confirmo este horario/}).check();await save.click();
  await expect(region.getByRole('status').first()).toContainText('Ahora es horario sin personal');await expect(region.getByRole('status').first()).toContainText('Revisión 1');
  await axe(page);
 });
 test('E1b: the driver behind the trip in turn is refused',async({page})=>{
  // Seeded queue: driver0's trip is first with room from the terminal; driver1 is behind it.
  await login(page,'driver1','/chofer');await page.getByLabel('Vehículo autorizado',{exact:true}).selectOption({index:1});
  const sale=page.getByRole('region',{name:'Registrar pasajero en terminal',exact:true});
  await sale.getByRole('button',{name:'Comprobar si puedo registrar',exact:true}).click();
  await expect(sale.getByRole('status')).toContainText('no es el que está en turno');
  await expect(sale.getByRole('button',{name:'Registrar grupo',exact:true})).toHaveCount(0);
 });
 test('E1c: the driver in turn attests no minors and registers once',async({page},info)=>{
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:900});
  await login(page,'driver0','/chofer');await page.getByLabel('Vehículo autorizado',{exact:true}).selectOption({index:1});
  const turn=page.getByRole('region',{name:'Registrar pasajero en terminal',exact:true});
  await turn.getByRole('button',{name:'Comprobar si puedo registrar',exact:true}).click();
  await expect(turn).toContainText('en turno · horario sin personal');
  await turn.getByLabel('Plazas del grupo',{exact:true}).fill('1');
  await turn.getByRole('button',{name:'Revisar importe',exact:true}).click();
  await expect(turn).toContainText('La consulta no retiene plazas');
  const register=turn.getByRole('button',{name:'Registrar grupo',exact:true});
  await turn.getByRole('checkbox',{name:/todo el grupo/}).check();await expect(register).toBeDisabled();
  await turn.getByText('Si viaja un menor de edad',{exact:true}).click();await expect(turn).toContainText('llama a las autoridades correspondientes');
  await turn.getByRole('checkbox',{name:/no viaja ningún menor/}).check();
  const sent=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/walk-in/driver-register')sent.push(r.postDataJSON());});
  await register.click();
  await expect(turn.getByRole('status')).toContainText('Grupo registrado.');await expect(turn.getByRole('status')).toContainText('Reserva confirmada en tu trufi por turno.');
  expect(sent).toHaveLength(1);expect(sent[0].noMinors).toBe(true);expect(sent[0].confirmed).toBe(true);expect(Object.keys(sent[0]).sort()).toEqual(['alightingPointId','boardingPointId','confirmed','noMinors','quote','seats','tripId']);
  await axe(page);await noOverflow(page);
  await mkdir('.local/4b1-evidence',{recursive:true});await page.screenshot({path:`.local/4b1-evidence/${info.project.name}-driver-registered.png`,fullPage:true,scale:'css'});
 });
 test('E1d: the administrator traces exactly that registration',async({page})=>{
  const region=await hours(page);
  await expect(region.getByRole('status').first()).toContainText('Ahora es horario sin personal');
  await region.getByRole('button',{name:'Consultar registros de choferes',exact:true}).click();
  const list=region.locator('.driver-registrations li');await expect(list).toHaveCount(1);await expect(list.first()).toContainText('1 plaza');await expect(list.first()).toContainText('CONFIRMED');
  await axe(page);await noOverflow(page);
 });
});

test('4B1-E2: a restricted administrator reads the schedule but cannot change it',async({page})=>{
 await login(page,'adminR','/administracion');const panel=page.locator('.administrative-directory');
 await panel.getByRole('button',{name:'Consultar directorio administrativo',exact:true}).click();
 await panel.getByRole('button',{name:/^Consultar asociación Horizonte del Chaco/}).click();
 const region=panel.getByRole('region',{name:'Horario sin personal',exact:true});
 await region.getByRole('button',{name:'Consultar horario sin personal',exact:true}).click();
 await expect(region).toContainText('Solo un administrador con alcance completo');
 await expect(region.getByRole('button',{name:'Guardar horario',exact:true})).toHaveCount(0);
 await axe(page);
});
