"""Verify the exact snapshot served by Pages, including every referenced shard."""
import hashlib
import json
import re

MAX_BYTES = 4 * 1024 * 1024


def verify_snapshot(manifest_bytes, read_shard):
    def require(condition, reason):
        if not condition:
            raise ValueError('Invalid published snapshot: ' + reason)

    require(len(manifest_bytes) <= MAX_BYTES, 'manifest size')
    manifest = json.loads(manifest_bytes)
    require(isinstance(manifest, dict) and manifest.get('schema') == 'research-monitor-shards-v1', 'schema')
    metadata = manifest.get('metadata')
    total = manifest.get('totalStored')
    require(type(total) is int and total >= 0, 'total count')
    require(isinstance(metadata, dict) and 'papers' not in metadata and metadata.get('totalStored') == total, 'metadata')
    shards = manifest.get('shards')
    require(isinstance(shards, list), 'shard list')
    paths, ids = set(), set()
    for shard in shards:
        require(isinstance(shard, dict), 'shard descriptor')
        digest, path = shard.get('sha256'), shard.get('path')
        count, size = shard.get('count'), shard.get('bytes')
        require(isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest), 'checksum format')
        require(path == f'papers/{digest}.json' and path not in paths, 'unsafe or duplicate shard path')
        require(type(count) is int and count > 0 and type(size) is int and 0 < size <= MAX_BYTES, 'shard bounds')
        paths.add(path)
        body = read_shard(path)
        require(len(body) == size and hashlib.sha256(body).hexdigest() == digest, 'shard size/checksum')
        records = json.loads(body)
        require(isinstance(records, list) and len(records) == count, 'shard count')
        for record in records:
            require(isinstance(record, dict), 'paper record')
            paper_id = record.get('id')
            require(isinstance(paper_id, str) and paper_id and paper_id not in ids, 'missing or duplicate paper ID')
            ids.add(paper_id)
    require(len(ids) == total, 'total count mismatch')
    return total
