# OEVRYN Engine status — 2026-11-08

This engineering audit uses live deployment metadata, recent Actions history, the `a1c0f17` source archive and a fresh Chromium visit. Times below are Asia/Shanghai unless explicitly UTC. Counts describe collected records, not exhaustive coverage or independently verified research advances.

## Operational status

- Data deployment `42455984026` / source `a1c0f17`: 10,765 papers, 81,164 GitHub projects and 2,789 public-news records. Collection completed at 14:22–14:23 on November 8. Web code remains the November 5 performance release; a static web build date is not the current data date.
- The latest 12 source runs and 12 data-publication runs inspected succeeded. Both workflows request hourly scheduling, but observed execution gaps over the last three days were approximately 3–9 hours. Independent publication schedules add delay. This is a freshness limitation, not a current failed workflow; hourly configuration is not an hourly delivery guarantee.
- News/GitHub source manifest: 41 sources `ok`, 13 `partial`, zero `error`, with no source error messages. Partial coverage includes intentional query caps and must not be reported as a source failure.
- A single live Chromium cold/warm pair measured 8.862 s / 1.078 s to a usable paper overview. Three overviews requested no complete paper library and produced no script errors. This is a current-network sample, not an SLA or a controlled comparison with November 5.

Evidence: [source run](https://github.com/YazhouZhu19/YazhouZhu19.github.io/actions/runs/42454387841), [data run](https://github.com/YazhouZhu19/oevryn-data/actions/runs/42455984026), [data deployment metadata](https://yazhouzhu19.github.io/oevryn-data/deployment.json).

## Capacity and coverage

The signals source archive contains 83,953 of 100,000 allowed records (83.95%; 16,047 remaining), and occupies 80,116,835 of 100,663,296 bytes (79.59%; 20,546,461 bytes remaining). The source is still one JSON archive even though public delivery is sharded. Exceeding either limit stops new signal persistence; the collection workflow can then fail before committing newly collected papers. This failure has not happened in the inspected runs.

The existing automatic relevance labels are 69,213 direct / 11,951 candidate GitHub records and 1,719 direct / 1,070 candidate news records. They are heuristic classifications, not audited precision estimates. Separately, 71,721 GitHub records are marked `early` by metadata maturity rules; this does not mean they are irrelevant. Volume, maturity, relevance and independent evidence are different measures.

## Repairs in this change

1. Source-only AI remains available when full paper loading is pending or fails. Selecting papers requires completed paper evidence and exposes retry; unselecting papers restores source-only analysis. Background paper arrival no longer invalidates an unrelated source-only assessment.
2. After accepting a full paper snapshot, the workspace stops the redundant overview loader/poller. Overview failure still falls back to complete data.
3. Public validation retains typed `status` and `errors`. Previously an all-source error could be downgraded to a warning and lose its source names; both full and overview paths now preserve that metadata. This is a repaired failure path, not a claim that current sources failed.
4. Paper revisions explicitly dated after an analysis cutoff cannot supply current abstracts or PI links to that window. Exclusion counts are reported. `firstSeenAt` is not treated as original publication time. Missing/invalid revision dates still cannot establish historical availability; prompts explicitly describe publication-date-filtered current versions, not a reconstructed historical snapshot or predictive backtest.
5. Existing collection logs now expose byte/record headroom and emit an Actions warning at 80% of either source-archive limit. Limits and records are unchanged; warning alone does not resolve the approaching capacity boundary.

## Next priorities

1. **Capacity and failure isolation:** shard signal source storage and separate source persistence failures so a signal-cap failure does not prevent paper progress. Preserve complete records and integrity checks; simply raising limits is insufficient.
2. **Detailed reading:** a click on one paper still loads the complete corpus and reclassifies it. Add ID-to-shard lookup and lazy detail/author-index loading, with equivalent work grouping, local watchlist matching and joint-evidence semantics. The last 10,550-paper projection audit found author data and affiliation dictionary together represented about 54% of raw overview size; that is a historical measurement, not the current file size.
3. **Research-judgment validation:** AI reports need durable versioned storage, their input evidence and cutoff recorded, and later comparisons with actual outcomes. Current in-memory AI result caching is not a prediction-validation history. The classifier evaluation remains provisional: 85 boundary cases and 31 missing-abstract cases remain unresolved/unverified, and the sample influenced rule development. Its diagnostic scores must not be advertised as independently validated production accuracy.

The engine currently supports evidence discovery and conditional research hypotheses. It does not yet establish calibrated forecasting accuracy or exhaustive coverage.
