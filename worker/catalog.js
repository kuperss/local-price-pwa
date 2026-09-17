// Admin-only metadata. Deliberately contains no price or protected fields.
const response=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const normalize=value=>String(value??'').normalize('NFKC').trim().toUpperCase();
const codes=value=>[...new Set((Array.isArray(value)?value:String(value??'').split(/[\n\r\t,，;；]+/)).map(normalize).filter(Boolean))];
const valid=list=>list.length>0&&list.length<=100&&list.every(s=>s.length<=100&&/^[\x21-\x7e]+$/.test(s));
const cte=`WITH universe AS (
 SELECT sku FROM product_metadata WHERE snapshot=(SELECT value FROM settings WHERE key='product_snapshot')
 UNION SELECT sku FROM catalog
), items AS (
 SELECT u.sku,m.name,m.sale,m.discontinued,m.shipping,m.a2,m.available,m.incoming,m.eta,m.transfer,m.changes,m.issue,
 m.sku IS NULL AS missing,c.sku IS NOT NULL AS tracked,c.source,c.approved_at,
 CASE WHEN c.sku IS NULL THEN 0 ELSE COALESCE(r.active,1) END AS active,
 COALESCE(r.note,'') note,COALESCE(r.targets,'[]') targets,COALESCE(r.replace_old,0) replace_old,
 EXISTS(SELECT 1 FROM catalog_members l WHERE l.sku=u.sku AND l.version=(SELECT value FROM settings WHERE key='current_bundle')) AS live
 FROM universe u LEFT JOIN product_metadata m ON m.sku=u.sku AND m.snapshot=(SELECT value FROM settings WHERE key='product_snapshot')
 LEFT JOIN catalog c ON c.sku=u.sku LEFT JOIN catalog_rules r ON r.sku=u.sku
), products AS (
 SELECT *,CASE WHEN active AND live THEN 'published' WHEN active THEN 'pending_add'
 WHEN live THEN 'pending_remove' WHEN tracked THEN 'removed' ELSE 'outside' END AS state FROM items
) `;
const filters={all:'1',sale:"sale='Y'",discontinued:"discontinued='Y'",sale_empty:"sale='Y' AND available<=0",clearance:"sale='Y' AND available>0",discontinued_stock:"discontinued='Y' AND available>0",
 transfer:"(COALESCE(transfer,'')<>'' OR targets<>'[]')",transfer_zero:"available=0 AND (COALESCE(transfer,'')<>'' OR targets<>'[]')",
 changed:"COALESCE(changes,'')<>''",returned:'tracked=1 AND active=0 AND available>0',unknown:'available IS NULL',missing:'missing=1',
 attention:`(missing=1 OR COALESCE(issue,'')<>'' OR (available<=0 AND (COALESCE(transfer,'')<>'' OR targets<>'[]')) OR
 (COALESCE(transfer,'')<>'' AND NOT EXISTS(SELECT 1 FROM catalog tc LEFT JOIN catalog_rules tr ON tr.sku=tc.sku WHERE tc.sku=products.transfer AND COALESCE(tr.active,1)=1)) OR
 EXISTS(SELECT 1 FROM json_each(targets) t WHERE NOT EXISTS(SELECT 1 FROM catalog tc LEFT JOIN catalog_rules tr ON tr.sku=tc.sku WHERE tc.sku=t.value AND COALESCE(tr.active,1)=1)))`};
