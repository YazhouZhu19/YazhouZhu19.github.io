import fnmatch
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sync_report import (capacity, collect_report, render_summary, signal_archive_info,
                         SIGNALS_LEGACY_MAX_BYTES, SIGNALS_ARCHIVE_MAX_BYTES, SIGNALS_MAX_RECORDS)


class SyncReportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.monitor = self.root / 'monitor'
        self.temp = self.root / 'temp'
        (self.monitor / 'dist').mkdir(parents=True)
        (self.monitor / 'data').mkdir()
        (self.temp / 'research-sync-diagnostics').mkdir(parents=True)
        self.write('dist/budget-report.json', {
            'schemaVersion': 1,
            'measuredAt': '2026-11-17T06:00:00Z',
            'violations': [],
        })
        self.write('data/papers.json', {
            'totalStored': 12127,
            'metadata': {
                'collectedAt': '2026-11-17T05:58:00Z',
                'lastSuccessfulSync': '2026-11-16T05:58:00Z',
                'status': 'partial',
            },
        })
        self.write('data/research-signals.json', {
            'schemaVersion': 1,
            'generatedAt': '2026-11-17T05:59:00Z',
            'records': [{'id': 'first', 'sourceId': 'source-ok', 'title': 'Not uploaded'},
                        {'id': 'second', 'sourceId': 'source-error'}],
            'sources': [{'id': 'source-' + status, 'kind': 'github', 'status': status}
                        for status in ['ok', 'error', 'partial']],
            'limitations': [],
        })
        (self.temp / 'research-sync-diagnostics/attempt').write_text('2\n')
        (self.temp / 'research-sync-diagnostics/stage').write_text('Build and enforce resource budgets\n')
        (self.temp / 'research-collect-exit').write_text('0\n')
        (self.temp / 'research-signals-exit').write_text('0\n')
        (self.temp / 'research-sync-diagnostics/signal-limits.json').write_text(json.dumps({
            'maxRecords': 10, 'maxBytes': 1000, 'legacyMaxBytes': 800,
        }))

    def write(self, path, value):
        (self.monitor / path).write_text(json.dumps(value))

    def report(self, outcome='failure'):
        return collect_report(self.monitor, self.temp, outcome)

    def sharded(self, groups=None):
        flat = json.loads((self.monitor / 'data/research-signals.json').read_text())
        if flat.get('schema') == 'research-monitor-signals-source-v1':
            metadata = flat['metadata']
        else:
            metadata = {key: value for key, value in flat.items() if key != 'records'}
        groups = groups if groups is not None else [[{'id': 'one', 'sourceId': 'source-ok'}],
                                                   [{'id': 'two', 'sourceId': 'source-error'}]]
        directory = self.monitor / 'data/research-signals'
        directory.mkdir(exist_ok=True)
        shards = []
        for records in groups:
            body = (json.dumps(records, ensure_ascii=False) + '\n').encode()
            digest = hashlib.sha256(body).hexdigest()
            relative = f'research-signals/{digest}.json'
            (self.monitor / 'data' / relative).write_bytes(body)
            shards.append({'path': relative, 'sha256': digest, 'bytes': len(body), 'count': len(records)})
        manifest = {'schema': 'research-monitor-signals-source-v1', 'metadata': metadata,
                    'totalRecords': sum(len(records) for records in groups), 'shards': shards}
        self.write('data/research-signals.json', manifest)
        return manifest

    def assert_unknown_signals(self, report):
        self.assertEqual(report['refreshOutcome'], 'failure')
        self.assertIsNone(report['signals']['count'])
        self.assertIsNone(report['signals']['bytes'])
        for metric in report['signals']['capacity'].values():
            self.assertEqual(metric['status'], 'unknown')
            self.assertIsNone(metric['remaining'])
        self.assertTrue(any('research-signals.json' in note for note in report['notes']))

    def test_completed_budget_does_not_turn_failed_refresh_into_success(self):
        report = self.report()
        self.assertEqual(report['refreshOutcome'], 'failure')
        self.assertEqual(report['budgetStatus'], 'passed')
        self.assertEqual(report['attempt'], '2')
        self.assertEqual(report['paperCollectorExit'], '0')
        self.assertEqual(report['papers']['count'], 12127)
        self.assertIn('2026-11-17T05:58:00Z', render_summary(report))
        self.assertIn('uncommitted source changes', render_summary(report))

    def test_budget_violation_is_visible_and_no_archive_records_are_in_diagnostics(self):
        self.write('dist/budget-report.json', {
            'schemaVersion': 1,
            'measuredAt': '2026-11-17T06:00:00Z',
            'violations': ['data:papers: rawBytes 107776134 exceeds 86858913'],
        })
        report = self.report()
        self.assertEqual(report['budgetStatus'], 'failed')
        self.assertIn('rawBytes 107776134 exceeds 86858913', render_summary(report))
        self.assertNotIn('Not uploaded', json.dumps(report))
        self.assertNotIn('first', json.dumps(report))

    def test_failure_before_build_reports_missing_measurement_as_incomplete(self):
        (self.monitor / 'dist/budget-report.json').unlink()
        (self.temp / 'research-collect-exit').unlink()
        report = self.report()
        self.assertEqual(report['budgetStatus'], 'not completed')
        self.assertEqual(report['paperCollectorExit'], 'not completed')
        self.assertIn('Not completed: no valid budget result', render_summary(report))
        self.assertNotIn('No resource budget violations', render_summary(report))

    def test_invalid_budget_is_not_a_pass(self):
        for value in [[], {}, {'violations': []}, {'schemaVersion': 1, 'measuredAt': 'now', 'violations': [2]}]:
            self.write('dist/budget-report.json', value)
            self.assertEqual(self.report()['budgetStatus'], 'not completed')
        (self.monitor / 'dist/budget-report.json').write_text('{broken')
        report = self.report()
        self.assertEqual(report['budgetStatus'], 'not completed')
        self.assertTrue(any('invalid report' in note for note in report['notes']))

    def test_partial_source_status_and_capacity_remain_visible(self):
        report = self.report('success')
        self.assertEqual(report['signals']['count'], 2)
        self.assertEqual(report['signals']['bytes'], (self.monitor / 'data/research-signals.json').stat().st_size)
        self.assertEqual(report['signals']['sourceStatuses'], {'error': 1, 'ok': 1, 'partial': 1})
        self.assertIn('2026-11-17T05:59:00Z', render_summary(report))
        self.assertIn('source bytes', render_summary(report))
        self.assertEqual(report['signals']['capacity']['records']['remaining'], 8)

    def test_sharded_totals_measure_manifest_and_all_active_shards_and_keep_metadata(self):
        manifest = self.sharded()
        # Unreferenced immutable generations are not part of active capacity.
        (self.monitor / 'data/research-signals/unreferenced.json').write_text('not active')
        report = self.report()
        expected_bytes = ((self.monitor / 'data/research-signals.json').stat().st_size
                          + sum(shard['bytes'] for shard in manifest['shards']))
        self.assertEqual(report['signals']['format'], 'sharded')
        self.assertEqual(report['signals']['count'], 2)
        self.assertEqual(report['signals']['bytes'], expected_bytes)
        self.assertEqual(report['signals']['generatedAt'], manifest['metadata']['generatedAt'])
        self.assertEqual(report['signals']['sourceStatuses'], {'error': 1, 'ok': 1, 'partial': 1})
        self.assertEqual(report['signals']['capacity']['bytes']['limit'], 1000)
        self.assertEqual(report['refreshOutcome'], 'failure')
        self.assertNotIn('sourceId', json.dumps(report))

    def test_missing_size_changed_and_checksum_corrupt_shards_report_unknown(self):
        for change in ['missing', 'size', 'checksum']:
            with self.subTest(change=change):
                manifest = self.sharded()
                path = self.monitor / 'data' / manifest['shards'][0]['path']
                if change == 'missing':
                    path.unlink()
                elif change == 'size':
                    path.write_bytes(path.read_bytes() + b' ')
                else:
                    path.write_bytes(path.read_bytes().replace(b'one', b'bad'))
                report = self.report()
                self.assert_unknown_signals(report)
                self.assertEqual(report['signals']['format'], 'sharded')
                self.assertEqual(report['signals']['sourceStatuses']['error'], 1)

    def test_unsafe_and_duplicate_paths_are_rejected_without_reading_shards(self):
        for change in ['traversal', 'absolute', 'duplicate']:
            with self.subTest(change=change):
                manifest = self.sharded()
                if change == 'duplicate':
                    manifest['shards'][1] = dict(manifest['shards'][0])
                else:
                    manifest['shards'][0]['path'] = '../unsafe.json' if change == 'traversal' else '/tmp/unsafe.json'
                self.write('data/research-signals.json', manifest)
                with patch('sync_report.read_regular_bytes') as reader:
                    notes = []
                    _, count, size, _ = signal_archive_info(self.monitor / 'data/research-signals.json', manifest, notes)
                    self.assertIsNone(count)
                    self.assertIsNone(size)
                    reader.assert_not_called()
                self.assert_unknown_signals(self.report())

    def test_manifest_shard_and_shard_directory_symlinks_are_not_followed(self):
        manifest = self.sharded()
        shard = self.monitor / 'data' / manifest['shards'][0]['path']
        target = self.root / 'real-shard.json'
        shard.rename(target)
        shard.symlink_to(target)
        self.assert_unknown_signals(self.report())
        shard.unlink()
        target.rename(shard)
        directory = self.monitor / 'data/research-signals'
        # Even a link to another directory inside data is disallowed.
        sibling = self.monitor / 'data/other-shards'
        directory.rename(sibling)
        directory.symlink_to(sibling, target_is_directory=True)
        self.assert_unknown_signals(self.report())
        directory.unlink()
        sibling.rename(directory)
        source = self.monitor / 'data/research-signals.json'
        destination = self.root / 'manifest.json'
        source.rename(destination)
        source.symlink_to(destination)
        self.assert_unknown_signals(self.report())

    def test_duplicate_record_ids_with_valid_checksums_and_unknown_sources_report_unknown(self):
        for groups in [
            [[{'id': 'same', 'sourceId': 'source-ok'}], [{'id': 'same', 'sourceId': 'source-error'}]],
            [[{'id': 'same', 'sourceId': 'source-ok'}, {'id': 'same', 'sourceId': 'source-ok'}]],
            [[{'id': 'one', 'sourceId': 'missing'}]],
            [[{'sourceId': 'source-ok'}]],
        ]:
            with self.subTest(groups=groups):
                self.sharded(groups)
                self.assert_unknown_signals(self.report())

    def test_valid_checksum_cannot_hide_invalid_json_row_types_or_actual_count(self):
        for body, count in [(b'{broken', 1), (b'{}', 1), (b'[false]', 1),
                            (b'[{"id":"one","sourceId":"source-ok"}]', 2)]:
            manifest = self.sharded()
            digest = hashlib.sha256(body).hexdigest()
            relative = f'research-signals/{digest}.json'
            (self.monitor / 'data' / relative).write_bytes(body)
            manifest['totalRecords'] = count
            manifest['shards'] = [{'path': relative, 'sha256': digest, 'bytes': len(body), 'count': count}]
            self.write('data/research-signals.json', manifest)
            self.assert_unknown_signals(self.report())

    def test_invalid_metadata_and_declared_counts_report_unknown(self):
        for change in ['metadata', 'sources', 'total', 'fraction', 'boolean', 'overflow', 'records-in-metadata']:
            with self.subTest(change=change):
                manifest = self.sharded()
                if change == 'metadata':
                    manifest['metadata'] = []
                elif change == 'sources':
                    manifest['metadata']['sources'].append(dict(manifest['metadata']['sources'][0]))
                elif change == 'records-in-metadata':
                    manifest['metadata']['records'] = []
                else:
                    manifest['totalRecords'] = {'total': 3, 'fraction': 1.5, 'boolean': True, 'overflow': 250001}[change]
                self.write('data/research-signals.json', manifest)
                self.assert_unknown_signals(self.report())
                # Restore valid metadata for the next case.
                self.write('data/research-signals.json', {
                    'schemaVersion': 1, 'generatedAt': '2026-11-17T05:59:00Z', 'limitations': [],
                    'sources': [{'id': 'source-ok', 'kind': 'github', 'status': 'ok'},
                                {'id': 'source-error', 'kind': 'github', 'status': 'error'}], 'records': [],
                })

    def test_source_aggregate_counts_and_size_preflight_happen_before_any_shard_read(self):
        for change in ['count', 'size']:
            manifest = self.sharded()
            if change == 'count':
                manifest['shards'][0]['count'] = 250001
            else:
                manifest['totalRecords'] = 64
                manifest['shards'] = [dict(manifest['shards'][0], sha256=f'{index:064x}',
                                          path=f'research-signals/{index:064x}.json',
                                          bytes=4 * 1024 * 1024, count=1) for index in range(64)]
            self.write('data/research-signals.json', manifest)
            with patch('sync_report.read_regular_bytes') as reader:
                notes = []
                _, count, size, _ = signal_archive_info(self.monitor / 'data/research-signals.json', manifest, notes)
                self.assertIsNone(count)
                self.assertIsNone(size)
                reader.assert_not_called()
                self.assertTrue(notes)

    def test_source_aggregate_size_exact_boundary_includes_manifest(self):
        manifest = self.sharded()
        total = ((self.monitor / 'data/research-signals.json').stat().st_size
                 + sum(shard['bytes'] for shard in manifest['shards']))
        with patch('sync_report.SIGNALS_ARCHIVE_MAX_BYTES', total):
            self.assertEqual(self.report()['signals']['bytes'], total)
        with patch('sync_report.SIGNALS_ARCHIVE_MAX_BYTES', total - 1):
            self.assert_unknown_signals(self.report())

    def test_legacy_capacity_uses_96_mib_and_never_falls_back_to_sharded_limit(self):
        self.assertEqual(SIGNALS_LEGACY_MAX_BYTES, 96 * 1024 * 1024)
        self.assertEqual(SIGNALS_ARCHIVE_MAX_BYTES, 256 * 1024 * 1024)
        self.assertEqual(SIGNALS_MAX_RECORDS, 250000)
        limits = self.temp / 'research-sync-diagnostics/signal-limits.json'
        limits.write_text(json.dumps({'maxRecords': SIGNALS_MAX_RECORDS,
                                      'maxBytes': SIGNALS_ARCHIVE_MAX_BYTES,
                                      'legacyMaxBytes': SIGNALS_LEGACY_MAX_BYTES}))
        report = self.report()
        self.assertEqual(report['signals']['format'], 'flat')
        self.assertEqual(report['signals']['capacity']['bytes']['limit'], SIGNALS_LEGACY_MAX_BYTES)
        for value in [None, True, -1]:
            values = {'maxRecords': SIGNALS_MAX_RECORDS, 'maxBytes': SIGNALS_ARCHIVE_MAX_BYTES}
            if value is not None:
                values['legacyMaxBytes'] = value
            limits.write_text(json.dumps(values))
            self.assertEqual(self.report()['signals']['capacity']['bytes']['status'], 'unknown')

    def test_legacy_byte_limit_is_checked_before_reading_and_duplicate_ids_are_unknown(self):
        path = self.monitor / 'data/research-signals.json'
        size = path.stat().st_size
        with patch('sync_report.SIGNALS_LEGACY_MAX_BYTES', size):
            self.assertEqual(self.report()['signals']['bytes'], size)
        with patch('sync_report.SIGNALS_LEGACY_MAX_BYTES', size - 1):
            self.assert_unknown_signals(self.report())
        data = json.loads(path.read_text())
        data['records'].append(dict(data['records'][0]))
        self.write('data/research-signals.json', data)
        self.assert_unknown_signals(self.report())

    def test_real_hard_limits_warn_at_80_percent_and_keep_negative_remaining(self):
        monitor = Path(__file__).resolve().parents[1]
        limits = json.loads(subprocess.check_output([
            'node', '--import', 'tsx', '--input-type=module', '-e',
            'import { SIGNALS_MAX_RECORDS, SIGNALS_MAX_BYTES, SIGNALS_ARCHIVE_MAX_BYTES } from "./lib/research-signals.ts"; console.log(JSON.stringify([SIGNALS_MAX_RECORDS, SIGNALS_MAX_BYTES, SIGNALS_ARCHIVE_MAX_BYTES]));',
        ], cwd=monitor, text=True))
        self.assertEqual(limits, [SIGNALS_MAX_RECORDS, SIGNALS_LEGACY_MAX_BYTES, SIGNALS_ARCHIVE_MAX_BYTES])
        for limit in limits:
            boundary = (limit * 4 + 4) // 5
            self.assertEqual(capacity(boundary - 1, limit)['status'], 'within capacity')
            self.assertEqual(capacity(boundary, limit)['status'], 'warning')
            self.assertEqual(capacity(limit, limit)['remaining'], 0)
            exceeded = capacity(limit + 1, limit)
            self.assertEqual(exceeded['remaining'], -1)
            self.assertEqual(exceeded['status'], 'warning')
        report = self.report()
        report['signals']['capacity']['records'] = capacity(limits[0] + 1, limits[0])
        self.assertIn('| -1 |', render_summary(report))
        self.assertIn('**Capacity warning:', render_summary(report))

    def test_missing_or_invalid_limits_are_explicitly_unknown(self):
        path = self.temp / 'research-sync-diagnostics/signal-limits.json'
        path.unlink()
        report = self.report()
        self.assertEqual(report['signals']['capacity']['records']['status'], 'unknown')
        self.assertIn('| unknown | unknown | unknown | unknown |', render_summary(report))
        for value in [{'maxRecords': True, 'maxBytes': 20}, {'maxRecords': -1, 'maxBytes': 20}, {}]:
            path.write_text(json.dumps(value))
            report = self.report()
            self.assertEqual(report['signals']['capacity']['records']['status'], 'unknown')

    def test_flat_paper_snapshot_and_missing_source_files_are_diagnostic_only(self):
        self.write('data/papers.json', {'totalStored': 3, 'collectedAt': 'old', 'status': 'error'})
        self.assertEqual(self.report()['papers']['collectedAt'], 'old')
        (self.monitor / 'data/research-signals.json').unlink()
        report = self.report()
        self.assertIsNone(report['signals']['count'])
        self.assertTrue(any('research-signals.json' in note for note in report['notes']))

    def test_markup_in_violation_does_not_break_summary_table(self):
        report = self.report()
        report['budgetViolations'] = ['a|b\n`injected`']
        report['budgetStatus'] = 'failed'
        self.assertIn("`a\\|b 'injected'`", render_summary(report))


