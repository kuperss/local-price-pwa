"""Explicit deployment migration: separate costs in the current cloud bundle, preserving its data timestamp.

Does NOT refresh BI data or configure a password. Run after selftest and before deploying
the split-cost Worker; never pass a password on the command line.
"""
import base64
import json
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cloud import Cloud, ROOT, deployment
from publish_data import publish_bundle

def migrate_current_bundle(cloud,db):
    for sql in (ROOT/'worker/schema.sql').read_text(encoding='utf-8').split(';'):
        if sql.strip():cloud.query(db,sql)
    rows=cloud.query(db,"SELECT * FROM bundles WHERE version=(SELECT value FROM settings WHERE key='current_bundle')")
    if not rows:raise RuntimeError('No current bundle; publish fresh products first')
    bundle=rows[0];version=bundle['version']
    if cloud.query(db,'SELECT version FROM cost_bundles WHERE version=?',[version]):
        print('COST_MIGRATION_OK already migrated');return
    chunks=cloud.query(db,'SELECT content FROM bundle_chunks WHERE version=? ORDER BY seq',[version])
    if len(chunks)!=bundle['chunks']:raise RuntimeError('Current bundle incomplete')
    cipher=base64.b64decode(''.join(row['content'] for row in chunks))
    plain=AESGCM(base64.b64decode(bundle['key_b64'])).decrypt(base64.b64decode(bundle['iv_b64']),cipher,version.encode())
    products=json.loads(plain)
    if len(products)!=bundle['product_count']:raise RuntimeError('Current bundle count mismatch')
    catalog=cloud.query(db,'SELECT sku,resolution FROM catalog')
    resolved=[r['sku'] for r in catalog if r['resolution']=='included']
    missing=[r['sku'] for r in catalog if r['resolution']=='missing']
    publish_bundle(cloud,db,products,bundle['fetched_at'],resolved,missing)
    print('COST_MIGRATION_OK original freshness preserved; administrator must set password')

def main():
    migrate_current_bundle(Cloud(),deployment()['database_id'])

if __name__=='__main__':main()
