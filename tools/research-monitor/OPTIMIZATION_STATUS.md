# Optimization execution record

Plan: [OPTIMIZATION_PLAN.md](OPTIMIZATION_PLAN.md). Baseline revision: `1a2c0da`.
Started: 2026-10-21 (Asia/Shanghai).

Measurements are taken from the current archive and build. Figures in the supplied plan are reference
observations, not targets to reproduce by changing data. No collected records or compatibility endpoints
may be removed to meet a performance budget.

Each task has its own commit. Validation and any unmet acceptance criteria are recorded below.
Classification labels remain provisional until the maintainer reviews them. Provisional evaluation
scores must not be presented as independently validated accuracy.

## Task status

| Task | Status | Evidence / next step |
| --- | --- | --- |
| P0.1 | Complete | Measured entry graph and data; explicit per-resource regression budgets fail the build. |
| P0.2 | AI review complete; gold pending | 400 frozen records reviewed; 51 records conservatively revised, originals retained; no human gold claim. |
| P1.1 | Complete | Month/ID buckets, append-only URL dictionary and single atomic manifest replacement. |
| P1.3 | Complete | Verified Cache Storage reuse, bounded generation retention and safe storage fallback. |
| P1.6 | Complete | Both manifest readers use conditional revalidation; hidden-page suspension and bounded backoff integrated. |
| P1.4 | Complete | Kind/month shards, compact exact overview and on-demand records; retry and stale-drill guards verified. |
| P1.2 | Complete | Lossless v3 transport; raw shards reduced 30.001%; v1/v2 compatibility retained. |
| P1.5 | Complete | Worker fetch/decode/validate/index/search, cancellation and validated fallback; initial local longest task 97 ms. |
| P1.7 | Implemented; live timing pending | Shallow checkout, fail-closed verification, 800 MB guard and exact generation cleanup tested. |
| P3.1 | Complete | Prettier 3.6.2, width 110; formatting-only pass preserves 417 + 25 passing tests and build. |
| P3.2 | Complete | Workspace reduced from 1,389 to 253 lines; 14 extracted files ≤253 lines, bilingual SSR unchanged. |
| P2.1 | Complete | Removed 48 unreachable UI modules, an orphan chart view and 13 unused dependencies. |
| P2.2 | Implemented | Main JS 41,129 B gzip; source/paper UI lazy; startup total still explicitly counts vendors and Worker. |
| P2.3 | Pending | List containment, stable chart inputs and shared derived indexes. |
| P2.4 | Implemented | Shared hash state, push/replace navigation, locale preservation and generation-bound drill recovery; 11 URL tests pass. |
| P3.3 | Pending | Design tokens, CSS consolidation, responsive and dark-mode checks. |
| P3.4 | Pending | Shared dashboard shell while preserving metrics. |
| P3.5 | Pending | Severity-based notices with all limitation text retained. |
| P3.6 | Pending | Shared loading, empty and error states. |
| P3.7 | Pending | Accessibility and mobile interaction checks. |
| P4.1 | Pending | Scope classifier and default research scope; reviewed labels required for acceptance. |
| P4.2 | Pending | More precise diagnosis tagging; reviewed labels required for acceptance. |
| P4.3 | Pending | Publication-date provenance and future-date handling. |
| P4.4 | Pending | Conservative work grouping without merging source records. |
| P4.5 | Pending | Question-aware bilingual retrieval and deterministic diverse sampling. |
| P4.6 | Pending | Model-specific input budgets and excerpts. |
| P4.7 | Pending | Author-position counts and non-merging identity hints. |
| P4.8 | Pending | Repository maturity tiers and provisional relevance review. |
| P4.9 | Pending | News event grouping with individual reports retained. |
| P4.10 | Pending | Collection-method annotations, proportions and uncertainty. |
| P5.1 | Pending | PR and synchronization quality gates. |
| P5.2 | Pending | Bilingual local-fixture smoke tests. |
| Section 6 | Deferred by plan | Requires at least 30 days after new formats launch and maintainer approval. |

## Explicit review gates

- **P0.2:** Review the provisional paper labels before designating `eval/relevance-gold.csv`.
- **P1.7:** Review `docs/data-hosting-options.md`; no orphan-branch migration, history rewrite or
  scheduling change is authorized by preparing the options.
- **P4.8:** Review provisional repository labels before changing the `direct` relevance rules.
- **Section 6:** Keep old endpoints active; a 30-day observation period and explicit decision are required.

