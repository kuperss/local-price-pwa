import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {catalogApi} from '../worker/catalog.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const f of ['schema.sql','catalog-schema.sql'])sql.exec(readFileSync(new URL('../worker/'+f,import.meta.url),'utf8'));
 const DB={prepare(query){return {p:[],bind(...p){this.p=p;return this;},async first(){return sql.prepare(query).get(...this.p)||null;},async all(){return {results:sql.prepare(query).all(...this.p)};},async run(){const r=sql.prepare(query).run(...this.p);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 sql.exec("INSERT INTO settings VALUES('product_snapshot','s'),('catalog_revision','0'),('current_bundle','v');");
 for(const [sku,ship,a2,transfer,sale,discontinued] of [['OLD',0,0,'NEW','Y','N'],['NEW',0,4,'NEXT','','N'],['NEXT',10,0,'','','N'],['NEG',-10,3,'','Y','N'],['UNK',0,null,'','','Y'],['CLEAR',0,3,'','Y','N']]){
  sql.prepare('INSERT INTO product_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('s',sku,'品名'+sku,sale,discontinued,ship,a2,a2===null?null:ship+a2,20,'',transfer,'','');
  if(!['NEW','NEXT'].includes(sku)){sql.prepare('INSERT INTO catalog(sku,source,approved_at) VALUES(?,?,?)').run(sku,'seed','2026-09-17');sql.prepare('INSERT INTO catalog_members VALUES(?,?)').run('v',sku);}
 }
 async function call(path='',data){const url=new URL('https://test/admin/api/products'+path);return (await catalogApi(new Request(url,{method:data?'POST':'GET'}),DB,url,data||{},'owner@test')).json();}
 return {sql,call};
}
test('catalog filters use shipping + A2; unknown and negative stock remain distinct',async()=>{
 const {sql,call}=fixture();try{
  const initial=await call();assert.equal(initial.total,4);assert.equal(initial.metrics.transfer_zero,1);assert.equal(initial.metrics.clearance,1);
  assert.deepEqual((await call('?filters=transfer_zero')).rows.map(r=>r.sku),['OLD']);
  assert.deepEqual((await call('?filters=sale_empty')).rows.map(r=>r.sku),['NEG','OLD']);
  assert.equal((await call('?filters=unknown')).rows[0].sku,'UNK');
  assert.equal((await call('?q=NEW&scope=all')).rows[0].state,'outside');
  const detail=await call('/detail?sku=OLD');assert.equal(detail.nodes.length,3);assert.equal(detail.edges.length,2);
 }finally{sql.close();}
});
test('batch add, archive, restore, revision conflict and audit are recoverable',async()=>{
 const {sql,call}=fixture();try{
  const preview=await call('/preview',{codes:' new\nNEW\nUNKNOWN-NEW'});assert.equal(preview.rows.length,2);assert.equal(preview.rows[1].missing,1);
  const added=await call('/apply',{action:'add',codes:['NEW'],revision:'0'});
  assert.equal((await call('?q=NEW')).rows[0].state,'pending_add');
  await assert.rejects(call('/apply',{action:'remove',codes:['OLD'],revision:'0'}),e=>e.status===409);
  const removed=await call('/apply',{action:'remove',codes:['OLD'],revision:added.revision});
  assert.equal((await call('?scope=archived')).rows[0].state,'pending_remove');
  await call('/apply',{action:'add',codes:['OLD'],revision:removed.revision});
  assert.equal((await call('?q=OLD')).rows[0].state,'published');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM admin_audit').get().n,3);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM catalog_members').get().n,4);
 }finally{sql.close();}
});
test('replacement is staged atomically, validates targets, and never overwrites source fields',async()=>{
 const {sql,call}=fixture();try{
  await assert.rejects(call('/apply',{action:'replace',codes:['OLD'],targets:['MISSING'],revision:'0'}),e=>e.status===400);
  assert.equal((await call()).revision,'0');
  await call('/apply',{action:'replace',codes:['OLD'],targets:['NEW','NEXT'],revision:'0'});
  const old=(await call('?scope=archived')).rows[0];assert.equal(old.sku,'OLD');assert.equal(old.replace_old,1);assert.equal(old.live,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM catalog_rules WHERE active=1').get().n,2);
  const revision=(await call()).revision;
  await call('/apply',{action:'edit',codes:['OLD'],targets:['NEXT'],note:'manual note',revision,available:999});
  const detail=await call('/detail?sku=OLD');assert.equal(detail.root.note,'manual note');assert.equal(detail.root.available,0);assert.equal(detail.root.transfer,'NEW');
  assert.equal(detail.history.length,2);
  await assert.rejects(call('/apply',{action:'edit',codes:['NEXT'],targets:['OLD'],revision:detail.revision}),e=>e.status===400&&e.message.includes('循環'));
 }finally{sql.close();}
});

test('full metadata pagination and a 100-SKU batch stay bounded',async()=>{
 const {sql,call}=fixture();try{
  sql.exec(`WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<30000)
   INSERT INTO product_metadata(snapshot,sku,name,sale,discontinued,shipping,a2,available,incoming,eta,transfer)
   SELECT 's','BULK-'||printf('%05d',x),'測試品','','N',1,2,3,0,'','' FROM seq`);
  const page=await call('?scope=all&q=BULK-&offset=200');assert.equal(page.total,30000);assert.equal(page.rows.length,100);assert.equal(page.rows[0].sku,'BULK-00201');
  const list=page.rows.map(r=>r.sku);await call('/apply',{action:'add',codes:list,revision:'0'});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM catalog_rules').get().n,100);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM admin_audit').get().n,100);
 }finally{sql.close();}
});

test('list returns replacement stock outside the selected catalog, including unknown and missing',async()=>{
 const {sql,call}=fixture();try{
  let old=(await call('?q=OLD')).rows[0];
  assert.deepEqual(old.replacements[0],{sku:'NEW',name:'品名NEW',available:4,shipping:0,a2:4,missing:0,state:'outside'});
  await call('/apply',{action:'edit',codes:['OLD'],targets:['NEW','UNK','NEG','GONE'],revision:'0'});
  old=(await call('?q=OLD')).rows[0];
  assert.equal(old.replacements.length,4);
  assert.equal(old.replacements.find(r=>r.sku==='UNK').available,null);
  assert.equal(old.replacements.find(r=>r.sku==='NEG').available,-7);
  assert.equal(old.replacements.find(r=>r.sku==='GONE').missing,1);
  const changed=await call('/apply',{action:'replace',codes:['OLD'],targets:['NEXT'],revision:(await call()).revision});
  assert.ok(changed.ok);assert.equal(sql.prepare("SELECT targets FROM catalog_rules WHERE sku='OLD'").get().targets,'["NEXT"]');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM catalog WHERE sku='NEW'").get().n,0);
 }finally{sql.close();}
});
