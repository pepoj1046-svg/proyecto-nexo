import{watchDocument,proofHeaders,rawBootstrap,rememberDocument}from'./document-browser.mjs';
import{expect}from'@playwright/test';
import{readFile,mkdir,writeFile}from'node:fs/promises';
const accounts=JSON.parse(await readFile(process.env.NEXO_WEB_CREDENTIALS_FILE,'utf8')).accounts;
export async function login(page,user){watchDocument(typeof page.page==='function'?page.page():page);await page.getByLabel('Usuario ficticio',{exact:true}).fill(accounts[user].login);await page.getByLabel('Contraseña de prueba',{exact:true}).fill(accounts[user].password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();}
export async function prepare(page,user,enroute=false){
 await page.goto('/');
 if(enroute){for(const[label,query]of[['Origen','Palmar de prueba'],['Destino','Villa Montes']]){await page.getByRole('combobox',{name:label,exact:true}).fill(query);await page.getByRole('option',{name:new RegExp('^'+query+' ')}).first().click();}await page.getByRole('button',{name:'Buscar viajes',exact:true}).click();}
 else await page.getByRole('button',{name:'Probar Yacuiba'}).click();
 const association=page.getByRole('article',{name:'Horizonte del Chaco · ficticia',exact:true});
 await(enroute?association.getByRole('region',{name:'Trufi 3',exact:true}):association).getByRole('button',{name:'Elegir viaje',exact:true}).first().click();
 await page.getByRole('button',{name:'Reservar con sesión',exact:true}).click();await login(page,user);await page.getByRole('button',{name:'Revisar solicitud',exact:true}).click();await page.getByLabel('Confirmo el recorrido').check();return page.locator('.checkout');
}
export async function revoke(page){expect((await page.request.post('/api/logout',{headers:{Origin:new URL(page.url()).origin,...proofHeaders(page)},data:{}})).status()).toBe(200);}
export async function loginApi(page,user){await rawBootstrap(page);const r=await page.request.post('/api/login',{headers:{Origin:new URL(page.url()).origin,...proofHeaders(page)},data:{login:accounts[user].login,password:accounts[user].password}});expect(r.status()).toBe(200);rememberDocument(page,await r.json());}
export const intentions=page=>{const all=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/reservations')all.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()});});return all;};
export async function capture(page,info,name,state){await mkdir('.local/5a2-evidence',{recursive:true});await page.locator('.checkout').screenshot({path:'.local/5a2-evidence/'+info.project.name+'-'+name+'.png',scale:'css'});await writeFile('.local/5a2-evidence/'+info.project.name+'-'+name+'.json',JSON.stringify(state,null,2));}

