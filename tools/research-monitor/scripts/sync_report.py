"""Summarize an Actions sync without changing its collection/build outcome."""

import json
import os
import hashlib
import re
import stat
from collections import Counter
from pathlib import Path
from snapshot_checks import MAX_BYTES
from signals_checks import SIGNALS_MAX_RECORDS, SIGNALS_ARCHIVE_MAX_BYTES

SIGNALS_LEGACY_MAX_BYTES = 96 * 1024 * 1024


def read_regular_bytes(path, max_bytes):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
        raise ValueError('not a regular file within the size limit')
    with path.open('rb') as handle:
        body = handle.read(max_bytes + 1)
    if len(body) != info.st_size or len(body) > max_bytes:
        raise ValueError('file changed while reading or exceeds the size limit')
    return body


def read_json(path, notes, max_bytes=None):
    if not path.is_file():
        notes.append(f'{path.name}: not completed (file absent)')
        return None
    try:
        value = json.loads(read_regular_bytes(path, max_bytes) if max_bytes is not None else path.read_text())
        if not isinstance(value, dict):
            raise ValueError('expected an object')
        return value
    except (OSError, ValueError) as error:
        notes.append(f'{path.name}: not completed (invalid report: {error})')
        return None


def read_text(path):
    return path.read_text().strip() if path.is_file() else 'not completed'


def capacity(used, limit):
    known = type(used) is int and used >= 0 and type(limit) is int and limit > 0
    return {
        'used': used,
        'limit': limit,
        'remaining': limit - used if known else None,
        'percent': round(used / limit * 100, 2) if known else None,
        'status': ('warning' if used * 5 >= limit * 4 else 'within capacity') if known else 'unknown',
    }


def signal_archive_info(path, signals, notes):
    """Measure complete active storage; incomplete shards must not look small."""
    if signals is None:
        return {}, None, None, 'unknown'
    sharded = signals.get('schema') == 'research-monitor-signals-source-v1'
    metadata = signals.get('metadata') if sharded else signals
    archive_format = 'sharded' if sharded else 'flat' if 'schema' not in signals else 'unknown'
    try:
        if (not isinstance(metadata, dict) or type(metadata.get('schemaVersion')) is not int
                or metadata['schemaVersion'] != 1
                or not isinstance(metadata.get('generatedAt'), str)
                or not isinstance(metadata.get('sources'), list)
                or not isinstance(metadata.get('limitations'), list)
                or any(not isinstance(item, str) for item in metadata['limitations'])
                or (sharded and 'records' in metadata)):
            raise ValueError('invalid source metadata')
        source_ids = set()
        for source in metadata['sources']:
            if (not isinstance(source, dict) or not isinstance(source.get('id'), str) or not source['id']
                    or source['id'] in source_ids or source.get('kind') not in ('github', 'news')
                    or source.get('status') not in ('ok', 'partial', 'error', 'pending')):
                raise ValueError('invalid or duplicate source identity/status')
            source_ids.add(source['id'])
        ids = set()

        def check_records(records):
            if not isinstance(records, list):
                raise ValueError('invalid source records')
            for record in records:
                if (not isinstance(record, dict) or not isinstance(record.get('id'), str)
                        or not record['id'] or record['id'] in ids
                        or not isinstance(record.get('sourceId'), str) or record['sourceId'] not in source_ids):
                    raise ValueError('invalid or duplicate record identity/source')
                ids.add(record['id'])

        info = path.lstat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('source manifest is not a regular file')
        if not sharded:
            if (archive_format != 'flat' or not isinstance(signals.get('records'), list)
                    or len(signals['records']) > SIGNALS_MAX_RECORDS or info.st_size > SIGNALS_LEGACY_MAX_BYTES):
                raise ValueError('invalid legacy archive or capacity exceeded')
            check_records(signals['records'])
            return signals, len(signals['records']), info.st_size, 'flat'
        if set(signals) != {'schema', 'metadata', 'totalRecords', 'shards'} or info.st_size > MAX_BYTES:
            raise ValueError('invalid source manifest or manifest size')
        total, shards = signals.get('totalRecords'), signals.get('shards')
        if (type(total) is not int or not 0 <= total <= SIGNALS_MAX_RECORDS
                or not isinstance(shards, list) or len(shards) > SIGNALS_MAX_RECORDS):
            raise ValueError('invalid source counts or shards')
        total_bytes, described_count, paths = info.st_size, 0, set()
        for shard in shards:
            if not isinstance(shard, dict) or set(shard) != {'path', 'sha256', 'bytes', 'count'}:
                raise ValueError('invalid source shard descriptor')
            digest, relative = shard.get('sha256'), shard.get('path')
            size, count = shard.get('bytes'), shard.get('count')
            if not (isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest)
                    and relative == f'research-signals/{digest}.json' and relative not in paths
                    and type(size) is int and 0 < size <= MAX_BYTES
                    and type(count) is int and count > 0):
                raise ValueError('invalid source shard path, size or count')
            paths.add(relative)
            total_bytes += size
            described_count += count
        if total_bytes > SIGNALS_ARCHIVE_MAX_BYTES or described_count != total:
            raise ValueError('source aggregate size or total record count exceeds bounds')
        # Preflight every descriptor before any shard is opened. A small valid
        # manifest must never conceal an oversized or incomplete archive.
        if shards:
            directory_info = (path.parent / 'research-signals').lstat()
            if not stat.S_ISDIR(directory_info.st_mode):
                raise ValueError('source shard directory is missing or unsafe')
        actual_count = 0
        for shard in shards:
            relative, size, count, digest = shard['path'], shard['bytes'], shard['count'], shard['sha256']
            shard_path = path.parent / relative
            if (not shard_path.is_file() or shard_path.is_symlink()
                    or not shard_path.resolve().is_relative_to(path.parent.resolve())):
                raise ValueError(f'missing or unsafe source shard: {relative}')
            if shard_path.stat().st_size != size:
                raise ValueError(f'source shard size mismatch: {relative}')
            body = read_regular_bytes(shard_path, size)
            if len(body) != size or hashlib.sha256(body).hexdigest() != digest:
                raise ValueError(f'source shard checksum mismatch: {relative}')
            records = json.loads(body)
            if not isinstance(records, list) or len(records) != count:
                raise ValueError(f'source shard count mismatch: {relative}')
            check_records(records)
            actual_count += len(records)
        if actual_count != total:
            raise ValueError('source total record count mismatch')
        return metadata, total, total_bytes, 'sharded'
    except (OSError, ValueError) as error:
        notes.append(f'research-signals.json: capacity unknown ({error})')
        return metadata if isinstance(metadata, dict) else {}, None, None, archive_format


