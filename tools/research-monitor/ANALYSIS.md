# Preliminary paper analysis / 论文初步分析

This view supports topic selection and reading. It computes from the public metadata snapshot in the browser, without an AI model, generated summary, translation, citation-quality score, or claim of exhaustive field coverage.

## Shared scope and denominators

`buildPreliminaryAnalysis` applies the selected source, research interest, and publication-date window together. Publication dates remain the clock even if a caller passes a discovery-clock filter. Paper IDs are deduplicated; malformed dates, impossible calendar dates, and future publication dates are excluded. All charts, drill-down IDs, reading candidates, author counts, and watchlist matches use those same records.

- **Directions and topics:** count distinct records per interest, organ, or modality. Percentage denominator is the complete filtered scope. Tags overlap, so percentages do not sum to 100%.
- **Direction × method:** each paper contributes at most once per combination. Percentage denominator is the number of filtered records in that direction. The twenty largest combinations are returned; this is a descriptive count, not novelty or quality. `foundation × 基础模型` is omitted because both tags come from the same definition. Other foundation-model combinations remain available.
- **Evidence signals:** six rules inspect abstracts for external validation, multicentre work, prospective work, clinician/reader evaluation, code availability, and data availability. The denominator is filtered records **with an abstract**, exposed as `scope.withAbstractCount`. Missing abstracts are unknown. No detected signal does not establish that a study lacks the property.

## Abstract excerpts and reading candidates

`buildPaperAnalysis` uses `originalAbstract` when present, otherwise `abstract`, with HTML removed and whitespace normalized. It selects a representative objective, methods, or results sentence only when the corresponding rule matches; otherwise it returns `null`. Explicit study aims take precedence over a background sentence under an Objectives heading. Methods and Materials & Methods headings take precedence over generic method verbs; study-aim sentences and future plans cannot substitute for performed methods. Text remains in the source language. Long excerpts are visibly truncated and are never rewritten as a generated summary.

Signals require a nonempty supporting excerpt and affirmative wording about performed work or available resources. Conservative rules reject negation, future plans, background references, protocol-only reports, and reviews that discuss other studies. Expert annotation alone is not clinician evaluation. Restricted sharing, mere use of someone else's public resources, supplementary-information notices, and released data-split indices alone do not establish open data/code. Wording can still cause missed or incorrect matches: these are **reading clues**, not study-quality grades or confirmed clinical evidence.

At most six reading candidates are selected from the same scope. Records with abstracts are preferred. Recent records diversify represented direction–method combinations; remaining places use detected clues and then source publication date. Each candidate shows its selection reason. This is not a recommendation of the best or most clinically reliable papers.

## Authors and watchlists

Author grouping prefers a supplied ORCID, otherwise a normalized name. Name-only identities are explicitly uncertain; ORCID values are source metadata and are not independently verified. Repeat authors within a paper count once per identity. Coauthor pairs represent shared authorship only. Papers with more than forty distinct author identities are excluded from pair enumeration and counted in `coauthorExcludedLargePapers`; they remain in paper and author totals. Watchlists use the existing exact member/ORCID and optional affiliation matching. These features do not infer lab membership, competitive strength, or willingness to collaborate.

中文说明：所有分析使用同一来源、感兴趣方向及来源发表日期筛选范围，并按记录 ID 去重。方向与器官/模态比例以范围内记录数为分母，方向×方法比例以该方向内记录数为分母，研究线索比例以有摘要记录数为分母。标签允许重叠，未识别并不表示没有。摘要内容为原文句子摘录，不调用模型生成总结。阅读候选依据组合覆盖、摘要线索和发表日期选取，不是论文质量排名；作者与共同署名分析也不用于判断团队实力。基础模型方向与同名方法的组合因定义重复而省略。
