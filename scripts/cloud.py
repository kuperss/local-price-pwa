"""Cloudflare helpers. Credentials stay in the existing environment/Windows user registry."""
import json
import os
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

    def api(self, path, method='GET', data=None):
        response = self.session.request(method, f'https://api.cloudflare.com/client/v4/accounts/{self.account}/{path}', json=data, timeout=90)
        result = response.json()
        if not response.ok or not result.get('success'):
            codes = [e.get('code') for e in result.get('errors', [])]
            raise RuntimeError(f'Cloudflare {method} {path.split("?")[0]}: HTTP {response.status_code}, codes={codes}')
        return result['result']

    def query(self, db, sql, params=None):
        result = self.api(f'd1/database/{db}/query', 'POST', {'sql':sql,'params':params or []})
        if not all(r.get('success') for r in result):
            raise RuntimeError('D1 query failed')
        return result[0].get('results', []) if result else []

def deployment():
    return json.loads((ROOT/'deployment.local.json').read_text(encoding='utf-8'))
