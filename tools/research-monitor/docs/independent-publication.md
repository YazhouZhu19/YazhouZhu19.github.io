# Independent web and data publication

The 2026-11-04 sync generated 831,504,794 bytes and was correctly stopped by the 800 MB publication cap. The last public snapshot was collected on 2026-10-25 UTC (2026-10-26 Asia/Shanghai). Replicating v1/v2/v3, flat and sharded signals, and preceding generations into every web release caused the growth.

## Release boundaries

- `research-monitor-sync.yml`: collect, validate, compact and commit **source archives only**. Before collection, retain the preceding compact archive dictionaries so new query URLs do not renumber historical shards. Failed or malformed collection never discards saved records.
- `research-monitor-pages.yml`: publish a GitHub Pages Actions artifact containing the existing public home/project pages and new web assets. Exclude tools, source archives, dependencies and Git history. `VITE_MONITOR_DATA_BASE_URL` selects `https://yazhouzhu19.github.io/oevryn-data/` for both paper Worker/fallback and signal loading.
- `YazhouZhu19/oevryn-data`: independently scheduled GitHub Pages workflow reads the public source repository and publishes only modern v3 paper and v2 signal transport, preserving current and preceding generations. Its own token writes only its own repository. No cross-repository PAT is needed. The schedule is hourly, subject to GitHub scheduling delays.

The data site validates complete round trips before upload and verifies public source revision and manifest hashes after deployment. Failure keeps the last successful Pages deployment. The web deployment independently verifies its public revision. Both provide `deployment.json`; the data site's collection times and counts are authoritative for current data.

## Compatibility and storage

The original `research-monitor/data/` URLs remain an unchanged, dated **transition snapshot**, including their originally retained shards. They are not advertised as current feeds and are not regenerated on each release. The new web client reads current data exclusively from the data site. No original record is removed from the source archives. Compatibility retirement requires a separate maintainer decision; this migration does not schedule deletion.

The old 800 MB publication cap and 950 MB complete web artifact cap remain enforced. Paper dataset totals use a reviewed per-record envelope based on 9,209 records, with an explicit maximum of 30,000 records. Individual files, code and CSS remain under fixed budgets. Builds do not rewrite budgets. The bounded data site is not unlimited storage.

The November 11 repair addresses sync run `42899828413`: collection and lossless validation passed, but 11,361 papers used 77,496,667 raw bytes against a 77,292,048-byte record-only allowance. The failure stopped the source commit; the last successful public data remained available. Only the complete-paper raw baseline was recalibrated to that observed density plus 5%, normalized to 9,209 records and rounded up to KiB (65,958,912 bytes). The existing gzip baseline was retained.

Record count alone cannot account for new collection history on existing papers. Source `e9ea300` contains 11,294 papers and 151,125 provenance entries, whose encoded arrays occupy 12,357,383 bytes (about 82 bytes/entry). The additional allowance is `max(0, entries - ceil(123226 * paperScale))` times 128 raw / 32 gzip bytes, capped at a reviewed 1,000,000 entries. The baseline density scales with paper count so new papers do not earn history credit twice. Counts come from decoded, checksum-verified snapshots; they are not read from metadata counters. The report includes both startup and optional dataset counts and sizes.

This allowance applies only to complete paper data. It does not relax the overview/startup budget, individual-file caps, code/CSS budgets, record maximum or publication caps. Enriched paper content can still exceed its reviewed density, and history can still exceed its independent maximum; either requires investigation. The source signal archive's separate 100,000-record / 96 MiB limits are unchanged and remain a separate capacity concern.

The November 17 repair addresses sync run `44082074491` and the repeated failures since the last successful November 11 collection. The inherited v3 affiliation dictionary left only 11,142 bytes below the 4 MiB manifest cap. Growing metadata and query URLs pushed the next manifest over that cap, causing a lossless but much larger v2 fallback. The writer now retains a fitting prefix of the affiliation dictionary, preserves its indices, and encodes removed references as complete strings while keeping v3 author/provenance tuples and shared abstracts. The previous generation remains readable. No records, evidence, or size limits are removed or increased.

A real November 17 collection of 12,231 papers and 158,471 provenance entries reproduced the failure: the old writer produced 108,301,523 raw bytes; the repaired writer produced 84,627,532 raw / 16,212,838 gzip bytes, within the existing 87,603,807-byte raw allowance. Full decoded records and metadata were equal in both outputs. The paper overview and individual-file limits also passed unchanged.

Source status remains independent of publication success. Partial external failures retain saved records and their errors; GitHub's `lastSuccessAt` now means the latest run with a successful response, consistent with the other sources, including a valid zero-result response. A successful web/data deployment alone does not prove fresh collection: compare `collectedAt`, `signalsGeneratedAt`, counts, and source revision after a successful source sync. The failed November 17 run also reported 96,083 signals against the separate 100,000-record cap; that remaining capacity requires a source-archive sharding migration, not deletion of history or an unreviewed increase to a flat-file limit.

## Bootstrap / recovery

1. Push this source change to a PR branch; run CI including round-trip, publication retention and artifact size checks.
2. Enable Actions Pages on the independent data repository and manually dispatch its workflow with that source branch. Verify its public `deployment.json` before switching the client.
3. Enable Actions Pages on the web repository, merge the approved change, and verify the web workflow and real browser requests.
4. Run source collection and dispatch data publication again after its verified source commit, restoring current records.

A source failure does not require rolling back the website. A data deployment failure leaves its last verified snapshot available. A code rollback should retain the frozen compatibility data. Never raise a storage cap merely to suppress an unexplained failure.
