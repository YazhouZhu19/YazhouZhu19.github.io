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
| P0.2 | In progress | Export a reproducible 400-paper sample, provisional labels and evaluation tooling. |
| P1.1 | Designed | Stable month buckets also need append-only provenance URL dictionaries. |
| P1.3 | Pending | Cache only verified shards; retain current and previous generations. |
| P1.6 | Pending | Conditional manifest requests and polling backoff. |
| P1.4 | Pending | Separate GitHub/news transport, preaggregated overview and on-demand loading. |
| P1.2 | Pending | Lossless v3 paper transport with v2/v1 fallback. |
| P1.5 | Pending | Worker loading, validation and search with a fallback path. |
| P1.7 | Pending | Shallow checkout, directory size guard and generation cleanup. |
| P3.1 | Pending | Formatting-only commit. |
| P3.2 | Pending | Split workspace responsibilities into hooks and components. |
| P2.1 | Pending | Remove verified-unused UI modules and dependencies. |
| P2.2 | Pending | Measure and reduce the initial JavaScript bundle. |
| P2.3 | Pending | List containment, stable chart inputs and shared derived indexes. |
| P2.4 | Pending | Shareable hash state and browser navigation. |
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
