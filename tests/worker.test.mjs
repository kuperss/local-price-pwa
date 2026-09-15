import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import worker from '../worker/index.js';

const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
const DB={prepare(query){return {params:[],bind(...params){this.params=params;return this;},async first(){return sql.prepare(query).get(...this.params)||null;},async all(){return {results:sql.prepare(query).all(...this.params)};},async run(){const r=sql.prepare(query).run(...this.params);return {meta:{changes:Number(r.changes)}};}};},async batch(items){sql.exec('BEGIN');try{const result=await Promise.all(items.map(s=>s.run()));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey),id=crypto.randomUUID();
const {publicKey:apub,privateKey:apriv}=await generateKeyPair('RS256');const jwk={...await exportJWK(apub),kid:'test',alg:'RS256'};
const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const issuer=`http://127.0.0.1:${server.address().port}`;
const env={DB,ACCESS_TEAM:issuer,ACCESS_AUD:'test-aud',ADMIN_EMAIL:'owner@example.com',ASSETS:{fetch:()=>new Response('public')}};
async function token(email='owner@example.com'){return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuedAt().setIssuer(issuer).setAudience('test-aud').setExpirationTime('5m').sign(apriv);}
const call=(path,init={})=>worker.fetch(new Request('https://app.test'+path,init),env);
const post=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
async function signed(path,data,extra={}){const raw=data===undefined?'':JSON.stringify(data),method=raw?'POST':'GET',t=String(Date.now()),n=crypto.randomUUID();const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex');const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode([method,path.split('?')[0],t,n,hash].join('\n')));return new Request('https://app.test'+path,{method,body:raw||undefined,headers:{'X-Device-Id':id,'X-Device-Time':t,'X-Device-Nonce':n,'X-Device-Signature':Buffer.from(sig).toString('base64'),...extra}});}
async function admin(path,data,email){return call('/admin/api/'+path,{...(data?post(data):{}),headers:{'Content-Type':'application/json','Cf-Access-Jwt-Assertion':await token(email)}});}

test('device authorization, signed requests, auditing and revocation end to end',async()=>{
 try{
  assert.equal((await call('/')).status,200);
  assert.equal((await call('/admin/')).status,401);
  assert.equal((await call('/admin/api/devices',{headers:{'Cf-Access-Jwt-Assertion':'forged'}})).status,401);
  assert.equal((await admin('devices',undefined,'intruder@example.com')).status,403);
  assert.equal((await call('/api/register',post({id,name:'測試使用者',publicKey}))).status,201);
  let r=await worker.fetch(await signed('/api/status'),env);assert.equal((await r.json()).status,'pending');
  assert.equal((await worker.fetch(await signed('/api/bundle'),env)).status,403);
  assert.equal((await admin('devices',{id,status:'approved'})).status,200);
  const req=await signed('/api/status');assert.equal((await worker.fetch(req.clone(),env)).status,200);assert.equal((await worker.fetch(req,env)).status,409);
  assert.equal((await worker.fetch(await signed('/api/status',undefined,{'X-Device-Signature':'bad'}),env)).status,401);
  const events=[{id:crypto.randomUUID(),kind:'search',query:'LED-4201',resultCount:3,occurredAt:new Date().toISOString(),offline:true,version:'test'}];
  for(let n=0;n<2;n++)assert.equal((await worker.fetch(await signed('/api/events',{events}),env)).status,200);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM events').get().n,1);
  const rows=await (await admin('events?device='+id)).json();assert.equal(rows[0].query,'LED-4201');assert.equal(rows[0].offline,1);
  assert.equal((await worker.fetch(await signed('/api/requests',{sku:'TEST-NEW',note:'test'}),env)).status,200);
  const requests=await (await admin('requests')).json();assert.equal(requests.length,1);
  assert.equal((await admin('requests',{ids:[requests[0].id],status:'approved'})).status,200);
  assert.equal(sql.prepare("SELECT resolution FROM catalog WHERE sku='TEST-NEW'").get().resolution,'awaiting');
  assert.equal((await admin('devices',{id,status:'revoked'})).status,200);
  assert.equal((await worker.fetch(await signed('/api/bundle'),env)).status,403);
  assert.equal((await worker.fetch(await signed('/api/requests',{sku:'NO'}),env)).status,403);
  // Backlogged offline searches still reach the admin after revocation, but no keys are returned.
  events[0].id=crypto.randomUUID();assert.equal((await worker.fetch(await signed('/api/events',{events}),env)).status,200);
  assert.equal((await (await worker.fetch(await signed('/api/status'),env)).json()).status,'revoked');
 }finally{await new Promise(resolve=>server.close(resolve));sql.close();}
});
