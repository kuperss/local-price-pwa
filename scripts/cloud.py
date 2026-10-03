"""Cloudflare helpers. Credentials stay in the existing environment/Windows user registry."""
import json
import os
from contextlib import contextmanager, nullcontext
from functools import wraps
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent

def credential(name):
    value = os.environ.get(name)
    if not value and os.name == 'nt':
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
            value = winreg.QueryValueEx(key, name)[0]
    if not value:
        raise RuntimeError(f'Missing environment variable: {name}')
    return value

class Cloud:
    def __init__(self):
        self.account = credential('CLOUDFLARE_ACCOUNT_ID')
        self.session = requests.Session()
        self.session.headers['Authorization'] = 'Bearer ' + credential('CLOUDFLARE_API_TOKEN')
        self._usage = {}
        self._phase = 'other'

    @contextmanager
    def phase(self, name):
        previous = self._phase
        self._phase = name
        try:
            yield
        finally:
            self._phase = previous

    def usage_report(self):
        # Only provider counters, never SQL, bindings, credentials or product data.
        phases = {name: dict(values) for name, values in self._usage.items()}
        totals = {key: sum(v[key] for v in phases.values()) for key in
                  ('requests', 'statements', 'rows_read', 'rows_written', 'missing_meta', 'failed_requests')}
        return {'source': 'cloudflare_d1_response_meta',
                'complete': totals['missing_meta'] == 0 and totals['failed_requests'] == 0,
                'totals': totals, 'phases': phases}

    def api(self, path, method='GET', data=None):
        response = self.session.request(method, f'https://api.cloudflare.com/client/v4/accounts/{self.account}/{path}', json=data, timeout=90)
        result = response.json()
        if not response.ok or not result.get('success'):
            codes = [e.get('code') for e in result.get('errors', [])]
            raise RuntimeError(f'Cloudflare {method} {path.split("?")[0]}: HTTP {response.status_code}, codes={codes}')
        return result['result']

    def query(self, db, sql, params=None):
        stats = self._usage.setdefault(self._phase, dict.fromkeys(
            ('requests', 'statements', 'rows_read', 'rows_written', 'missing_meta', 'failed_requests'), 0))
        stats['requests'] += 1
        try:
            result = self.api(f'd1/database/{db}/query', 'POST', {'sql':sql,'params':params or []})
        except Exception:
            stats['failed_requests'] += 1
            raise
        for statement in result:
            stats['statements'] += 1
            meta = statement.get('meta') or {}
            if not all(isinstance(meta.get(k), (int, float)) for k in ('rows_read', 'rows_written')):
                stats['missing_meta'] += 1
            for key in ('rows_read', 'rows_written'):
                if isinstance(meta.get(key), (int, float)):
                    stats[key] += meta[key]
        if not all(r.get('success') for r in result):
            stats['failed_requests'] += 1
            raise RuntimeError('D1 query failed')
        return result[0].get('results', []) if result else []

def measured_phase(name):
    """Compatible with local/offline cloud doubles that expose query() only."""
    def decorate(function):
        @wraps(function)
        def wrapped(cloud, *args, **kwargs):
            with cloud.phase(name) if hasattr(cloud, 'phase') else nullcontext():
                return function(cloud, *args, **kwargs)
        return wrapped
    return decorate

def deployment():
    return json.loads((ROOT/'deployment.local.json').read_text(encoding='utf-8'))
