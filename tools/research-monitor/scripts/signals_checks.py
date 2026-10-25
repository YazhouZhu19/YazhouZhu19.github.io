"""Verify every published columnar GitHub/news shard and reconstruct its archive."""
import hashlib
import json
import re

from snapshot_checks import MAX_BYTES

COMMON = ['id', 'kind', 'title', 'url', 'summary', 'summaryKind', 'publisher', 'publishedAt',
          'firstSeenAt', 'observedAt', 'updatedAt', 'topics', 'sourceId', 'relatedUrls', 'discoveryGroups', 'relevance']
EXTRA = {
    'github': ['fullName', 'stars', 'forks', 'openIssues', 'license', 'language', 'archived',
               'pushedAt', 'releasedAt', 'releaseUrl', 'readmeExcerpt'],
    'news': ['newsType', 'discoveryUrl', 'originalUrl'],
}
DICTIONARY = {'kind', 'summaryKind', 'publisher', 'firstSeenAt', 'observedAt', 'updatedAt', 'topics', 'sourceId',
              'discoveryGroups', 'relevance', 'license', 'language', 'archived', 'newsType'}
OPTIONAL = {'discoveryGroups', 'relevance'}


def verify_signals_snapshot(manifest_bytes, read_shard, *, return_data=False):
    def require(condition, reason):
        if not condition:
            raise ValueError('Invalid published signals snapshot: ' + reason)

    require(len(manifest_bytes) <= MAX_BYTES, 'manifest size')
    manifest = json.loads(manifest_bytes)
    require(isinstance(manifest, dict) and manifest.get('schema') == 'research-monitor-signals-v2'
            and manifest.get('schemaVersion') == 2, 'schema')
    counts, shards = manifest.get('counts'), manifest.get('shards')
    require(isinstance(counts, dict) and set(counts) == set(EXTRA)
            and all(type(value) is int and value >= 0 for value in counts.values()), 'counts')
    require(sum(counts.values()) <= 100000 and isinstance(shards, list), 'record or shard bounds')
    require(isinstance(manifest.get('sources'), list) and isinstance(manifest.get('limitations'), list)
            and isinstance(manifest.get('generatedAt'), str), 'metadata')
    source_ids = {source['id'] for source in manifest['sources'] if isinstance(source, dict) and isinstance(source.get('id'), str)}
    require(len(source_ids) == len(manifest['sources']), 'source IDs')
    ids, paths, records, actual = set(), set(), [], {kind: 0 for kind in EXTRA}
    for shard in shards:
        require(isinstance(shard, dict) and shard.get('kind') in EXTRA, 'descriptor kind')
        digest, path, kind = shard.get('sha256'), shard.get('path'), shard['kind']
        require(isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest)
                and path == f'shards/{digest}.json' and path not in paths, 'path/checksum')
        require(isinstance(shard.get('bucket'), str)
                and re.fullmatch(r'(?:undated|\d{4}-(?:0[1-9]|1[0-2]))(?:\.part-[1-9]\d*)?', shard['bucket']), 'bucket')
        require(type(shard.get('bytes')) is int and 0 < shard['bytes'] <= MAX_BYTES
                and type(shard.get('count')) is int and shard['count'] > 0, 'shard bounds')
        paths.add(path)
        body = read_shard(path)
        require(len(body) == shard['bytes'] and hashlib.sha256(body).hexdigest() == digest, 'shard size/checksum')
        payload = json.loads(body)
        columns = COMMON + EXTRA[kind]
        require(isinstance(payload, dict) and set(payload) == {'columns', 'dictionaries', 'rows'}
                and payload['columns'] == columns, 'columns')
        dictionaries = payload['dictionaries']
        require(isinstance(dictionaries, dict) and set(dictionaries) == DICTIONARY.intersection(columns)
                and all(isinstance(value, list) for value in dictionaries.values()), 'dictionaries')
        rows = payload['rows']
        require(isinstance(rows, list) and len(rows) == shard['count'], 'shard count')
        for row in rows:
            require(isinstance(row, list) and len(row) == len(columns), 'row width')
            record = {}
            for name, value in zip(columns, row):
                if name in DICTIONARY:
                    if name in OPTIONAL and type(value) is int and value == -1:
                        continue
                    require(type(value) is int and 0 <= value < len(dictionaries[name]), 'dictionary index')
                    value = dictionaries[name][value]
                record[name] = value
            require(isinstance(record.get('id'), str) and record['id'] and record['id'] not in ids
                    and record['kind'] == kind and record.get('sourceId') in source_ids, 'record identity/source/kind')
            ids.add(record['id'])
            actual[kind] += 1
            if return_data:
                records.append(record)
    require(actual == counts, 'total counts')
    if not return_data:
        return actual
    metadata = {key: manifest[key] for key in ('generatedAt', 'sources', 'limitations', 'discoveryState') if key in manifest}
    return {**metadata, 'schemaVersion': 1, 'records': sorted(records, key=lambda record: record['id'])}
