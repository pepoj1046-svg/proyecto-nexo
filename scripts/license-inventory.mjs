import{readFile}from'node:fs/promises';
import{fileURLToPath}from'node:url';
// Etapa 10A. Dependency and license inventory from package-lock.json (reproducible,
// offline). `node scripts/license-inventory.mjs` prints a Markdown table.
export const STRONG_COPYLEFT=/\b(A?GPL|SSPL|EUPL|OSL)\b/i;
export async function inventory(lockUrl=new URL('../package-lock.json',import.meta.url)){
 const lock=JSON.parse(await readFile(lockUrl,'utf8'));
 return Object.entries(lock.packages??{}).filter(([k])=>k).map(([k,v])=>({name:k.split('node_modules/').at(-1),version:v.version,license:v.license??null,scope:v.dev?'desarrollo':'producción',optional:!!v.optional}))
  .sort((a,b)=>a.scope.localeCompare(b.scope)||a.name.localeCompare(b.name));
}
export function markdown(rows){
 const head='| Paquete | Versión | Licencia | Uso | Opcional |\n| --- | --- | --- | --- | --- |';
 return head+'\n'+rows.map(r=>`| ${r.name} | ${r.version} | ${r.license??'SIN DECLARAR'} | ${r.scope} | ${r.optional?'sí':'no'} |`).join('\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(markdown(await inventory()));
