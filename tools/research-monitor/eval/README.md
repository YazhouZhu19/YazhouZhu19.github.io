# Relevance evaluation — Task P0.2

**Provisional labels, pending maintainer review. No human gold standard has been created.**

This directory freezes a 400-record audit sample and draft labels before changes to the scope and track classifiers. These labels must not be used to declare P4 precision/recall targets achieved.

## Files

- `relevance-sample.csv`: the requested eight columns. Track and task lists use `;`; an empty `label_tracks` means no applicable track, not an unreviewed row.
- `relevance-evidence.json`: complete titles and abstracts for the same 400 IDs, sampling metadata, population/sample strata and an evidence SHA-256 digest. It is an evaluation fixture, not a replacement public snapshot.
- `relevance-annotations.json`: reproducible Codex draft labels keyed by paper ID, with a reason for every decision.
- `report.md`: current classifier diagnostic metrics with an explicit provisional status.
- [second-review.json](second-review.json) and [second-review.md](second-review.md): a second AI review of all 400 frozen records; no human confirmation is implied.
- [relevance-ai-reviewed.csv](relevance-ai-reviewed.csv) and [relevance-ai-reviewed-annotations.json](relevance-ai-reviewed-annotations.json): a separate, provisional reconciliation of the second-review suggestions. The original CSV and annotations remain unchanged.
- [reconciliation.md](reconciliation.md) and [reconciliation.json](reconciliation.json): each accepted, partially accepted or deferred change, with its reason, original/suggested/final labels and source-file checksums.
- [report-ai-reviewed.md](report-ai-reviewed.md): diagnostic metrics using the reconciled CSV and the same frozen evidence.

## AI reconciliation, 2026-10-21

All 67 `change_suggested` records were individually checked against their complete frozen titles and abstracts and the conventions below: **42 suggestions accepted, 9 partially accepted, 16 deferred**. This changes labels for 51 records: 3 scope changes and 50 track changes, with overlap.

The 217 AI-agreement records, 85 `boundary_review_required` records and 31 `missing_abstract_unverified` records retain their original labels. The 85 boundaries remain unresolved and the 31 missing-abstract labels remain unverified. Every annotation in the new JSON explicitly records `humanConfirmed: false`, including accepted corrections. Neither AI review nor their agreement establishes a human gold standard.

Actual downstream classification, segmentation or quantitative measurements can support corrections. Merely including a preprocessing tool, adapting an existing foundation model, or reporting a reader study does not automatically settle the corresponding task boundary. Partially accepted entries apply only the supported part and retain the original value for the unresolved part. These decisions remain provisional, not a new authoritative taxonomy.

This was not a blinded reconciliation: both earlier labels and second-review suggestions were visible. Only the 67 change suggestions were re-read in full in this pass; the other 333 records were retained with their earlier review status. No full texts or new external sources were retrieved.

```sh
# Keep the original draft/report intact; evaluate the separate AI-reconciled version.
npx tsx scripts/eval-classifier.ts --labels eval/relevance-ai-reviewed.csv --output eval/report-ai-reviewed.md
```

The new report still includes unresolved and title-only records and is diagnostic only. It cannot satisfy `--require-gold`; the existing human confirmation gate is unchanged.

## P4.1 scope diagnostics

[Scope report](report-p4-scope.md), [structured scope diagnostics](p4-scope-diagnostics.json) and [pre-change baseline](p4-classifier-baseline.json) use the same frozen AI-reconciled sample. With `2026-10-21-scope-v1`, core precision/recall move from **78.1%/98.1%** to **92.5%/86.9%**. However, **17 of 54 annotated out records are still classified core (31.5%)**, above the plan's ≤3% target. These are provisional diagnostics, not achieved acceptance criteria.

The unmodified 8,326-record snapshot is classified in memory as 3,960 core, 2,829 adjacent and 1,537 out. No records are removed. The ten track predictions remain unchanged in this step. Known limitations include computational terms appearing only in background, broad multimodal terminology and the clinical-only case/cohort rule differing from the draft's imaging-centrality convention.

```sh
npx tsx scripts/eval-classifier.ts --labels eval/relevance-ai-reviewed.csv --output eval/report-p4-scope.md
```

## Scope definitions

- **core**: proposes, evaluates or applies a computational method, model, software or quantitative image-analysis pipeline to medical images.
- **adjacent**: clinical or technical imaging study in which imaging is the central evidence, without a computational image-analysis contribution.
- **out**: imaging is incidental, the application is outside medical imaging, or the record is a general treatment, reference, commentary or governance item without such an analysis contribution.

