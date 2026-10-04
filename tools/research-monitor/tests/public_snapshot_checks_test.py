import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from snapshot_checks import verify_snapshot


def fixture(records, urls=None):
    body = json.dumps(records, ensure_ascii=False).encode()
    digest = hashlib.sha256(body).hexdigest()
    path = f'papers/{digest}.json'
    manifest = {'schema': 'research-monitor-shards-v1' if urls is None else 'research-monitor-shards-v2',
                'metadata': {'totalStored': len(records), 'custom': '原文'}, 'totalStored': len(records),
                'shards': [{'path': path, 'sha256': digest, 'bytes': len(body), 'count': len(records)}]}
    if urls is not None:
        manifest['queryUrls'] = urls
    return json.dumps(manifest).encode(), lambda requested: body if requested == path else b''


class PublicSnapshotChecksTest(unittest.TestCase):
    def test_v1_and_v2_decode_to_identical_full_records(self):
        source = [{'id': 'one', 'originalAbstract': '<p>Different original</p>', 'provenance': [
            {'queryUrl': 'https://example.org/query', 'extra': [1, False, None]}, {'collectedAt': 'retained'}]}]
        encoded = json.loads(json.dumps(source))
        encoded[0]['provenance'][0]['queryUrl'] = 0
        old_manifest, old_reader = fixture(source)
        new_manifest, new_reader = fixture(encoded, ['https://example.org/query'])
        self.assertEqual(verify_snapshot(new_manifest, new_reader), 1)
        self.assertEqual(verify_snapshot(old_manifest, old_reader, return_data=True),
                         verify_snapshot(new_manifest, new_reader, return_data=True))

    def test_invalid_indices_fail_despite_matching_checksum(self):
        for index in [-1, 1, 0.5, True, '0', None, {}]:
            with self.subTest(index=index):
                manifest, reader = fixture([{'id': 'p', 'provenance': [{'queryUrl': index}]}], ['https://example.org'])
                with self.assertRaises(ValueError):
                    verify_snapshot(manifest, reader)

    def test_unsafe_or_duplicate_dictionary_entries_fail(self):
        for urls in [['javascript:alert(1)'], ['https://'], [None], ['https://example.org', 'https://example.org']]:
            with self.subTest(urls=urls):
                manifest, reader = fixture([{'id': 'p', 'provenance': []}], urls)
                with self.assertRaises(ValueError):
                    verify_snapshot(manifest, reader)

    def test_corrupted_shards_cannot_pass(self):
        manifest, reader = fixture([{'id': 'p', 'provenance': [{'queryUrl': 0}]}], ['https://example.org'])
        with self.assertRaises(ValueError):
            verify_snapshot(manifest, lambda path: reader(path).replace(b'"queryUrl": 0', b'"queryUrl": 1'))

    def test_missing_provenance_and_mismatched_counts_fail(self):
        for record in [{'id': 'p'}, {'id': 'p', 'provenance': [False]}]:
            manifest, reader = fixture([record], [])
            with self.assertRaises(ValueError):
                verify_snapshot(manifest, reader)
        manifest, reader = fixture([{'id': 'p', 'provenance': []}], [])
        value = json.loads(manifest)
        value['totalStored'] = value['metadata']['totalStored'] = 2
        with self.assertRaises(ValueError):
            verify_snapshot(json.dumps(value).encode(), reader)


if __name__ == '__main__':
    unittest.main()
