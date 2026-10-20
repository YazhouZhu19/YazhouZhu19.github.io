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
    require(isinstance(manifest, dict) and isinstance(manifest.get('schema'), str) and manifest['schema'] in {'research-monitor-shards-v1', 'research-monitor-shards-v2', 'research-monitor-shards-v3'}, 'schema')
    encoded = manifest['schema'] != 'research-monitor-shards-v1'
    compact = manifest['schema'] == 'research-monitor-shards-v3'
    query_urls = manifest.get('queryUrls')
    if encoded:
        require(isinstance(query_urls, list), 'query URL dictionary')
        unique_urls = set()
        for url in query_urls:
            require(isinstance(url, str) and len(url) <= 12000 and re.match(r'^https?://', url, re.I), 'query URL format')
            parsed = urlsplit(url)
            require(bool(parsed.netloc) and url not in unique_urls, 'query URL format or duplicate')
            unique_urls.add(url)
    affiliations = manifest.get('affiliations')
    if compact:
        require(isinstance(affiliations, list) and all(isinstance(value, str) for value in affiliations), 'affiliation dictionary')
        require(len(set(affiliations)) == len(affiliations), 'duplicate affiliation dictionary entry')

    def decode_affiliations(values):
        require(isinstance(values, list), 'v3 affiliations')
        result = []
        for value in values:
            if isinstance(value, str):
                result.append(value)
            else:
                require(type(value) is int and 0 <= value < len(affiliations), 'v3 affiliation reference')
                result.append(affiliations[value])
        return result

    def decode_author(value):
        require(isinstance(value, list) and 3 <= len(value) <= 6, 'v3 author tuple')
        require(isinstance(value[0], str) and (value[1] is None or isinstance(value[1], str)), 'v3 author name or ORCID')
        mask = value[4] if len(value) > 4 else 7 if len(value) > 3 else 3
        require(type(mask) is int and 0 <= mask <= 7, 'v3 author presence')
        extra = value[5] if len(value) > 5 else {}
        require(isinstance(extra, dict) and not {'name', 'orcid', 'affiliations', 'displayName'}.intersection(extra), 'v3 author extra fields')
        decoded = decode_affiliations(value[2])
        require(bool(mask & 1) or value[1] is None, 'v3 absent author ORCID')
        require(bool(mask & 2) or not decoded, 'v3 absent author affiliations')
        result = {**extra, 'name': value[0]}
        if mask & 1:
            result['orcid'] = value[1]
        if mask & 2:
            result['affiliations'] = decoded
        if mask & 4:
            require(len(value) > 3 and isinstance(value[3], str), 'v3 author display name')
            result['displayName'] = value[3]
        else:
            require(len(value) <= 3 or value[3] is None, 'v3 absent author display name')
        return result

    def decode_provenance(value):
        require(isinstance(value, list) and 4 <= len(value) <= 6, 'v3 provenance tuple')
        mask = value[4] if len(value) > 4 else 15
        require(type(mask) is int and 0 <= mask <= 15, 'v3 provenance presence')
        extra = value[5] if len(value) > 5 else {}
        keys = ('queryUrl', 'collectedAt', 'queryTrack', 'sourceRecordId')
        require(isinstance(extra, dict) and not set(keys).intersection(extra), 'v3 provenance extra fields')
        result = {**extra}
        for index, key in enumerate(keys):
            if mask & (1 << index):
                result[key] = value[index]
            else:
                require(value[index] is None, 'v3 absent provenance field')
        return result

    def decode_compact_record(value):
        require(isinstance(value, list) and len(value) == 2 and type(value[0]) is int
                and value[0] in (0, 1) and isinstance(value[1], dict), 'v3 wrapper')
        flags, paper = value
        require(isinstance(paper.get('authors'), list) and isinstance(paper.get('provenance'), list), 'v3 authors or provenance')
        result = {**paper, 'authors': [decode_author(author) for author in paper['authors']],
                  'provenance': [decode_provenance(entry) for entry in paper['provenance']]}
        if 'affiliations' in paper:
            result['affiliations'] = decode_affiliations(paper['affiliations'])
        if flags & 1:
            require('originalAbstract' not in paper and isinstance(paper.get('abstract'), str), 'v3 shared abstract')
            result['originalAbstract'] = paper['abstract']
        return result
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
        if 'bucket' in shard:
            require(isinstance(shard['bucket'], str) and re.fullmatch(r'(?:\d{4}-(?:0[1-9]|1[0-2])|undated)(?:\.part-[1-9]\d*)?', shard['bucket']), 'bucket')
        paths.add(path)
        body = read_shard(path)
        require(len(body) == size and hashlib.sha256(body).hexdigest() == digest, 'shard size/checksum')
        records = json.loads(body)
        require(isinstance(records, list) and len(records) == count, 'shard count')
        for record in records:
            if compact:
                record = decode_compact_record(record)
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
    if return_data:
        # Normalize both legacy and bucketed order for cross-format equality.
        # Python's portable ordering is independent of the browser's ICU locale.
        papers.sort(key=lambda paper: paper['id'])
        papers.sort(key=lambda paper: paper.get('publishedAt') if isinstance(paper.get('publishedAt'), str) else '', reverse=True)
    return {**metadata, 'papers': papers} if return_data else total
