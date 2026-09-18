# Medical Image Research Monitor / 医学影像科研观察

A public bilingual research dashboard covering 10 medical imaging research interests, including organ/lesion segmentation, human-in-the-loop clinical diagnosis, detection, reconstruction, registration, radiomics, prognosis, image–language understanding, intervention, and foundation models. The filter is named **感兴趣方向 / Research interests**. See [INTERESTS.md](INTERESTS.md) for the bilingual scope and design sources.

- Chinese: https://yazhouzhu19.github.io/research-monitor/
- English: https://yazhouzhu19.github.io/research-monitor/en/

## Operation

GitHub Pages serves this Vite/React static application. The repository workflow `.github/workflows/research-monitor-sync.yml` collects public metadata directly from Europe PMC, arXiv, and medRxiv at minute 23 of each hour, then builds and publishes the snapshot. Scheduling and source indexing can be delayed; the dashboard shows source-specific status and last successful fetch times. It is periodic monitoring, not a guarantee of instantaneous or exhaustive coverage.

The collector and dashboard use deterministic keyword classification and statistics. No ChatGPT, LLM, AI API key, login service, paid backend, or model token is required for operation. The previous daily Codex check is not used. GitHub Actions and source API availability remain subject to their provider limits.

The **检查最新数据 / Check for updates** button checks the latest published snapshot. It shows progress and reports whether a newer snapshot was loaded, no published update was found, or the check failed; existing data and personal notes remain available on failure. It does not start source collection. The page also checks quietly every five minutes while visible. To collect sources immediately, a repository maintainer can run the GitHub workflow described below; publication takes a few minutes, and a successful check does not necessarily add papers.

## Personal data

Saved papers, notes, and team/PI watchlists are stored only in localStorage under `medical-research-monitor:personal:v1`. Chinese and English pages share this browser data. Nothing personal is uploaded by the app. Use **Local data → Export backup** before clearing browser data or moving devices. **Import backup** validates the file and requests confirmation before replacing both lists. Private/incognito sessions and blocked/full storage can prevent persistence. Old-site account data is not automatically transferred.

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

`data/papers.json` is the persistent public metadata snapshot. Do not replace it with an empty seed on every run. The build copies it to `dist/data/papers.json`; the workflow publishes `dist/` into the repository's `/research-monitor/` subtree. Both locale entry HTML files are built explicitly. Do not commit `node_modules`, private backups, credentials, or `.test-build`.

Tests cover source parsing, DOI/native identifier merging, version history, outages, preservation of stored papers, local CRUD, import/export, quota and malformed-data protection, and compatibility of the actual public snapshot. `COLLECTOR.md` documents search bounds and provenance.

## Data interpretation

Open **初步分析 / Preliminary analysis** to inspect observed research topics, direction–method combinations, and abstract-based reading leads for the selected publication-date window, interest, and source. Each aggregate opens its supporting paper records. Paper details include original objective, methods, and results excerpts when recognizable, plus quoted validation or open-resource signals. These are deterministic reading aids, not model-generated summaries, full-text reviews, novelty claims, or quality scores. Missing/negative/planned evidence must not be presented as completed validation. See [ANALYSIS.md](ANALYSIS.md) for the rules and denominators.

The initial snapshot is a recent-paper sample. Queries have caps, tags are heuristic, and journal/preprint versions may remain distinct. Interest labels can overlap and do not rate quality or clinical validity. Expansion from two to ten interests changes collection coverage, so increased counts may partly reflect that scope change. Source errors preserve old records and are visibly reported; an empty HTTP response is never counted as zero new papers. Author names may be ambiguous. Coauthorship and matches to a user-created watchlist do not establish current team membership, competitive strength, or willingness to collaborate.

## Maintenance

Both locale entry pages include static Open Graph and Twitter `summary_large_image` metadata. The share cover is `public/social-preview-v1.png` (1200 × 630); its editable vector source is `public/social-preview-v1.svg`. Vite copies these public assets into every deployment. The same PNG can be attached directly to a social post if the link preview is unavailable. When changing the artwork, use a new versioned filename and update both HTML entry points.

Use **Actions → Research monitor sync → Run workflow** for an immediate refresh. Partial source outages publish the available result with source errors. When all sources fail, the workflow publishes validated failure metadata while retaining the library and marks the run failed. Pages output is checked against a deployment marker and public data SHA-256 before success is reported.

The existing homepage publishes from `main` at the repository root. This workflow preserves that setting and unrelated homepage files. GitHub may delay schedules or disable scheduled workflows after prolonged repository inactivity; check the Actions page if updates stop.
