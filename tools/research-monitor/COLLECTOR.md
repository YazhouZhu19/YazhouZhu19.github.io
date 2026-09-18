# Official-source collector

Copy `lib/{types,classify,record,parse,collect}.ts`, `scripts/collect.ts`, and `tests/collector.test.ts` into the static-site repository. Requires Node.js 22+ and the development dependencies `tsx`, `typescript`, and `@types/node`. The collector does not need an AI provider, account, API key, database, or proxy.

```sh
npx tsx scripts/collect.ts
npx tsx scripts/collect.ts --input data/papers.json --output data/papers.json
node --import tsx --test tests/collector.test.ts
```

`--input` and `--output` each default to `data/papers.json`, relative to the current working directory. Input is required and must be a `MonitorData` object (the legacy seed `{papers, collectedAt, queryRuns}` shape also works). An absent or invalid input fails without writing; initialize the repository from the existing public library before scheduling collection. Do not initialize from an empty file on every Actions run.

The output is written to a temporary sibling file and atomically renamed only after every source has produced an outcome. Use GitHub Actions `concurrency` to serialize collection so two jobs cannot commit conflicting snapshots.

## Coverage and identity

- Europe PMC: two existing segmentation / human-in-the-loop keyword queries; up to three 100-record pages per query. Date window overlaps the last clean successful source run by 7 days, starts 37 days back when no source run is available, and limits catch-up to 90 days.
- arXiv: up to 100 matching entries, sorted by version update date, as in the old collector. This is not an exhaustive date-range search.
- medRxiv: `radiology and imaging` category, up to eight official pages (normally 30 version records each), using the same overlap window. A HTTP 200 empty body is an explicit source error; only an official JSON response with `status: ok`, `total: 0`, and `collection: []` represents no results.

Candidates are selected by the existing local keyword rules, never AI. Full official abstracts and author lists are retained. `originalAbstract` preserves the source text before display cleanup; `authorString` preserves unstructured author metadata where supplied. There is no summary generation, title rewriting, translation, or inferred affiliation.

Non-arXiv records deduplicate by normalized DOI and available native IDs. arXiv deduplicates by its versionless arXiv ID; its DOI can identify the journal publication, so it is preserved as a relationship without collapsing the preprint and journal record. Merging retains earliest `firstSeenAt`, nonempty abstracts/authors, combined sources/affiliations/provenance/version metadata, and updates classifications from the retained text. No title-similarity merging is performed.

All existing papers survive source outages and bounded fetch windows. There is no 3,000-paper storage cap. `totalStored` is the full stored count; a UI may choose to render the latest 3,000. The initial snapshot `queryRuns` are preserved unchanged for frontend compatibility. The last 45 source `runs` and 500 individual `requestLogs` are retained; new requests are never mixed into the initial query snapshot.

## Errors and Actions behavior

Requests use HTTPS official API hosts only, a 25-second timeout, and up to three attempts for network errors, empty responses, HTTP 429, and HTTP 5xx. Other HTTP errors fail immediately. No proxy or `chatgpt.site` dependency exists.

Each source run reports `ok`, `partial`, or `error`, along with its real error message. A source is `partial` when capped results remain or a later request fails after a validated page; valid fetched records can still be merged. `error` means no valid page was obtained for that source. Errors also appear in `MonitorData.errors` / `error` and individual request logs. Partial/capped results never claim exhaustive coverage. A clean success (including an intentional result cap) advances `lastSuccessfulSync`; an error-interrupted source does not advance its catch-up anchor.

- At least one source yields a valid page: save the snapshot and exit 0. Other sources can fail, and Actions may publish the partial result with its visible errors.
- All three sources fail: save all previous papers with new error runs and exit 1.
- Invalid input or a filesystem failure: exit 1; no valid snapshot is replaced by an empty library.

An Actions workflow may use `continue-on-error: true` on the collector step to commit/publish the recorded failure status even when all sources fail, then explicitly fail a final step so monitoring shows the job failure. Avoid allowing shell `|| true` to hide collector failures.

The offline tests cover DOI/arXiv/version merging, raw metadata retention, empty and malformed responses, partial source failure, complete outage, the bounded history window, run retention, legacy input, and libraries larger than 3,000 papers. Tests make no external requests.