const all=async(db,sql,params=[]) => (await db.prepare(sql).bind(...params).all()).results;
const settings=async db=>Object.fromEntries((await all(db,"SELECT key,value FROM settings WHERE key IN ('catalog_revision','product_snapshot','product_fetched_at','current_bundle')")).map(r=>[r.key,r.value]));
const product=async(db,sku)=>(await all(db,cte+'SELECT * FROM products WHERE sku=?',[sku]))[0]||{sku,missing:1,active:0,tracked:0,live:0,state:'outside',targets:'[]'};
const productMap=async(db,list)=>new Map((await all(db,cte+'SELECT * FROM products WHERE sku IN (SELECT value FROM json_each(?))',[JSON.stringify(list)])).map(r=>[r.sku,r]));
const absent=sku=>({sku,missing:1,active:0,tracked:0,live:0,state:'outside',targets:'[]'});
export async function catalogApi(request,db,url,data,actor){
 const path=url.pathname.slice('/admin/api/products'.length);
 const s=await settings(db);
 if(request.method==='GET'&&!path){
  const p=url.searchParams,params=[],where=[];
  const scope=p.get('scope')||'active';
  if(scope==='active')where.push('active=1');else if(scope==='archived')where.push('tracked=1 AND active=0');else if(scope==='tracked')where.push('tracked=1');
  const term=(p.get('q')||'').trim().slice(0,100).toUpperCase();
  if(term){where.push('(instr(upper(sku),?)>0 OR instr(upper(COALESCE(name,\'\')),?)>0)');params.push(term,term);}
  for(const f of (p.get('filters')||'').split(','))if(filters[f])where.push('('+filters[f]+')');
  if(p.get('state')&&['published','pending_add','pending_remove','removed','outside'].includes(p.get('state'))){where.push('state=?');params.push(p.get('state'));}
  const clause=where.length?' WHERE '+where.join(' AND '):'';
  const sort={sku:'sku',name:'name',available:'available',shipping:'shipping',a2:'a2',state:'state'}[p.get('sort')]||'sku';
  const dir=p.get('dir')==='desc'?'DESC':'ASC',offset=Math.max(0,parseInt(p.get('offset'))||0);
  const rows=await all(db,cte+'SELECT * FROM products'+clause+` ORDER BY ${sort} ${dir},sku LIMIT 100 OFFSET ?`,[...params,offset]);
  const total=(await db.prepare(cte+'SELECT COUNT(*) n FROM products'+clause).bind(...params).first()).n;
  const metrics=await db.prepare(cte+'SELECT '+Object.entries(filters).map(([key,expr])=>`SUM(CASE WHEN tracked=1 AND (${expr}) THEN 1 ELSE 0 END) AS "${key}"`).join(',')+' FROM products').first();
  const bundle=await db.prepare('SELECT fetched_at,published_at,product_count FROM bundles WHERE version=?').bind(s.current_bundle||'').first();
  const publication=await db.prepare('SELECT report FROM catalog_publications WHERE version=?').bind(s.current_bundle||'').first();
  return response({rows,total,metrics,revision:s.catalog_revision||'0',fetchedAt:s.product_fetched_at,snapshot:s.product_snapshot,bundle,report:publication?JSON.parse(publication.report):{}});
 }
 if(request.method==='GET'&&path==='/detail'){
  const code=normalize(url.searchParams.get('sku'));if(!valid([code]))fail(400,'型號格式錯誤');
  const root=await product(db,code),nodes=[],edges=[],seen=new Set();let queue=[code],depth=0;
  while(queue.length&&nodes.length<50&&depth++<20){
   const level=[...new Set(queue)].filter(s=>!seen.has(s)).slice(0,50-nodes.length),found=await productMap(db,level);queue=[];
   for(const current of level){
    seen.add(current);const row=found.get(current)||absent(current);nodes.push(row);
    for(const target of [...new Set([row.transfer,...JSON.parse(row.targets)].filter(Boolean))]){
     edges.push({from:current,to:target,source:target===row.transfer?'ERP':'手動'});if(!seen.has(target))queue.push(target);
    }
   }
  }
  const history=await all(db,"SELECT actor,action,target,created_at FROM admin_audit WHERE action LIKE 'catalog_%' AND json_valid(target) AND json_extract(target,'$.sku')=? ORDER BY created_at DESC LIMIT 50",[code]);
  return response({root,nodes,edges,truncated:queue.length>0||edges.some(e=>!seen.has(e.to)),history,revision:s.catalog_revision||'0'});
 }
 if(request.method==='POST'&&path==='/preview'){
  const list=codes(data.codes);if(!valid(list))fail(400,'每批請輸入 1～100 個有效型號（一行一個）');
  const found=await productMap(db,list),rows=list.map(code=>found.get(code)||absent(code));
  return response({rows,revision:s.catalog_revision||'0'});
 }
 if(request.method==='POST'&&path==='/apply'){
  const list=codes(data.codes),action=data.action;
  if(!valid(list)||!['add','remove','edit','replace','add_targets'].includes(action))fail(400,'操作或型號無效（每批最多 100 筆）');
  if(['edit','replace','add_targets'].includes(action)&&list.length!==1)fail(400,'請逐筆設定替代型號');
  const targets=codes(data.targets||[]);if(targets.length>20||targets.some(s=>!valid([s]))||targets.some(s=>list.includes(s)))fail(400,'替代型號不得等於原型號，最多 20 個');
  if(['replace','add_targets'].includes(action)&&!targets.length)fail(400,'請指定替代型號');
  if(['edit','replace','add_targets'].includes(action)&&targets.length){
   let queue=[...targets],depth=0;const seen=new Set();
   while(queue.length){
    const level=[...new Set(queue)].filter(s=>!seen.has(s));queue=[];
    if(level.includes(list[0]))fail(400,'替代關係會形成循環，請先修正料號');
    if(seen.size+level.length>100||depth++>=20)fail(400,'替代關係超過 100 個節點或 20 層，請先分批檢查');
    const found=await productMap(db,level);
    for(const current of level){seen.add(current);const related=found.get(current)||absent(current);queue.push(...[related.transfer,...JSON.parse(related.targets)].filter(Boolean));}
   }
  }
  const revision=s.catalog_revision||'0';if(data.revision!==revision)fail(409,'清單已被更新，請重新整理後再操作');
  const next=crypto.randomUUID(),stamp=new Date().toISOString();
  const beforeRows=await productMap(db,[...list,...targets]);
  const statements=[db.prepare(`INSERT INTO settings(key,value) VALUES('catalog_revision',CASE WHEN COALESCE((SELECT value FROM settings WHERE key='catalog_revision'),'0')=? THEN ? ELSE NULL END) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(revision,next)];
  const changes=[],audits=[];
  for(const code of list){
   const before=beforeRows.get(code)||absent(code);
   if(['edit','replace','add_targets','remove'].includes(action)&&!before.tracked)fail(400,'請先加入清單再操作');
   const active=action==='remove'||action==='replace'?0:action==='add'?1:before.active;
   const note=action==='edit'?String(data.note||'').trim().slice(0,1000):before.note||'';
   const manual=['edit','replace','add_targets'].includes(action)?JSON.stringify(targets):before.targets||'[]';
   const replacement=action==='replace'?1:action==='add'||action==='remove'?0:before.replace_old||0;
   changes.push({sku:code,source:'admin',active,note,targets:manual,replace_old:replacement});
   if(['replace','add_targets'].includes(action))for(const target of targets){
    const targetBefore=beforeRows.get(target)||absent(target);
    if(targetBefore.missing)fail(400,'替代型號查無來源：'+target+'；請先確認料號');
    changes.push({sku:target,source:'replacement',active:1,note:targetBefore.note||'',targets:targetBefore.targets||'[]',replace_old:0});
    audits.push({id:crypto.randomUUID(),action:'catalog_add_target',target:JSON.stringify({sku:target,from:code,before:targetBefore.active,after:1})});
   }
   audits.push({id:crypto.randomUUID(),action:'catalog_'+action,target:JSON.stringify({sku:code,before:{active:before.active,note:before.note,targets:before.targets},after:{active,note,targets:manual,replace_old:replacement}})});
  }
  const encoded=JSON.stringify(changes);
  // Fixed four-statement atomic batch, even for 100 SKUs; avoid per-row remote queries.
  statements.push(db.prepare("INSERT OR IGNORE INTO catalog(sku,source,approved_at) SELECT json_extract(value,'$.sku'),json_extract(value,'$.source'),? FROM json_each(?)").bind(stamp,encoded),
   db.prepare(`INSERT INTO catalog_rules SELECT json_extract(value,'$.sku'),json_extract(value,'$.active'),json_extract(value,'$.note'),json_extract(value,'$.targets'),json_extract(value,'$.replace_old'),?,? FROM json_each(?) WHERE 1
    ON CONFLICT(sku) DO UPDATE SET active=excluded.active,note=excluded.note,targets=excluded.targets,replace_old=excluded.replace_old,updated_at=excluded.updated_at,actor=excluded.actor`).bind(stamp,actor,encoded),
   db.prepare("INSERT INTO admin_audit SELECT json_extract(value,'$.id'),?,json_extract(value,'$.action'),json_extract(value,'$.target'),? FROM json_each(?)").bind(actor,stamp,JSON.stringify(audits)));
  try{await db.batch(statements);}catch(e){if(String(e.message).includes('NOT NULL'))fail(409,'清單已被更新，請重新整理');throw e;}
  return response({ok:true,revision:next,message:'已儲存，產品增減將於下次成功發布時生效。'});
 }
 fail(404,'找不到清單功能');
}
