"""V36 cache → approved SKU list → encrypted JSON → authenticated device downloads.

No Excel prices are imported: the workbook establishes scope only. No plaintext products
or keys are written into the public static directory. D1's current pointer advances last.
"""
import argparse
import base64
import gzip
import hashlib
import json
import os
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
import openpyxl
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cloud import Cloud, ROOT, deployment

BASE=ROOT.parent.parent/'價格查詢工具'/'價格查詢'
def clean(code):
    return str(code).strip().replace('"','').replace('\\','').replace('/','').upper()
def canonical(code):
    return unicodedata.normalize('NFKC',str(code)).strip().upper()
def utc():return datetime.now(timezone.utc).isoformat()
def read_seed(path):
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True)
    try:
        ws=wb['合併結果'] if '合併結果' in wb.sheetnames else wb.worksheets[0]
        rows=ws.iter_rows(values_only=True);headers=list(next(rows));idx=headers.index('料號')
        codes=set();invalid=0
        for row in rows:
            value=row[idx]
            if not value:continue
            code=canonical(value)
            if code.startswith(('查無','已中斷')):invalid+=1;continue
            codes.add(code)
        return sorted(codes),invalid
    finally:wb.close()

def product(row,specs):
    mapping={'IMA01':'型號','IMA02':'中文品名','IMA130':'售架','IMA140':'停產','TA_IMA107':'售轉料號','IMA021':'包裝規格(小/中/大)','A':'底價','B':'量價','C':'開盤價','IMAUD01':'備註'}
    out={mapping.get(k,k):str(v).strip() for k,v in row.items() if v is not None and str(v).strip() and k not in ['搭贈1','搭贈2','搭贈3']}
    bonus=[str(row.get(k) or '').strip() for k in ['搭贈1','搭贈2','搭贈3']]
    if any(bonus):out['搭贈']=' / '.join(v for v in bonus if v)
    for prefix,fields in [('單入尺寸(cm)',['單入長(cm)','單入寬(cm)','單入高(cm)']),('外箱尺寸(cm)',['外箱長度(cm)','外箱寬度(cm)','外箱高度(cm)'])]:
        if all(out.get(f) for f in fields):
            out[prefix]=' x '.join(out.pop(f) for f in fields)
    for k,v in specs.items():
        if v is not None and str(v).strip():out['規格_'+k]=str(v).strip()
    return out

def build(payload,codes):
    master=payload['master']; specs=payload.get('specs',{})
    raw_index={canonical(row.get('IMA01',key)):(key,row) for key,row in master.items()}
    cleaned_index={clean(key):(key,row) for key,row in master.items()}
    rows=[];missing=[];resolved=[];seen=set()
    for code in sorted(codes):
        hit=raw_index.get(canonical(code)) or cleaned_index.get(clean(code))
        if not hit:missing.append(code);continue
        key,row=hit;resolved.append(code)
        if key in seen:continue
        seen.add(key);rows.append(product(row,specs.get(key,{})))
    if not rows:raise ValueError('No approved products resolved; previous bundle retained')
    return rows,resolved,missing

def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=path.name,dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--seed',type=Path,default=BASE/'0903.xlsx');ap.add_argument('--cache',type=Path,default=BASE/'SEVICache.json.gz');ap.add_argument('--check-only',action='store_true');args=ap.parse_args()
    seeds,invalid=read_seed(args.seed)
    with gzip.open(args.cache,'rt',encoding='utf-8') as f:payload=json.load(f)
    fetched=payload['fetched_at']
    if not args.check_only and (datetime.now()-datetime.fromisoformat(fetched)).total_seconds()>24*3600:
        raise ValueError('V36 cache older than 24 hours; refusing to publish stale prices')
    if args.check_only:
        rows,resolved,missing=build(payload,seeds)
        print(json.dumps({'seed_unique':len(seeds),'invalid_source_rows':invalid,'products':len(rows),'missing':len(missing),'missing_skus':missing,'fetched_at':fetched},ensure_ascii=False));return
    cfg=deployment();cloud=Cloud();db=cfg['database_id'];stamp=utc()
    # Bootstrap once; subsequent runs use the approved catalog as the source of scope.
    seeded=cloud.query(db,"SELECT value FROM settings WHERE key='seed_initialized'")
    if not seeded:
        for start in range(0,len(seeds),25):
            batch=seeds[start:start+25];cloud.query(db,'INSERT OR IGNORE INTO catalog(sku,source,approved_at) VALUES '+','.join("(?,'seed',?)" for _ in batch),[v for code in batch for v in (code,stamp)])
        cloud.query(db,"INSERT OR IGNORE INTO settings VALUES('seed_initialized',?)",[stamp])
    codes=[r['sku'] for r in cloud.query(db,'SELECT sku FROM catalog ORDER BY sku')]
    rows,resolved,missing=build(payload,codes)
    plain=json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()
    # Include freshness in version so users can verify the latest daily check even if prices are unchanged.
    version=hashlib.sha256(fetched.encode()+b'\n'+plain).hexdigest()[:32]
    previous=cloud.query(db,"SELECT value FROM settings WHERE key='current_bundle'")
    if previous and previous[0]['value']==version:
        print(f'PRICE_PWA_OK unchanged version={version} products={len(rows)}');return
    key=AESGCM.generate_key(bit_length=256);iv=os.urandom(12);cipher=AESGCM(key).encrypt(iv,plain,version.encode())
    encoded=base64.b64encode(cipher).decode();chunks=[encoded[i:i+80000] for i in range(0,len(encoded),80000)]
    bundle={'format':'price-pwa-aes-gcm-v1','version':version,'fetchedAt':fetched,'count':len(rows),'iv':base64.b64encode(iv).decode(),'hash':hashlib.sha256(cipher).hexdigest(),'cipher':encoded}
    # This local .json intentionally contains no decryption key; keys require device authorization.
    private=ROOT/'data-private';atomic(private/'price-data.json',bundle)
    atomic(private/'publish-report.json',{'fetched_at':fetched,'products':len(rows),'approved':len(codes),'invalid_seed_rows':invalid,'missing_skus':missing})
    for i,chunk in enumerate(chunks):cloud.query(db,'INSERT OR REPLACE INTO bundle_chunks VALUES(?,?,?)',[version,i,chunk])
    cloud.query(db,'INSERT OR REPLACE INTO bundles(version,fetched_at,published_at,product_count,key_b64,iv_b64,content_hash,chunks) VALUES(?,?,?,?,?,?,?,?)',[version,fetched,stamp,len(rows),base64.b64encode(key).decode(),bundle['iv'],bundle['hash'],len(chunks)])
    for status,items in [('included',resolved),('missing',missing)]:
        for start in range(0,len(items),50):
            batch=items[start:start+50];cloud.query(db,'UPDATE catalog SET resolution=?,resolved_at=?,included_version=? WHERE sku IN ('+','.join('?' for _ in batch)+')',[status,stamp,version if status=='included' else None,*batch])
    # Publish last: interrupted upload cannot replace the last complete version.
    cloud.query(db,"INSERT INTO settings VALUES('current_bundle',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[version])
    print(f'PRICE_PWA_OK version={version} products={len(rows)} approved={len(codes)} missing={len(missing)} fetched_at={fetched}')

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(f'PRICE_PWA_ERROR {type(exc).__name__}: {exc}');raise SystemExit(1)
