import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import publish_data as publisher


class ProductFieldWhitelist(unittest.TestCase):
    """共用產品快照是 BI 原始列的超集；料檔只能帶白名單欄位（2026-10-04 合併快照時加）。"""
    def test_extra_snapshot_fields_are_not_published(self):
        row={'IMA01':'X-1','IMA02':'品名','A':'90','D':'70','E':'60','F':'55','IMA133':'X-1',
             '某天新增的欄位':'機密','搭贈1':'9+1','銷售成本':'40'}
        out=publisher.product(row,{})
        self.assertEqual(out['型號'],'X-1');self.assertEqual(out['底價'],'90');self.assertEqual(out['D'],'70')
        self.assertEqual(out['搭贈'],'9+1');self.assertEqual(out['銷售成本'],'40')
        for leaked in ('E','F','IMA133','某天新增的欄位'):self.assertNotIn(leaked,out)


class OldFormatSnapshotRefused(unittest.TestCase):
    """舊格式快照（沒有搭贈／在途／條碼欄）必須在連雲端之前就被拒絕。"""
    def test_old_format_never_reaches_cloud(self):
        import gzip,json,tempfile
        from datetime import datetime
        from unittest.mock import patch
        old={'fetched_at':datetime.now().isoformat(timespec='seconds'),
             'master':{'X-1':{'IMA01':'X-1','A':'90'}},'specs':{}}
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp)/'snap.json.gz'
            with gzip.open(cache,'wt',encoding='utf-8') as f:json.dump(old,f)
            def boom(*a,**k):raise AssertionError('must not reach Cloud')
            with patch.object(publisher,'read_seed',lambda p:(['X-1'],0)),patch.object(publisher,'Cloud',boom),\
                 patch.object(sys,'argv',['publish_data.py','--cache',str(cache)]):
                with self.assertRaisesRegex(ValueError,'old format'):publisher.main()


if __name__=='__main__':unittest.main()