def collect_report(monitor, temp, outcome):
    notes = []
    diagnostics = temp / 'research-sync-diagnostics'
    budget = read_json(monitor / 'dist/budget-report.json', notes)
    violations = budget.get('violations') if budget else None
    if not (
        budget
        and budget.get('schemaVersion') == 1
        and isinstance(budget.get('measuredAt'), str)
        and isinstance(violations, list)
        and all(isinstance(item, str) for item in violations)
    ):
        if budget is not None:
            notes.append('budget-report.json: not completed (invalid violations)')
        budget_status, violations = 'not completed', []
    else:
        budget_status = 'failed' if violations else 'passed'
    papers = read_json(monitor / 'data/papers.json', notes)
    paper_metadata = papers.get('metadata', papers) if papers else {}
    if not isinstance(paper_metadata, dict):
        paper_metadata = {}
        notes.append('papers.json: not completed (invalid metadata)')
    signal_path = monitor / 'data/research-signals.json'
    signals = read_json(signal_path, notes, SIGNALS_LEGACY_MAX_BYTES)
    signal_metadata, signal_count, signal_bytes, signal_format = signal_archive_info(signal_path, signals, notes)
    limits = read_json(diagnostics / 'signal-limits.json', notes)
    if not (limits and all(type(limits.get(key)) is int and limits[key] > 0 for key in ['maxRecords', 'maxBytes'])):
        if limits is not None:
            notes.append('signal-limits.json: capacity unknown (invalid hard limits)')
        limits = {}
    byte_limit = limits.get('maxBytes')
    if signal_format == 'flat':
        byte_limit = limits.get('legacyMaxBytes')
        if type(byte_limit) is not int or byte_limit <= 0:
            notes.append('signal-limits.json: capacity unknown (missing or invalid legacy byte limit)')
            byte_limit = None
    source_counts = Counter()
    if isinstance(signal_metadata.get('sources'), list):
        source_counts.update(
            source.get('status', 'unknown')
            for source in signal_metadata['sources']
            if isinstance(source, dict) and isinstance(source.get('status', 'unknown'), str)
        )
    return {
        'refreshOutcome': outcome or 'not completed',
        'attempt': read_text(diagnostics / 'attempt'),
        'lastStage': read_text(diagnostics / 'stage'),
        'paperCollectorExit': read_text(temp / 'research-collect-exit'),
        'signalCollectorExit': read_text(temp / 'research-signals-exit'),
        'budgetStatus': budget_status,
        'budgetViolations': violations,
        'papers': {
            'count': papers.get('totalStored', paper_metadata.get('totalStored')) if papers else None,
            'collectedAt': paper_metadata.get('collectedAt'),
            'lastSuccessfulSync': paper_metadata.get('lastSuccessfulSync'),
            'status': paper_metadata.get('status'),
        },
        'signals': {
            'count': signal_count,
            'bytes': signal_bytes,
            'format': signal_format,
            'generatedAt': signal_metadata.get('generatedAt'),
            'sourceStatuses': dict(sorted(source_counts.items())),
            'capacity': {
                'records': capacity(signal_count, limits.get('maxRecords')),
                'bytes': capacity(signal_bytes, byte_limit),
            },
        },
        'notes': notes,
    }


