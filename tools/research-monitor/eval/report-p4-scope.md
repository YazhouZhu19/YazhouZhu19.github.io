# Relevance classifier evaluation

> **PROVISIONAL — pending maintainer review.** These are model-assisted draft annotations, not a human gold standard. Metrics are diagnostic only and must not be used to claim P4 acceptance targets.

- Population: 8326; fixed sample: 400; labelled: 400; unlabelled/excluded: 0.
- Snapshot collected at: 2026-10-20T14:35:21.416Z; seed: `oevryn-relevance-2026-10-21-v1`.
- Frozen evidence SHA-256: `12f32a22fa27f29f582a6f8c2b6f7556c7490cec030e80d0431c2037bee7e124`.
- Scope classifier: `2026-10-21-scope-v1`.
- Track classifier taxonomy: `2026-09-18-ten-interests-v1`.
- Sampling is balanced across source × assigned track × month, not prevalence-proportional. These unweighted metrics describe the audit sample, not population-wide accuracy.
- Before scopeOf exists, relevant=true is mapped to core and relevant=false to out to measure the existing inclusive display policy. This is not an existing three-class algorithm; adjacent can never be predicted by this baseline.
- Labels may select no tracks. A single word such as diagnosis or radiotherapy is insufficient evidence of a corresponding computational imaging task. Undefined precision/recall is shown as —, not a perfect score.

## Scope confusion matrix

Rows: annotation; columns: prediction.

| Actual / predicted | core | adjacent | out |
|---|---:|---:|---:|
| core | 271 | 33 | 8 |
| adjacent | 5 | 23 | 6 |
| out | 17 | 22 | 15 |

## Scope metrics

| Label | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| core | 312 | 271 | 22 | 41 | 92.5% | 86.9% | 89.6% |
| adjacent | 34 | 23 | 55 | 11 | 29.5% | 67.6% | 41.1% |
| out | 54 | 15 | 14 | 39 | 51.7% | 27.8% | 36.1% |

## Track metrics

| Label | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| segmentation | 99 | 94 | 34 | 5 | 73.4% | 94.9% | 82.8% |
| human_loop | 16 | 11 | 37 | 5 | 22.9% | 68.8% | 34.4% |
| diagnosis | 104 | 69 | 72 | 35 | 48.9% | 66.3% | 56.3% |
| reconstruction | 76 | 46 | 10 | 30 | 82.1% | 60.5% | 69.7% |
| registration | 43 | 28 | 5 | 15 | 84.8% | 65.1% | 73.7% |
| quantification | 86 | 38 | 31 | 48 | 55.1% | 44.2% | 49.0% |
| prognosis | 38 | 28 | 24 | 10 | 53.8% | 73.7% | 62.2% |
| language | 52 | 45 | 7 | 7 | 86.5% | 86.5% | 86.5% |
| intervention | 21 | 14 | 49 | 7 | 22.2% | 66.7% | 33.3% |
| foundation | 46 | 33 | 15 | 13 | 68.8% | 71.7% | 70.2% |

## Review boundaries

The CSV contains only the first 600 Unicode characters of each abstract. The paired frozen evidence file contains the complete title and abstract for reproduction and review. Missing abstracts and uncertain boundaries are noted in the draft labels. Maintainers must review scope, every track, and the reason against that evidence before promoting the CSV to gold.

## Scope disagreements

