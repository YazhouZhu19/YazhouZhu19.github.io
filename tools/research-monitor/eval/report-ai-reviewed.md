# Relevance classifier evaluation

> **PROVISIONAL — pending maintainer review.** These are model-assisted draft annotations, not a human gold standard. Metrics are diagnostic only and must not be used to claim P4 acceptance targets.

- Population: 8326; fixed sample: 400; labelled: 400; unlabelled/excluded: 0.
- Snapshot collected at: 2026-10-20T14:35:21.416Z; seed: `oevryn-relevance-2026-10-21-v1`.
- Frozen evidence SHA-256: `12f32a22fa27f29f582a6f8c2b6f7556c7490cec030e80d0431c2037bee7e124`.
- Scope classifier: `legacy-relevance-as-core (operational baseline, no scope classifier)`.
- Track classifier taxonomy: `2026-09-18-ten-interests-v1`.
- Sampling is balanced across source × assigned track × month, not prevalence-proportional. These unweighted metrics describe the audit sample, not population-wide accuracy.
- Before scopeOf exists, relevant=true is mapped to core and relevant=false to out to measure the existing inclusive display policy. This is not an existing three-class algorithm; adjacent can never be predicted by this baseline.
- Labels may select no tracks. A single word such as diagnosis or radiotherapy is insufficient evidence of a corresponding computational imaging task. Undefined precision/recall is shown as —, not a perfect score.

## Scope confusion matrix

Rows: annotation; columns: prediction.

| Actual / predicted | core | adjacent | out |
|---|---:|---:|---:|
| core | 306 | 0 | 6 |
| adjacent | 34 | 0 | 0 |
| out | 52 | 0 | 2 |

## Scope metrics

| Label | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| core | 312 | 306 | 86 | 6 | 78.1% | 98.1% | 86.9% |
| adjacent | 34 | 0 | 0 | 34 | — | 0.0% | 0.0% |
| out | 54 | 2 | 6 | 52 | 25.0% | 3.7% | 6.5% |

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

