"""Private usage history and read-only analytics; never executes SQL or changes a plan.

Local totals cover only recorded publisher runs, attributed by their UTC finish date.
They are NOT account totals or a billing-day ledger (a run may cross UTC midnight).
Cloud analytics is opt-in, has ingestion lag, and missing metrics are never zero.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import json
import math
import os
from pathlib import Path
import tempfile
import time
import uuid

from cloud import Cloud, ROOT, deployment

COUNTERS = ('requests', 'statements', 'rows_read', 'rows_written', 'missing_meta', 'failed_requests')
PHASES = {'other', 'bootstrap_and_membership', 'metadata_sync', 'catalog_plan', 'bundle_publish'}
DEFAULT_THRESHOLDS = (70, 85, 95)
DEFAULT_LIMITS = {'rows_read': 5_000_000, 'rows_written': 100_000}

# Account total intentionally has NO databaseId filter; selected is a separate subset.
# Date filters match the official D1 analytics schema. No dimensions means one sum,
# not a truncated per-database list. Only today's UTC date is requested.
QUERY = """query D1DailyUsage($accountTag: string!, $day: Date!, $databaseId: string!) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    accountTotal: d1AnalyticsAdaptiveGroups(limit: 1,
      filter: {date_geq: $day, date_leq: $day}) { sum { rowsRead rowsWritten } }
    selected: d1AnalyticsAdaptiveGroups(limit: 1,
      filter: {date_geq: $day, date_leq: $day, databaseId: $databaseId}) {
      sum { rowsRead rowsWritten }
    }
  } }
}"""


def utc_now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def configuration(thresholds=None, read_limit=None, write_limit=None):
    raw = thresholds if thresholds is not None else os.environ.get('D1_USAGE_THRESHOLDS', '70,85,95')
    levels = tuple(float(v) for v in raw.split(',')) if isinstance(raw, str) else tuple(raw)
    if len(levels) != 3 or not all(numeric(v) and 0 < v <= 100 for v in levels) or not levels[0] < levels[1] < levels[2]:
        raise ValueError('Expected three increasing thresholds between 0 and 100')
    limits = {'rows_read': int(read_limit or os.environ.get('D1_USAGE_READ_LIMIT', 5_000_000)),
              'rows_written': int(write_limit or os.environ.get('D1_USAGE_WRITE_LIMIT', 100_000))}
    if any(v <= 0 for v in limits.values()):
        raise ValueError('Usage limits must be positive')
    return levels, limits


def assessment(totals, thresholds=DEFAULT_THRESHOLDS, limits=None):
    limits = limits or DEFAULT_LIMITS
    result = {}
    for metric, limit in limits.items():
        value = totals.get(metric)
        percent = value / limit * 100 if numeric(value) else None
        level = 'unknown' if percent is None else 'below_threshold'
        for mark, name in zip(thresholds, ('notice', 'warning', 'critical')):
            if percent is not None and percent >= mark:
                level = name
        result[metric] = {'observed': value if numeric(value) else None, 'reference_limit': limit,
                          'percent_of_reference': round(percent, 2) if percent is not None else None,
                          'level': level}
    return result


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextmanager
def local_lock(directory):
    """OS-released lock: crash recovery needs no deletion of someone else's lock."""
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.d1-usage.lock').open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        deadline = time.monotonic() + 2
        while True:
            try:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('Local usage report lock busy')
                time.sleep(.05)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def sanitized_run(cloud, status, error_type, now):
    source = cloud.usage_report()
    totals = {key: source.get('totals', {}).get(key) for key in COUNTERS}
    complete = source.get('complete') is True and all(numeric(v) for v in totals.values())
    totals = {key: value if numeric(value) else 0 for key, value in totals.items()}
    phases = {}
    for key, stats in source.get('phases', {}).items():
        name = key if key in PHASES else 'other'
        aggregate = phases.setdefault(name, dict.fromkeys(COUNTERS, 0))
        for counter in COUNTERS:
            value = stats.get(counter)
            if numeric(value):
                aggregate[counter] += value
            else:
                complete = False
    # Stable on this Cloud instance, so retrying the finalizer replaces, never adds.
    if not hasattr(cloud, '_usage_run_id'):
        cloud._usage_run_id = uuid.uuid4().hex
    return {'schema': 1, 'source': 'cloudflare_d1_response_meta', 'run_id': cloud._usage_run_id,
            'finished_at': iso(now), 'utc_finish_date': now.astimezone(timezone.utc).date().isoformat(),
            'scope': 'observed_publisher_run_only', 'complete': complete,
            'status': status if status in ('completed', 'failed') else 'unknown',
            'error_type': error_type if error_type in ('RuntimeError', 'ValueError', 'OSError', 'TimeoutError', 'ConnectionError') else ('Error' if error_type else None),
            'totals': totals, 'phases': phases}


