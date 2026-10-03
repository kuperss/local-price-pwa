"""Offline provider-meta accounting, without credentials or network access."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from cloud import Cloud, measured_phase
from publish_data import usage_report

class CloudUsageTests(unittest.TestCase):
    def cloud(self):
        cloud=Cloud.__new__(Cloud)
        cloud._usage={};cloud._phase='other'
        return cloud

    def test_phase_totals_include_all_statements_without_sensitive_values(self):
        cloud=self.cloud()
        result=[{'success':True,'results':[{'value':'SECRET'}],'meta':{'rows_read':12,'rows_written':2}},
                {'success':True,'results':[],'meta':{'rows_read':3,'rows_written':1}}]
        with patch.object(cloud,'api',return_value=result):
            with cloud.phase('metadata_sync'):
                self.assertEqual(cloud.query('secret-db','SECRET SQL',['SECRET']),[{'value':'SECRET'}])
                with cloud.phase('nested'):cloud.query('secret-db','SECRET SQL')
            cloud.query('secret-db','SECRET SQL')
        report=cloud.usage_report()
        self.assertEqual(report['totals']['rows_read'],45)
        self.assertEqual(report['totals']['rows_written'],9)
        self.assertEqual(report['totals']['statements'],6)
        self.assertEqual(report['phases']['metadata_sync']['requests'],1)
        self.assertNotIn('SECRET',json.dumps(report))
        self.assertNotIn('secret-db',json.dumps(report))

    def test_missing_counters_and_failures_are_not_claimed_as_measured_zero(self):
        cloud=self.cloud()
        with patch.object(cloud,'api',return_value=[{'success':True}]):cloud.query('','SELECT')
        with patch.object(cloud,'api',side_effect=RuntimeError('SECRET provider text')):
            with self.assertRaises(RuntimeError):cloud.query('','SELECT')
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/'private/usage.json'
            usage_report(cloud,target,'failed','RuntimeError')
            report=json.loads(target.read_text(encoding='utf-8'))
        self.assertEqual(report['totals']['missing_meta'],1)
        self.assertEqual(report['totals']['failed_requests'],1)
        self.assertEqual(report['status'],'failed')
        self.assertNotIn('SECRET',json.dumps(report))

    def test_decorator_supports_query_only_offline_double(self):
        @measured_phase('metadata_sync')
        def work(cloud):return 123
        self.assertEqual(work(object()),123)

if __name__=='__main__':unittest.main()