- `doi:10.3171/2026.4.jns26111`: annotation **adjacent**, prediction **core**.
- `arxiv:2602.00990`: annotation **adjacent**, prediction **core**.
- `doi:10.5937/jomb0-61610`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1341814`: annotation **adjacent**, prediction **core**.
- `arxiv:2609.36991`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC12493938`: annotation **adjacent**, prediction **core**.
- `doi:10.2214/ajr.26.35721`: annotation **out**, prediction **core**.
- `doi:10.1016/j.ijmedinf.2026.106685`: annotation **out**, prediction **core**.
- `doi:10.5005/jp-journals-10078-1520`: annotation **adjacent**, prediction **core**.
- `epmc:PMC:PMC1488488`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1546679`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC12493913`: annotation **adjacent**, prediction **core**.
- `doi:10.1016/j.cjco.2026.05.008`: annotation **adjacent**, prediction **core**.
- `doi:10.3960/jslrt.26029`: annotation **out**, prediction **core**.
- `doi:10.1093/nop/npag034`: annotation **out**, prediction **core**.
- `arxiv:2202.04785`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.06.25.26356599`: annotation **core**, prediction **out**.
- `doi:10.1136/jcp.27.2.172-a`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1260334`: annotation **out**, prediction **core**.
- `doi:10.1097/bot.0000000000003215`: annotation **adjacent**, prediction **core**.
- `arxiv:2507.22791`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1650382`: annotation **out**, prediction **core**.
- `doi:10.18502/jthc.v20i2.19711`: annotation **adjacent**, prediction **core**.
- `epmc:PMC:PMC12493369`: annotation **adjacent**, prediction **core**.
- `doi:10.1515/iss-2025-0010`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.09.25.26362274`: annotation **adjacent**, prediction **core**.
- `epmc:PMC:PMC491715`: annotation **out**, prediction **core**.
- `doi:10.1002/ase.70357`: annotation **out**, prediction **core**.
- `doi:10.1055/a-2811-1781`: annotation **adjacent**, prediction **core**.
- `doi:10.5005/jp-journals-10024-3984`: annotation **out**, prediction **core**.
- `doi:10.18502/jthc.v20i2.19708`: annotation **adjacent**, prediction **core**.
- `doi:10.53045/jprs.2025-0100`: annotation **adjacent**, prediction **core**.
- `doi:10.3332/ecancer.2026.2151`: annotation **out**, prediction **core**.
- `doi:10.3238/arztebl.m2026.0172`: annotation **out**, prediction **core**.
- `doi:10.2147/imcrj.s583050`: annotation **out**, prediction **core**.
- `doi:10.1177/014107688407701132`: annotation **out**, prediction **core**.
- `arxiv:2606.05628`: annotation **out**, prediction **core**.
- `arxiv:2507.09562`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC1214808`: annotation **out**, prediction **core**.
- `arxiv:2501.00277`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.10.05.26364781`: annotation **adjacent**, prediction **core**.
- `doi:10.1016/j.ctarc.2025.101062`: annotation **out**, prediction **core**.
- `doi:10.1177/20551169261462693`: annotation **out**, prediction **core**.
- `epmc:PMC:PMC496574`: annotation **adjacent**, prediction **core**.
- `doi:10.1016/j.prnil.2026.01.004`: annotation **out**, prediction **core**.
- `doi:10.4103/jmau.jmau_3_23`: annotation **out**, prediction **core**.
- `doi:10.1177/10732748261494374`: annotation **out**, prediction **core**.
- `doi:10.1007/s00259-026-08190-w`: annotation **adjacent**, prediction **core**.
- `doi:10.1016/j.jhep.2026.03.004`: annotation **adjacent**, prediction **core**.
- `doi:10.1177/003591577707000334`: annotation **out**, prediction **core**.
- `doi:10.1016/j.amjcard.2026.09.014`: annotation **adjacent**, prediction **core**.
- `arxiv:2410.03086`: annotation **adjacent**, prediction **core**.
- `doi:10.1148/rg.250166`: annotation **adjacent**, prediction **core**.
- `doi:10.12968/bjon.2026.0117`: annotation **out**, prediction **core**.
- `doi:10.1016/j.media.2026.104327`: annotation **core**, prediction **out**.
- `doi:10.1109/tuson.2026.3659798`: annotation **out**, prediction **core**.
- `doi:10.1002/jfa2.70226`: annotation **adjacent**, prediction **core**.
- `doi:10.7759/cureus.114517`: annotation **out**, prediction **core**.
- `doi:10.1109/tmi.2026.3739833`: annotation **core**, prediction **out**.
- `doi:10.1002/jfa2.70222`: annotation **out**, prediction **core**.
- `doi:10.12688/f1000research.166604.2`: annotation **adjacent**, prediction **core**.
- `doi:10.1002/gin2.70067`: annotation **out**, prediction **core**.
- `doi:10.1016/j.hroo.2026.06.011`: annotation **out**, prediction **core**.
- `doi:10.1109/tmi.2026.3741804`: annotation **core**, prediction **out**.
- `doi:10.1097/ms9.0000000000005474`: annotation **out**, prediction **core**.
- `arxiv:2406.11868`: annotation **out**, prediction **core**.
- `arxiv:2609.07188`: annotation **core**, prediction **out**.
- `epmc:PMC:PMC1416436`: annotation **adjacent**, prediction **core**.
- `arxiv:2602.16991`: annotation **out**, prediction **core**.
- `doi:10.1136/jcp.44.4.352-c`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.09.10.26362809`: annotation **core**, prediction **out**.
- `doi:10.1097/rlu.0000000000006648`: annotation **out**, prediction **core**.
- `doi:10.1016/j.hroo.2026.06.001`: annotation **adjacent**, prediction **core**.
- `doi:10.1136/bmj.307.6909.940-b`: annotation **out**, prediction **core**.
- `doi:10.5603/fm.112832`: annotation **adjacent**, prediction **core**.
- `doi:10.1007/s13193-025-02482-7`: annotation **out**, prediction **core**.
- `doi:10.1080/20905998.2026.2623583`: annotation **out**, prediction **core**.
- `doi:10.1227/neuprac.0000000000000216`: annotation **adjacent**, prediction **core**.
- `arxiv:2605.09697`: annotation **out**, prediction **core**.
- `doi:10.1016/j.ard.2026.06.024`: annotation **out**, prediction **core**.
- `doi:10.1097/ms9.0000000000005589`: annotation **out**, prediction **core**.
- `doi:10.1021/cbmi.6c00066`: annotation **adjacent**, prediction **core**.
- `doi:10.1109/tuson.2026.3666270`: annotation **adjacent**, prediction **core**.
- `doi:10.24963/ijcai.2024/610`: annotation **out**, prediction **core**.
- `doi:10.64898/2026.08.10.26359935`: annotation **adjacent**, prediction **core**.
- `doi:10.1136/bmj.300.6718.194`: annotation **adjacent**, prediction **core**.
- `doi:10.3389/fonc.2026.1751817`: annotation **adjacent**, prediction **core**.
- `doi:10.21203/rs.3.rs-10975699/v1`: annotation **adjacent**, prediction **core**.
- `arxiv:2606.30651`: annotation **out**, prediction **core**.
- `arxiv:2606.29599`: annotation **out**, prediction **core**.
- `doi:10.36721/pjps.2026.39.12.346.1`: annotation **out**, prediction **core**.
- `doi:10.1007/s13193-026-02534-6`: annotation **adjacent**, prediction **core**.

