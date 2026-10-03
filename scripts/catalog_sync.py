"""Private, price-free product metadata and publication membership. No ERP writes."""
import argparse
import gzip
import hashlib
import json
import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from cloud import ROOT, Cloud, deployment, measured_phase

SCHEMA=(ROOT/'worker/catalog-schema.sql').read_text(encoding='utf-8')
FIELDS=['sku','name','sale','discontinued','shipping','a2','available','incoming','eta','transfer','changes','issue']
# In-place delta must fit ONE statement (one JSON bind) so it stays atomic. D1 allows
# 2 MB strings; keep headroom. Larger deltas fall back to a full immutable snapshot.
DELTA_MAX_BYTES=900_000
def canonical(value):
    return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def number(value):
    # Missing is unknown, not zero. Negative stock remains negative.
    if value is None or isinstance(value,bool):return None
    value=unicodedata.normalize('NFKC',str(value)).strip().replace(',','')
    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)',value):return None
    result=float(value)
    return result if math.isfinite(result) else None

def setup(cloud,db):
    for sql in SCHEMA.split(';'):
        if sql.strip():cloud.query(db,sql)
    cloud.query(db,"INSERT OR IGNORE INTO settings VALUES('catalog_revision','0')")
    # Backfill only the current legacy publication, never desired future membership.
    cloud.query(db,"""INSERT OR IGNORE INTO catalog_members(version,sku)
      SELECT included_version,sku FROM catalog WHERE included_version=(SELECT value FROM settings WHERE key='current_bundle')
      AND NOT EXISTS(SELECT 1 FROM catalog_publications WHERE version=catalog.included_version)""")
    cloud.query(db,"""INSERT OR IGNORE INTO catalog_publications(version,revision)
      SELECT value,'legacy' FROM settings WHERE key='current_bundle'""")

def setting(cloud,db,key,default=None):
    rows=cloud.query(db,'SELECT value FROM settings WHERE key=?',[key])
    return rows[0]['value'] if rows else default

def switch_metadata(cloud,db,updates,current,previous_input):
    # Atomic pointer/freshness updates, including same-snapshot reuse. The input guard
    # prevents an older uploader overwriting freshness after another reused the snapshot.
    switched=cloud.query(db,"""INSERT INTO settings(key,value)
      SELECT json_extract(value,'$.key'),json_extract(value,'$.value') FROM json_each(?)
      WHERE COALESCE((SELECT value FROM settings WHERE key='product_snapshot'),'')=?
      AND COALESCE((SELECT value FROM settings WHERE key='product_metadata_input'),'')=?
      ON CONFLICT(key) DO UPDATE SET value=excluded.value RETURNING key""",
      [json.dumps([{'key':key,'value':value} for key,value in updates.items()]),current or '',previous_input or ''])
    if len(switched)!=len(updates):
        raise ValueError('Metadata changed during upload; completed snapshot retained. Retry next sync.')

def metadata(payload,previous=None):
    previous=previous or {};rows={}
    for key,raw in payload['master'].items():
        code=canonical(raw.get('IMA01',key))
        if not code:continue
        shipping,a2=number(raw.get('出貨可用量')),number(raw.get('A2外倉'))
        r={'sku':code,'name':str(raw.get('IMA02') or ''),'sale':canonical(raw.get('IMA130')),
           'discontinued':canonical(raw.get('IMA140')),'shipping':shipping,'a2':a2,
           'available':shipping+a2 if shipping is not None and a2 is not None else None,
           'incoming':number(raw.get('在途量')),'eta':str(raw.get('到貨日') or ''),
           'transfer':canonical(raw.get('TA_IMA107')),'changes':'','issue':''}
        old=previous.get(code)
        if old:
            changes=[]
            if r['sale']=='Y' and old['sale']!='Y':changes.append('新售架')
            if r['discontinued']=='Y' and old['discontinued']!='Y':changes.append('新停產')
            if r['available']==0 and old['available'] is not None and old['available']!=0:changes.append('新歸零')
            if r['available'] is not None and r['available']>0 and old['available'] is not None and old['available']<=0:changes.append('恢復庫存')
            r['changes']='、'.join(changes)
        rows[code]=r
    for code,r in rows.items():
        seen={code};target=r['transfer']
        while target:
            if target in seen:r['issue']='售轉循環';break
            if target not in rows:r['issue']='售轉料號查無來源';break
            seen.add(target);target=rows[target]['transfer']
            if len(seen)>100:r['issue']='售轉鏈過長';break
    return rows

