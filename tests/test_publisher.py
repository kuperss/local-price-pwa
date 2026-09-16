"""Synthetic-only publishing tests; no BI or Cloudflare access."""
import base64
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import publish_data as publisher
import migrate_costs

class LocalCloud:
    def __init__(self):
        self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
        self.db.executescript((publisher.ROOT/'worker/schema.sql').read_text(encoding='utf-8'))
        self.fail_cost_upload=False
    def query(self,db,sql,params=None):
        if self.fail_cost_upload and 'INTO cost_chunks' in sql:raise RuntimeError('Synthetic interrupted upload')
        return [dict(row) for row in self.db.execute(sql,params or [])]

class PublisherTests(unittest.TestCase):
    def test_split_encrypt_and_atomic_pointer(self):
        cloud=LocalCloud();rows=[{'型號':'TEST-01','底價':'100','銷售成本':'COST_SECRET','規格_成本':'EXTRA_SECRET'}]
        prices,costs=publisher.split_costs(rows)
        self.assertEqual(prices,[{'型號':'TEST-01','底價':'100'}])
        self.assertEqual(costs[0]['銷售成本'],'COST_SECRET')
        with tempfile.TemporaryDirectory() as temp,patch.object(publisher,'ROOT',Path(temp)):
            publisher.publish_bundle(cloud,'local',rows,'2026-09-15T09:00:00',['TEST-01'],[])
            version=cloud.query('',"SELECT value FROM settings WHERE key='current_bundle'")[0]['value']
            def decrypt(table,chunks,aad):
                b=cloud.query('',f'SELECT * FROM {table} WHERE version=?',[version])[0]
                encoded=''.join(r['content'] for r in cloud.query('',f'SELECT content FROM {chunks} WHERE version=? ORDER BY seq',[version]))
                return json.loads(AESGCM(base64.b64decode(b['key_b64'])).decrypt(base64.b64decode(b['iv_b64']),base64.b64decode(encoded),aad.encode()))
            self.assertEqual(decrypt('bundles','bundle_chunks',version),prices)
            self.assertEqual(decrypt('cost_bundles','cost_chunks','costs:'+version),costs)
            local=(Path(temp)/'data-private/price-data.json').read_text(encoding='utf-8')
            self.assertNotIn('COST_SECRET',local);self.assertNotIn('key_b64',local)
            cloud.fail_cost_upload=True
            with self.assertRaises(RuntimeError):publisher.publish_bundle(cloud,'local',rows,'2026-09-16T09:00:00',['TEST-01'],[])
            self.assertEqual(cloud.query('',"SELECT value FROM settings WHERE key='current_bundle'")[0]['value'],version)
        cloud.db.close()
    def test_normalized_lookup_preserves_prices_and_cost_before_split(self):
        payload={'master':{'TEST1':{'IMA01':'TEST/1','A':'20','B':'30','銷售成本':'10'}}}
        rows,resolved,missing=publisher.build(payload,['TEST/1','MISSING'])
        self.assertEqual(rows[0]['底價'],'20');self.assertEqual(rows[0]['銷售成本'],'10')
        self.assertEqual(resolved,['TEST/1']);self.assertEqual(missing,['MISSING'])

    def test_daily_publisher_initializes_additive_tables_and_fullwidth_costs(self):
        cloud=LocalCloud()
        cloud.query('', 'DROP TABLE cost_chunks');cloud.query('', 'DROP TABLE cost_bundles')
        rows=[{'型號':'TEST-02','底價':'0','ＣＯＳＴ':'9'}]
        with tempfile.TemporaryDirectory() as temp,patch.object(publisher,'ROOT',Path(temp)):
            publisher.publish_bundle(cloud,'local',rows,'2026-09-15T09:00:00',['TEST-02'],[])
            self.assertEqual(len(cloud.query('', 'SELECT * FROM cost_bundles')),1)
            self.assertEqual(publisher.split_costs(rows)[0],[{'型號':'TEST-02','底價':'0'}])
        cloud.db.close()

    def test_migration_preserves_original_freshness_and_is_idempotent(self):
        cloud=LocalCloud();version='legacy-test';fetched='2026-09-11T17:09:27'
        key=AESGCM.generate_key(bit_length=256);iv=b'123456789012'
        rows=[{'型號':'TEST-03','底價':'100','銷售成本':'10'}]
        cipher=AESGCM(key).encrypt(iv,json.dumps(rows).encode(),version.encode())
        encoded=lambda value:base64.b64encode(value).decode()
        cloud.query('', 'INSERT INTO bundles VALUES(?,?,?,?,?,?,?,?)',
                    [version,fetched,fetched,1,encoded(key),encoded(iv),'synthetic-hash',1])
        cloud.query('', 'INSERT INTO bundle_chunks VALUES(?,?,?)',[version,0,encoded(cipher)])
        cloud.query('', "INSERT INTO settings VALUES('current_bundle',?)",[version])
        with tempfile.TemporaryDirectory() as temp,patch.object(publisher,'ROOT',Path(temp)):
            migrate_costs.migrate_current_bundle(cloud,'local')
            current=cloud.query('', "SELECT * FROM bundles WHERE version=(SELECT value FROM settings WHERE key='current_bundle')")[0]
            self.assertNotEqual(current['version'],version);self.assertEqual(current['fetched_at'],fetched)
            self.assertEqual(len(cloud.query('', 'SELECT * FROM cost_bundles')),1)
            migrate_costs.migrate_current_bundle(cloud,'local')
            self.assertEqual(len(cloud.query('', 'SELECT * FROM bundles')),2)
        cloud.db.close()

if __name__=='__main__':unittest.main()
