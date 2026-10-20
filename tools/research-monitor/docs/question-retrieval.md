# Question-aware evidence retrieval (P4.5)

Interest questions and nonempty team questions now rank the eligible dated works with local BM25
(k1 1.2, b 0.75; title token frequency ×2). The dictionary covers the ten directions and all current
modality, organ and method labels, plus thyroid/nodule synonyms. A positive-score candidate pool is
capped at max(4 × sample limit, 40), across selected evidence kinds. Time/source strata retain score
order; kinds take equal turns. No positive candidate means no model evidence, not an arbitrary sample.
The UI and model envelope expose the candidate count and expanded terms. Raw records are unchanged.

Landscape sampling balances time/source and uses greedy maximum-marginal-relevance selection with
equal relevance and tag Jaccard redundancy, instead of an ID hash. Stable IDs resolve ties. Source and
time balancing deliberately changes proportions; it cannot estimate field prevalence.

`eval/retrieval-examples.json` records exact before/after IDs and titles for three questions on the frozen
400-paper evaluation sample (2025-01-01 through 2026-10-20, six records supplied). Before this change all
three questions returned the same six records. After the change:

| Question | Capped candidates | Examples among selected evidence |
| --- | ---: | --- |
| 甲状腺超声分割的最新方法 | 40 | Thyroid nodule ultrasound cine clips; ultrasound muscle fascia tracking |
| 病理基础模型的跨域泛化 | 40 | Histopathology batch-effect robustness; cross-magnification foundation-model distillation |
| MRI reconstruction diffusion models | 40 | Low-field MRI super-resolution; 3D diffusion models; brain MRI prediction |

These examples demonstrate changed retrieval, not a measured relevance-accuracy gain. Matching one
expanded concept is sufficient for a positive score; samples can contain adjacent work, including
non-thyroid segmentation or non-MRI reconstruction. The stratified cap may omit the globally highest
scores. This is transparent lexical retrieval, not proof that every selected work answers every part of
the question. A separate question-level human relevance set would be needed for precision/recall.

Six regression tests cover the required five thyroid-ultrasound works among fifty, no-match behavior,
Chinese expansion, title weighting, pool caps, determinism and tag diversity. All existing paper/signal
coverage, historical-date, citation and source-kind boundaries remain tested.