@measured_phase('metadata_sync')
def sync_metadata(cloud,db,payload):
    setup(cloud,db)
    digest=hashlib.sha256(json.dumps(payload['master'],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
    input_version=payload['fetched_at']+'-'+digest
    current=setting(cloud,db,'product_snapshot')
    previous_input=setting(cloud,db,'product_metadata_input')
    if current==input_version or (current and previous_input==input_version):return current
    retired=setting(cloud,db,'product_previous_snapshot')
    previous={}
    if current:
        after=''
        while True:
            page=cloud.query(db,'SELECT '+','.join(FIELDS)+' FROM product_metadata WHERE snapshot=? AND sku>? ORDER BY sku LIMIT 1000',[current,after])
            previous.update({r['sku']:r for r in page})
            if len(page)<1000:break
            after=page[-1]['sku']
    generated=metadata(payload,previous)
    rows=list(generated.values())
    if not rows:raise ValueError('Empty metadata snapshot; previous retained')
    # Preserve the immutable snapshot when every whitelisted field is unchanged.
    # Compare calculated changes/issue too: yesterday's change flags must clear today.
    if current and generated==previous:
        switch_metadata(cloud,db,{'product_fetched_at':payload['fetched_at'],
                        'product_metadata_input':input_version},current,previous_input)
        print(f'CATALOG_METADATA_OK reused products={len(rows)} fetched_at={payload["fetched_at"]}')
        return current
    # Daily stock movement touches ~2,500 of ~29,000 SKUs. Rewriting the whole snapshot
    # cost ~87,000 rows_written/day (87% of the D1 free 100,000), so update only changed
    # rows of the live snapshot. Removed SKUs or an oversized delta use the full path.
    if current and not previous.keys()-generated.keys():
        changed=[r for code,r in generated.items() if previous.get(code)!=r]
        batch=json.dumps(changed,ensure_ascii=False,separators=(',',':'))
        if len(batch.encode())<=DELTA_MAX_BYTES:
            # Claim first: the guarded upsert only lands while this run still owns the
            # input marker, so two publishers cannot interleave rows. The upsert is one
            # statement (atomic); an interruption leaves the previous complete rows.
            claim='claim-'+uuid.uuid4().hex[:12]
            switch_metadata(cloud,db,{'product_metadata_input':claim},current,previous_input)
            cloud.query(db,'INSERT INTO product_metadata(snapshot,'+','.join(FIELDS)+') SELECT ?,'+
                        ','.join("json_extract(value,'$."+f+"')" for f in FIELDS)+' FROM json_each(?)'
                        " WHERE (SELECT value FROM settings WHERE key='product_snapshot')=?"
                        " AND (SELECT value FROM settings WHERE key='product_metadata_input')=?"
                        ' ON CONFLICT(snapshot,sku) DO UPDATE SET '+
                        ','.join(f+'=excluded.'+f for f in FIELDS if f!='sku'),[current,batch,current,claim])
            switch_metadata(cloud,db,{'product_fetched_at':payload['fetched_at'],
                            'product_metadata_input':input_version},current,claim)
            print(f'CATALOG_METADATA_OK delta changed={len(changed)} products={len(rows)} fetched_at={payload["fetched_at"]}')
            return current
    fields=FIELDS
    # Separate concurrent staging even for the same input; computed change flags can
    # differ when two runs started from different baselines. Only the CAS winner is live.
    snapshot=input_version+'-'+uuid.uuid4().hex[:12]
    for start in range(0,len(rows),200):
        batch=json.dumps(rows[start:start+200],ensure_ascii=False,separators=(',',':'))
        cloud.query(db,'INSERT OR REPLACE INTO product_metadata(snapshot,'+','.join(fields)+') SELECT ?,'+
                    ','.join("json_extract(value,'$."+f+"')" for f in fields)+' FROM json_each(?)',[snapshot,batch])
        if (start+200)%5000==0:print(f'CATALOG_METADATA_STAGED {start+200}/{len(rows)}',flush=True)
    # One atomic statement: readers never see a new snapshot with an old timestamp.
    # CAS also stops a slower publisher overwriting a newer completed snapshot.
    switch_metadata(cloud,db,{'product_snapshot':snapshot,
                    'product_fetched_at':payload['fetched_at'],
                    'product_previous_snapshot':current or snapshot,
                    'product_metadata_input':input_version},current,previous_input)
    # Indexed delete of one known retired snapshot, never scan/delete other publishers' staging.
    # Pre-upgrade orphan snapshots are deliberately left for explicit maintenance.
    if retired and retired not in (snapshot,current):
        cloud.query(db,"""DELETE FROM product_metadata WHERE snapshot=? AND snapshot NOT IN
          (SELECT value FROM settings WHERE key IN ('product_snapshot','product_previous_snapshot'))""",[retired])
    print(f'CATALOG_METADATA_OK products={len(rows)} fetched_at={payload["fetched_at"]}')
    return snapshot

@measured_phase('catalog_plan')
def plan(cloud,db,payload):
    revision=setting(cloud,db,'catalog_revision','0')
    records=cloud.query(db,"""SELECT c.sku,COALESCE(r.active,1) active,COALESCE(r.targets,'[]') targets,
      COALESCE(r.replace_old,0) replace_old FROM catalog c LEFT JOIN catalog_rules r ON r.sku=c.sku ORDER BY c.sku""")
    products=metadata(payload)
    active={r['sku'] for r in records if r['active']}
    rules={r['sku']:r for r in records};aliases=[];blocked=[]
    def targets(code):
        manual=json.loads(rules.get(code,{}).get('targets','[]'))
        # An explicit replacement selects its destinations; source links remain readonly history.
        if rules.get(code,{}).get('replace_old') and manual:return sorted(set(manual))
        source=products.get(code,{}).get('transfer','')
        return sorted(set(manual+([source] if source else [])))
    def leaves(code,seen):
        if code in seen or len(seen)>100:raise ValueError('售轉循環或過長')
        if code not in products:raise ValueError('替代型號查無來源：'+code)
        if code in active:return [code]
        following=targets(code)
        if not following:raise ValueError('替代型號尚未加入清單：'+code)
        return [leaf for target in following for leaf in leaves(target,seen|{code})]
    for r in records:
        if r['active'] or not r['replace_old']:continue
        try:
            following=targets(r['sku'])
            if not following:raise ValueError('尚未指定替代型號')
            final=sorted(set(leaf for t in following for leaf in leaves(t,{r['sku']})))
            aliases.append({'型號':r['sku'],'中文品名':products.get(r['sku'],{}).get('name','舊型號'), '_replacements':final})
        except ValueError as exc:
            active.add(r['sku']);blocked.append({'sku':r['sku'],'reason':str(exc)})
    if not active:raise ValueError('清單不可為空；保留上一版料檔')
    return {'revision':revision,'codes':sorted(active),'aliases':aliases,'blocked':blocked}

def main():
    ap=argparse.ArgumentParser(description='Initialize admin metadata only; never changes price bundle')
    ap.add_argument('--cache',type=Path,default=ROOT.parent.parent/'價格查詢工具/價格查詢/SEVICache.json.gz')
    args=ap.parse_args()
    with gzip.open(args.cache,'rt',encoding='utf-8') as f:payload=json.load(f)
    # Import only for the command-line entry point (publish_data imports this module).
    from publish_data import usage_report
    cloud=Cloud();status='failed';error_type=None
    try:
        sync_metadata(cloud,deployment()['database_id'],payload)
        status='completed'
    except Exception as exc:
        error_type=type(exc).__name__
        raise
    finally:
        usage_report(cloud,ROOT/'data-private/d1-usage-metadata.json',status,error_type)

if __name__=='__main__':main()
