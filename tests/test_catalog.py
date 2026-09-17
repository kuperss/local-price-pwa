import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import catalog_sync as catalog
import publish_data as publisher
from test_publisher import LocalCloud

def payload():
    return {'fetched_at':'2026-09-17T10:00:00','master':{
        'OLD':{'IMA01':'OLD','IMA02':'旧品','出貨可用量':'0','A2外倉':'0','TA_IMA107':'NEW','IMA130':'Y','銷售成本':'PRIVATE'},
        'NEW':{'IMA01':'NEW','IMA02':'新品','出貨可用量':'1,000','A2外倉':'-2','A':'100'},
        'UNK':{'IMA01':'UNK','出貨可用量':'0','A2外倉':''}}}

class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.cloud=LocalCloud();catalog.setup(self.cloud,'local')
        for code in ['OLD','NEW']:
            self.cloud.query('',"INSERT INTO catalog(sku,source,approved_at) VALUES(?,'seed','stamp')",[code])
    def tearDown(self):self.cloud.db.close()
    def test_whitelist_stock_changes_and_snapshot_idempotency(self):
        p=payload();rows=catalog.metadata(p)
        self.assertEqual(rows['NEW']['available'],998);self.assertIsNone(rows['UNK']['available'])
        self.assertNotIn('PRIVATE',json.dumps(rows));self.assertEqual(rows['OLD']['changes'],'')
        catalog.sync_metadata(self.cloud,'',p)
        p['master']['NEW']['出貨可用量']='2';p['fetched_at']='2026-09-18T10:00:00'
        snap=catalog.sync_metadata(self.cloud,'',p)
        changed=self.cloud.query('',"SELECT changes FROM product_metadata WHERE snapshot=? AND sku='NEW'",[snap])[0]
        self.assertEqual(changed['changes'],'新歸零')
        self.assertEqual(catalog.sync_metadata(self.cloud,'',p),snap)
        self.assertEqual(catalog.number('-3'),-3);self.assertIsNone(catalog.number('nan'));self.assertIsNone(catalog.number('--'))
    def test_replacement_zero_price_alias_and_fallback(self):
        p=payload();self.cloud.query('',"INSERT INTO catalog_rules VALUES('OLD',0,'','[]',1,'stamp','owner')")
        plan=catalog.plan(self.cloud,'',p)
        self.assertEqual(plan['codes'],['NEW']);self.assertEqual(plan['aliases'][0]['_replacements'],['NEW'])
        self.assertEqual(set(plan['aliases'][0]),{'型號','中文品名','_replacements'})
        del p['master']['NEW'];plan=catalog.plan(self.cloud,'',p)
        self.assertIn('OLD',plan['codes']);self.assertEqual(plan['aliases'],[]);self.assertEqual(len(plan['blocked']),1)
    def test_atomic_publication_and_revision_race(self):
        catalog.sync_metadata(self.cloud,'',payload())
        plan=catalog.plan(self.cloud,'',payload());rows,resolved,missing=publisher.build(payload(),plan['codes'])
        with tempfile.TemporaryDirectory() as tmp,patch.object(publisher,'ROOT',Path(tmp)):
            publisher.publish_bundle(self.cloud,'',rows,payload()['fetched_at'],resolved,missing,catalog_plan=plan)
            before=catalog.setting(self.cloud,'','current_bundle')
            self.assertEqual(len(self.cloud.query('', 'SELECT * FROM catalog_members WHERE version=?',[before])),2)
            publisher.publish_bundle(self.cloud,'',rows,payload()['fetched_at'],resolved,missing,catalog_plan=plan)
            self.assertEqual(catalog.setting(self.cloud,'','current_bundle'),before)
            self.cloud.query('',"UPDATE settings SET value='changed' WHERE key='catalog_revision'")
            with self.assertRaisesRegex(ValueError,'Catalog changed'):
                publisher.publish_bundle(self.cloud,'',rows,'2026-09-18T10:00:00',resolved,missing,catalog_plan=plan)
            self.assertEqual(catalog.setting(self.cloud,'','current_bundle'),before)
    def test_source_cycles_and_manual_one_to_many(self):
        p=payload();p['master']['NEW']['TA_IMA107']='OLD'
        self.assertEqual(catalog.metadata(p)['OLD']['issue'],'售轉循環')
        self.cloud.query('',"INSERT INTO catalog_rules VALUES('OLD',0,'','[\"NEW\",\"UNK\"]',1,'stamp','owner')")
        plan=catalog.plan(self.cloud,'',p);self.assertEqual(len(plan['blocked']),1)
        self.cloud.query('',"INSERT INTO catalog(sku,source,approved_at) VALUES('UNK','admin','stamp')")
        plan=catalog.plan(self.cloud,'',p);self.assertEqual(plan['aliases'][0]['_replacements'],['NEW','UNK'])

    def test_replacement_publish_keeps_old_membership_until_complete(self):
        self.cloud.query('',"INSERT INTO settings VALUES('current_bundle','previous')")
        self.cloud.query('',"INSERT INTO catalog_members VALUES('previous','OLD')")
        self.cloud.query('',"INSERT INTO catalog_rules VALUES('OLD',0,'','[]',1,'stamp','owner')")
        plan=catalog.plan(self.cloud,'',payload())
        rows,resolved,missing=publisher.build(payload(),plan['codes']);rows.extend(plan['aliases'])
        with tempfile.TemporaryDirectory() as tmp,patch.object(publisher,'ROOT',Path(tmp)):
            self.cloud.fail_cost_upload=True
            with self.assertRaises(RuntimeError):publisher.publish_bundle(self.cloud,'',rows,payload()['fetched_at'],resolved,missing,catalog_plan=plan)
            self.assertEqual(catalog.setting(self.cloud,'','current_bundle'),'previous')
            self.cloud.fail_cost_upload=False
            publisher.publish_bundle(self.cloud,'',rows,payload()['fetched_at'],resolved,missing,catalog_plan=plan)
            current=catalog.setting(self.cloud,'','current_bundle')
            self.assertEqual(self.cloud.query('', 'SELECT sku FROM catalog_members WHERE version=?',[current]),[{'sku':'NEW'}])
            bundle=self.cloud.query('', 'SELECT product_count FROM bundles WHERE version=?',[current])[0]
            self.assertEqual(bundle['product_count'],1)

    def test_competing_publisher_cannot_replace_newer_pointer(self):
        plan=catalog.plan(self.cloud,'',payload());rows,resolved,missing=publisher.build(payload(),plan['codes'])
        original=self.cloud.query
        def competing(db,sql,params=None):
            result=original(db,sql,params)
            if 'INTO cost_bundles' in sql:
                original(db,"INSERT INTO settings VALUES('current_bundle','other-complete-version') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            return result
        with tempfile.TemporaryDirectory() as tmp,patch.object(publisher,'ROOT',Path(tmp)),patch.object(self.cloud,'query',competing):
            with self.assertRaisesRegex(ValueError,'previous bundle retained'):
                publisher.publish_bundle(self.cloud,'',rows,payload()['fetched_at'],resolved,missing,catalog_plan=plan)
        self.assertEqual(catalog.setting(self.cloud,'','current_bundle'),'other-complete-version')

    def test_explicit_replacement_does_not_force_unselected_erp_target(self):
        p=payload();p['master']['OLD']['TA_IMA107']='UNKNOWN-ERP-TARGET'
        self.cloud.query('',"INSERT INTO catalog_rules VALUES('OLD',0,'','[\"NEW\"]',1,'stamp','owner')")
        plan=catalog.plan(self.cloud,'',p)
        self.assertEqual(plan['blocked'],[])
        self.assertEqual(plan['aliases'][0]['_replacements'],['NEW'])
        self.assertEqual(p['master']['OLD']['TA_IMA107'],'UNKNOWN-ERP-TARGET')


if __name__=='__main__':unittest.main()
