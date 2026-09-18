# Medical Image Research Monitor / 医学影像科研观察

A public bilingual research dashboard for organ/lesion segmentation and human-in-the-loop clinical diagnosis.

- Chinese: https://yazhouzhu19.github.io/research-monitor/
- English: https://yazhouzhu19.github.io/research-monitor/en/

## Operation

GitHub Pages serves this Vite/React static application. The repository workflow `.github/workflows/research-monitor-sync.yml` collects public metadata directly from Europe PMC, arXiv, and medRxiv at minute 23 of each hour, then builds and publishes the snapshot. Scheduling and source indexing can be delayed; the dashboard shows source-specific status and last successful fetch times. It is periodic monitoring, not a guarantee of instantaneous or exhaustive coverage.

The collector and dashboard use deterministic keyword classification and statistics. No ChatGPT, LLM, AI API key, login service, paid backend, or model token is required for operation. The previous daily Codex check is not used. GitHub Actions and source API availability remain subject to their provider limits.

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

The initial snapshot is a recent-paper sample. Queries have caps, tags are heuristic, and journal/preprint versions may remain distinct. Source errors preserve old records and are visibly reported; an empty HTTP response is never counted as zero new papers. Author names may be ambiguous. Coauthorship and matches to a user-created watchlist do not establish current team membership, competitive strength, or willingness to collaborate.

## Maintenance

Use **Actions → Research monitor sync → Run workflow** for an immediate refresh. Partial source outages publish the available result with source errors. When all sources fail, the workflow publishes validated failure metadata while retaining the library and marks the run failed. Pages output is checked against a deployment marker and public data SHA-256 before success is reported.

The existing homepage publishes from `main` at the repository root. This workflow preserves that setting and unrelated homepage files. GitHub may delay schedules or disable scheduled workflows after prolonged repository inactivity; check the Actions page if updates stop.
