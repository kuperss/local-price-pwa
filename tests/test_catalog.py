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

    def test_metadata_keyset_atomic_switch_and_targeted_cleanup(self):
        p={'fetched_at':'2026-09-17T10:00:00','master':{
            f'K{i:05}':{'IMA01':f'K{i:05}','出貨可用量':'1','A2外倉':'0'} for i in range(2305)}}
        snapshots=[];queries=[];original=self.cloud.query
        def recording(db,sql,params=None):
            queries.append((sql,params));return original(db,sql,params)
        # Force the full immutable-snapshot path; the delta path has its own tests.
        with patch.object(self.cloud,'query',recording),patch.object(catalog,'DELTA_MAX_BYTES',0):
            for day in (17,18,19):
                p['fetched_at']=f'2026-09-{day}T10:00:00'
                p['master']['K00000']['IMA02']=str(day)
                snapshots.append(catalog.sync_metadata(self.cloud,'',p))
                self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),p['fetched_at'])
            queries.clear()
            self.assertEqual(catalog.sync_metadata(self.cloud,'',p),snapshots[-1])
            self.assertFalse(any('INTO product_metadata' in sql or 'DELETE FROM product_metadata' in sql for sql,_ in queries))
        kept=self.cloud.query('', 'SELECT DISTINCT snapshot FROM product_metadata ORDER BY snapshot')
        self.assertEqual([r['snapshot'] for r in kept],sorted(snapshots[-2:]))
        # Capture one further sync to prove cursor traversal and primary-key deletion.
        queries.clear();p['fetched_at']='2026-09-20T10:00:00';p['master']['K00000']['IMA02']='20'
        with patch.object(self.cloud,'query',recording),patch.object(catalog,'DELTA_MAX_BYTES',0):
            catalog.sync_metadata(self.cloud,'',p)
        pages=[(sql,params) for sql,params in queries if 'AND sku>?' in sql]
        self.assertEqual([params[1] for _,params in pages],['','K00999','K01999'])
        self.assertTrue(all('OFFSET' not in sql for sql,_ in queries))
        self.assertTrue(all('WHERE snapshot=?' in sql for sql,_ in queries if 'DELETE FROM product_metadata' in sql))

    def test_metadata_interruption_and_competing_pointer_keep_complete_state(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p)
        old_time=catalog.setting(self.cloud,'','product_fetched_at')
        p['fetched_at']='2026-09-18T10:00:00';p['master']['NEW']['IMA02']='changed';original=self.cloud.query
        def failing(db,sql,params=None):
            if 'INTO product_metadata' in sql:raise RuntimeError('interrupted staging')
            return original(db,sql,params)
        with patch.object(self.cloud,'query',failing),self.assertRaises(RuntimeError):catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(catalog.setting(self.cloud,'','product_snapshot'),first)
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),old_time)
        def competing(db,sql,params=None):
            result=original(db,sql,params)
            if 'INTO product_metadata' in sql:
                original(db,"UPDATE settings SET value='other-complete-snapshot' WHERE key='product_snapshot'")
                original(db,"UPDATE settings SET value='other-time' WHERE key='product_fetched_at'")
            return result
        with patch.object(self.cloud,'query',competing),self.assertRaisesRegex(ValueError,'Metadata changed'):
            catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(catalog.setting(self.cloud,'','product_snapshot'),'other-complete-snapshot')
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'other-time')
        self.assertEqual(len(original('', 'SELECT sku FROM product_metadata WHERE snapshot=?',[first])),3)

    def test_identical_metadata_reuses_snapshot_but_not_expired_change_flags(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query;queries=[]
        def recording(db,sql,params=None):
            queries.append(sql);return original(db,sql,params)
        p['fetched_at']='2026-09-18T10:00:00';p['master']['NEW']['A']='999'
        with patch.object(self.cloud,'query',recording):
            self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
            self.assertFalse(any('INTO product_metadata' in sql or 'DELETE FROM product_metadata' in sql for sql in queries))
            self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),p['fetched_at'])
            queries.clear()
            self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
            self.assertFalse(any('FROM product_metadata' in sql for sql in queries))
        p['fetched_at']='2026-09-19T10:00:00';p['master']['NEW']['出貨可用量']='2'
        # Changed stock updates the live snapshot in place; freshness moves with it.
        self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
        self.assertEqual(original('',"SELECT changes FROM product_metadata WHERE snapshot=? AND sku='NEW'",[first])[0]['changes'],'新歸零')
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'2026-09-19T10:00:00')
        p['fetched_at']='2026-09-20T10:00:00'
        self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
        self.assertEqual(original('',"SELECT changes FROM product_metadata WHERE snapshot=? AND sku='NEW'",[first])[0]['changes'],'')

    def test_same_snapshot_reuse_cannot_overwrite_concurrent_freshness(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query
        p['fetched_at']='2026-09-18T10:00:00'
        def competing(db,sql,params=None):
            if 'INSERT INTO settings(key,value)' in sql:
                original(db,"UPDATE settings SET value='newer-input' WHERE key='product_metadata_input'")
                original(db,"UPDATE settings SET value='newer-time' WHERE key='product_fetched_at'")
            return original(db,sql,params)
        with patch.object(self.cloud,'query',competing),self.assertRaisesRegex(ValueError,'Metadata changed'):
            catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(catalog.setting(self.cloud,'','product_snapshot'),first)
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'newer-time')


    def _upserts(self,run):
        """Run sync_metadata, return the JSON rows each product_metadata write carried."""
        original=self.cloud.query;writes=[]
        def recording(db,sql,params=None):
            if 'INTO product_metadata' in sql:writes.append(json.loads(params[1]))
            return original(db,sql,params)
        with patch.object(self.cloud,'query',recording):result=run()
        return result,writes

    def test_delta_writes_only_changed_rows_in_one_statement(self):
        p={'fetched_at':'2026-09-17T10:00:00','master':{
            f'K{i:05}':{'IMA01':f'K{i:05}','出貨可用量':'1','A2外倉':'0'} for i in range(2305)}}
        first=catalog.sync_metadata(self.cloud,'',p)
        p['fetched_at']='2026-09-18T10:00:00'
        p['master']['K00007']['出貨可用量']='5';p['master']['K01234']['IMA02']='改名'
        p['master']['K99999']={'IMA01':'K99999','出貨可用量':'3','A2外倉':'0'}
        snap,writes=self._upserts(lambda:catalog.sync_metadata(self.cloud,'',p))
        self.assertEqual(snap,first)
        self.assertEqual(len(writes),1)
        self.assertEqual(sorted(r['sku'] for r in writes[0]),['K00007','K01234','K99999'])
        rows={r['sku']:r for r in self.cloud.query('', 'SELECT sku,shipping,name FROM product_metadata WHERE snapshot=?',[first])}
        self.assertEqual(len(rows),2306)
        self.assertEqual(rows['K00007']['shipping'],5);self.assertEqual(rows['K01234']['name'],'改名')
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'2026-09-18T10:00:00')
        self.assertEqual(catalog.setting(self.cloud,'','product_metadata_input')[:19],'2026-09-18T10:00:00')

    def test_removed_sku_deletes_only_that_row(self):
        # 2026-10-07: ERP deleted one SKU and the full path wrote 93,095 rows.
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query;queries=[]
        def recording(db,sql,params=None):
            queries.append((sql,params));return original(db,sql,params)
        p['fetched_at']='2026-09-18T10:00:00';del p['master']['UNK']
        with patch.object(self.cloud,'query',recording):second=catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(second,first)
        self.assertEqual([r['sku'] for r in original('', 'SELECT sku FROM product_metadata WHERE snapshot=? ORDER BY sku',[first])],['NEW','OLD'])
        deletes=[params for sql,params in queries if 'DELETE FROM product_metadata' in sql]
        self.assertEqual([json.loads(params[1]) for params in deletes],[['UNK']])
        # Nothing else changed, so no upsert is sent.
        self.assertFalse(any('INTO product_metadata' in sql for sql,_ in queries))
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'2026-09-18T10:00:00')

    def test_removed_source_marks_dependent_and_lost_claim_deletes_nothing(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query
        p['fetched_at']='2026-09-18T10:00:00';del p['master']['NEW']
        def competing(db,sql,params=None):
            if 'DELETE FROM product_metadata' in sql:
                original(db,"UPDATE settings SET value='other-input' WHERE key='product_metadata_input'")
            return original(db,sql,params)
        with patch.object(self.cloud,'query',competing),self.assertRaisesRegex(ValueError,'Metadata changed'):
            catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(len(original('', 'SELECT sku FROM product_metadata WHERE snapshot=?',[first])),3)
        self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
        rows={r['sku']:r for r in original('', 'SELECT sku,issue FROM product_metadata WHERE snapshot=?',[first])}
        self.assertEqual(set(rows),{'OLD','UNK'})
        self.assertEqual(rows['OLD']['issue'],'售轉料號查無來源')

    def test_interrupted_removal_recovers_with_same_change_flags(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query
        p['fetched_at']='2026-09-18T10:00:00';del p['master']['UNK'];p['master']['NEW']['出貨可用量']='2'
        def failing(db,sql,params=None):
            if 'INTO product_metadata' in sql:raise RuntimeError('network')
            return original(db,sql,params)
        with patch.object(self.cloud,'query',failing),self.assertRaises(RuntimeError):catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'2026-09-17T10:00:00')
        self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
        rows={r['sku']:r for r in original('', 'SELECT sku,changes FROM product_metadata WHERE snapshot=?',[first])}
        self.assertEqual(set(rows),{'NEW','OLD'})
        self.assertEqual(rows['NEW']['changes'],'新歸零')

    def test_oversized_delta_builds_full_snapshot(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p)
        p['fetched_at']='2026-09-19T10:00:00';p['master']['NEW']['IMA02']='x'
        with patch.object(catalog,'DELTA_MAX_BYTES',10):second=catalog.sync_metadata(self.cloud,'',p)
        self.assertNotEqual(second,first)

    def test_delta_lost_claim_writes_nothing(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query
        p['fetched_at']='2026-09-18T10:00:00';p['master']['NEW']['IMA02']='changed'
        def competing(db,sql,params=None):
            if 'INTO product_metadata' in sql:   # another publisher takes over after our claim
                original(db,"UPDATE settings SET value='other-input' WHERE key='product_metadata_input'")
            return original(db,sql,params)
        with patch.object(self.cloud,'query',competing),self.assertRaisesRegex(ValueError,'Metadata changed'):
            catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(original('',"SELECT name FROM product_metadata WHERE snapshot=? AND sku='NEW'",[first])[0]['name'],'新品')
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'2026-09-17T10:00:00')

    def test_interrupted_delta_recovers_next_run(self):
        p=payload();first=catalog.sync_metadata(self.cloud,'',p);original=self.cloud.query
        p['fetched_at']='2026-09-18T10:00:00';p['master']['NEW']['IMA02']='changed'
        def failing(db,sql,params=None):
            if 'INTO product_metadata' in sql:raise RuntimeError('network')
            return original(db,sql,params)
        with patch.object(self.cloud,'query',failing),self.assertRaises(RuntimeError):catalog.sync_metadata(self.cloud,'',p)
        self.assertEqual(original('',"SELECT name FROM product_metadata WHERE snapshot=? AND sku='NEW'",[first])[0]['name'],'新品')
        self.assertEqual(catalog.sync_metadata(self.cloud,'',p),first)
        self.assertEqual(original('',"SELECT name FROM product_metadata WHERE snapshot=? AND sku='NEW'",[first])[0]['name'],'changed')
        self.assertEqual(catalog.setting(self.cloud,'','product_fetched_at'),'2026-09-18T10:00:00')

if __name__=='__main__':unittest.main()
