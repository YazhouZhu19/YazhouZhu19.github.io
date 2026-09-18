# Official-source collector

The collector lives in `lib/{types,classify,record,parse,collect}.ts` and `scripts/collect.ts`. Requires Node.js 22.13+ and the development dependencies `tsx`, `typescript`, and `@types/node`. The collector does not need an AI provider, account, API key, database, or proxy. [INTERESTS.md](INTERESTS.md) describes the 10 research interests and their source basis.

```sh
npx tsx scripts/collect.ts
npx tsx scripts/collect.ts --input data/papers.json --output data/papers.json
node --import tsx --test tests/collector.test.ts
```

`--input` and `--output` each default to `data/papers.json`, relative to the current working directory. Input is required and must be a `MonitorData` object (the legacy seed `{papers, collectedAt, queryRuns}` shape also works). An absent or invalid input fails without writing; initialize the repository from the existing public library before scheduling collection. Do not initialize from an empty file on every Actions run.

The output is written to a temporary sibling file and atomically renamed only after every source has produced an outcome. Use GitHub Actions `concurrency` to serialize collection so two jobs cannot commit conflicting snapshots.

## Coverage and identity

- Europe PMC: one keyword query for each of the 10 interests; up to three 100-record pages per query. Date windows overlap the last clean successful source run by 7 days and limit catch-up to 90 days. The first run for the expanded taxonomy looks back at least 37 days so a recent run under the old two-interest scope cannot suppress backfill.
- arXiv: one query per interest, each returning up to 100 entries sorted by version update date. Queries run serially; all actual requests, including retries, are separated by at least 3.1 seconds. Once all 10 queries succeed, later runs on the same UTC day reuse the collected records without adding source runs or request logs or changing the real fetch time. Failed collections are retried on the next run. This follows the [official API guidance](https://info.arxiv.org/help/api/user-manual.html) on request spacing and caching daily results. It is not an exhaustive date-range search.
- medRxiv: `radiology and imaging` category, up to eight official pages (normally 30 version records each), filtered locally across all 10 interests. It uses the same overlap/backfill window as Europe PMC. This category does not cover all medically relevant papers on medRxiv. A HTTP 200 empty body is an explicit source error; only an official JSON response with `status: ok`, `total: 0`, and `collection: []` represents no results.

Candidates are selected by local title/abstract keyword rules with medical imaging context, never AI. A paper may match several interests; cross-query duplicates merge using the identifiers below. Interest totals therefore overlap, and the two-to-ten-interest expansion is a coverage change rather than evidence of rising publication activity. Full official abstracts and author lists are retained. `originalAbstract` preserves the source text before display cleanup; `authorString` preserves unstructured author metadata where supplied. There is no summary generation, title rewriting, translation, or inferred affiliation.

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
