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
| P1.7 | Implemented; live timing pending | Shallow checkout, fail-closed verification, 800 MB publication / 950 MB complete-root guards and exact generation cleanup tested. |
| P3.1 | Complete | Prettier 3.6.2, width 110; formatting-only pass preserves 417 + 25 passing tests and build. |
| P3.2 | Complete | Workspace reduced from 1,389 to 253 lines; 14 extracted files ≤253 lines, bilingual SSR unchanged. |
| P2.1 | Complete | Removed 48 unreachable UI modules, an orphan chart view and 13 unused dependencies. |
| P2.2 | Implemented | Main JS is below the fixed 110 KB gzip target; final sizes are in docs/resource-measurements.json, including vendors and Worker. |
| P2.3 | Implemented; performance acceptance unverified | Full-data 4× CPU runner records real timings; native-control coverage is incomplete and is never counted as a pass. |
| P2.4 | Implemented | Source/PI public context and version-bound drill restoration; 20 focused tests and 28 bilingual browser checks pass. |
| P3.3 | Implemented; final visual checks ongoing | One token system and dark palette; 5,404 selector/property pairs retained; main CSS remains below 120,000 B. |
| P3.4 | Implemented | Shared shell/slots, four/two-column metrics and accessible description tooltips; bilingual SSR verified. |
| P3.5 | Implemented | Single global error banner, expandable warning/info notices; original explanations retained. |
| P3.6 | Implemented | Shared bilingual loading/empty/retry states across paper, source, reading and AI views. |
| P3.7 | Implemented | Eight bilingual axe pages: no serious/critical issues; mobile drawers/filters/details and 40px controls pass. |
| P4.1 | Implemented; accuracy gate unmet | Default methods scope with all-record switch; diagnostic P/R 92.5%/86.9%, out→core 31.5% (target ≤3%). |
| P4.2 | Implemented; precision gate unmet | Diagnosis precision 48.9%→79.8%, recall 66.3%→64.4% on provisional labels; other nine directions unchanged. |
| P4.3 | Implemented | Earliest valid nonfuture date, raw-date provenance, unresolved future badges; 117 focused tests pass. |
| P4.4 | Implemented; human group audit pending | 8,326 records → 8,170 probable works; candidate-version links and work count. 20 groups AI-reviewed only. |
| P4.5 | Implemented | BM25 plus bilingual expansions, explicit no-match result, tag-diverse landscape; 34 focused tests and three query comparisons. |
| P4.6 | Implemented | Complete-sentence excerpts with excerpted/omitted-budget states, per-model caps, lightweight preview 4 items; 69 related tests pass. |
| P4.7 | Implemented | Work-level author positions, senior/works sorting and non-merging identity hints; 44 focused tests pass. |
| P4.8 | Implemented; human relevance audit pending | All 48,410 repositories retained; 7,240 established/active by metadata. 200 provisional labels; direct rules unchanged. |
| P4.9 | Implemented | 2,380 reports → 2,318 event leads; all reports expandable, no source records merged. |
| P4.10 | Implemented | Explicit version markers, source/period denominators and Wilson/Newcombe intervals; missing source history is not inferred. |
| P5.1 | Implemented; live CI pending | Both workflows check format/build/budgets; PR evaluation job summary stays provisional. |
| P5.2 | Final local validation ongoing; live CI pending | Bilingual smoke, axe, mobile/tablet and injected chunk-failure recovery checks; external requests blocked. |
| Section 6 | Deferred by plan | Requires at least 30 days after new formats launch and maintainer approval. |

## Explicit review gates

- **P0.2:** Review the provisional paper labels before designating `eval/relevance-gold.csv`.
- **P1.7:** Review `docs/data-hosting-options.md`; no orphan-branch migration, history rewrite or
  scheduling change is authorized by preparing the options.
- **P4.4:** The 20 candidate work groups have been AI-reviewed, not human-reviewed. Candidate
  links remain explicitly provisional and never merge the original records.
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