Draft boundary conventions need maintainer confirmation. Focused reviews of image-analysis algorithms and benchmarks are provisionally `core`; broad policy reviews and cross-domain surveys merely mentioning imaging are `out`. Clinical studies applying explicit segmentation, registration, reconstruction or radiomics pipelines may be `core`; routine manual measurements followed by clinical statistical association are `adjacent`. Biomedical/veterinary microscopy and MR spectroscopy, acquisition hardware, protocols without reported results, and missing abstracts are explicitly flagged where relevant.

Track labels follow the existing ten IDs, independently of scope. Label the demonstrated research task, not every term in the background. In particular, routine diagnosis wording does not imply `diagnosis`; the diagnosis track requires image-based detection/classification or a diagnostic-accuracy assessment. Molecular-status identification is not automatically future-outcome prediction. Expert annotation, simulated clicks and gaze supervision alone do not establish a clinical human-in-the-loop study.

## How the draft was reviewed

Codex read all 400 titles and selected method/clinical evidence sentences from the stored abstracts, then read complete abstracts for ambiguous boundaries. Draft reasons were written per record without copying the current classifier's track outputs. Some abstracts are missing, and some conclusions are necessarily title-only. Full-text papers were not retrieved, no independent domain expert reviewed these labels, and no inter-rater agreement is claimed. The draft is therefore **not** a gold standard or an estimate of production accuracy.

The frozen complete abstracts permit the maintainer to check passages beyond the CSV's first 600 Unicode characters. Pay particular attention to notes containing “boundary”, “missing”, “review”, “title”, and “confirmation”. All labels, not just those flagged, require review.

## Sampling and reproducibility

The fixed seed is `oevryn-relevance-2026-10-21-v1`. A record is assigned to one stratum:

1. Its primary stored `source` (additional discovery sources do not duplicate the record).
2. One of its existing direction IDs, selected by a seeded hash of its ID; records without a direction use `unassigned`.
3. Its publication month, with invalid/missing dates assigned `undated`.

Seeded SHA-256 priorities order strata and records. Round-robin selection across strata yields 400 unique papers, is independent of input ordering, and protects small strata. It is **not prevalence-proportional**; report metrics are unweighted audit-sample metrics. Sparse/historical records and missing abstracts can consequently be overrepresented. The sample is for annotation and regression review, not a representative estimate of the public archive.

The generator reads the snapshot through `readSnapshotFile`, preserving validation and sharded input support. It never modifies `data/`. Source collection time, population count, source content digest, and the complete selected evidence digest are recorded. Subsequent algorithm comparisons must use this frozen evidence rather than silently re-sampling a changing archive.

```sh
# Export a new, blank sample deliberately; this overwrites the evaluation fixtures.
npx tsx scripts/export-eval-sample.ts

# Reproduce annotations only against the same source snapshot and sample.
npx tsx scripts/export-eval-sample.ts --annotations eval/relevance-annotations.json

# Run now: explicitly produces a provisional report if gold does not exist.
npx tsx scripts/eval-classifier.ts

# A strict validation gate fails until a complete maintainer-reviewed gold exists.
npx tsx scripts/eval-classifier.ts --require-gold
```

Optional generator flags: `--input`, `--output`, `--size`, `--seed`, `--annotations`. Optional evaluator flags: `--labels`, `--evidence`, `--output`, `--require-gold`.

## Human confirmation gate

Only the repository maintainer may promote reviewed annotations:

1. Review every scope, track and note against the paired full evidence; correct uncertainties, including missing-abstract decisions.
2. Save the reviewed version as `eval/relevance-gold.csv`. Keep the provisional draft for audit.
3. Replace the provisional first-line comment with `# maintainer-reviewed: YYYY-MM-DD; reviewer=NAME`. Do not add this marker until review is complete.
4. Run `npx tsx scripts/eval-classifier.ts --require-gold` and commit the reviewed file and report.

Renaming the file alone does not make it gold. A gold filename, an explicit maintainer review marker, no remaining provisional comment, complete labels, known IDs/tracks and matching frozen evidence are all required. The marker records an external maintainer attestation; the script cannot authenticate the reviewer's identity.

Before `scopeOf` exists, the evaluator maps the current inclusive `relevant()` result to `core`/`out` to measure the existing display policy. It clearly names this operational baseline and does not pretend an earlier three-class classifier existed. Once exported, `scopeOf` and `SCOPE_CLASSIFIER_VERSION` are used automatically. Track predictions always run `classify()` on the complete frozen title/abstract, not on the 600-character CSV excerpt.

Precision with no predicted positives, recall with no annotated positives, and F1 with no positive cases are shown as `—`. Unlabelled draft rows are counted and excluded, while incomplete gold is rejected. Scope confusion matrices use annotation rows and prediction columns.