def aggregate_day(directory, day, thresholds=DEFAULT_THRESHOLDS, limits=None):
    """Rebuild from immutable run identities: no read-modify-increment double counts."""
    records = {}
    malformed = 0
    for path in (directory / 'usage-history' / day).glob('run-*.json'):
        try:
            report = json.loads(path.read_text(encoding='utf-8'))
            if report.get('scope') != 'observed_publisher_run_only' or report['utc_finish_date'] != day:
                raise ValueError('Unexpected report scope')
            if not all(numeric(report['totals'].get(k)) for k in COUNTERS):
                raise ValueError('Invalid counters')
            records[report['run_id']] = report
        except (OSError, ValueError, KeyError, TypeError):
            malformed += 1
    totals = {key: sum(r['totals'][key] for r in records.values()) for key in COUNTERS}
    result = {'schema': 1, 'scope': 'observed_publisher_runs_finished_on_utc_date',
              'utc_finish_date': day, 'is_account_total': False, 'is_billing_day_total': False,
              'note': 'Only local recorded runs; excludes website and other tools. Runs crossing UTC midnight are attributed to finish date.',
              'runs': len(records), 'failed_runs': sum(r['status'] == 'failed' for r in records.values()),
              'complete_for_recorded_runs': bool(records) and malformed == 0 and all(r['complete'] for r in records.values()),
              'unreadable_reports': malformed, 'totals': totals,
              'assessment': assessment(totals if records else {}, thresholds, limits)}
    atomic_json(directory / 'usage-history' / day / 'local-summary.json', result)
    return result


def print_assessment(report, prefix):
    for metric, values in report['assessment'].items():
        print(f'{prefix} scope={report["scope"]} metric={metric} '
              f'observed={values["observed"]} percent_of_reference={values["percent_of_reference"]} '
              f'level={values["level"]}', flush=True)


def record_usage(cloud, path, status, error_type=None, now=None):
    now = now or utc_now()
    path = Path(path)
    thresholds, limits = configuration()
    report = sanitized_run(cloud, status, error_type, now)
    with local_lock(path.parent):
        archive = path.parent / 'usage-history' / report['utc_finish_date'] / ('run-' + report['run_id'] + '.json')
        atomic_json(archive, report)
        atomic_json(path, report)
        summary = aggregate_day(path.parent, report['utc_finish_date'], thresholds, limits)
    print_assessment(summary, 'D1_USAGE_LOCAL')
    if not summary['complete_for_recorded_runs']:
        print('D1_USAGE_LOCAL incomplete=true; missing counters are not zero usage', flush=True)
    # Opt-in once per publisher run, never per frontend request. Failure is advisory.
    if os.environ.get('D1_USAGE_ACCOUNT_CHECK') == '1':
        try:
            monitor = cloud_daily(cloud, deployment()['database_id'], now, thresholds, limits)
            save_cloud_report(path.parent, monitor)
            print_assessment(monitor['account'], 'D1_USAGE_ACCOUNT')
        except Exception:
            print('D1_USAGE_MONITOR unavailable; publication result unchanged', flush=True)
    return report


