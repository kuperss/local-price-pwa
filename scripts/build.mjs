import {mkdir,copyFile,cp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Explicit allowlist: never deploy workbooks, configuration, private data or source tools.
await mkdir('dist',{recursive:true});
for(const f of ['index.html','app.js','styles.css','manifest.webmanifest','sw.js','managed.js','managed.css']) await copyFile(f,`dist/${f}`);
for(const dir of ['assets','vendor','admin']) await cp(dir,`dist/${dir}`,{recursive:true});
const hash=createHash('sha256');
for(const f of ['index.html','app.js','managed.js','managed.css','styles.css','sw.js']) hash.update(await readFile(f));
const sw=(await readFile('sw.js','utf8')).replace(/const CACHE_NAME = "[^"]+";/,`const CACHE_NAME = "local-price-pwa-${hash.digest('hex').slice(0,12)}";`);
await writeFile('dist/sw.js',sw);
console.log('Public assets built. No workbook or price dataset included.');
