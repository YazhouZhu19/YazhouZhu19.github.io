# Preliminary paper analysis / 论文初步分析

This view supports topic selection and reading. It computes from the public metadata snapshot in the browser, without an AI model, generated summary, translation, citation-quality score, or claim of exhaustive field coverage.

## Research-scope classification / 研究范围

`scopeOf(title, abstract)` assigns `core` (computational medical-image method clues), `adjacent` (imaging or diagnostic-accuracy context without such clues), or `out` (no medical-image context, or clinical-only trial/case/cohort clues). Rules require affirmative local context: a negated AI/software mention does not promote a record to `core`. Every result carries inspectable `scopeReasons` and the separate `SCOPE_CLASSIFIER_VERSION`; the ten direction IDs and `INTEREST_TAXONOMY_VERSION` stay unchanged.

These are text-screening rules, not a full-text determination. Background method mentions, generic multimodal terms, and clinical studies using quantitative image processing can cross the wrong boundary. The plan's clinical case/cohort exclusion is stricter than the provisional annotation convention when imaging is the study's central evidence. Missing abstracts remain uncertain and are marked in reasons where title evidence determines scope. No scope result deletes a record.

Public snapshot validation computes the current scope in the data Worker (or the verified main-thread fallback) even for older snapshots. Collection normalization recomputes every retained paper. A network-free explicit migration is available with `tsx scripts/collect.ts --input INPUT --output OUTPUT --reclassify-only`; it preserves record IDs, order, custom metadata and collection timestamps without merging duplicates or declaring a successful source sync. The raw snapshots are not changed by a browser load.

The fixed 400-paper AI-reconciled evaluation remains **provisional**, with unresolved boundaries and missing abstracts. Its metrics diagnose the rules; they are not human-gold acceptance measurements.

## Detection and classification tags / 检测分类口径

Since `2026-10-21-diagnosis-v2`, `diagnosis` requires an explicit detection/classification task, studied diagnostic accuracy, or affirmative downstream classification experiments. Standalone “diagnosis”, “diagnosed with” and “differential diagnosis” do not trigger the tag. Background benefits alone, negated tasks, anatomical/device/image-quality detection and screening-uptake studies are excluded where local wording identifies them. Title evidence and reported method/evaluation context remain imperfect proxies; report generation, methodological reviews and molecular/phenotype classification still have unresolved boundaries.

`TASK_CLASSIFIER_VERSION` identifies this change independently from scope and the stable interest taxonomy. Public validation recalculates the derived tags in the Worker before indexes and charts consume them; collection and `--reclassify-only` use the same classifier. The other nine direction rules and IDs are unchanged. Historical counts can change because classification changed, not because new publications appeared; consumers should show the rule-version date when comparing counts.

## Publication-date evidence / 发表日期证据

Europe PMC normalization compares `firstPublicationDate`, `electronicPublicationDate` and `firstIndexDate`, choosing the earliest valid calendar date no later than the UTC collection day. Every supplied raw value and the chosen field remain in provenance. `firstIndexDate` is a source-observation fallback, not proof of the bibliographic publication date. Impossible days, partial dates and malformed timestamps do not become fabricated January 1 or collection dates.

When all valid candidates are future dates, the preferred original value remains in `publishedAt` with `dateAnomaly: "future"`. Records remain in the library. Overview trends (including discovery-clock views), reading clues and AI evidence exclude both flagged records and dates later than their current Beijing-day window. A later normalization can clear the flag once a valid elapsed date is available; merging incoming corrections evaluates dates independently from metadata-version precedence.

The unchanged 8,326-record snapshot collected on 2026-10-20 contains 43 future-dated records, all from Europe PMC. Their stored metadata has no alternative date candidates, so a local pass can flag them but cannot invent corrected dates. Source retrieval is needed to obtain any earlier electronic/index dates. No source snapshot was rewritten during this implementation.

## Shared scope and denominators

`groupWorks` now adds exact normalized-title equality (case, punctuation and whitespace removed) with either a matching first-author surname or author-name Jaccard ≥ 0.5 to the existing DOI/PMID/arXiv/source-identifier relationships. Missing author lists never match by title alone. Conflicting same-title author groups cannot be joined by an overlap bridge. Single unstructured names and collective names are not guessed as surnames. Source records remain separate; `buildWorkIndex` exposes a work count and candidate-version links without rewriting IDs, source dates or metadata.

The 2026-10-20 snapshot has 8,326 records and 8,170 possible works (8,322 under identifier-only grouping), with 156 multi-record groups, 152 newly connected by title/author evidence and 24 preprint/published groups. [The complete group report](eval/work-groups.md) and [20-group provisional AI review](eval/work-groups-review.json) retain the evidence. Eleven sampled groups have supporting abstracts on both records; nine rely on metadata because one abstract is missing. No conflict was identified in that AI sample, but human review has not been completed, and “no false merges” has not been established.

`buildPreliminaryAnalysis` applies the selected source, research interest, and publication-date window together. Publication dates remain the clock even if a caller passes a discovery-clock filter. Paper IDs are deduplicated; malformed dates, impossible calendar dates, and future publication dates are excluded. All charts, drill-down IDs, reading candidates, author counts, and watchlist matches use those same records.

