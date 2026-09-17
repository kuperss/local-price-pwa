import {createCostPasswordConfig} from '/cost-crypto.js';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={pending:'待核准',approved:'已核准',revoked:'已停權',rejected:'未通過',awaiting:'等待更新',included:'已加入',missing:'BI 尚未查到',session:'開啟',search:'搜尋',view:'查看產品'};
const badge=s=>`<span class="badge ${esc(s)}">${esc(labels[s]||s)}</span>`;
const date=s=>s?new Date(s).toLocaleString('zh-TW',{hour12:false}):'—';
let page='devices',offset=0,device='',query='',serial=0;
async function api(path,data){const r=await fetch('/admin/api/'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,cache:'no-store'});if(!r.ok){let m;try{m=(await r.json()).error;}catch{}throw new Error(m||'登入已逾時，請重新整理並登入後台');}return r.json();}
const message=(s,error=false)=>{$('#message').textContent=s;$('#message').className=error?'error':'';};
async function confirm(text){const dialog=$('#confirm');$('#confirm-text').textContent=text;dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok'),{once:true}));}
function columns(names){$('#head').innerHTML='<tr>'+names.map(s=>`<th>${s}</th>`).join('')+'</tr>';}
async function load(){
 const token=++serial;message('讀取中…');$('#refresh').disabled=true;
 try{
  const [overview,rows]=await Promise.all([api('overview'),api(page==='security'?'cost-password':page+'?'+new URLSearchParams({offset,device,query}))]);if(token!==serial)return;
  $('#actor').textContent=overview.actor;
  const counts=Object.fromEntries(overview.devices.map(d=>[d.status,d.n]));
  $('#summary').innerHTML=[['已開通装置',counts.approved||0],['待審核裝置',counts.pending||0],['已停權裝置',counts.revoked||0],['目前產品數',overview.bundle?.product_count||0]].map(([title,value])=>`<div class="metric"><span>${title}</span><strong>${Number(value).toLocaleString()}</strong></div>`).join('');
  $('#range').textContent=overview.bundle?`料檔：${date(overview.bundle.fetched_at)}`:'尚未發布料檔';
  if(page==='security'){
   $('#password-state').textContent=rows.configured?`已設定 · 最近變更 ${date(rows.updatedAt)}`:'尚未設定；目前所有使用者都無法解鎖@。';
   message('輸入新密碼並確認即可設定或變更。');return;
  }
  const size=page==='events'?100:200;$('#prev').disabled=offset===0;$('#next').disabled=rows.length<size;$('#page-count').textContent=`第 ${Math.floor(offset/size)+1} 頁`;
  if(page==='devices'){
   columns(['姓名／裝置','狀態','申請／最近連線','開啟／搜尋／提交','操作']);
   $('#rows').innerHTML=rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong><small>${esc(r.id)}</small><small>${esc(r.user_agent)}</small></td><td>${badge(r.status)}</td><td>${date(r.created_at)}<small>最近：${date(r.last_seen)}</small><small>核准：${date(r.approved_at)}　停權：${date(r.revoked_at)}</small></td><td>${r.sessions} ／ ${r.searches} ／ ${r.submissions}</td><td><button data-events="${r.id}">查詢紀錄</button><button data-submissions="${r.id}">提交型號</button>${r.status!=='approved'?`<button data-device="${r.id}" data-status="approved">開通</button>`:''}${r.status!=='revoked'?`<button class="danger" data-device="${r.id}" data-status="revoked">停權</button>`:''}</td></tr>`).join('');
  }else if(page==='events'){
   columns(['使用者／裝置','事件','查詢內容／產品型號','結果數','發生時間','收到時間']);
   $('#rows').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}<small>${esc(r.device_id)}</small></td><td>${badge(r.kind)}${r.offline?'<small>離線發生</small>':''}</td><td><strong>${esc(r.query||r.sku||'—')}</strong><small>料檔 ${esc(r.version)}</small></td><td>${r.result_count??'—'}</td><td>${date(r.occurred_at)}</td><td>${date(r.received_at)}</td></tr>`).join('');
  }else if(page==='requests'){
   columns(['<input type="checkbox" id="select-all" aria-label="勾選本頁所有申請">','型號','提交者／裝置','說明','審核／更新狀態','提交時間']);
   const filtered=device?rows.filter(r=>r.device_id===device):rows;
   $('#rows').innerHTML=filtered.map(r=>`<tr><td><input type="checkbox" data-request="${r.id}" aria-label="勾選 ${esc(r.sku)}"></td><td><strong>${esc(r.sku)}</strong></td><td>${esc(r.name)}<small>${esc(r.device_id)}</small></td><td>${esc(r.note)}</td><td>${badge(r.status)} ${r.resolution?badge(r.resolution):''}<small>${esc(r.included_version||'')}</small></td><td>${date(r.created_at)}</td></tr>`).join('');
  }else{
   columns(['核准型號','來源','核准時間','更新狀態','最後處理／版本']);
   $('#rows').innerHTML=rows.map(r=>`<tr><td><strong>${esc(r.sku)}</strong></td><td>${r.source==='seed'?'初始 Excel':'使用者提交'}</td><td>${date(r.approved_at)}</td><td>${badge(r.resolution)}</td><td>${date(r.resolved_at)}<small>${esc(r.included_version||'')}</small></td></tr>`).join('');
  }
  if(!$('#rows').children.length)$('#rows').innerHTML='<tr><td colspan="6" class="empty">目前沒有符合的紀錄。</td></tr>';
  message('資料已更新。');
 }catch(e){message(e.message,true);}finally{if(token===serial)$('#refresh').disabled=false;}
}
function show(next){page=next;offset=0;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#title').textContent={devices:'裝置與使用者',events:'查詢紀錄',requests:'型號審核',catalog:'更新清單',security:'@密碼'}[page];
 $('#list-surface').hidden=page==='security';$('#password-panel').hidden=page!=='security';$('#cost-password-form').reset();
 $('#filters').innerHTML=page==='events'?`<form id="search"><input type="search" name="q" placeholder="搜尋型號或查詢文字" value="${esc(query)}"><button>搜尋</button></form>${device?'<button id="all-devices">查看所有裝置</button>':''}`:page==='requests'?`<button data-review="approved" class="primary">核准勾選型號</button><button data-review="rejected">不予通過</button>${device?'<button id="all-devices">查看所有裝置</button>':''}`:'';
 load();}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.page){device='';query='';show(b.dataset.page);return;}
 if(b.dataset.events){device=b.dataset.events;show('events');return;}
 if(b.dataset.submissions){device=b.dataset.submissions;show('requests');return;}
 if(b.id==='all-devices'){device='';show(page);return;}
 if(b.dataset.device){if(!await confirm(b.dataset.status==='revoked'?'停權後，此裝置下次回連將清除本機價格資料。確定停權？':'核准這台裝置使用查價功能？'))return;b.disabled=true;try{await api('devices',{id:b.dataset.device,status:b.dataset.status});await load();}catch(e){message(e.message,true);}finally{b.disabled=false;}}
 if(b.dataset.review){const ids=[...document.querySelectorAll('[data-request]:checked')].map(c=>c.dataset.request);if(!ids.length){message('請先勾選型號。',true);return;}if(ids.length>50){message('每次最多審核 50 筆。',true);return;}if(!await confirm(`確定${b.dataset.review==='approved'?'核准':'拒絕'} ${ids.length} 筆申請？核准型號將於下一次同步時查找。`))return;try{await api('requests',{ids,status:b.dataset.review});await load();}catch(e){message(e.message,true);}}
});
document.addEventListener('change',e=>{if(e.target.id==='select-all')document.querySelectorAll('[data-request]').forEach(c=>c.checked=e.target.checked);});
document.addEventListener('submit',e=>{if(e.target.id==='search'){e.preventDefault();query=e.target.elements.q.value.trim();offset=0;load();}});
$('#refresh').onclick=load;$('#prev').onclick=()=>{offset=Math.max(0,offset-(page==='events'?100:200));load();};$('#next').onclick=()=>{offset+=page==='events'?100:200;load();};
const hashPage=()=>show(['events','requests','security'].includes(location.hash.slice(1))?location.hash.slice(1):'devices');
window.addEventListener('hashchange',hashPage);hashPage();

$('#cost-password-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');if(button.disabled)return;
 let password=$('#cost-password-new').value;
 if(password!==$('#cost-password-confirm').value){message('兩次密碼不一致，請重新確認。',true);password='';return;}
 button.disabled=true;
 let config;
 try{
  if(!await confirm('儲存後，前端收到更新時會鎖回@，須使用新密碼解鎖。確定變更？'))return;
  form.reset();message('正在安全處理密碼…');
  config=await createCostPasswordConfig(password);password='';
  await api('cost-password',config);config.wrappingKey='';
  await load();message('@密碼已更新。請重新整理前端，取得最新設定後用新密碼解鎖。');
 }catch(error){message(error.message,true);}
 finally{password='';if(config)config.wrappingKey='';form.reset();button.disabled=false;}
});
