// Device private keys and local AES keys are non-exportable CryptoKeys in IndexedDB.
import {COST_FORMAT,isCostField} from './cost-crypto.js';
import {createCostSession} from './cost-session.js';
const enc=new TextEncoder();
const K={identity:'managed-identity',grant:'managed-grant',cache:'managed-cache',events:'managed-events',requests:'managed-requests'};
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64=a=>{let s='';for(const n of new Uint8Array(a))s+=String.fromCharCode(n);return btoa(s);};
const hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(n=>n.toString(16).padStart(2,'0')).join('');
export async function startManaged(hooks){
 const {get,set,del,activate,clear}=hooks;
 let identity=await get(K.identity), grant=await get(K.grant), current=await get(K.cache), allowed=false, busy=false, mutation=Promise.resolve(), sessionRecorded=false;
 const costSession=createCostSession({get,set,del,lock:hooks.lockCosts,show:hooks.showCosts,
  context:()=>({id:identity?.id,approval:grant?.approvedAt,revision:current?.costRevision,version:current?.version,envelope:current?.cost,allowed})});
 // Old bundles carried costs with general prices: never reuse them, even offline.
 if(current?.securityFormat!==COST_FORMAT){current=null;await costSession.forget();await del(K.cache);await del('search-history');clear();}
 const gate=document.createElement('section');gate.className='device-gate';gate.setAttribute('role','status');
 gate.innerHTML='<div class="device-card"><span class="device-mark">價</span><h1>售價速查表</h1><p id="device-message">正在確認裝置權限…</p><form id="device-apply" hidden><label for="device-name">你的姓名</label><input id="device-name" required maxlength="80" autocomplete="name" placeholder="請填寫可辨識的姓名"><p class="device-note">申請送出後，請通知管理員，開通後即可使用。</p><button class="primary-button">申請使用</button></form><p id="device-id" class="device-id"></p><button id="device-check" class="ghost-button" type="button">重新確認</button></div>';
 document.body.append(gate);
 const surfaces=[...document.querySelectorAll('.app-shell,.mobile-dock')];
 surfaces.forEach(el=>el.inert=true);
 const message=gate.querySelector('#device-message'), form=gate.querySelector('form'), check=gate.querySelector('#device-check');
 const lock=(msg)=>{allowed=false;clear();surfaces.forEach(el=>el.inert=true);gate.hidden=false;message.textContent=msg;};
 const requireAuthentication=async msg=>{allowed=false;await costSession.forget();grant=null;await del(K.grant);lock(msg);};
 const display=()=>{gate.querySelector('#device-id').textContent=identity?`裝置 ${identity.id}`:'';form.hidden=!!identity?.registered;};
 const exclusive=fn=>{const work=mutation.then(fn);mutation=work.catch(()=>{});return work;};
 async function request(path,data){
  const method=data===undefined?'GET':'POST', raw=data===undefined?'':JSON.stringify(data), nonce=crypto.randomUUID(), time=String(Date.now());
  const route=new URL(path,location.origin), digest=await hash(enc.encode(raw));
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.privateKey,enc.encode([method,route.pathname,time,nonce,digest].join('\n')));
  const response=await fetch(route,{method,body:raw||undefined,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Device-Id':identity.id,'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Signature':b64(signature)}});
  const result=await response.json();if(!response.ok) throw Object.assign(new Error(result.error||'連線失敗'),{status:response.status,deviceStatus:result.status});return result;
 }
 async function wipe(status){
  grant=null;current=null;allowed=false;
  await costSession.forget();
  await Promise.all([K.grant,K.cache,'active-document','unlock-passphrase','search-history','detail-field-config'].map(del));
  // Clear older service-worker data caches as well; app shell contains no price data.
  for(const key of await caches.keys()) if(key.startsWith('local-price-pwa')){const cache=await caches.open(key);for(const req of await cache.keys()) if(/\/api\/|\.json(?:\?|$)|\.xlsx(?:\?|$)/.test(req.url)) await cache.delete(req);}
  lock(status==='revoked'?'這台裝置已停權，本機價格資料已清除。':'這台裝置尚未核准。核准後按「重新確認」。');
 }
 async function addEvent(kind,extra={}){
  if(!allowed)return;
  await exclusive(async()=>{const list=await get(K.events)||[];list.push({id:crypto.randomUUID(),kind,occurredAt:new Date().toISOString(),offline:!navigator.onLine,version:current?.version||'',...extra});await set(K.events,list);});
 }
 async function flushEvents(){
  for(let page=0;page<20;page++){
   const list=await get(K.events)||[];if(!list.length)return;
   const sent=list.slice(0,100);const result=await request('/api/events',{events:sent});
   await exclusive(async()=>{const ids=new Set(sent.map(e=>e.id));await set(K.events,(await get(K.events)||[]).filter(e=>!ids.has(e.id)));});
   if(result.status==='revoked'){await wipe('revoked');return;}
  }
 }
 async function flushRequests(){
  const list=await get(K.requests)||[];
  for(const r of list){await request('/api/requests',r);await exclusive(async()=>{await set(K.requests,(await get(K.requests)||[]).filter(e=>e.id!==r.id));});}
 }
 async function decrypt(cache){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(cache.iv),additionalData:enc.encode(cache.version)},cache.localKey,bytes(cache.cipher));
  const rows=JSON.parse(new TextDecoder().decode(plain));if(!Array.isArray(rows)||!rows.length) throw new Error('料檔格式錯誤');
  if(rows.some(row=>!row||Object.keys(row).some(isCostField)))throw new Error('料檔尚未完成成本分離，請聯絡管理員更新');
  return rows;
 }
 async function openCached(){
  if(!current||!grant||grant.id!==identity?.id)return false;
  const rows=await decrypt(current);await activate(rows,current);allowed=true;
  await costSession.restore();
  gate.hidden=true;surfaces.forEach(el=>el.inert=false);
  if(!sessionRecorded){sessionRecorded=true;await addEvent('session');}
  return true;
 }
 async function sync(){
  if(busy)return;busy=true;check.disabled=true;
  try{
   display();if(!identity?.registered){await requireAuthentication('為確保資訊安全，請填寫使用者名稱驗證。');return;}
   let status;
   try{status=await request('/api/status');}
   catch(e){
    if(e.deviceStatus==='revoked'){await wipe('revoked');return;}
    if(e.status===401||e.status===403){await requireAuthentication(e.message);return;}
    if(e.status){throw e;}
    if(grant&&current){await openCached();hooks.status(`離線查詢 · 料檔 ${current.fetchedAt.replace('T',' ')}`);return;}
    lock('目前無法連線。這台裝置需要先連線開通及下載料檔。');return;
   }
   if(status.status!=='approved'){
    try{await flushEvents();}catch{}
    await wipe(status.status);return;
   }
   if(grant?.approvedAt!==status.approvedAt)await costSession.forget();
   grant={id:identity.id,name:status.name,approvedAt:status.approvedAt,checkedAt:new Date().toISOString()};await set(K.grant,grant);
   const bundle=await request(`/api/bundle?version=${encodeURIComponent(current?.version||'')}&costRevision=${encodeURIComponent(current?.costRevision||'')}`);
   if(bundle.securityFormat!==COST_FORMAT)throw new Error('伺服器尚未完成安全升級，請聯絡管理員');
   if(current&&bundle.costRevision!==current.costRevision)await costSession.forget();
   if(!bundle.unchanged){
    if(await hash(bytes(bundle.cipher))!==bundle.hash)throw new Error('下載資料不完整，請重新更新');
    const localKey=await crypto.subtle.importKey('raw',bytes(bundle.key),'AES-GCM',false,['decrypt']);
    const candidate={version:bundle.version,fetchedAt:bundle.fetchedAt,count:bundle.count,iv:bundle.iv,cipher:bundle.cipher,localKey,securityFormat:COST_FORMAT,costRevision:bundle.costRevision,cost:bundle.cost};
    hooks.lockCosts(); // Hide old product costs while replacing the dataset; retain the saved KEK.
    await decrypt(candidate);await set(K.cache,candidate);current=candidate;
    hooks.toast('已更新料檔');
   }
   else if(bundle.costRevision!==current.costRevision){
    hooks.lockCosts();
    const candidate={...current,costRevision:bundle.costRevision,cost:bundle.cost};
    await set(K.cache,candidate);current=candidate;
   }
   await openCached();hooks.status(`料檔更新：${current.fetchedAt.replace('T',' ')} · ${current.count.toLocaleString()} 筆`);
   await flushEvents();await flushRequests();
  }catch(e){
   if(e.deviceStatus==='revoked'){await wipe('revoked');}
   else if(e.status===401||e.status===403){await requireAuthentication(e.message);}
   else if(grant&&current){await openCached();hooks.status(`更新未完成，保留原料檔。${e.message}`);}
   else lock(e.message||'料檔尚未準備完成，請稍後重新確認。');
  }finally{busy=false;check.disabled=false;display();}
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();const name=gate.querySelector('input').value.trim();if(!name)return;
  const button=form.querySelector('button');button.disabled=true;
  try{
   if(!identity){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);identity={id:crypto.randomUUID(),privateKey:pair.privateKey,publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};await set(K.identity,identity);}
   const response=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:identity.id,name,publicKey:identity.publicKey}),signal:AbortSignal.timeout(15000)});
   if(!response.ok){const data=await response.json();throw new Error(data.error||'申請失敗');}
   identity.registered=true;await set(K.identity,identity);await sync();
  }catch(err){message.textContent=err.message;}finally{button.disabled=false;}
 });
 check.addEventListener('click',sync);
 window.addEventListener('online',sync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 setInterval(()=>{if(!document.hidden&&navigator.onLine)sync();},60000);
 // Migrate old manually imported content out of this managed origin.
 await del('active-document');await del('unlock-passphrase');
 display();await sync();
 return {
  get allowed(){return allowed;},
  unlockCosts:costSession.unlock,
  forgetCosts:costSession.forget,
  async event(kind,extra){await addEvent(kind,extra);if(navigator.onLine)try{await flushEvents();}catch(e){if(e.deviceStatus==='revoked')await wipe('revoked');else if(e.status===401||e.status===403)await requireAuthentication(e.message);}},
  async submit(sku,note){
   if(!allowed)throw new Error('裝置尚未開通');
   await exclusive(async()=>{const list=await get(K.requests)||[];list.push({id:crypto.randomUUID(),sku,note});await set(K.requests,list);});
   if(navigator.onLine)await flushRequests();return navigator.onLine?'型號已提交，等待審核。':'型號已保存在本機，連線後會自動提交。';
  },sync
 };
}
