# Loading pipeline audit — 2026-11-05 (Asia/Shanghai)

The former paper dashboard waited for the entire paper corpus, including abstracts and collection provenance, then reclassified every paper, built the search index in a Worker and cloned records to the UI. The paper loader also ran when opening the GitHub/news overview. A five-minute timeout prevented early cancellation but did not reduce this work.

A local profile of 10,550 papers measured about 4,764 ms for validation/classification, 98 ms for search indexing, 454 ms for a structured clone, and 73 ms for dashboard calculations. These are individual Node measurements, not browser network timings. Provenance occupied 132 MB in expanded records, abstracts/original abstracts about 40 MB combined. Public v3 transport already compresses repeated fields; expanded field sizes are not transfer sizes.

## Implemented changes

- Publication produces `data/paper-overview.json`, an explicitly typed projection. Classification runs at publication time. Overview records retain fields needed for filters, counts, date rules, source health, explicit-ID/title-author work grouping, local watchlists and chart drill IDs. Authors' affiliations use a shared dictionary; repeated provenance identifiers are reduced to unique identifiers for grouping. Full source evidence is preserved in the complete v3 archive.
- The dashboard loads this projection without starting the paper Worker or downloading full paper shards. It supports the existing controls and CSV overview export. Opening a paper or entering the library, analysis, or PI/team views loads verified full records.
- Direct GitHub/news overview entry requests no paper data. Their library views load paper context for explicit links and joint assessment; joint assessment waits for that context rather than silently treating an unloaded corpus as empty.
- Missing/corrupt overview data falls back to the existing verified full-snapshot loader. Personal collections and teams remain browser-local.
- Budgets now separately report startup overview and optional complete papers. Complete corpus limits remain enforced. Existing code/CSS ceilings remain unchanged; extracted shared modules have explicit small file limits.

## Controlled before/after result

See `loading-audit.json` for raw requests and long tasks. Same 10,550-paper dataset, gzip level 9, shared server bandwidth of 8,192 bytes each 16 ms (approximately 4 Mbps), 80 ms response delay, normal CPU. One cold and one warm navigation per version; this is a laboratory comparison, not an Internet guarantee or a percentile estimate.

| Measurement | Before | After |
| --- | ---: | ---: |
| Cold dashboard usable | 35.814 s | 8.237 s |
| Warm dashboard usable | 5.888 s | 0.507 s |
| Cold compressed response bodies | 14,054,591 bytes | 3,570,316 bytes |

Both versions displayed the same 1,470 records in the default scoped/time-filtered headline, from the same 10,550-record corpus. The overview is 14,278,047 bytes uncompressed / 3,352,408 bytes gzip level 9. Parsing/validating the projection measured about 269 ms in Node. The full paper library still requires the complete corpus on its first use; this change targets startup and overview loading, with no claim that complete evidence is free to load.

## Reproduce

Build the prior revision in a separate directory, build current `dist` with complete data, then run:

```sh
node --import tsx e2e/loading-audit.ts --before /absolute/path/to/prior/dist --after dist --output docs/loading-audit.json
```

The audit serves both revisions locally with the same current data, precompresses responses before timing, checks a nonzero dashboard and an interactive filter, and rejects unexpected browser exceptions/external requests. It measures cold and cache-backed navigation in the same browser context for each revision. Source data remains local throughout the audit.