- `arxiv:2605.09977`: annotation **core**, prediction **adjacent**.
- `doi:10.5937/jomb0-61610`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.08.26.26361434`: annotation **core**, prediction **adjacent**.
- `arxiv:2510.00009`: annotation **core**, prediction **adjacent**.
- `arxiv:2609.36991`: annotation **out**, prediction **core**.
- `arxiv:2604.21636`: annotation **core**, prediction **adjacent**.
- `arxiv:2601.03321`: annotation **core**, prediction **adjacent**.
- `doi:10.2214/ajr.26.35721`: annotation **out**, prediction **core**.
- `doi:10.1111/vru.70252`: annotation **core**, prediction **adjacent**.
- `arxiv:2608.25970`: annotation **core**, prediction **adjacent**.
- `doi:10.1016/j.ijmedinf.2026.106685`: annotation **out**, prediction **core**.
- `arxiv:2508.12410`: annotation **core**, prediction **adjacent**.
- `doi:10.1002/2056-4538.70119`: annotation **core**, prediction **adjacent**.
- `doi:10.1016/j.neuroimage.2026.122215`: annotation **core**, prediction **adjacent**.
- `doi:10.5005/jp-journals-10078-1520`: annotation **adjacent**, prediction **core**.
- `epmc:PMC:PMC13674572`: annotation **core**, prediction **adjacent**.
- `epmc:PMC:PMC1488488`: annotation **out**, prediction **adjacent**.
- `epmc:PMC:PMC1546679`: annotation **out**, prediction **adjacent**.
- `doi:10.1093/nop/npag034`: annotation **out**, prediction **adjacent**.
- `doi:10.1016/j.ajodo.2026.07.016`: annotation **core**, prediction **adjacent**.
- `arxiv:2202.04785`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.06.25.26356599`: annotation **core**, prediction **out**.
- `doi:10.1136/jcp.27.2.172-a`: annotation **out**, prediction **adjacent**.
- `arxiv:2606.19300`: annotation **core**, prediction **adjacent**.
- `epmc:PMC:PMC1260334`: annotation **out**, prediction **adjacent**.
- `doi:10.1097/bot.0000000000003215`: annotation **adjacent**, prediction **out**.
- `arxiv:2507.22791`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1650382`: annotation **out**, prediction **adjacent**.
- `doi:10.64898/2026.10.17.26365809`: annotation **core**, prediction **adjacent**.
- `arxiv:2511.18089`: annotation **core**, prediction **adjacent**.
- `epmc:PMC:PMC491715`: annotation **out**, prediction **adjacent**.
- `doi:10.1002/ase.70357`: annotation **out**, prediction **adjacent**.
- `doi:10.1055/a-2811-1781`: annotation **adjacent**, prediction **out**.
- `doi:10.64898/2026.10.15.26365547`: annotation **core**, prediction **out**.
- `doi:10.5005/jp-journals-10024-3984`: annotation **out**, prediction **core**.
- `doi:10.53045/jprs.2025-0100`: annotation **adjacent**, prediction **core**.
- `doi:10.1007/s00330-026-12937-2`: annotation **core**, prediction **adjacent**.
- `doi:10.1177/014107688407701132`: annotation **out**, prediction **adjacent**.
- `arxiv:2606.05628`: annotation **out**, prediction **adjacent**.
- `arxiv:2507.09562`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1214808`: annotation **out**, prediction **adjacent**.
- `doi:10.1101/2024.03.26.24304935`: annotation **core**, prediction **adjacent**.
- `arxiv:2501.00277`: annotation **out**, prediction **core**.
- `arxiv:2511.02086`: annotation **core**, prediction **adjacent**.
- `doi:10.1016/j.ctarc.2025.101062`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC13580684`: annotation **core**, prediction **adjacent**.
- `doi:10.1016/j.prnil.2026.01.004`: annotation **out**, prediction **adjacent**.
- `doi:10.4103/jmau.jmau_3_23`: annotation **out**, prediction **adjacent**.
- `doi:10.1177/10732748261494374`: annotation **out**, prediction **adjacent**.
- `doi:10.1016/j.annonc.2026.07.001`: annotation **core**, prediction **out**.
- `arxiv:2503.17543`: annotation **core**, prediction **adjacent**.
- `arxiv:2610.12134`: annotation **core**, prediction **adjacent**.
- `doi:10.1016/j.jhep.2026.03.004`: annotation **adjacent**, prediction **core**.
- `doi:10.4103/jiaps.jiaps_90_26`: annotation **core**, prediction **adjacent**.
- `doi:10.1177/003591577707000334`: annotation **out**, prediction **adjacent**.
- `doi:10.1016/j.amjcard.2026.09.014`: annotation **adjacent**, prediction **out**.
- `doi:10.1148/rg.250166`: annotation **adjacent**, prediction **core**.
- `doi:10.12968/bjon.2026.0117`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.03.27.26349508`: annotation **core**, prediction **adjacent**.
- `doi:10.1016/j.media.2026.104327`: annotation **core**, prediction **out**.
- `doi:10.1109/tuson.2026.3659798`: annotation **out**, prediction **core**.
- `doi:10.1109/tmi.2026.3739833`: annotation **core**, prediction **out**.
- `doi:10.12688/f1000research.166604.2`: annotation **adjacent**, prediction **out**.
- `doi:10.1002/gin2.70067`: annotation **out**, prediction **adjacent**.
- `doi:10.1109/tmi.2026.3741804`: annotation **core**, prediction **out**.
- `arxiv:2406.11868`: annotation **out**, prediction **core**.
- `arxiv:2609.07188`: annotation **core**, prediction **out**.
- `arxiv:2602.16991`: annotation **out**, prediction **core**.
- `doi:10.1136/jcp.44.4.352-c`: annotation **out**, prediction **adjacent**.
- `arxiv:2608.10002`: annotation **core**, prediction **adjacent**.
- `doi:10.64898/2026.09.10.26362809`: annotation **core**, prediction **out**.
- `doi:10.1097/rlu.0000000000006648`: annotation **out**, prediction **adjacent**.
- `doi:10.1136/bmj.307.6909.940-b`: annotation **out**, prediction **adjacent**.
- `doi:10.5603/fm.112832`: annotation **adjacent**, prediction **core**.
- `doi:10.1007/s13193-025-02482-7`: annotation **out**, prediction **adjacent**.
- `doi:10.1080/20905998.2026.2623583`: annotation **out**, prediction **adjacent**.
- `doi:10.1109/tuson.2026.3683326`: annotation **core**, prediction **adjacent**.
- `doi:10.1109/iros60139.2025.11246546`: annotation **core**, prediction **adjacent**.
- `arxiv:2605.09697`: annotation **out**, prediction **core**.
- `arxiv:2608.24237`: annotation **core**, prediction **adjacent**.
- `doi:10.24963/ijcai.2024/610`: annotation **out**, prediction **core**.
- `arxiv:2608.00831`: annotation **core**, prediction **adjacent**.
- `doi:10.1109/tuson.2025.3648199`: annotation **core**, prediction **adjacent**.
- `doi:10.21203/rs.3.rs-10975699/v1`: annotation **adjacent**, prediction **out**.
- `arxiv:2606.30651`: annotation **out**, prediction **core**.
- `arxiv:2609.08148`: annotation **core**, prediction **adjacent**.
- `doi:10.64898/2026.08.27.26361537`: annotation **core**, prediction **adjacent**.
- `arxiv:2606.29599`: annotation **out**, prediction **adjacent**.
- `doi:10.64898/2026.09.03.26362159`: annotation **core**, prediction **adjacent**.
- `doi:10.64898/2026.09.20.26363529`: annotation **core**, prediction **adjacent**.
- `doi:10.1007/s13193-026-02534-6`: annotation **adjacent**, prediction **out**.
