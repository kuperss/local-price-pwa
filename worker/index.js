import {createRemoteJWKSet,jwtVerify} from 'jose';
import {COST_FORMAT,validCostConfig,wrapCostKey} from '../cost-crypto.js';
const enc=new TextEncoder();
const json=(obj,status=200)=>Response.json(obj,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const b64bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const now=()=>new Date().toISOString();
const uuid=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/i.test(s);
const text=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
const sku=s=>text(s,100).normalize('NFKC').toUpperCase();
let jwks;
async function admin(request,env){
 if(!env.ACCESS_AUD||!env.ACCESS_TEAM) fail(503,'管理員驗證尚未設定');
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token) fail(401,'請先登入管理後台');
 jwks??=createRemoteJWKSet(new URL(`${env.ACCESS_TEAM}/cdn-cgi/access/certs`));
 let payload;
 try{({payload}=await jwtVerify(token,jwks,{issuer:env.ACCESS_TEAM,audience:env.ACCESS_AUD,algorithms:['RS256']}));}catch{fail(401,'管理員驗證失敗');}
 if(payload.email?.toLowerCase()!==env.ADMIN_EMAIL.toLowerCase()) fail(403,'此帳號無管理權限');
 return payload.email;
}
async function body(request,max=100000){
 if(Number(request.headers.get('Content-Length'))>max) fail(413,'內容過長');
 const raw=await request.text(); if(enc.encode(raw).length>max) fail(413,'內容過長');
 try{return {raw,data:raw?JSON.parse(raw):{}};}catch{fail(400,'JSON 格式錯誤');}
}
async function authenticate(request,env,raw){
 const id=request.headers.get('X-Device-Id'), time=request.headers.get('X-Device-Time'), nonce=request.headers.get('X-Device-Nonce');
 if(!uuid(id)||!uuid(nonce)||!/^\d{13}$/.test(time||'')||Math.abs(Date.now()-Number(time))>300000) fail(401,'装置驗證失敗，請檢查裝置時間');
 const device=await env.DB.prepare('SELECT * FROM devices WHERE id=?').bind(id).first();
 if(!device) fail(401,'找不到裝置申請');
 const message=[request.method,new URL(request.url).pathname,time,nonce,await sha(raw)].join('\n');
 let ok=false;
 try{const key=await crypto.subtle.importKey('jwk',JSON.parse(device.public_key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,b64bytes(request.headers.get('X-Device-Signature')||''),enc.encode(message));}catch{}
 if(!ok) fail(401,'裝置簽章驗證失敗');
 const result=await env.DB.prepare('INSERT OR IGNORE INTO nonces(device_id,nonce,expires) VALUES(?,?,?)').bind(id,nonce,Date.now()+300000).run();
 if(result.meta.changes!==1) fail(409,'請求已使用，請重試');
 await env.DB.batch([env.DB.prepare('DELETE FROM nonces WHERE expires<?').bind(Date.now()),env.DB.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now(),id)]);
 return device;
}
async function register(request,env,data){
 const name=text(data.name,80); if(!name||!uuid(data.id)||data.publicKey?.kty!=='EC'||data.publicKey?.crv!=='P-256'||data.publicKey?.d) fail(400,'請填寫姓名及有效裝置資料');
 try{await crypto.subtle.importKey('jwk',data.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch{fail(400,'裝置公鑰無效');}
 const publicKey=JSON.stringify({kty:'EC',crv:'P-256',x:data.publicKey.x,y:data.publicKey.y});
 const existing=await env.DB.prepare('SELECT public_key FROM devices WHERE id=?').bind(data.id).first();
 if(existing){if(existing.public_key!==publicKey) fail(409,'裝置已存在');return json({ok:true});}
 const hour=new Date().toISOString().slice(0,13), bucket=await sha((request.headers.get('CF-Connecting-IP')||'unknown')+hour);
 await env.DB.prepare('INSERT INTO registration_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1').bind(bucket).run();
 const limit=await env.DB.prepare('SELECT count FROM registration_limits WHERE bucket=?').bind(bucket).first();
 if(limit.count>15) fail(429,'申請過於頻繁，請稍後再試');
 await env.DB.prepare('INSERT INTO devices(id,name,public_key,created_at,user_agent) VALUES(?,?,?,?,?)').bind(data.id,name,publicKey,now(),text(request.headers.get('User-Agent'),300)).run();
 return json({ok:true},201);
}
async function api(request,env,url){
 const {raw,data}=await body(request);
 if(!['GET','POST'].includes(request.method)) fail(405,'不支援此操作');
 if(request.method==='POST'&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin) fail(403,'來源不符');
 const path=url.pathname;
 if(path==='/api/register'&&request.method==='POST') return register(request,env,data);
 if(path.startsWith('/admin/api/')) return adminApi(request,env,url,data,await admin(request,env));
 const d=await authenticate(request,env,raw);
 if(path==='/api/status') return json({id:d.id,name:d.name,status:d.status,approvedAt:d.approved_at});
 // Accept queued audits from revoked devices, but never send them products or keys.
 if(path==='/api/events'&&request.method==='POST'){
  if(!['approved','revoked'].includes(d.status)) fail(403,'尚未核准');
  if(!Array.isArray(data.events)||data.events.length>100) fail(400,'紀錄格式錯誤');
  const statements=[];
  for(const e of data.events){
   if(!uuid(e.id)||!['session','search','view'].includes(e.kind)||!Number.isFinite(Date.parse(e.occurredAt))) fail(400,'紀錄格式錯誤');
   statements.push(env.DB.prepare('INSERT OR IGNORE INTO events(id,device_id,kind,query,sku,result_count,occurred_at,received_at,offline,version) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(e.id,d.id,e.kind,text(e.query,200),sku(e.sku),Number.isInteger(e.resultCount)?Math.max(0,e.resultCount):null,e.occurredAt,now(),e.offline?1:0,text(e.version,80)));
  }
  if(statements.length) await env.DB.batch(statements);
  return json({ok:true,status:d.status});
 }
 if(d.status!=='approved') return json({status:d.status,error:'此裝置尚未開通或已停權'},403);
 if(path==='/api/bundle'){
  const b=await env.DB.prepare("SELECT * FROM bundles WHERE version=(SELECT value FROM settings WHERE key='current_bundle')").first();
  if(!b) fail(503,'產品資料尚未發布');
  // Never serve legacy bundles: those included costs in the ordinary price payload.
  const costs=await env.DB.prepare('SELECT * FROM cost_bundles WHERE version=?').bind(b.version).first();
  if(!costs) fail(503,'料檔安全格式升級中，請聯絡管理員完成成本資料分離');
  const configRow=await env.DB.prepare("SELECT value FROM settings WHERE key='cost_password_v1'").first();
  const config=configRow?JSON.parse(configRow.value):null;
  const costRevision=config?.revision||'none';
  const unchanged=url.searchParams.get('version')===b.version;
  let cost;
  if(!unchanged||url.searchParams.get('costRevision')!==costRevision){
   cost={configured:false,revision:costRevision};
   if(config){
    const chunks=await env.DB.prepare('SELECT content FROM cost_chunks WHERE version=? ORDER BY seq').bind(b.version).all();
    if(chunks.results.length!==costs.chunks) fail(503,'成本資料包不完整');
    cost={configured:true,revision:costRevision,version:b.version,salt:config.salt,iterations:config.iterations,
      ...await wrapCostKey(costs.key_b64,b.version,config),iv:costs.iv_b64,cipher:chunks.results.map(x=>x.content).join(''),hash:costs.content_hash};
   }
  }
  const security={securityFormat:COST_FORMAT,costRevision,...(cost?{cost}:{})};
  if(unchanged) return json({unchanged:true,version:b.version,...security});
  const chunks=await env.DB.prepare('SELECT content FROM bundle_chunks WHERE version=? ORDER BY seq').bind(b.version).all();
  if(chunks.results.length!==b.chunks) fail(503,'資料包不完整');
  return json({version:b.version,fetchedAt:b.fetched_at,count:b.product_count,key:b.key_b64,iv:b.iv_b64,hash:b.content_hash,cipher:chunks.results.map(x=>x.content).join(''),...security});
 }
 if(path==='/api/requests'&&request.method==='POST'){
  const code=sku(data.sku); if(!code||!/^[\x21-\x7e]+$/.test(code)) fail(400,'請填寫有效的產品型號');
  await env.DB.prepare('INSERT OR IGNORE INTO requests(id,device_id,sku,note,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),d.id,code,text(data.note,300),now()).run();
  return json({ok:true});
 }
 if(path==='/api/requests') return json((await env.DB.prepare('SELECT sku,note,status,created_at FROM requests WHERE device_id=? ORDER BY created_at DESC LIMIT 100').bind(d.id).all()).results);
 fail(404,'找不到功能');
}
async function adminApi(request,env,url,data,actor){
 const path=url.pathname.slice('/admin/api/'.length), offset=Math.max(0,Number.parseInt(url.searchParams.get('offset')||'0')||0);
 const log=(action,target)=>env.DB.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,target,now());
 if(path==='cost-password'&&request.method==='GET'){
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='cost_password_v1'").first();
  const config=row?JSON.parse(row.value):null;
  return json({configured:!!config,updatedAt:config?.updatedAt||null,revision:config?.revision||null});
 }
 if(path==='cost-password'&&request.method==='POST'){
  if(!validCostConfig(data)) fail(400,'成本密碼設定格式錯誤');
  const config={salt:data.salt,iterations:data.iterations,wrappingKey:data.wrappingKey,revision:crypto.randomUUID(),updatedAt:now()};
  await env.DB.batch([env.DB.prepare("INSERT INTO settings VALUES('cost_password_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(config)),log('cost_password_changed',config.revision)]);
  return json({ok:true,updatedAt:config.updatedAt,revision:config.revision});
 }
 if(path==='overview') return json({actor,bundle:await env.DB.prepare("SELECT version,fetched_at,published_at,product_count FROM bundles WHERE version=(SELECT value FROM settings WHERE key='current_bundle')").first(),devices:(await env.DB.prepare('SELECT status,COUNT(*) AS n FROM devices GROUP BY status').all()).results});
 if(path==='devices'&&request.method==='GET') return json((await env.DB.prepare("SELECT d.id,d.name,d.status,d.created_at,d.approved_at,d.revoked_at,d.last_seen,d.user_agent, (SELECT COUNT(*) FROM events e WHERE e.device_id=d.id AND kind='session') AS sessions,(SELECT COUNT(*) FROM events e WHERE e.device_id=d.id AND kind='search') AS searches,(SELECT COUNT(*) FROM requests r WHERE r.device_id=d.id) AS submissions FROM devices d ORDER BY d.created_at DESC LIMIT 200 OFFSET ?").bind(offset).all()).results);
 if(path==='devices'&&request.method==='POST'){
  if(!uuid(data.id)||!['approved','revoked'].includes(data.status)) fail(400,'操作無效');
  const d=await env.DB.prepare('SELECT id FROM devices WHERE id=?').bind(data.id).first();if(!d) fail(404,'找不到裝置');
  await env.DB.batch([env.DB.prepare('UPDATE devices SET status=?,approved_at=CASE WHEN ?=\'approved\' THEN ? ELSE approved_at END,revoked_at=CASE WHEN ?=\'revoked\' THEN ? ELSE NULL END WHERE id=?').bind(data.status,data.status,now(),data.status,now(),data.id),log(data.status,data.id)]);return json({ok:true});
 }
 if(path==='events'){
  const device=url.searchParams.get('device')||'', term=text(url.searchParams.get('query'),200);
  return json((await env.DB.prepare('SELECT e.*,d.name FROM events e JOIN devices d ON d.id=e.device_id WHERE (?=\'\' OR device_id=?) AND (?=\'\' OR instr(query,?)>0 OR instr(sku,?)>0) ORDER BY e.received_at DESC,e.id DESC LIMIT 100 OFFSET ?').bind(device,device,term,term,term,offset).all()).results);
 }
 if(path==='requests'&&request.method==='GET') {const device=url.searchParams.get('device')||'';return json((await env.DB.prepare('SELECT r.*,d.name,c.resolution,c.included_version FROM requests r JOIN devices d ON d.id=r.device_id LEFT JOIN catalog c ON c.sku=r.sku WHERE (?=\'\' OR r.device_id=?) ORDER BY r.created_at DESC LIMIT 200 OFFSET ?').bind(device,device,offset).all()).results);}
 if(path==='requests'&&request.method==='POST'){
  if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>50||!['approved','rejected'].includes(data.status)||!data.ids.every(uuid)) fail(400,'請選擇最多 50 筆申請');
  const statements=[];
  for(const id of data.ids){
   const r=await env.DB.prepare('SELECT sku FROM requests WHERE id=?').bind(id).first();if(!r) fail(404,'找不到申請');
   if(data.status==='approved') statements.push(env.DB.prepare("INSERT OR IGNORE INTO catalog(sku,source,approved_at) VALUES(?,'request',?)").bind(r.sku,now()));
   statements.push(env.DB.prepare('UPDATE requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?').bind(data.status,now(),actor,id),log(`request_${data.status}`,id));
  }
  await env.DB.batch(statements);return json({ok:true});
 }
 if(path==='catalog') return json((await env.DB.prepare('SELECT * FROM catalog ORDER BY approved_at DESC,sku LIMIT 200 OFFSET ?').bind(offset).all()).results);
 fail(404,'找不到管理功能');
}
export default {async fetch(request,env){
 try{
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin/api/')) return await api(request,env,url);
  if(url.pathname==='/admin'||url.pathname.startsWith('/admin/')){
   await admin(request,env);
   if(url.pathname==='/admin') return Response.redirect(url.origin+'/admin/',302);
  }
  const response=await env.ASSETS.fetch(request), headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('X-Frame-Options','DENY');
  if(url.pathname.startsWith('/admin')) headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
 }catch(e){if(!e.status) console.error('Request failed',e.name);return json({error:e.status?e.message:'服務暫時無法使用'},e.status||500);}
}};
