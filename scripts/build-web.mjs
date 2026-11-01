import { build } from 'esbuild';
import { mkdir,readFile,writeFile,readdir,unlink } from 'node:fs/promises';
import { resolve,basename } from 'node:path';
const outdir=resolve('apps/web/dist');await mkdir(outdir,{recursive:true});
// Only generated bundle files in this fixed directory; never recursive deletion.
for(const name of await readdir(outdir))if(/^app-[A-Z0-9]+\.(js|css)$/.test(name))await unlink(resolve(outdir,name));
const result=await build({entryPoints:['apps/web/src/main.tsx'],outdir,bundle:true,minify:true,metafile:true,
  target:['es2022'],jsx:'automatic',entryNames:'app-[hash]',legalComments:'none',define:{'process.env.NODE_ENV':'"production"'}});
const files=Object.keys(result.metafile.outputs);const js=basename(files.find(f=>f.endsWith('.js'))),css=basename(files.find(f=>f.endsWith('.css')));
const html=(await readFile('apps/web/index.html','utf8')).replace('<!-- APP_ASSETS -->',`<link rel="stylesheet" href="/${css}" />\n  <script type="module" src="/${js}"></script>`);
await writeFile(resolve(outdir,'index.html'),html);
console.log('Web local compilada: apps/web/dist (sin recursos externos).');