## Validation notes

- **P0.1 (2026-10-21):** Initial JS 571,063 raw / 176,919 gzip bytes; CSS 263,903 /
  43,892; data 117,452,798 / 19,063,015. Includes 8,326 papers and 50,790 signals.
  `budget.json` preserves the original baseline and the compression method. Six new budget checks
  passed. Full test chain: 341 TypeScript tests plus 23 local API tests passed (includes independent
  cache/bucket tests being prepared in parallel). TypeScript, Vite, data copy/round-trip checks and
  budget validation passed; `dist/budget-report.json` contains no violations.
  The runtime provides Node but no npm executable, so the scripts were run using their equivalent
  direct Node commands. These byte measurements are not browser timings.
- **P1.1:** Real-archive simulation appended five records (8,326 → 8,331): only one current-month
  shard changed in both archive (84 shards) and public v2 (64 shards). Other months stayed identical.
  The v2 payload is 68,822,944 raw / 11,140,619 gzip bytes; month boundaries add 10,452 raw bytes
  and save 74,909 gzip bytes compared with the original baseline. Eight new stability tests, the
  snapshot CLI integrity check and Python full-field v1/v2 comparison passed. Final shared-tree
  validation: 353 TypeScript + 24 local API + 9 Python tests, typecheck and complete build/budget
  passed. Changes to historical records or their provenance legitimately change their own buckets.
- **P1.3:** Six cache behavior tests plus a local API integration test cover reloads, changed hashes,
  poisoned cache entries, invalid network bytes, cancellation, blocked storage and quota failures.
  A fresh loader requests zero unchanged shards; changing one of two fixture shards makes exactly one
  shard request. Metadata-only changes request no shards. The final P1.1 shared-tree validation above
  included this completed integration and its full build/budget checks. Real updates can touch more
  than three shards when historical records are actually revised; the cache does not suppress updates.
- **P1.6 infrastructure:** ETag/If-None-Match, bodyless 304 reuse, unchanged-200 object reuse,
  bounded stream reads and cancellation passed four tests. Three scheduler tests cover 5/10/20/40/60
  minute delays, visibility changes, non-overlapping checks and cleanup. The public API now uses the
  conditional reader; 375 TypeScript and 24 local API tests passed in the shared tree. Typecheck and
  Vite/data-copy/budget checks passed. Final signals scheduling is integrated with P1.4 because the
  old single-file signals endpoint has no separate manifest. The <5 KiB polling target depends on a
  server returning 304; a host that ignores ETag may send the full unchanged manifest.

- **P1.2:** On all 8,326 saved records, raw shard bytes decrease from 66,577,673 to
  46,603,678 (30.001%). Total with manifest is 50,501,670 raw / 10,649,085 gzip bytes;
  including manifests, the raw reduction is 26.62% and gzip reduction is 4.41%. Node and
  Python comparisons preserve every source field, unknown extras, missing values and nulls.
  Nine v3 TypeScript and eleven snapshot Python checks passed, including strict malformed-input
  rejection. The browser preference/fallback integration is committed with P1.5's shared loader.

- **P1.4 / P1.6 integration:** 48,410 GitHub + 2,380 news records round-trip exactly.
  The signals overview manifest is 259,124 raw / 36,437 gzip bytes; 227 kind/month shards
  total 25,261,240 raw / 7,487,431 gzip bytes. The default paper view makes no signals
  requests; each source overview needs only the manifest, while library, custom filters,
  drill-through and explicit AI source selection request that kind's records. Snapshot-day
  aggregates are labeled as such. The old flat endpoint remains available. Tests cover
  exact aggregate/drill equivalence, first-load retry, stale selection cancellation, importer
  failure, and an aborted reader that never settles. Conditional polling touches only
  manifests for already requested sources and retains complete previous data on failure.

- **P1.5:** The default module Worker loads v3 with validated v2/v1 fallback, hashes and
  decodes shards, validates public data and builds the shared search/facet index. Main-thread
  fallback handles unsupported/failed Worker startup; data errors do not trigger duplicate
  loading. Bounded chunks transfer records, and generation/abort guards reject stale loads
  and searches. Nineteen Worker/loader tests and 25 local API tests passed. The measured
  unthrottled local Chromium initial load had one 97 ms long task and no browser errors;
  `docs/performance-phase1.json` records the probe output. This is not a 4× CPU or field INP
  claim. The reproducible local-only probe is generated by `scripts/instrument-preview.ts`.
  Startup budgeting now explicitly counts the Worker (18,289 gzip bytes), which duplicates
  validation code; total initial JS is 195,386 gzip bytes before P2 splitting. With v3 and
  signals deferred, initial data is 10,649,085 gzip bytes, versus 19,063,015 at baseline.

