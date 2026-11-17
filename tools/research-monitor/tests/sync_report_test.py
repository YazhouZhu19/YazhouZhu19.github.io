import fnmatch
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sync_report import capacity, collect_report, render_summary


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
            'generatedAt': '2026-11-17T05:59:00Z',
            'records': [{'id': 'first', 'title': 'Not uploaded'}, {'id': 'second'}],
            'sources': [{'status': 'ok'}, {'status': 'error'}, {'status': 'partial'}],
        })
        (self.temp / 'research-sync-diagnostics/attempt').write_text('2\n')
        (self.temp / 'research-sync-diagnostics/stage').write_text('Build and enforce resource budgets\n')
        (self.temp / 'research-collect-exit').write_text('0\n')
        (self.temp / 'research-signals-exit').write_text('0\n')
        (self.temp / 'research-sync-diagnostics/signal-limits.json').write_text(json.dumps({
            'maxRecords': 10, 'maxBytes': 1000,
        }))

    def write(self, path, value):
        (self.monitor / path).write_text(json.dumps(value))

    def report(self, outcome='failure'):
        return collect_report(self.monitor, self.temp, outcome)

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

    def test_real_hard_limits_warn_at_80_percent_and_keep_negative_remaining(self):
        monitor = Path(__file__).resolve().parents[1]
        limits = json.loads(subprocess.check_output([
            'node', '--import', 'tsx', '--input-type=module', '-e',
            'import { SIGNALS_MAX_RECORDS, SIGNALS_MAX_BYTES } from "./lib/research-signals.ts"; console.log(JSON.stringify([SIGNALS_MAX_RECORDS, SIGNALS_MAX_BYTES]));',
        ], cwd=monitor, text=True))
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
