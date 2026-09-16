import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCostSession,COST_ACCESS_KEY} from '../cost-session.js';
import {createCostPasswordConfig,wrapCostKey,toBase64} from '../cost-crypto.js';
const password='Synthetic persistent password';
const enc=new TextEncoder();
async function fixture(){
  const config={...await createCostPasswordConfig(password),revision:'revision-1'};
  async function envelope(version,amount='73.21'){
    const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`costs:${version}`)},key,
      enc.encode(JSON.stringify([{'型號':'TEST-001','銷售成本':amount}])));
    return {configured:true,version,revision:config.revision,salt:config.salt,iterations:config.iterations,
      ...await wrapCostKey(toBase64(raw),version,config),iv:toBase64(iv),cipher:toBase64(cipher)};
  }
  const c={id:'device-1',approval:'approval-1',revision:config.revision,version:'version-1',allowed:true,envelope:await envelope('version-1')};
  const store=new Map();let shown;
  const hooks={get:async k=>structuredClone(store.get(k)),set:async(k,v)=>store.set(k,structuredClone(v)),del:async k=>store.delete(k),
    context:()=>({...c}),lock:()=>{shown=null;},show:rows=>{shown=rows;}};
  return {c,store,hooks,envelope,session:()=>createCostSession(hooks),get shown(){return shown;}};
}
test('remembered non-exportable key survives reload and decrypts the next daily dataset',async()=>{
  const f=await fixture();await f.session().unlock(password);
  const saved=f.store.get(COST_ACCESS_KEY);
  assert.equal(saved.key.extractable,false);assert.equal(saved.password,undefined);
  await assert.rejects(crypto.subtle.exportKey('raw',saved.key));
  assert.equal(JSON.stringify(saved).includes('73.21'),false);
  assert.equal(await f.session().restore(),true);assert.equal(f.shown[0]['銷售成本'],'73.21');
  f.c.version='version-2';f.c.envelope=await f.envelope('version-2','88.88');
  assert.equal(await f.session().restore(),true);assert.equal(f.shown[0]['銷售成本'],'88.88');
});
test('password rotation, another device, and a new approval generation clear saved access',async()=>{
  for(const field of ['revision','approval','id']){
    const f=await fixture();await f.session().unlock(password);f.c[field]+='-changed';
    assert.equal(await f.session().restore(),false);assert.equal(f.store.has(COST_ACCESS_KEY),false);
    assert.equal(f.shown,null);
  }
});
test('wrong password never saves access; manual lock and revocation remove it',async()=>{
  const f=await fixture(),session=f.session();
  await assert.rejects(session.unlock('Synthetic wrong password'));assert.equal(f.store.size,0);
  await session.unlock(password);await session.forget();assert.equal(await f.session().restore(),false);
  await session.unlock(password);f.c.allowed=false;await session.forget();
  assert.equal(f.store.size,0);await assert.rejects(session.unlock(password));
});
test('revocation during async decryption cannot resurrect a saved grant',async()=>{
  const f=await fixture(),session=f.session();
  const pending=session.unlock(password);
  f.c.allowed=false;await session.forget();await assert.rejects(pending);
  assert.equal(f.store.has(COST_ACCESS_KEY),false);
});
