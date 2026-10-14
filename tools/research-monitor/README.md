# Medical Image Research Monitor / 医学影像科研观察

A public bilingual research dashboard covering 10 medical imaging research interests, including organ/lesion segmentation, human-in-the-loop clinical diagnosis, detection, reconstruction, registration, radiomics, prognosis, image–language understanding, intervention, and foundation models. The filter is named **感兴趣方向 / Research interests**. See [INTERESTS.md](INTERESTS.md) for the bilingual scope and design sources.

The primary workspace has four entrances: **科研仪表盘 / Research dashboard**, **方向研判 / Research outlook**, **PI / Teams**, and **论文库 / Paper library**. The dashboard is the default macro overview, retaining the original metrics, direction and date distributions, publication status, task–modality matrix, methods, team matches and source health. Chart drill-through opens the paper library and returns to the dashboard with its filters preserved; preliminary analysis remains a dashboard subview and an expandable library section. Research outlook compares publication windows and proposes evidence-linked, conditional research hypotheses. Team outlook uses user-confirmed name/ORCID watchlists. The full paper archive, original abstracts, reading notes and source provenance remain available. Saved papers and source diagnostics are auxiliary entrances. See [FORESIGHT.md](FORESIGHT.md) for the inference limits, deduplication, comparison checks and revision history.

- Chinese: https://yazhouzhu19.github.io/research-monitor/
- English: https://yazhouzhu19.github.io/research-monitor/en/

## Operation

GitHub Pages serves this Vite/React static application. The repository workflow `.github/workflows/research-monitor-sync.yml` collects public metadata directly from Europe PMC, arXiv, and medRxiv at minute 23 of each hour, then builds and publishes the snapshot. Scheduling and source indexing can be delayed; the dashboard shows source-specific status and last successful fetch times. It is periodic monitoring, not a guarantee of instantaneous or exhaustive coverage.

The collector and dashboard use deterministic keyword classification and statistics. No ChatGPT, LLM, AI API key, login service, paid backend, or model token is required for operation. The previous daily Codex check is not used. GitHub Actions and source API availability remain subject to their provider limits.

The **检查最新数据 / Check for updates** button checks the latest published snapshot. It shows progress and reports whether a newer snapshot was loaded, no published update was found, or the check failed; existing data and personal notes remain available on failure. It does not start source collection. The page also checks quietly every five minutes while visible. To collect sources immediately, a repository maintainer can run the GitHub workflow described below; publication takes a few minutes, and a successful check does not necessarily add papers.

The source status panel separates request failures from limited coverage and reports the last error-free fetch. Confirmed Europe PMC terminal pages are accepted even when the search count exceeds returned core records; count discrepancies remain recorded. If the medRxiv primary API fails, the collector uses the official alternate API and filters its all-category results locally. Recovered primary errors remain in request logs; unresolved failures name the affected source in the page warning. See [COLLECTOR.md](COLLECTOR.md) for pagination limits and fallback behavior.

## Personal data

Saved papers, notes, and team/PI watchlists are stored only in localStorage under `medical-research-monitor:personal:v1`. Chinese and English pages share this browser data. Nothing personal is uploaded by the app. Use **Local data → Export backup** before clearing browser data or moving devices. **Import backup** validates the file and requests confirmation before replacing both lists. Private/incognito sessions and blocked/full storage can prevent persistence. Old-site account data is not automatically transferred.

The PI / Teams page also offers a public author directory grouped by the ten research interests, alongside the original personal watchlist categories (ongoing interest, competitive observation and potential collaboration). Directory entries come from the current paper archive, not a fixed or verified PI roster. Selecting an author opens a temporary, evidence-linked assessment without creating a personal watchlist; **Save to my watchlists** opens the existing form for confirmation. Direction filters apply to candidate counts and the assessment scope. Directory counts are library records, while outlook windows deduplicate works. Names and publication affiliations require identity checks and do not establish a lab's membership or current appointments.

Assessment revisions and manual outcome reviews use the separate local key `medical-research-monitor:assessments:v1`. The collapsed **How assessments change** panel exports that history separately; the existing personal backup format is unchanged. No retrospective forecasts are fabricated. History records only versions viewed on the current browser, up to 12 per scope and 40 scopes; there is no background notification or server-side personal tracking.

## Development

Requires Node.js 22.13 or later.

```sh
npm ci
npm run dev
npm test
npm run collect
npm run build
npm run preview
```

