"""Verify the exact snapshot served by Pages, including every referenced shard."""
import hashlib
import json
import re
from urllib.parse import urlsplit

MAX_BYTES = 4 * 1024 * 1024


def verify_snapshot(manifest_bytes, read_shard, *, return_data=False):
    def require(condition, reason):
        if not condition:
            raise ValueError('Invalid published snapshot: ' + reason)

    require(len(manifest_bytes) <= MAX_BYTES, 'manifest size')
    manifest = json.loads(manifest_bytes)
    require(isinstance(manifest, dict) and isinstance(manifest.get('schema'), str) and manifest['schema'] in {'research-monitor-shards-v1', 'research-monitor-shards-v2'}, 'schema')
    encoded = manifest['schema'] == 'research-monitor-shards-v2'
    query_urls = manifest.get('queryUrls')
    if encoded:
        require(isinstance(query_urls, list), 'query URL dictionary')
        unique_urls = set()
        for url in query_urls:
            require(isinstance(url, str) and len(url) <= 12000 and re.match(r'^https?://', url, re.I), 'query URL format')
            parsed = urlsplit(url)
            require(bool(parsed.netloc) and url not in unique_urls, 'query URL format or duplicate')
            unique_urls.add(url)
    metadata = manifest.get('metadata')
    total = manifest.get('totalStored')
    require(type(total) is int and total >= 0, 'total count')
    require(isinstance(metadata, dict) and 'papers' not in metadata and metadata.get('totalStored') == total, 'metadata')
    shards = manifest.get('shards')
    require(isinstance(shards, list), 'shard list')
    paths, ids, papers = set(), set(), []
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
            if encoded:
                provenance = record.get('provenance')
                require(isinstance(provenance, list), 'encoded provenance')
                for item in provenance:
                    require(isinstance(item, dict), 'encoded provenance entry')
                    if 'queryUrl' in item:
                        index = item['queryUrl']
                        require(type(index) is int and 0 <= index < len(query_urls), 'query URL reference')
                        item['queryUrl'] = query_urls[index]
            if return_data:
                papers.append(record)
    require(len(ids) == total, 'total count mismatch')
    return {**metadata, 'papers': papers} if return_data else total
