"""Summarize an Actions sync without changing its collection/build outcome."""

import json
import os
from collections import Counter
from pathlib import Path


def read_json(path, notes):
    if not path.is_file():
        notes.append(f'{path.name}: not completed (file absent)')
        return None
    try:
        value = json.loads(path.read_text())
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
    signals = read_json(signal_path, notes)
    limits = read_json(diagnostics / 'signal-limits.json', notes)
    if not (limits and all(type(limits.get(key)) is int and limits[key] > 0 for key in ['maxRecords', 'maxBytes'])):
        if limits is not None:
            notes.append('signal-limits.json: capacity unknown (invalid hard limits)')
        limits = {}
    signal_count = len(signals['records']) if signals and isinstance(signals.get('records'), list) else None
    signal_bytes = signal_path.stat().st_size if signal_path.is_file() else None
    source_counts = Counter()
    if signals and isinstance(signals.get('sources'), list):
        source_counts.update(
            source.get('status', 'unknown')
            for source in signals['sources']
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
            'generatedAt': signals.get('generatedAt') if signals else None,
            'sourceStatuses': dict(sorted(source_counts.items())),
            'capacity': {
                'records': capacity(signal_count, limits.get('maxRecords')),
                'bytes': capacity(signal_bytes, limits.get('maxBytes')),
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
        f"| Research signals | {cell(signals['count'])} | {cell(signals['generatedAt'])} | {cell(signals['bytes'])} source bytes; source statuses: {cell(json.dumps(signals['sourceStatuses'], ensure_ascii=False))} |",
        '',
        '### Research signal capacity',
        '',
        'Hard limits are imported from the collector configuration after dependency setup. Capacity warns at 80%; negative remaining values are preserved.',
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