- **Directions and topics:** count distinct records per interest, organ, or modality. Percentage denominator is the complete filtered scope. Tags overlap, so percentages do not sum to 100%.
- **Direction × method:** each paper contributes at most once per combination. Percentage denominator is the number of filtered records in that direction. The twenty largest combinations are returned; this is a descriptive count, not novelty or quality. `foundation × 基础模型` is omitted because both tags come from the same definition. Other foundation-model combinations remain available.
- **Evidence signals:** six rules inspect abstracts for external validation, multicentre work, prospective work, clinician/reader evaluation, code availability, and data availability. The denominator is filtered records **with an abstract**, exposed as `scope.withAbstractCount`. Missing abstracts are unknown. No detected signal does not establish that a study lacks the property.

## Abstract excerpts and reading candidates

`buildPaperAnalysis` uses `originalAbstract` when present, otherwise `abstract`, with HTML removed and whitespace normalized. It selects a representative objective, methods, or results sentence only when the corresponding rule matches; otherwise it returns `null`. Explicit study aims take precedence over a background sentence under an Objectives heading. Methods and Materials & Methods headings take precedence over generic method verbs; study-aim sentences and future plans cannot substitute for performed methods. Text remains in the source language. Long excerpts are visibly truncated and are never rewritten as a generated summary.

Signals require a nonempty supporting excerpt and affirmative wording about performed work or available resources. Conservative rules reject negation, future plans, background references, protocol-only reports, and reviews that discuss other studies. Expert annotation alone is not clinician evaluation. Restricted sharing, mere use of someone else's public resources, supplementary-information notices, and released data-split indices alone do not establish open data/code. Wording can still cause missed or incorrect matches: these are **reading clues**, not study-quality grades or confirmed clinical evidence.

At most six reading candidates are selected from the same scope. Records with abstracts are preferred. Recent records diversify represented direction–method combinations; remaining places use detected clues and then source publication date. Each candidate shows its selection reason. This is not a recommendation of the best or most clinically reliable papers.

## Authors and watchlists

The PI/author directory now ranks by distinct last-author works, then total distinct works; users can switch to total works. First-author and last-author positions count once per grouped work even when several source versions exist. All source records remain available. A solo author counts in both positions. `seniorShare` is last-author works divided by all works, not a probability of being a PI. Alphabetical authorship, consortia, shared first/senior authorship and field-specific ordering conventions limit this proxy; no PI role, lab membership or leadership is confirmed.

Directory construction defaults to `core`; the workspace passes its already selected core/all scope explicitly. Invalid or future-flagged publication dates are excluded. Direction filtering recomputes work counts, author positions, affiliations and hints together. The default listing requires at least two works rather than two version records.

The directory prefers an available full name over a source's initials. A name-only identity and an ORCID identity may receive a bidirectional “possibly the same person” hint only when normalized full names match and they share an affiliation string or at least two distinct named coauthors. Abbreviated names cannot establish the hint; distinct ORCIDs are never linked by this rule. Hints preserve independent identities, counts and source records and link to the other entry for review.

Author grouping prefers a supplied ORCID, otherwise a normalized name. Name-only identities are explicitly uncertain; ORCID values are source metadata and are not independently verified. Repeat authors within a paper count once per identity. Coauthor pairs represent shared authorship only. Papers with more than forty distinct author identities are excluded from pair enumeration and counted in `coauthorExcludedLargePapers`; they remain in paper and author totals. Watchlists use the existing exact member/ORCID and optional affiliation matching. These features do not infer lab membership, competitive strength, or willingness to collaborate.

中文说明：所有分析使用同一来源、感兴趣方向及来源发表日期筛选范围，并按记录 ID 去重。方向与器官/模态比例以范围内记录数为分母，方向×方法比例以该方向内记录数为分母，研究线索比例以有摘要记录数为分母。标签允许重叠，未识别并不表示没有。摘要内容为原文句子摘录，不调用模型生成总结。阅读候选依据组合覆盖、摘要线索和发表日期选取，不是论文质量排名；作者与共同署名分析也不用于判断团队实力。基础模型方向与同名方法的组合因定义重复而省略。

## GitHub maturity and pending relevance review (P4.8)

`GITHUB_QUALITY_VERSION = 2026-10-21-v1` adds a separate metadata maturity view;
it does not modify `SIGNAL_RELEVANCE_VERSION`, direct evidence, paper scope or
stored records. Thresholds and missing-data behavior are specified in `SIGNALS.md`.
The snapshot of 2026-10-20 contains 48,410 repositories: 2,376 established, 4,864
active and 41,170 early. The 30-day overview changes from 5,229 to 2,255 repositories
under the default mature selection; all 48,410 remain in the library. Global
collection totals remain unfiltered and are labelled separately.

P0.2 is a paper evaluation set and cannot measure repository precision. The
separate 200-direct-repository stratified metadata review has 171 provisional
positive, 8 negative and 21 uncertain annotations, awaiting human confirmation.
Its balanced strata are not population weights. These counts are not an accepted
accuracy result, and no claim that the direct-precision target has been achieved
is made. No relevance rule has changed, so its before/after prediction is identical.
