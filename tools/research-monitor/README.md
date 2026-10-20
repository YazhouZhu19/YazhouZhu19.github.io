# OEVRYN Engine

**Research Intelligence for Medical Image Analysis**

汇聚研究证据，洞察医学影像前沿。

A public bilingual research platform connecting papers, open-source code and public updates to support evidence analysis and research direction, PI and team outlooks. Its paper dashboard covers 10 medical imaging research interests, including organ/lesion segmentation, human-in-the-loop clinical diagnosis, detection, reconstruction, registration, radiomics, prognosis, image–language understanding, intervention, and foundation models. The filter is named **感兴趣方向 / Research interests**. See [INTERESTS.md](INTERESTS.md) for the bilingual scope and design sources.

The primary workspace has five entrances: **论文洞察 / Paper insights**, **开源洞察 / Open-source insights**, **前沿动态 / Frontier updates**, **方向研判 / Research outlook**, and **PI / Teams**. The paper dashboard is the default view, with internal Overview, Paper library and Reading leads views. It retains the original metrics, direction and date distributions, publication status, task–modality matrix, methods, team matches and source health. Chart drill-through opens the integrated paper library and returns to its originating view with the dashboard filters preserved. The full archive, original abstracts, reading notes and source provenance remain available. Each additional-source dashboard combines aggregate statistics with its searchable repository/news library; scoped charts drill into the exact records counted. Saved papers and source diagnostics remain auxiliary entrances.

Research outlook has independent AI windows for discovering recurring directions and tasks in the library sample and exploring a custom research question. Each window has its own publication dates and forecast horizon. Team outlook applies the same AI workflow to a selected public author or user-confirmed name/ORCID watchlist. See [FORESIGHT.md](FORESIGHT.md) for AI models, evidence selection, inference limits and the retained legacy diagnostics.

- Chinese: https://yazhouzhu19.github.io/research-monitor/
- English: https://yazhouzhu19.github.io/research-monitor/en/

## Operation

GitHub Pages serves this Vite/React static application. The repository workflow `.github/workflows/research-monitor-sync.yml` collects public metadata directly from Europe PMC, arXiv, and medRxiv at minute 23 of each hour, then builds and publishes the snapshot. Scheduling and source indexing can be delayed; the dashboard shows source-specific status and last successful fetch times. It is periodic monitoring, not a guarantee of instantaneous or exhaustive coverage.

The collector and macro dashboard use deterministic keyword classification and statistics. Collection, browsing and the default local AI option require no AI API key, login service or paid backend. Optional AI analysis runs only after the reader clicks Analyze; it does not change source collection or the archive. The previous daily Codex check is not used. GitHub Actions and source API availability remain subject to their provider limits.

The **检查最新数据 / Check for updates** button checks the latest published snapshot. It shows progress and reports whether a newer snapshot was loaded, no published update was found, or the check failed; existing data and personal notes remain available on failure. It does not start source collection. The page also checks quietly every five minutes while visible. To collect sources immediately, a repository maintainer can run the GitHub workflow described below; publication takes a few minutes, and a successful check does not necessarily add papers.

The source status panel separates request failures from limited coverage and reports the last error-free fetch. Confirmed Europe PMC terminal pages are accepted even when the search count exceeds returned core records; count discrepancies remain recorded. If the medRxiv primary API fails, the collector uses the official alternate API and filters its all-category results locally. Recovered primary errors remain in request logs; unresolved failures name the affected source in the page warning. See [COLLECTOR.md](COLLECTOR.md) for pagination limits and fallback behavior.

## Additional public sources

GitHub projects and public announcements discovered through Google News and independent publisher RSS/Atom feeds each have a dashboard with an integrated searchable library. Readers can compare repositories, inspect linked papers, analyze the current source, or combine papers, GitHub and news in research outlook. PI analysis uses only explicit URL / DOI / arXiv links. News snippets are labelled as unverified discovery material; publisher claims and repository popularity are not independent scientific validation. See [SIGNALS.md](SIGNALS.md) for collection, caching, provenance and AI limitations.