- **P2.3:** Paper rows retain incremental loading and add content visibility/intrinsic sizing (disabled for print). Timeline, ring and source charts are memoized; paper chart callbacks and matrix columns remain stable across unrelated renders. Source facets reuse the Worker index, including the library change shipped with P2.4. Timer/listener cleanup was inspected in snapshot, personal, signal, URL and viewport hooks. The shared 446-test suite, typecheck and Vite build pass. The 4× CPU <200 ms acceptance is not yet verified; initial QA timings varied under concurrent builds and are not presented as field INP.

- **P3.3:** Consolidated colors/spacing/type/radius/shadow into tokens, merged legacy layers and moved reading/AI/library CSS to lazy views. Audit retains all 5,404 existing selector/property pairs. Outside token definitions and breakpoints, color literals fall 662→0, spacing 1,517→0, font sizes 556→0 and radii 165→0. Main CSS measures 117,360 raw bytes versus baseline 263,903, meeting the 120,000-byte target before later features. Core text contrasts are at least 4.62 light/8.03 dark. Typecheck, 446 shared tests and build pass. Responsive visual checks are ongoing; in-app viewport screenshots show a scaling artifact despite correct DOM widths, so clean browser screenshots are required before final visual acceptance.

- **P4.1:** Independent scope rules and version metadata are calculated for old records in the Worker and for the complete archive by the collector. The UI applies methods-only by default to overview, reading clues, team directory and AI inputs, with clinical/all switches and explicit excluded counts; saved personal papers remain available. Offline migration preserves all 8,326 records and original non-derived fields. Current archive counts are 3,960 core / 2,829 adjacent / 1,537 out. On the provisional AI-reviewed 400, core precision/recall are 92.5%/86.9%, but 17/54 annotated-out records become core (31.5%), missing the ≤3% target. This is an unresolved accuracy gate, not gold-standard validation.

- **P4.2:** Explicit diagnosis action/object and accuracy rules replace bare diagnosis mentions. A separate task version triggers complete retained-record reclassification without changing taxonomy IDs/version. Full-archive diagnosis count is 4,257→1,666; all other nine directions are unchanged. Provisional precision improves to 79.8% but does not meet 85%; recall falls 1.9 percentage points. Public old-data fallback uses the same rules, with full-record tests and an offline migration checking identity, ordering, non-derived fields and collection time. The UI and README mark the version change so it is not interpreted as a research trend.

- **P4.3–P4.7 integration:** Date normalization preserves all original date fields and flags 43 unresolved future EPMC records; a later source refresh may supply an earlier valid date, but none is invented. Conservative title/author grouping adds 152 groups and preserves 8,326 records. The 20-group audit is AI-assisted (11 with matching abstracts, nine missing one abstract), never a claim of human review. See `eval/work-groups.md`. Question retrieval and local model budgets are documented in `docs/question-retrieval.md` and `docs/local-model-budgets.md`; lexical matching can include adjacent themes and token estimates are approximate. All paid/free and citation boundaries remain in place.

- **P4.6 excerpt follow-up:** Small budgets select complete source sentences, keeping stated limitations
  and negative conclusions instead of cutting words or omission markers. `excerpted` marks partial
  coverage; empty `omitted-budget` means no full sentence fit, not that the source lacked an abstract.
  Source text, questions and citation IDs remain unchanged. The 300/180/80-character boundaries,
  explicit single-sentence omission and a 2,000-Han-character question with four long titles pass in
  the actual 0.6B budget path. Standard batch counts do not increase. All 69 related local/mocked tests
  and TypeScript checks pass; no live model quality or latency claim is made.

- **P4.8:** Metadata maturity is 2,376 established / 4,864 active / 41,170 early.
  All 48,410 repositories remain searchable; the default overview excludes early records and
  offers an explicit switch. On the frozen default 30-day window, the overview changes from
  5,229 to 2,255 records. The 200-item direct-relevance audit has 171 provisional yes,
  eight no and 21 uncertain labels. Its stratified counts do not estimate population precision.
  No `direct` rule was tightened using unconfirmed labels. See `eval/github-quality-report.md`.

