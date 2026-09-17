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