The GitHub overview mirrors the paper dashboard: a global library / added-today strip, 7/30/90-day or custom date controls, headline metrics, latest-activity/initial-publication line charts, maintenance composition and direction/language breakdowns. Date filters default to latest repository activity; initial publication uses the GitHub repository creation timestamp, not first Release or conversion to public. Dropdowns reuse the paper dashboard selection component. Dates and "today" use Beijing time. The earliest collected batch is separately inspectable as an inferred baseline; old repositories found during backfill are additions to this library, not newly released projects. Chart drill-through preserves exact record IDs and the full library remains available from the global total.

The public-updates dashboard uses the same summary strip, controls, cards, line charts, and chart-to-library navigation. It defaults to a 30-day publication window and all collected leads, with directly relevant and review-needed records shown separately. Readers can switch to first collection dates, inspect message-type and publisher composition, and open recent messages. News dates and daily ingestion counts use Beijing time; publication is not collection, and multiple reports can describe the same work. The four scoped cards show message count, distinct publisher names, model-related messages, and tool/platform messages. Collection health remains available below the overview.

## AI research analysis

Visitors can choose **Qwen3-0.6B**, **Qwen3-1.7B** (default) or **Qwen3-4B** for free through WebLLM, without registering or entering a key. The first explicit analysis downloads approximately 350 MB, 1 GB or 2.3 GB of model files respectively, plus the runtime; the browser can cache them. A WebGPU-compatible browser and several GB of available GPU memory are recommended on a desktop device. A smaller model reduces the download but may produce weaker analysis. Models are not downloaded in the background; failed downloads or unsupported devices do not trigger an API request.