def parse_sum(groups):
    if not isinstance(groups, list) or len(groups) != 1 or not isinstance(groups[0], dict):
        return None
    value = groups[0].get('sum')
    if not isinstance(value, dict) or not all(numeric(value.get(key)) for key in ('rowsRead', 'rowsWritten')):
        return None
    return {'rows_read': value['rowsRead'], 'rows_written': value['rowsWritten']}


def cloud_daily(cloud, database_id, now=None, thresholds=DEFAULT_THRESHOLDS, limits=None):
    """One GraphQL HTTP request, zero SQL. Never return raw provider error bodies."""
    now = (now or utc_now()).astimezone(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = {'schema': 1, 'source': 'cloudflare_graphql_d1_analytics', 'scope': 'account_and_selected_database',
              'observed_at': iso(now), 'window_start_utc': iso(start), 'requested_through_utc': iso(now),
              'next_reset_utc': iso(start + timedelta(days=1)), 'reset_taiwan': '08:00',
              'ingestion_may_lag': True, 'billing_authoritative': False, 'status': 'unavailable'}
    account, selected = None, None
    reason = 'request_failed'
    try:
        response = cloud.session.post('https://api.cloudflare.com/client/v4/graphql',
            json={'query': QUERY, 'variables': {'accountTag': cloud.account,
                  'day': start.date().isoformat(), 'databaseId': database_id}}, timeout=30)
        if not response.ok:
            reason = 'http_error'
        else:
            payload = response.json()
            if payload.get('errors'):
                reason = 'graphql_error_or_permission_denied'
            else:
                accounts = payload.get('data', {}).get('viewer', {}).get('accounts')
                if isinstance(accounts, list) and len(accounts) == 1:
                    account = parse_sum(accounts[0].get('accountTotal'))
                    selected = parse_sum(accounts[0].get('selected'))
                reason = 'no_data_or_incomplete_metrics'
    except Exception:
        # Never expose credentials/IDs, provider text or request headers in artifacts.
        reason = 'request_failed'
    for name, scope, totals in [('account', 'all_account_d1_databases', account),
                                ('selected_database', 'configured_database_only', selected)]:
        result[name] = {'scope': scope, 'totals': totals,
                        'assessment': assessment(totals or {}, thresholds, limits)}
    if account is not None and selected is not None:
        result['status'] = 'available'
    else:
        result['status'] = 'partial' if account is not None or selected is not None else 'unavailable'
        result['reason'] = reason
    return result


def save_cloud_report(directory, report):
    stamp = datetime.fromisoformat(report['observed_at']).astimezone(timezone.utc)
    with local_lock(directory):
        # Snapshots are gauges, NEVER summed together or into publisher counters.
        atomic_json(directory / 'usage-history' / stamp.date().isoformat() /
                    ('account-' + stamp.strftime('%H%M%S%f') + '-' + uuid.uuid4().hex + '.json'), report)
        atomic_json(directory / 'd1-usage-account.json', report)


def main():
    parser = argparse.ArgumentParser(description='Private D1 usage summary; --cloud is read-only analytics, no SQL')
    parser.add_argument('--cloud', action='store_true', help='Also fetch current UTC-day account and configured DB analytics')
    parser.add_argument('--thresholds', help='Notice,warning,critical percentages; default 70,85,95')
    parser.add_argument('--read-limit', type=int)
    parser.add_argument('--write-limit', type=int)
    args = parser.parse_args()
    thresholds, limits = configuration(args.thresholds, args.read_limit, args.write_limit)
    directory = ROOT / 'data-private'
    now = utc_now()
    with local_lock(directory):
        local = aggregate_day(directory, now.date().isoformat(), thresholds, limits)
    print_assessment(local, 'D1_USAGE_LOCAL')
    if args.cloud:
        try:
            report = cloud_daily(Cloud(), deployment()['database_id'], now, thresholds, limits)
        except Exception:
            print('D1_USAGE_MONITOR unavailable; check local deployment configuration and analytics token permissions')
            return 2
        save_cloud_report(directory, report)
        print_assessment(report['account'], 'D1_USAGE_ACCOUNT')
        print_assessment(report['selected_database'], 'D1_USAGE_SELECTED_DB')
        return 0 if report['status'] == 'available' else 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
