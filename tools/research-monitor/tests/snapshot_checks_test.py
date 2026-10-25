import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from snapshot_checks import verify_snapshot, MAX_BYTES


class PublishedSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.body = json.dumps([{'id': 'doi:1', 'title': '医学影像'}], ensure_ascii=False).encode()
        digest = hashlib.sha256(self.body).hexdigest()
        self.manifest = {'schema': 'research-monitor-shards-v1', 'totalStored': 1,
                         'metadata': {'totalStored': 1},
                         'shards': [{'path': f'papers/{digest}.json', 'sha256': digest,
                                     'bytes': len(self.body), 'count': 1}]}

    def verify(self, read=None):
        return verify_snapshot(json.dumps(self.manifest).encode(), read or (lambda path: self.body))

    def test_complete_snapshot(self):
        self.assertEqual(self.verify(), 1)

    def test_missing_and_corrupt_shards(self):
        with self.assertRaises(FileNotFoundError):
            self.verify(lambda path: (_ for _ in ()).throw(FileNotFoundError(path)))
        with self.assertRaises(ValueError):
            self.verify(lambda path: self.body.replace(b'doi:1', b'doi:2'))

    def test_invalid_paths_bounds_counts_and_duplicate_records(self):
        original = dict(self.manifest['shards'][0])
        for patch in ({'path': '../private.json'}, {'bytes': MAX_BYTES + 1}, {'count': 2}):
            self.manifest['shards'][0] = {**original, **patch}
            with self.assertRaises(ValueError):
                self.verify()
        self.body = b'[{"id":"same"},{"id":"same"}]'
        digest = hashlib.sha256(self.body).hexdigest()
        self.manifest.update(totalStored=2, metadata={'totalStored': 2}, shards=[
            {'path': f'papers/{digest}.json', 'sha256': digest, 'count': 2, 'bytes': len(self.body)}])
        with self.assertRaises(ValueError):
            self.verify()

    def test_optional_month_buckets_accept_legacy_and_reject_invalid_values(self):
        for bucket in ['2026-10', '2026-10.part-2', 'undated', 'undated.part-1']:
            self.manifest['shards'][0]['bucket'] = bucket
            self.assertEqual(self.verify(), 1)
        for bucket in ['2026-13', '2026-10.part-0', '../unsafe', '', None, 10]:
            self.manifest['shards'][0]['bucket'] = bucket
            with self.assertRaises(ValueError):
                self.verify()


if __name__ == '__main__':
    unittest.main()