**Free cloud AI** avoids model downloads and WebGPU requirements. Visitors register for their own free **OpenRouter** account and enter a key held only in page memory. Choose automatic `openrouter/free` routing or a compatible free model from the live official catalog. Catalog retrieval sends no key, paper or question. It filters out paid prices, non-text models, missing JSON response support and insufficient context. Free requests enforce zero model prices; there is no automatic paid fallback. Catalog failure preserves the automatic route. Quotas, provider compatibility and queues still apply; faster inference is not guaranteed. The separate **Paid API** option requires an explicit choice and model ID. Reports name the actual model. See the [Qwen model card](https://huggingface.co/Qwen/Qwen3-1.7B), [OpenRouter catalog](https://openrouter.ai/api/v1/models), [limits](https://openrouter.ai/docs/api-reference/limits) and [personal API key page](https://openrouter.ai/settings/keys); these links were checked on 2026-10-14.

**Library landscape**, **custom research interest** and **PI / team analysis** each have independent publication dates and a 6-, 12- or 24-month forecast horizon. The default evidence window is the latest 90 Beijing calendar days. Direction analysis derives categories from paper text rather than requiring a preset direction or modality; custom questions accept natural Chinese or English without strict keyword filtering. Collection queries and the macro dashboard's existing ten interest labels are unchanged.

Each panel defaults to **Quick preview**, using at most 6 distinct works locally or 12 through the API to reduce repeated model calls. **Expanded analysis** raises this to 24 locally or 80 through the API. Both sample across publication times and sources, then process bounded batches. Quick mode trades evidence coverage for less work; counts distinguish the eligible corpus from the actual sample. Results separate observations, conditional forecasts, alternative explanations and validation steps, and every finding must cite supplied paper IDs. Structure and citation-ID validation do not prove that a model's interpretation is correct. These samples do not establish field-wide prevalence, growth or an unstudied research gap. Results, questions and window settings are retained only in session memory for returning from evidence views, and disappear on refresh. Changing model or depth invalidates the result and cancels in-flight analysis.

## Personal data

Saved papers, notes, and team/PI watchlists are stored only in localStorage under `medical-research-monitor:personal:v1`. Chinese and English pages share this browser data. The app does not upload saved-paper lists, reading notes or personal team lists. Local AI keeps the analysis inputs on the device. If the reader explicitly chooses OpenRouter, the sampled public paper/repository/news text and the question they enter are sent to OpenRouter and its model provider; the API key authenticates that request and is not saved in browser storage. Use **Local data → Export backup** before clearing browser data or moving devices. **Import backup** validates the file and requests confirmation before replacing both lists. Private/incognito sessions and blocked/full storage can prevent persistence. Old-site account data is not automatically transferred.

The PI / Teams page also offers a public author directory grouped by the ten research interests, alongside the original personal watchlist categories (ongoing interest, competitive observation and potential collaboration). Directory entries come from the current paper archive, not a fixed or verified PI roster. Selecting an author opens an AI analysis window and public-paper diagnostics without creating a personal watchlist; **Save to my watchlists** opens the existing form for confirmation. Direction filters apply to candidate counts and the assessment scope. Directory counts are library records, while outlook windows deduplicate works. Names and publication affiliations require identity checks and do not establish a lab's membership or current appointments.

Earlier rule-based assessment revisions and manual outcome reviews remain untouched under the separate local key `medical-research-monitor:assessments:v1`. Those records describe the previous rule-based feature; they are not AI-generated history and new AI runs do not write to them. The existing personal backup format is unchanged. AI results are session-only, with no fabricated retrospective forecasts, background notification or server-side personal tracking.

## Development

Requires Node.js 22.13 or later.

```sh
npm ci
npm run dev
npm test
npm run collect
npm run collect:signals
npm run build
npm run measure
npm run preview
```

### Resource budgets (Task P0.1)

Every build ends with `scripts/measure-budget.ts`. It writes `dist/budget-report.json` and prints raw/gzip byte sizes for every JS/CSS resource, startup datasets and aggregate startup costs. A resource without an explicit budget, or any raw/gzip limit exceeded, fails the build. `npm run measure` repeats the check against an existing build. For an intentional budget review, `npx tsx scripts/measure-budget.ts --report-only` writes the same report without failing on budget violations; it does not change any limit. Missing files, invalid manifests and inconsistent declared shard sizes still fail.

Initial code is traced from the actual built Chinese and English HTML through Vite's static import graph, with shared files counted once. `budget.json.initialDynamicEntries` can declare modules rendered immediately by a future lazy default view. Other views, WebLLM and its AI worker are reported separately as optional resources; externally fetched model weights are outside the build. `budget.json.initialData` must stay synchronized with loader changes. Currently startup loads the v2 paper manifest and every shard it references, plus the complete signals file. Previous generations and v1 compatibility files are retained on disk but do not count toward startup transfer.

The measured baseline on **2026-10-21 (Asia/Shanghai)** uses source revision `1a2c0da` and the October 20 22:35 local snapshots (8,326 papers and 50,790 GitHub/news records):

| Measured scope | Raw bytes | Gzip bytes |
|---|---:|---:|
| Initial JavaScript | 571,063 | 176,919 |
| Initial CSS | 263,903 | 43,892 |
| Paper manifest + 16 current shards | 68,812,492 | 11,215,528 |
| Signals | 48,640,306 | 7,847,487 |
| All startup data | 117,452,798 | 19,063,015 |
| Initial JS + CSS + data | 118,287,764 | 19,283,826 |

Gzip uses level 9 independently for each resource, so it differs slightly from Vite's default compression estimate. These are transfer-size estimates, not browser timings; HTML, images, request headers and external requests are excluded. Initial limits allow 2% for code and 5% for growing data, rounded up to 1 KiB; individual paper files keep the existing 4 MiB cap. They guard against regressions rather than asserting the current payload is acceptable. Tighten the reviewed limits after optimization; builds never rewrite them automatically.

`data/papers.json` is the persistent snapshot manifest. Its metadata and content-addressed `data/papers/<sha256>.json` shards preserve the complete paper library, with each file limited to 4 MiB. The collector reads legacy single-file snapshots too, and writes the sharded format atomically without dropping history. Do not replace the snapshot with an empty seed. The build produces `dist/data/public-papers-v2.json` with a shared query-URL dictionary, reducing repeated provenance strings without removing any records or fields. If the dictionary exceeds the manifest budget, this endpoint falls back to the supported v1 representation. The original `dist/data/papers.json` and its shards remain available for cached v1 clients. Node and Python build checks verify complete decoded equality against the source archive; the workflow publishes `dist/` into `/research-monitor/` and validates both endpoints. Both locale entry HTML files are built explicitly. Do not commit `node_modules`, private backups, credentials, or `.test-build`.

New archive and public snapshots group records by publication month, then sort IDs within each bucket before splitting at the 4 MiB limit. Manifest descriptors include `bucket` (`YYYY-MM`, or `YYYY-MM.part-N` for a split month). Missing, invalid and future dates use `undated`; future means later than the snapshot's `collectedAt`, so rebuilding the same snapshot never depends on the build clock. Writers also accept an explicit `asOf` for controlled migrations and tests. If no snapshot time is available, records remain in `undated`. After decoding, bucketed snapshots restore publication-date descending / ID order; legacy manifests without buckets retain their wire order.

Public query-URL dictionaries preserve previous indices and append new URLs, preventing an unrelated new query from rewriting older month shards. Records and provenance are preserved field for field. An older month's hash can still change when its record contents change, including a new collection provenance entry; stable bucketing only prevents changes caused by other months' insertions. Writers validate the final manifest before atomically replacing it and retain the preceding generation plus sibling manifest references for clients crossing a deployment.

`data/public-papers-v3.json` adds a lossless compact transport alongside the unchanged v1 and v2 endpoints. Each v3 wire record is `[flags, paper]`; flag `1` restores `originalAbstract` from `abstract` only when that field originally existed and was exactly equal. Absent, null and distinct originals remain distinguishable. Authors use `[name, orcid, affiliations, displayName?]` tuples, with optional presence bits and an extra-fields object preserving absent versus null ORCID and any other collected fields. Provenance uses `[queryUrlIndex, collectedAt, queryTrack, sourceRecordId]`, likewise extending with presence bits and extra fields so missing values are never silently replaced by null. Shared institutions are indexed in the manifest; strings with no net savings or no remaining manifest capacity stay literal. Paper-level affiliations reuse the same dictionary. Both dictionaries append entries without changing published indices; dictionary allocation reserves 256 KiB for metadata growth, and all manifests and shards retain the 4 MiB cap. If growing metadata cannot fit a v3 dictionary, that endpoint can carry the lossless v2 or v1 representation instead. Clients prefer v3, then fall back to v2 and v1 if the preferred endpoint is unavailable or invalid; decoded records are verified against the complete archive in Node and Python.

On the saved 8,326-paper snapshot (`collectedAt: 2026-10-20T14:35:21.416Z`), v3 reduces raw shard bytes from 66,577,673 to 46,603,678 (30.00%). Including each format's manifest, raw bytes fall by 26.62%, while independently gzipped HTTP resources fall by 4.41% (11,140,619 to 10,649,085 bytes, gzip level 9). These are measured transport sizes, not a promise that future datasets achieve the same percentage. All 8,326 complete records compare equal in the Node and Python checks.

The browser fetches the versioned public manifest fresh, reuses the last validated library when the manifest is identical, and otherwise loads at most four immutable shards concurrently, verifying byte lengths, SHA-256 hashes, counts and unique paper IDs before showing a complete snapshot. It retains the existing displayed data if any shard fails. One previous generation of shards is retained for clients spanning a deployment. The dashboard still loads the complete library for its existing searches and aggregate statistics. Statistics reuse a Beijing date formatter and cached abstract analysis; auxiliary views and Recharts load on demand. The overview uses lightweight horizontal bars for interest-direction counts, a task/modality dot matrix, and linear method dot plots, with exact native controls and paper drill-through. Direction bars share a zero-based linear scale and keep exact values visible; the preliminary direction/method combinations retain their area-scaled bubbles. Overlapping labels never imply mutually exclusive shares. Reduced-motion preferences disable chart entrance animations and bar transitions.

Verified paper shards are also retained in the optional `rm-shards-v1` Cache Storage cache, independently
of personal data. Every cache hit is checked against its declared byte length and SHA-256 before use.
A new page can reuse unchanged shards without downloading them; changed manifests request only missing
hashes. Cache denial, quota exhaustion and private mode fall back to network loading. Successful complete
loads retain the current and preceding cache generations; failed or cancelled loads never publish a
partial library or prune the last successful generation.

Use `npx tsx scripts/snapshot-cli.ts check data/papers.json` to verify a snapshot, `migrate data/papers.json` to convert a legacy file without fetching sources, or `export data/papers.json /tmp/papers.json` to reconstruct a single temporary JSON for inspection. Never commit the exported monolith. The workflow checks all staged files against GitHub's 100 MiB limit before committing.

Tests cover source parsing, DOI/native identifier merging, version history, outages, preservation of stored papers, local CRUD, import/export, quota and malformed-data protection, and compatibility of the actual public snapshot. AI tests cover date bounds, distinct-work sampling, scoped inputs, prompt data projection, output/citation validation, batching, cancellation, API request policy and failure handling using controlled responses; these do not establish live cloud-provider availability or real-model research accuracy. `COLLECTOR.md` documents search bounds and provenance.

## Data interpretation

Open **Paper library → Explore statistics & reading leads → Preliminary analysis** to inspect observed research topics, direction–method combinations, and abstract-based reading leads for the selected publication-date window, interest, and source. Each aggregate opens its supporting paper records. Paper details include original objective, methods, and results excerpts when recognizable, plus quoted validation or open-resource signals. These are deterministic reading aids, not model-generated summaries, full-text reviews, novelty claims, or quality scores. Missing/negative/planned evidence must not be presented as completed validation. See [ANALYSIS.md](ANALYSIS.md) for the rules and denominators. The AI outlook is a separate, explicitly invoked workflow. Its conditional hypotheses are not calibrated probability forecasts. The old rule-based engine remains for paper-trajectory and comparison diagnostics; it is not presented as AI output.

The initial snapshot is a recent-paper sample. Queries have caps, tags are heuristic, and journal/preprint versions may remain distinct. Interest labels can overlap and do not rate quality or clinical validity. Expansion from two to ten interests changes collection coverage, so increased counts may partly reflect that scope change. Source errors preserve old records and are visibly reported; an empty HTTP response is never counted as zero new papers. Author names may be ambiguous. Coauthorship and matches to a user-created watchlist do not establish current team membership, competitive strength, or willingness to collaborate.

## Maintenance

Both locale entry pages include static Open Graph and Twitter `summary_large_image` metadata. The share cover is `public/social-preview-v2.png` (1200 × 630); its editable vector source is `public/social-preview-v2.svg`. Vite copies these public assets into every deployment. The same PNG can be attached directly to a social post if the link preview is unavailable. When changing the artwork, use a new versioned filename and update both HTML entry points.

Use **Actions → Research monitor sync → Run workflow** for an immediate refresh. Partial source outages publish the available result with source errors. When all sources fail, the workflow publishes validated failure metadata while retaining the library and marks the run failed. Pages output is checked against a deployment marker and public data SHA-256 before success is reported.

The existing homepage publishes from `main` at the repository root. This workflow preserves that setting and unrelated homepage files. GitHub may delay schedules or disable scheduled workflows after prolonged repository inactivity; check the Actions page if updates stop.