class SyncWorkflowPolicyTests(unittest.TestCase):
    def test_trigger_scope_and_diagnostic_upload(self):
        root = Path(__file__).resolve().parents[3]
        text = (root / '.github/workflows/research-monitor-sync.yml').read_text()
        paths_block = text.split('    paths:\n', 1)[1].split('\n\n', 1)[0]
        paths = re.findall(r"      - '([^']+)'", paths_block)
        for path in ['styles/news-events.css', 'components/news-events.tsx', 'docs/UI.md']:
            self.assertFalse(any(fnmatch.fnmatch('tools/research-monitor/' + path, pattern) for pattern in paths))
        for path in ['lib/collect-signals.ts', 'scripts/collect.ts', 'data/papers.json', 'package-lock.json', 'budget.json']:
            self.assertTrue(any(fnmatch.fnmatch('tools/research-monitor/' + path, pattern) for pattern in paths))
        self.assertIn("cron: '23 * * * *'", text)
        self.assertIn('  workflow_dispatch:', text)
        self.assertNotIn('continue-on-error:', text)
        self.assertIn('name: Summarize sync diagnostics\n        if: always()', text)
        self.assertIn('name: Retain sync diagnostics\n        if: always()', text)
        upload = text.split('      - name: Retain sync diagnostics', 1)[1]
        self.assertRegex(upload, r'actions/upload-artifact@[a-f0-9]{40}')
        self.assertIn('research-sync-diagnostics/summary.json', upload)
        self.assertIn('dist/budget-report.json', upload)
        self.assertNotIn('/data/', upload)
        self.assertNotIn('**', upload)


if __name__ == '__main__':
    unittest.main()