- **P1 shared integration validation:** 417 TypeScript + 25 local API tests passed.
  Full `npm run build` (typecheck, Vite, data round-trip/copy, retention and budget) passed.
  The sandbox blocks tsx CLI IPC, so that build ran with approved local execution.

- **P1.7:** A real mixed-generation build was reduced from 593,700,553 to 435,051,781
  bytes by removing 38 unreferenced shards (158,648,772 bytes), retaining 406 required
  current/previous/compatibility shards. Three governance tests, thirteen Python tests,
  complete paper/signals equality, YAML and embedded shell/Python syntax checks passed.
  CI checkout now uses depth 1; server comparison verifies lost push responses without
  pretending an API failure proves ancestry. Unverified results rebuild/retry within the
  existing limit, then fail if publishing remains unconfirmed. Both pre-publication and
  assembled output enforce 800,000,000 bytes. Actual CI checkout time and hourly commit
  delta require a deployed run and are not claimed here. Long-term branch/history options
  are documented only; history and synchronization frequency remain unchanged.

- **P3.1:** Added pinned Prettier 3.6.2 and format/format:check scripts (width 110).
  Reformatted lib/components/scripts/styles/hooks/tests and entry/config files without logic
  edits. Large data, output, vendored code and frozen evaluation records are ignored.
  Before and after: 417 TypeScript + 25 local API tests pass. Typecheck, Vite, complete
  data copy/validation, publication retention and explicit budget checks pass. Lockfile
  changes are limited to Prettier; unrelated npm normalization was not retained.

- **P0.2 / requested AI review:** Frozen 400-paper stratified sample and complete evidence
  were independently reread in a second AI pass: 217 provisionally agreed, 67 changes suggested,
  85 boundary cases and 31 missing abstracts. Reconciliation of all 67 against full abstracts
  accepted 42, partially accepted 9 and deferred 16; 51 records changed in a separate AI-reviewed
  CSV (3 scope changes and 50 track changes, overlapping). Original CSV, annotations and frozen
  evidence remain byte-identical. Each new annotation explicitly remains humanConfirmed=false.
  Ten evaluation tests, diagnostic reports and the strict gold rejection check passed. Metrics
  remain provisional; the balanced audit sample is not a population accuracy estimate.

- **P3.2:** Extracted snapshot/personal/library hooks and sidebar, header, filters, library and detail components. All 14 files are at most 253 formatted lines; the 87-module import graph is acyclic. Chinese and English initial server-rendered HTML matches the original apart from generated React IDs. 420 TypeScript and 25 local API tests, typecheck, Vite and data-copy checks passed; final resource budgets are rechecked with P2.2 splitting.

- **P2.1:** Import-graph and CSS audits identify 48 unreachable UI modules and the orphan Recharts view. Removed 13 direct packages; runtime dependencies fall from 24 to 11 and lockfile entries from 292 to 234, with no surviving package version changes. Kept sonner, animation CSS and 13 reachable UI modules. Typecheck and 420 + 25 tests pass. Resource measurements are finalized with P2.2; no data records changed.

- **P2.2:** Added Rolldown module reports (`stats.html` plus JSON), stable React/Radix vendor groups and lazy paper/source/AI interfaces. Main JS measures 131,483 raw / 41,129 gzip bytes, within the 110,000-byte gzip target. Total initial JS including shared vendors and the P4 classifier draft Worker is 205,184 gzip bytes, higher than P1's 195,386; this overhead is explicitly budgeted and documented. 434 shared-tree TypeScript tests, typecheck, Vite, all snapshot round trips and budget checks passed; local API checks include complete classified-record equality. Local browser confirms 8,326 records with no console errors. New lazy CSS resource budgets reflect P3 relocation; its final main CSS target is tracked separately.

- **P2.4:** Shareable hash state covers the main view, paper/overview/date/source/search and advanced filters. History pushes view changes and replaces filter edits; both browser events restore state. Drill IDs never enter URLs and cannot cross document or snapshot generations. Eleven focused history/normalization tests and the 446-test shared TypeScript suite pass; typecheck and production build passed. Bilingual end-to-end validation is tracked in P5.2.
