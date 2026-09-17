import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

test('public build includes offline cost module and excludes retired PDF and private sources',()=>{
  execFileSync(process.execPath,['scripts/build.mjs']);
  const root=resolve('dist'),files=readdirSync(root,{recursive:true});
  assert.equal(files.some(f=>/pdf|vendor|data-private|\.xlsx|\.py|tests[\\/]/i.test(f)),false);
  for(const f of ['index.html','app.js','styles.css','managed.js','cost-crypto.js','cost-session.js','search.js','sw.js']){
    assert.ok(existsSync(resolve(root,f)),f);
    assert.doesNotMatch(readFileSync(resolve(root,f),'utf8'),/pdfjs|pdf-input|preview-canvas/i);
  }
  const sw=readFileSync(resolve(root,'sw.js'),'utf8');
  assert.match(sw,/"\.\/cost-crypto\.js"/);
  assert.match(sw,/"\.\/search\.js"/);
  assert.match(readFileSync(resolve(root,'index.html'),'utf8'),/id="cost-unlock-form"/);
});

test('user-facing frontend, admin and API messages use @ instead of the protected field name',()=>{
  const visibleFiles=['index.html','app.js','managed.js','cost-session.js','admin/index.html','admin/admin.js','worker/index.js'];
  for(const file of visibleFiles){
    const source=readFileSync(resolve(file),'utf8')
      .replace(/<!--[^]*?-->/g,'')
      .replace(/^\s*\/\/.*$/gm,'');
    assert.doesNotMatch(source,/成本/,file);
  }
  const cryptoSource=readFileSync(resolve('cost-crypto.js'),'utf8').replace('/成本|cost/i','');
  assert.doesNotMatch(cryptoSource,/成本/,'cost-crypto.js messages');
});
