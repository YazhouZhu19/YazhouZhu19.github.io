import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from signals_checks import COMMON, EXTRA, DICTIONARY, OPTIONAL, verify_signals_snapshot


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


if __name__ == '__main__':
    unittest.main()
