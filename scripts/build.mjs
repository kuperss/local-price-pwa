import {mkdir,copyFile,cp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
// Explicit allowlist: never deploy workbooks, configuration, private data or source tools.
const root=await realpath('.'),output=resolve(root,'dist');
if(dirname(output)!==root)throw new Error('Invalid build output');
// dist is generated/ignored; clean it so retired PDF libraries cannot be deployed again.
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const f of ['index.html','app.js','styles.css','manifest.webmanifest','sw.js','managed.js','managed.css','cost-crypto.js','cost-session.js','search.js']) await copyFile(f,`${output}/${f}`);
for(const dir of ['assets','admin']) await cp(dir,`${output}/${dir}`,{recursive:true});
const hash=createHash('sha256');
for(const f of ['index.html','app.js','managed.js','managed.css','styles.css','sw.js','cost-crypto.js','cost-session.js','search.js']) hash.update(await readFile(f));
const sw=(await readFile('sw.js','utf8')).replace(/const CACHE_NAME = "[^"]+";/,`const CACHE_NAME = "local-price-pwa-${hash.digest('hex').slice(0,12)}";`);
await writeFile('dist/sw.js',sw);
console.log('Public assets built. No workbook or price dataset included.');
