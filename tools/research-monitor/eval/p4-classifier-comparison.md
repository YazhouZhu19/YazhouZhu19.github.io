# P4 classifier comparison

> **PROVISIONAL.** Fixed AI-reconciled 400-paper sample; no human gold standard. These diagnostics cannot establish acceptance. The 85 unresolved boundaries and 31 missing abstracts retain their earlier unconfirmed labels.

Scope rules: `2026-10-21-scope-v1`; task rules: `2026-10-21-diagnosis-v2`. The ten direction IDs and source-query taxonomy are unchanged. No source snapshot or frozen annotation was modified.

## Scope

| Metric | Inclusive baseline | P4.1 / P4.2 |
|---|---:|---:|
| Core precision | 78.1% | 92.5% |
| Core recall | 98.1% | 86.9% |
| Core f1 | 86.9% | 89.6% |

Out → core: 17/54 (31.5%); the ≤3% target is **not met**. The plan’s case/cohort exclusion and provisional labels’ imaging-centrality convention also differ.

## Ten directions

Unweighted sample precision/recall and full-snapshot label counts (all scopes):

| Direction | P before | P after | R before | R after | Count before | Count after |
|---|---:|---:|---:|---:|---:|---:|
| segmentation | 73.4% | 73.4% | 94.9% | 94.9% | 2039 | 2039 |
| human_loop | 22.9% | 22.9% | 68.8% | 68.8% | 307 | 307 |
| diagnosis | 48.9% | 79.8% | 66.3% | 64.4% | 4257 | 1666 |
| reconstruction | 82.1% | 82.1% | 60.5% | 60.5% | 522 | 522 |
| registration | 84.8% | 84.8% | 65.1% | 65.1% | 184 | 184 |
| quantification | 55.1% | 55.1% | 44.2% | 44.2% | 1575 | 1575 |
| prognosis | 53.8% | 53.8% | 73.7% | 73.7% | 1712 | 1712 |
| language | 86.5% | 86.5% | 86.5% | 86.5% | 378 | 378 |
| intervention | 22.2% | 22.2% | 66.7% | 66.7% | 1890 | 1890 |
| foundation | 68.8% | 68.8% | 71.7% | 71.7% | 424 | 424 |

Diagnosis precision remains below 85%; its recall change is -1.9 percentage points. The other nine direction metrics and full-library counts are unchanged. The new rules remove ordinary diagnosis wording and require explicit task/evaluation evidence; diagnostic report generation, broad method reviews, clinical screening and molecular/phenotype classification remain imperfect boundaries.

The sample has been inspected during development. It is a development diagnostic, not a held-out performance estimate. No record IDs or paper-specific titles are used by the classifier.

## Reproduction

- Frozen evidence SHA-256: `12f32a22fa27f29f582a6f8c2b6f7556c7490cec030e80d0431c2037bee7e124`.
- Full snapshot: 8326 records, collected 2026-10-20T14:35:21.416Z.
- Detailed after report: [report-p4-diagnosis.md](report-p4-diagnosis.md).
- Scope-only report: [report-p4-scope.md](report-p4-scope.md).
- Machine-readable before/after metrics and counts: [p4-classifier-comparison.json](p4-classifier-comparison.json).

```sh
npx tsx scripts/eval-classifier.ts --labels eval/relevance-ai-reviewed.csv --output eval/report-p4-diagnosis.md
```
