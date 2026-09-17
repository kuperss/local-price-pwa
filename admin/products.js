const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states={published:'已發布',pending_add:'待加入',pending_remove:'待移除',removed:'已移除',outside:'未加入'};
const labels={attention:'需要檢查',transfer_zero:'有售轉且零庫存',clearance:'售架有庫存',discontinued_stock:'停產有庫存',sale:'售架',discontinued:'停產',sale_empty:'售架無可用量',transfer:'有售轉／替代',changed:'本次狀態變動',returned:'移除後仍有庫存',unknown:'庫存未知',missing:'來源查無資料'};
const key='price-admin-products-v1';let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
let view={q:'',scope:'active',filters:[],state:'',sort:'sku',dir:'asc',...saved,offset:0};if(!Array.isArray(view.filters))view.filters=[];
let result,selected=new Set(),preview=[],detail,serial=0,busy=false;
const date=s=>s?new Date(s).toLocaleString('zh-TW',{hour12:false}):'尚未同步';
const num=v=>v==null?'<span class="unknown">未知</span>':`<span class="${v<0?'negative':v===0?'zero':''}">${Number(v).toLocaleString('zh-TW')}</span>`;
const state=r=>`<span class="badge state-${esc(r.state)}">${states[r.state]||'未知'}</span>${r.missing?'<small class="warning">來源查無資料</small>':''}`;
async function api(path='',data){const r=await fetch('/admin/api/products'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,cache:'no-store'});let value;try{value=await r.json();}catch{throw new Error('登入已逾時，請重新整理並登入管理後台。');}if(!r.ok)throw new Error(value.error||'讀取失敗');return value;}
function message(text,error=false){$('#message').textContent=text;$('#message').className=error?'error':'';}
function save(){try{localStorage.setItem(key,JSON.stringify(view));}catch{}}
function controls(){for(const id of ['query','scope','state'])$('#'+id).value=view[id==='query'?'q':id];}
function filterButtons(){
 const quick=['attention','transfer_zero','clearance','discontinued_stock'];
 $('#quick').innerHTML=quick.map(f=>`<button data-filter="${f}" aria-pressed="${view.filters.includes(f)}"><span>${labels[f]}</span><strong>${Number(result?.metrics?.[f]||0).toLocaleString()}</strong><small>${f==='transfer_zero'?'實際可用量恰好為 0':f==='attention'?'缺資料、售轉異常或替代品未納入':'依實際可用量加總判斷'}</small></button>`).join('');
 $('#chips').innerHTML=Object.keys(labels).filter(f=>!quick.includes(f)).map(f=>`<button data-filter="${f}" aria-pressed="${view.filters.includes(f)}">${labels[f]} · ${result?.metrics?.[f]||0}</button>`).join('');
}
function selection(){const n=selected.size;$('#selection').textContent=n?`已勾選 ${n} 筆（限本頁）`:'尚未勾選';$('#batch-add').disabled=!n||busy;$('#batch-remove').disabled=!n||busy;$('#select-all').checked=!!result?.rows.length&&n===result.rows.length;$('#select-all').indeterminate=n>0&&n<result.rows.length;}
async function load(){
 const token=++serial;message('讀取清單…');$('#refresh').disabled=true;save();
 try{
  const data=await api('?'+new URLSearchParams({...view,filters:view.filters.join(',')}));if(token!==serial)return;result=data;selected.clear();selection();filterButtons();
  $('#source-time').textContent=date(data.fetchedAt);$('#live-time').textContent=data.bundle?`${date(data.bundle.fetched_at)} · ${data.bundle.product_count.toLocaleString()} 筆`:'尚未發布';
  $('#rows').innerHTML=data.rows.map(r=>`<tr><td><input type="checkbox" data-select="${esc(r.sku)}" aria-label="選取 ${esc(r.sku)}"></td><td><button class="sku-link" data-detail="${esc(r.sku)}">${esc(r.sku)}</button><small>${esc(r.changes)}</small>${r.issue?`<small class="negative">${esc(r.issue)}</small>`:''}</td><td>${esc(r.name||'來源查無資料')}${r.note?`<small>備註：${esc(r.note)}</small>`:''}</td><td>${r.sale==='Y'?'<span class="badge">Y</span>':esc(r.sale||'—')}</td><td>${r.discontinued==='Y'?'<span class="badge">Y</span>':esc(r.discontinued||'—')}</td><td>${num(r.shipping)}</td><td>${num(r.a2)}</td><td>${num(r.available)}</td><td>${num(r.incoming)}</td><td>${esc([...new Set([r.transfer,...JSON.parse(r.targets)].filter(Boolean))].join('、')||'—')}</td><td>${state(r)}</td><td><button data-action="${r.active?'remove':'add'}" data-sku="${esc(r.sku)}">${r.active?'移出':r.tracked?'恢復':'加入'}</button></td></tr>`).join('')||'<tr><td colspan="12" class="empty">沒有符合條件的型號。可清除篩選，或改查完整產品來源。</td></tr>';
  $('#result-count').textContent=`符合 ${data.total.toLocaleString()} 筆`;$('#page-count').textContent=`第 ${Math.floor(view.offset/100)+1} / ${Math.max(1,Math.ceil(data.total/100))} 頁`;
  $('#prev').disabled=view.offset===0;$('#next').disabled=view.offset+100>=data.total;
  const blocked=data.report?.blocked||[];$('#publish-report').hidden=!blocked.length;$('#publish-report').textContent=blocked.length?'上次發布仍保留以下舊品：'+blocked.map(r=>r.sku+'（'+r.reason+'）').join('；'):'';
  message(data.snapshot?'已載入。變更會先儲存為待發布，線上料檔不會立即改動。':'尚無產品快照，請先執行來源資料同步。');
 }catch(e){message(e.message,true);}finally{if(token===serial)$('#refresh').disabled=false;}
}
async function apply(action,list,extra={},revision=result?.revision){
 if(busy)return false;busy=true;document.body.classList.add('loading');
 try{await api('/apply',{action,codes:list,revision,...extra});await load();message('已儲存。下一次成功發布時套用；目前線上版本維持不變。');return true;}
 catch(e){throw e;}finally{busy=false;document.body.classList.remove('loading');selection();}
}
async function membership(action,list){
 if(action==='remove'&&!confirm(`將 ${list.length} 個型號移出 PWA 清單？\n可恢復，ERP 原始資料不會刪除，下次成功發布才生效。`))return;
 try{await apply(action,list);}catch(e){message(e.message,true);}
}
async function showDetail(code){
 try{
  detail=await api('/detail?sku='+encodeURIComponent(code));const r=detail.root;$('#detail-title').textContent=r.sku;$('#detail-message').textContent='';
  $('#detail-content').innerHTML=`<p>${esc(r.name||'來源查無資料')}　${state(r)}</p><div class="detail-summary"><div>出貨可用量<strong>${num(r.shipping)}</strong></div><div>＋ A2外倉<strong>${num(r.a2)}</strong></div><div>＝ 實際可用量<strong>${num(r.available)}</strong></div><div>在途（不計入）<strong>${num(r.incoming)}</strong></div></div><p>售架：${esc(r.sale||'未標示')}　停產：${esc(r.discontinued||'未標示')}　到貨日：${esc(r.eta||'—')}</p><p>來源：${esc(({seed:'初始 Excel',request:'使用者提交',admin:'管理員新增',replacement:'替代型號'})[r.source]||'完整來源快照')}　加入：${date(r.approved_at)}</p><h2>售轉與替代關係</h2><div class="chain">${detail.nodes.map(n=>`<div class="chain-row"><strong>${esc(n.sku)}</strong>　${state(n)}　可用量 ${num(n.available)}<p>${esc(n.name||'來源查無資料')}</p>${detail.edges.filter(e=>e.from===n.sku).map(e=>`<p>→ ${esc(e.to)} <span class="source-badge">${e.source}</span></p>`).join('')||'<p class="source-badge">未記載後續替代型號</p>'}${n.issue?`<p class="negative">${esc(n.issue)}</p>`:''}</div>`).join('')}</div>${detail.truncated?'<p class="warning">關係超過 50 個節點或 20 層，顯示範圍已截斷，請檢查異常資料。</p>':''}`;
  $('#note').value=r.note||'';$('#targets').value=JSON.parse(r.targets).join('\n');$('#detail-form').hidden=!r.tracked;
  $('#history').innerHTML=detail.history.map(h=>`<div class="history-row">${date(h.created_at)} · ${esc(h.actor)} · ${esc(({catalog_add:'加入／恢復',catalog_remove:'移出',catalog_edit:'修改備註／關係',catalog_replace:'替換舊品',catalog_add_targets:'加入替代品',catalog_add_target:'加入替代品'})[h.action]||h.action)}<pre>${esc(JSON.stringify(JSON.parse(h.target),null,2))}</pre></div>`).join('')||'<p>尚無管理紀錄。</p>';
  if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
 }catch(e){message(e.message,true);}
}
document.addEventListener('click',e=>{
 const close=e.target.closest('[data-close]');if(close)$('#'+close.dataset.close).close();
 const f=e.target.closest('[data-filter]');if(f){const value=f.dataset.filter;view.filters=view.filters.includes(value)?view.filters.filter(x=>x!==value):[...view.filters,value];view.scope='tracked';view.offset=0;controls();load();}
 const sort=e.target.closest('[data-sort]');if(sort){view.dir=view.sort===sort.dataset.sort&&view.dir==='asc'?'desc':'asc';view.sort=sort.dataset.sort;view.offset=0;load();}
 const d=e.target.closest('[data-detail]');if(d)showDetail(d.dataset.detail);
 const a=e.target.closest('[data-action]');if(a)membership(a.dataset.action,[a.dataset.sku]);
});
$('#rows').addEventListener('change',e=>{if(!e.target.matches('[data-select]'))return;e.target.checked?selected.add(e.target.dataset.select):selected.delete(e.target.dataset.select);selection();});
$('#select-all').addEventListener('change',e=>{selected=new Set(e.target.checked?result.rows.map(r=>r.sku):[]);document.querySelectorAll('[data-select]').forEach(el=>el.checked=e.target.checked);selection();});
$('#batch-add').onclick=()=>membership('add',[...selected]);$('#batch-remove').onclick=()=>membership('remove',[...selected]);
$('#search-form').onsubmit=e=>{e.preventDefault();view.q=$('#query').value.trim();view.scope=$('#scope').value;view.state=$('#state').value;view.offset=0;load();};
for(const id of ['scope','state'])$('#'+id).onchange=()=>$('#search-form').requestSubmit();
$('#refresh').onclick=()=>load();$('#reset').onclick=()=>{view={q:'',scope:'active',state:'',filters:[],sort:'sku',dir:'asc',offset:0};controls();load();};
$('#prev').onclick=()=>{view.offset=Math.max(0,view.offset-100);load();};$('#next').onclick=()=>{view.offset+=100;load();};
$('#add').onclick=()=>{$('#add-codes').value='';$('#add-preview').innerHTML='';$('#add-message').textContent='';$('#confirm-add').disabled=true;$('#add-dialog').showModal();};
$('#add-codes').oninput=()=>{$('#confirm-add').disabled=true;preview=[];};let previewRevision;
$('#preview').onclick=async()=>{const text=$('#add-codes').value;$('#preview').disabled=true;try{const data=await api('/preview',{codes:text});if(text!==$('#add-codes').value)return;preview=data.rows;previewRevision=data.revision;$('#add-preview').innerHTML='<div class="preview-list">'+preview.map(r=>`<div class="preview-row"><strong>${esc(r.sku)}</strong><span>${r.missing?'查無來源，加入後待補資料':r.active?'已在清單':r.tracked?'已移除，可恢復':'可新增'}</span></div>`).join('')+'</div>';$('#confirm-add').disabled=!preview.length;$('#add-message').textContent=`去除重複後共 ${preview.length} 個型號。`;}catch(e){$('#add-message').textContent=e.message;}finally{$('#preview').disabled=false;}};
$('#confirm-add').onclick=async()=>{try{if(await apply('add',preview.map(r=>r.sku),{},previewRevision))$('#add-dialog').close();}catch(e){$('#add-message').textContent=e.message;}};
$('#detail-form').onsubmit=async e=>{e.preventDefault();try{if(await apply('edit',[detail.root.sku],{note:$('#note').value,targets:$('#targets').value},detail.revision))await showDetail(detail.root.sku);}catch(e){$('#detail-message').textContent=e.message;}};
for(const [id,action] of [['replace','replace'],['add-targets','add_targets']])$('#'+id).onclick=async()=>{
 const targets=[...new Set([detail.root.transfer,...$('#targets').value.split(/[\n\r\t,，;；]+/)].map(s=>s?.trim()).filter(Boolean))];
 if(!targets.length){$('#detail-message').textContent='請先填寫替代型號。';return;}
 if(!confirm(`加入替代型號：${targets.join('、')}\n${action==='replace'?'舊品將待移除；新資料未能完整發布時保留舊品。':'舊品仍留在清單。'}\n尚未儲存的備註不會隨此操作變更。`))return;
 try{if(await apply(action,[detail.root.sku],{targets},detail.revision))await showDetail(detail.root.sku);}catch(e){$('#detail-message').textContent=e.message;}
};
controls();filterButtons();load();
