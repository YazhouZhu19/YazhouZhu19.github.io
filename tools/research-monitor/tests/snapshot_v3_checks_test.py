import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from snapshot_checks import verify_snapshot


def fixture(records, affiliations=None, schema='research-monitor-shards-v3'):
    body = json.dumps(records, ensure_ascii=False).encode()
    digest = hashlib.sha256(body).hexdigest()
    path = f'papers/{digest}.json'
    manifest = {'schema': schema, 'metadata': {'totalStored': len(records)},
                'totalStored': len(records), 'queryUrls': ['https://example.org/query'],
                'affiliations': affiliations if affiliations is not None else ['医学影像实验室'],
                'shards': [{'path': path, 'sha256': digest, 'bytes': len(body), 'count': len(records), 'bucket': 'undated'}]}
    return json.dumps(manifest).encode(), lambda requested: body if requested == path else b''


class SnapshotV3ChecksTest(unittest.TestCase):
    def test_v3_roundtrips_all_fields_and_optional_presence(self):
        source = [{'id': 'first', 'abstract': 'Same', 'originalAbstract': 'Same',
                   'authors': [{'name': 'One', 'orcid': None, 'affiliations': ['医学影像实验室', 'Literal'],
                                'displayName': 'One A', 'custom': [False, None]},
                               {'name': 'Two', 'affiliations': []}],
                   'affiliations': ['医学影像实验室'], 'custom': {'retained': True},
                   'provenance': [{'queryUrl': 'https://example.org/query'},
                                  {'collectedAt': None, 'queryTrack': None, 'sourceRecordId': None},
                                  {'custom': [False, None]}]},
                  {'id': 'second', 'abstract': 'Missing original', 'authors': [], 'provenance': []},
                  {'id': 'third', 'abstract': 'Null original', 'originalAbstract': None, 'authors': [], 'provenance': []}]
        compact = [[1, {**source[0], 'authors': [['One', None, [0, 'Literal'], 'One A', 7, {'custom': [False, None]}],
                                              ['Two', None, [], None, 2]],
                         'affiliations': [0], 'provenance': [[0, None, None, None, 1],
                                                           [None, None, None, None, 14],
                                                           [None, None, None, None, 0, {'custom': [False, None]}]]}],
                   [0, source[1]], [0, source[2]]]
        del compact[0][1]['originalAbstract']
        v1, read_v1 = fixture(source, schema='research-monitor-shards-v1')
        v3, read_v3 = fixture(compact)
        self.assertEqual(verify_snapshot(v1, read_v1, return_data=True), verify_snapshot(v3, read_v3, return_data=True))
        self.assertNotIn('originalAbstract', verify_snapshot(v3, read_v3, return_data=True)['papers'][1])

    def test_corrupt_compact_metadata_fails_even_with_matching_hashes(self):
        base = {'id': 'p', 'abstract': 'A', 'authors': [], 'provenance': []}
        invalids = [[True, base], [2, base], [0, None], [0, base, {}],
                    [1, {**base, 'originalAbstract': 'conflicting'}],
                    [1, {**base, 'abstract': None}],
                    [0, {**base, 'authors': [['Name', None, [1]]]}],
                    [0, {**base, 'authors': [['Name', None, [False]]]}],
                    [0, {**base, 'authors': [['Name', None, [], None, 9]]}],
                    [0, {**base, 'authors': [['Name', None, [], None, 3, {'name': 'override'}]]}],
                    [0, {**base, 'provenance': [[None, None, None, None, 16]]}],
                    [0, {**base, 'provenance': [[None, None, None, None, 15, {'queryTrack': 'override'}]]}]]
        for record in invalids:
            with self.subTest(record=record):
                manifest, reader = fixture([record])
                with self.assertRaises(ValueError):
                    verify_snapshot(manifest, reader)
        for affiliations in [['duplicate', 'duplicate'], [None], [0]]:
            manifest, reader = fixture([[0, base]], affiliations)
            with self.assertRaises(ValueError):
                verify_snapshot(manifest, reader)


if __name__ == '__main__':
    unittest.main()
