// LOCAL SYNTHETIC QA ONLY. In-memory DB; never connects to Cloudflare or BI.
// Local /admin requests receive a test JWT for the synthetic owner, not production Access.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import worker from '../worker/index.js';
const root=resolve('dist');
const sql=new DatabaseSync(':memory:');sql.exec(await readFile('worker/schema.sql','utf8'));
sql.exec(await readFile('worker/catalog-schema.sql','utf8'));
const DB={prepare(query){return {params:[],bind(...p){this.params=p;return this;},async first(){return sql.prepare(query).get(...this.params)||null;},async all(){return {results:sql.prepare(query).all(...this.params)};},async run(){const r=sql.prepare(query).run(...this.params);return {meta:{changes:Number(r.changes)}};}};},async batch(items){sql.exec('BEGIN');try{const result=await Promise.all(items.map(s=>s.run()));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const version='synthetic-split-costs-1';
const prices=[{'型號':'TEST-001','中文品名':'測試崁燈','底價':'100','量價':'120','開盤價':'150','建議售價':'200','備註':'僅供本機測試'}];
prices.push({'型號':'OLD-009','中文品名':'旧版測試崁燈','_replacements':['TEST-001']});
const costs=[{'型號':'TEST-001','銷售成本':'73.21'}];
const enc=new TextEncoder(),b64=value=>Buffer.from(value).toString('base64');
async function seal(rows,aad){const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(rows)));return {key:b64(raw),iv:b64(iv),cipher:b64(cipher),hash:Buffer.from(await crypto.subtle.digest('SHA-256',cipher)).toString('hex')};}
const main=await seal(prices,version),cost=await seal(costs,'costs:'+version);
sql.prepare('INSERT INTO bundles VALUES(?,?,?,?,?,?,?,?)').run(version,'2026-09-15T09:00:00',new Date().toISOString(),1,main.key,main.iv,main.hash,1);
sql.prepare('INSERT INTO bundle_chunks VALUES(?,?,?)').run(version,0,main.cipher);
sql.prepare('INSERT INTO cost_bundles VALUES(?,?,?,?,?,?)').run(version,cost.key,cost.iv,cost.hash,1,1);
sql.prepare('INSERT INTO cost_chunks VALUES(?,?,?)').run(version,0,cost.cipher);
sql.prepare('INSERT INTO settings VALUES(?,?)').run('current_bundle',version);
sql.prepare('INSERT INTO settings VALUES(?,?)').run('product_snapshot','fixture');
sql.prepare('INSERT INTO settings VALUES(?,?)').run('product_fetched_at','2026-09-17T09:00:00');
sql.prepare('INSERT INTO settings VALUES(?,?)').run('catalog_revision','0');
for(const [code,name,sale,disc,ship,a2,transfer] of [['OLD-R9','舊版球泡','Y','N',0,0,'NEW-R10'],['NEW-R10','新版球泡 R10','','N',12075,7200,'NEW-R11'],['NEW-R11','新版球泡 R11','','N',1188,17160,''],['CLEAR-01','售架有外倉庫存','Y','N',0,30,''],['STOP-01','停產庫存品','','Y',-2,5,''],['UNKNOWN','缺少外倉資料','','N',0,null,''],['TEST-001','測試崁燈','','N',100,0,'']]){
 sql.prepare('INSERT INTO product_metadata VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('fixture',code,name,sale,disc,ship,a2,a2==null?null:ship+a2,0,'',transfer,'','');
 if(!code.startsWith('NEW')){sql.prepare('INSERT INTO catalog(sku,source,approved_at,included_version) VALUES(?,?,?,?)').run(code,'seed','2026-09-16',version);sql.prepare('INSERT INTO catalog_members VALUES(?,?)').run(version,code);}
}
const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'local-test',alg:'RS256'};
let issuer;
const ASSETS={async fetch(request){
 const pathname=decodeURIComponent(new URL(request.url).pathname);
 const file=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
 if(!file.startsWith(root+sep))return new Response('Not found',{status:404});
 try{return new Response(await readFile(file),{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream'}});}
 catch{return new Response('Not found',{status:404});}
}};
const server=createServer(async(req,res)=>{
 try{
  if(req.url==='/cdn-cgi/access/certs'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
  if(req.url.startsWith('/admin'))headers.set('Cf-Access-Jwt-Assertion',await new SignJWT({email:'synthetic-owner@example.test'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuedAt().setIssuer(issuer).setAudience('local-test').setExpirationTime('5m').sign(pair.privateKey));
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=Buffer.concat(chunks);
  const response=await worker.fetch(new Request(issuer+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body}),{DB,ASSETS,ACCESS_TEAM:issuer,ACCESS_AUD:'local-test',ADMIN_EMAIL:'synthetic-owner@example.test'});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error(error.message);res.writeHead(500);res.end('Synthetic preview error');}
});
server.listen(0,'127.0.0.1',()=>{issuer=`http://127.0.0.1:${server.address().port}`;console.log('SYNTHETIC_PREVIEW '+issuer);});
process.on('SIGINT',()=>server.close(()=>{sql.close();process.exit(0);}));