def cell(value):
    return str(value if value is not None else 'not completed').replace('\n', ' ').replace('|', '\\|').replace('`', "'")


def render_summary(report):
    lines = [
        '## Research source sync',
        '',
        '| Check | Result |',
        '| --- | --- |',
        f"| Archive refresh | {cell(report['refreshOutcome'])} |",
        f"| Attempt / last stage | {cell(report['attempt'])} / {cell(report['lastStage'])} |",
        f"| Paper / signal collector exit | {cell(report['paperCollectorExit'])} / {cell(report['signalCollectorExit'])} |",
        f"| Resource budgets | {cell(report['budgetStatus'])} |",
        '',
        '### Resource budget violations',
        '',
    ]
    if report['budgetStatus'] == 'not completed':
        lines.append('Not completed: no valid budget result is available. Inspect the last stage above.')
    elif report['budgetViolations']:
        lines.extend(f'- `{cell(item)}`' for item in report['budgetViolations'])
    else:
        lines.append('No resource budget violations in the completed measurement.')
    papers, signals = report['papers'], report['signals']
    lines.extend([
        '',
        '### Source data in this checkout',
        '',
        'These timestamps describe collection, not web/data publication. A failed refresh may leave uncommitted source changes in this disposable checkout.',
        '',
        '| Dataset | Records | Source timestamp | Detail |',
        '| --- | ---: | --- | --- |',
        f"| Papers | {cell(papers['count'])} | {cell(papers['collectedAt'])} | status: {cell(papers['status'])}; last success: {cell(papers['lastSuccessfulSync'])} |",
        f"| Research signals | {cell(signals['count'])} | {cell(signals['generatedAt'])} | {cell(signals['format'])}; {cell(signals['bytes'])} source bytes; source statuses: {cell(json.dumps(signals['sourceStatuses'], ensure_ascii=False))} |",
        '',
        '### Research signal capacity',
        '',
        'Hard limits are imported from the collector configuration after dependency setup. Capacity warns at 80%; negative remaining values are preserved.',
        'Active sharded bytes include the manifest and every referenced shard. Legacy flat archives use their separate byte limit. Missing or invalid archive evidence is reported as unknown.',
        '',
        '| Metric | Used | Hard limit | Remaining | Utilization | Status |',
        '| --- | ---: | ---: | ---: | ---: | --- |',
    ])
    for name, value in signals['capacity'].items():
        metric = lambda key: cell(value[key]) if value[key] is not None else 'unknown'
        utilization = f"{value['percent']}%" if value['percent'] is not None else 'unknown'
        lines.append(f"| {name} | {metric('used')} | {metric('limit')} | {metric('remaining')} | {utilization} | {cell(value['status'])} |")
    if any(value['status'] == 'warning' for value in signals['capacity'].values()):
        lines.extend(['', '**Capacity warning: at least one signal archive metric is at or above 80% of its hard limit.**'])
    if report['notes']:
        lines.extend(['', '### Incomplete diagnostics', ''])
        lines.extend(f'- {cell(note)}' for note in report['notes'])
    return '\n'.join(lines) + '\n'


def main():
    monitor = Path(__file__).resolve().parents[1]
    temp = Path(os.environ['RUNNER_TEMP'])
    report = collect_report(monitor, temp, os.environ.get('REFRESH_OUTCOME'))
    directory = temp / 'research-sync-diagnostics'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'summary.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as summary:
        summary.write(render_summary(report))


if __name__ == '__main__':
    main()