`data/papers.json` is the persistent snapshot manifest. Its metadata and content-addressed `data/papers/<sha256>.json` shards preserve the complete paper library, with each file limited to 4 MiB. The collector reads legacy single-file snapshots too, and writes the sharded format atomically without dropping history. Do not replace the snapshot with an empty seed. The build produces `dist/data/public-papers-v2.json` with a shared query-URL dictionary, reducing repeated provenance strings without removing any records or fields. If the dictionary exceeds the manifest budget, this endpoint falls back to the supported v1 representation. The original `dist/data/papers.json` and its shards remain available for cached v1 clients. Node and Python build checks verify complete decoded equality against the source archive; the workflow publishes `dist/` into `/research-monitor/` and validates both endpoints. Both locale entry HTML files are built explicitly. Do not commit `node_modules`, private backups, credentials, or `.test-build`.

The browser fetches the versioned public manifest fresh, reuses the last validated library when the manifest is identical, and otherwise loads at most four immutable shards concurrently, verifying byte lengths, SHA-256 hashes, counts and unique paper IDs before showing a complete snapshot. It retains the existing displayed data if any shard fails. One previous generation of shards is retained for clients spanning a deployment. The dashboard still loads the complete library for its existing searches and aggregate statistics. Statistics reuse a Beijing date formatter and cached abstract analysis; auxiliary views and Recharts load on demand. The overview uses lightweight horizontal bars for interest-direction counts, a task/modality dot matrix, and linear method dot plots, with exact native controls and paper drill-through. Direction bars share a zero-based linear scale and keep exact values visible; the preliminary direction/method combinations retain their area-scaled bubbles. Overlapping labels never imply mutually exclusive shares. Reduced-motion preferences disable chart entrance animations and bar transitions.

Use `npx tsx scripts/snapshot-cli.ts check data/papers.json` to verify a snapshot, `migrate data/papers.json` to convert a legacy file without fetching sources, or `export data/papers.json /tmp/papers.json` to reconstruct a single temporary JSON for inspection. Never commit the exported monolith. The workflow checks all staged files against GitHub's 100 MiB limit before committing.

Tests cover source parsing, DOI/native identifier merging, version history, outages, preservation of stored papers, local CRUD, import/export, quota and malformed-data protection, and compatibility of the actual public snapshot. `COLLECTOR.md` documents search bounds and provenance.

## Data interpretation

Open **Paper library → Explore statistics & reading leads → Preliminary analysis** to inspect observed research topics, direction–method combinations, and abstract-based reading leads for the selected publication-date window, interest, and source. Each aggregate opens its supporting paper records. Paper details include original objective, methods, and results excerpts when recognizable, plus quoted validation or open-resource signals. These are deterministic reading aids, not model-generated summaries, full-text reviews, novelty claims, or quality scores. Missing/negative/planned evidence must not be presented as completed validation. See [ANALYSIS.md](ANALYSIS.md) for the rules and denominators. Conditional outlook cards are rule-based research scenarios, not calibrated probability forecasts.

The initial snapshot is a recent-paper sample. Queries have caps, tags are heuristic, and journal/preprint versions may remain distinct. Interest labels can overlap and do not rate quality or clinical validity. Expansion from two to ten interests changes collection coverage, so increased counts may partly reflect that scope change. Source errors preserve old records and are visibly reported; an empty HTTP response is never counted as zero new papers. Author names may be ambiguous. Coauthorship and matches to a user-created watchlist do not establish current team membership, competitive strength, or willingness to collaborate.

## Maintenance

Both locale entry pages include static Open Graph and Twitter `summary_large_image` metadata. The share cover is `public/social-preview-v1.png` (1200 × 630); its editable vector source is `public/social-preview-v1.svg`. Vite copies these public assets into every deployment. The same PNG can be attached directly to a social post if the link preview is unavailable. When changing the artwork, use a new versioned filename and update both HTML entry points.

Use **Actions → Research monitor sync → Run workflow** for an immediate refresh. Partial source outages publish the available result with source errors. When all sources fail, the workflow publishes validated failure metadata while retaining the library and marks the run failed. Pages output is checked against a deployment marker and public data SHA-256 before success is reported.

The existing homepage publishes from `main` at the repository root. This workflow preserves that setting and unrelated homepage files. GitHub may delay schedules or disable scheduled workflows after prolonged repository inactivity; check the Actions page if updates stop.
