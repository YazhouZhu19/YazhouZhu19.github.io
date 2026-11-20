import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from signals_checks import (COMMON, EXTRA, DICTIONARY, OPTIONAL, SIGNALS_MAX_RECORDS,
                            SIGNALS_ARCHIVE_MAX_BYTES, verify_signals_snapshot)


def fixture(records):
    columns = COMMON + EXTRA['github']
    dictionaries = {key: [] for key in columns if key in DICTIONARY}
    rows = []
    for record in records:
        row = []
        for name in columns:
            if name in OPTIONAL and name not in record:
                row.append(-1)
            elif name in DICTIONARY:
                row.append(len(dictionaries[name]))
                dictionaries[name].append(record.get(name))
            else:
                row.append(record.get(name))
        rows.append(row)
    body = json.dumps({'columns': columns, 'dictionaries': dictionaries, 'rows': rows}, ensure_ascii=False).encode()
    digest = hashlib.sha256(body).hexdigest()
    manifest = {'schema': 'research-monitor-signals-v2', 'schemaVersion': 2, 'generatedAt': '2026-10-21T00:00:00Z',
                'sources': [{'id': 'github-public', 'kind': 'github'}], 'limitations': [],
                'counts': {'github': len(records), 'news': 0},
                'shards': [{'kind': 'github', 'bucket': '2026-10', 'path': f'shards/{digest}.json',
                            'sha256': digest, 'bytes': len(body), 'count': len(records)}]}
    return manifest, body


class SignalsSnapshotChecksTest(unittest.TestCase):
    def record(self, paper_id='github:lab/one'):
        return {key: None for key in COMMON + EXTRA['github'] if key not in OPTIONAL} | {
            'id': paper_id, 'kind': 'github', 'sourceId': 'github-public', 'title': '医学影像',
            'topics': ['MRI'], 'stars': 2, 'forks': 0,
        }

    def test_complete_lossless_records_and_optional_presence(self):
        records = [self.record(), self.record('github:lab/two') | {'discoveryGroups': [], 'relevance': None}]
        manifest, body = fixture(records)
        decoded = verify_signals_snapshot(json.dumps(manifest).encode(), lambda _: body, return_data=True)
        self.assertEqual(decoded['records'], records)
        self.assertEqual(verify_signals_snapshot(json.dumps(manifest).encode(), lambda _: body), {'github': 2, 'news': 0})

    def test_corruption_counts_paths_and_duplicate_ids_fail(self):
        manifest, body = fixture([self.record()])
        for patch in [{'path': '../unsafe'}, {'bytes': len(body) + 1}, {'count': 2}, {'kind': 'news'}]:
            changed = {**manifest, 'shards': [{**manifest['shards'][0], **patch}]}
            with self.assertRaises(ValueError):
                verify_signals_snapshot(json.dumps(changed).encode(), lambda _: body)
        with self.assertRaises(ValueError):
            verify_signals_snapshot(json.dumps(manifest).encode(), lambda _: body.replace(b'one', b'bad'))
        duplicate, duplicate_body = fixture([self.record(), self.record()])
        with self.assertRaises(ValueError):
            verify_signals_snapshot(json.dumps(duplicate).encode(), lambda _: duplicate_body)

    def test_metadata_and_discovery_state_survive_reconstruction(self):
        manifest, body = fixture([self.record()])
        manifest['limitations'] = ['Public metadata is not research validation']
        manifest['discoveryState'] = {'github': {'cursor': 2}}
        result = verify_signals_snapshot(json.dumps(manifest).encode(), lambda _: body, return_data=True)
        for key in ['generatedAt', 'sources', 'limitations', 'discoveryState']:
            self.assertEqual(result[key], manifest[key])

    def test_record_limit_and_descriptor_totals_are_checked_before_any_shard_read(self):
        self.assertEqual(SIGNALS_MAX_RECORDS, 250000)
        manifest, _ = fixture([self.record()])
        manifest['counts']['github'] = SIGNALS_MAX_RECORDS
        manifest['shards'][0]['count'] = SIGNALS_MAX_RECORDS
        reader = Mock(side_effect=FileNotFoundError('boundary accepted, no actual giant fixture'))
        with self.assertRaises(FileNotFoundError):
            verify_signals_snapshot(json.dumps(manifest).encode(), reader)
        reader.assert_called_once()
        for declared, described in [(250001, 250001), (1, 250000), (250000, 250001), (0, 1)]:
            manifest['counts']['github'] = declared
            manifest['shards'][0]['count'] = described
            reader.reset_mock()
            with self.assertRaises(ValueError):
                verify_signals_snapshot(json.dumps(manifest).encode(), reader)
            reader.assert_not_called()

    def test_aggregate_limit_includes_manifest_and_rejects_before_reading(self):
        self.assertEqual(SIGNALS_ARCHIVE_MAX_BYTES, 256 * 1024 * 1024)
        manifest, body = fixture([self.record()])
        encoded = json.dumps(manifest).encode()
        total = len(encoded) + len(body)
        reader = Mock(return_value=body)
        with patch('signals_checks.SIGNALS_ARCHIVE_MAX_BYTES', total):
            self.assertEqual(verify_signals_snapshot(encoded, reader), {'github': 1, 'news': 0})
        reader.reset_mock()
        with patch('signals_checks.SIGNALS_ARCHIVE_MAX_BYTES', total - 1):
            with self.assertRaisesRegex(ValueError, 'aggregate size'):
                verify_signals_snapshot(encoded, reader)
        reader.assert_not_called()
        # The full production 256 MiB allowance cannot be assigned to shards:
        # the nonempty manifest consumes part of the same allowance.
        manifest['counts']['github'] = 64
        manifest['shards'] = [dict(manifest['shards'][0], sha256=f'{index:064x}',
                                   path=f'shards/{index:064x}.json', bytes=4 * 1024 * 1024, count=1)
                              for index in range(64)]
        with self.assertRaisesRegex(ValueError, 'aggregate size'):
            verify_signals_snapshot(json.dumps(manifest).encode(), reader)
        reader.assert_not_called()

    def test_duplicate_shard_paths_and_wrong_kind_totals_fail_before_reading(self):
        manifest, _ = fixture([self.record()])
        reader = Mock()
        manifest['shards'].append(dict(manifest['shards'][0]))
        with self.assertRaisesRegex(ValueError, 'path/checksum'):
            verify_signals_snapshot(json.dumps(manifest).encode(), reader)
        reader.assert_not_called()
        manifest['shards'].pop()
        manifest['counts'] = {'github': 0, 'news': 1}
        with self.assertRaisesRegex(ValueError, 'descriptor total counts'):
            verify_signals_snapshot(json.dumps(manifest).encode(), reader)
        reader.assert_not_called()

    def test_duplicate_ids_across_separately_verified_shards_fail(self):
        manifest, body = fixture([self.record()])
        other, other_body = fixture([self.record() | {'title': 'second representation'}])
        manifest['counts']['github'] = 2
        manifest['shards'].extend(other['shards'])
        bodies = {manifest['shards'][0]['path']: body, other['shards'][0]['path']: other_body}
        with self.assertRaisesRegex(ValueError, 'record identity'):
            verify_signals_snapshot(json.dumps(manifest).encode(), bodies.__getitem__)


if __name__ == '__main__':
    unittest.main()