- **P4.9:** Conservative complete-link title/time clustering yields 2,318 event leads from
  2,380 reports, including 51 multi-report groups containing 113 reports. The default 30-day
  view has 450 reports / 421 leads. Titles use character trigrams, similarity ≥0.6 and a
  seven-day maximum span; unidentified dates and short generic titles remain singletons.
  Event leads are possible shared announcements, not verified independent scientific outcomes.
  All original reports, publisher identities and URLs remain available. See
  `eval/news-clustering-report.md`.

- **P4.10:** The same-period/source denominator is preserved before direction filtering,
  including all-time source views where the selected direction starts later. Equal adjacent
  windows use Wilson single-proportion and Newcombe difference intervals; either window
  below 30 records suppresses directional conclusions. Source comparisons load on demand
  so overview startup remains manifest-only. Seventy-one focused checks cover denominators,
  invalid dates, empty windows, exact zero/one intervals and marker positioning. Version
  dates are shown only when present in explicit metadata. Historical source-addition dates
  cannot be reconstructed reliably from current manifests and are left unmarked.

- **Remaining classification limitations:** Scope false positives include general computer
  vision or industrial imaging that mentions medical examples, and opinion/review articles
  mentioning AI without evaluating an imaging method. Diagnosis false positives include
  image-quality/site labels and auxiliary classification probes. The frozen labels also
  contain unresolved main-task versus auxiliary-task boundaries and 31 missing abstracts.
  These explain why keyword rules and AI labels cannot establish the outstanding precision
  targets. Record-specific exceptions were not introduced to inflate the evaluation score.


- **P2.3 final implementation:** Immutable snapshot metadata caches publication/discovery facts,
  source counts and work identity keys. Filtered work groups are still recomputed from each subset;
  caching does not change group membership. All three dashboards share native 40px selectors.
  The full-data 4× CPU probe cannot commit native keyboard selection in this headless environment;
  it explicitly reports those latencies as unknown. Synthetic fallback only checks behavior.
  Remaining recorded library interactions and the coverage flag are preserved in
  `docs/screenshots/full-data-audit.json`; no full <200 ms acceptance claim is made.

- **P5.2 recovery and visual fixes:** A top-level localized error boundary makes a failed lazy-view
  import recoverable through explicit reload while retaining the URL and saved personal data.
  Tests inject a 404 and verify recovery without an automatic reload loop. Visual review of the
  96-image matrix found and repaired tablet PI overflow, clipped mobile library choices, and
  overlapping source-filter action buttons. Final screenshots must correspond to the final build.


- **P1.7 whole-root follow-up:** Pages serves the repository root, which also includes tracked
  source archives. In addition to the 800 MB generated-subtree check, publication now measures
  every staged Git blob at every published path and fails above 950,000,000 bytes. Missing
  objects, unsupported file modes, unmerged entries and Git failures cannot produce a passing
  zero-size result. Seven new boundary/failure checks and all 20 Python tests pass; the real
  index passes and a one-byte threshold exits with failure. This gate runs after staging the
  generated publication and before commit/push. See `docs/data-hosting-options.md` for the
  distinction between the old checked-in publication and the replacement build estimate.


- **Resumed integration (2026-10-25):** Completed source and public PI share links, including
  separate per-kind shard signatures so same-timestamp data changes invalidate stale selections.
  Fixed the interrupted implementation's missing drill-generation type. TypeScript, 20 focused
  URL/state tests and all 28 bilingual browser checks pass (41 seconds). Production Vite build,
  full paper/signals round-trip, retention and all resource budgets pass. Earlier full integration
  covered 519 TypeScript, 25 local API and 20 Python tests; the subsequent one-test addition
  is covered by the focused URL run. Final screenshots are refreshed separately.
