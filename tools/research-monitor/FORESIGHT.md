# Research and team outlook

The simplified workspace preserves the complete archive and personal data. The research dashboard remains the default macro overview; the direction and team outlook views help readers formulate testable next steps using observed papers as evidence. They do not call an AI service, infer undisclosed PI plans, rank research quality or claim calibrated prediction accuracy.

## Scope and time

- Direction, modality and optional title/abstract keywords define one shared scope. Keywords use case-insensitive AND matching, not semantic search.
- Current and previous windows contain 90 publication days each, anchored to the current Beijing calendar day. First-seen times and backfill timestamps never define the trend window.
- DOI, related DOI, PMID, arXiv/version and namespaced source identifiers connect records into distinct works for this analysis only. Grouping uses the earliest valid known publication date and one representative source record, preferably with an abstract. Original records, dates, versions and library counts remain unchanged. Source-record dates shown in paper details may differ from the grouped work's window date.
- Invalid or future publication dates are excluded. Missing abstracts are unknown, not negative evidence.

## Conditional assessments

At most one card per dimension is selected: methods, data/annotation, validation, applications, testable opportunities and reproducible outputs. A card requires at least three distinct current-window works. Keyword matches are explicitly clues, including possible background mentions. Affirmative validation/resource statements reuse the conservative abstract rules documented in ANALYSIS.md. Suggestions are fixed, evidence-linked research scenarios; they do not invent dataset sizes, experimental results or literature gaps.

Each card shows a conditional outlook, the observed basis, support for that observation, and its horizon. Details retain evidence excerpts, all supporting record IDs from both windows, an alternative explanation, a next experiment and conditions to watch. The default is six to twelve months; shorter horizons emphasize a small verification study, while twelve to twenty-four months are exploratory and never receive the higher observation-support label.

“Broader observed evidence” requires at least five current-window works, at least four with abstracts, and a horizon shorter than twelve to twenty-four months. It describes the evidence volume for an observation, not the likelihood that the hypothesis will occur, quality of studies, independent research groups or replication.

## Comparing windows

Before interpreting a share difference, both windows need at least ten distinct works with publication dates spanning at least 45 days. Their record-count ratio must be at most three and total variation of normalized source composition at most 25%. PubMed and Europe PMC MED are aliases for this check; preprint sources remain distinct. Abstract-based cards repeat these checks on works with abstracts. A specific clue also requires at least three previous-window matches. Otherwise no numeric delta or rise/fall judgment is produced.

These conservative checks can detect major backfill and retrieval shifts, but do not establish constant coverage or field-wide representativeness. A comparable share change of at least five percentage points is described as a possible continuation of increased attention within this observed scope; a fall is not interpreted as abandonment. Similar shares suggest an existing line to follow. When comparison is unavailable, the card remains a conditional extension candidate and explicitly cannot identify a shift.

## PI / teams

The user confirms names or ORCIDs and optionally filters the author's publication affiliation. Neither an institution nor last authorship identifies a lab or PI. Team assessments use the same evidence rules as direction assessments, with explicit watchlist-limited wording. Author discovery is a list of public authors and matching records, not a PI ranking or verified membership list.

The selectable directory follows the original dynamic author-discovery approach, with one list per research interest and name/ORCID/affiliation search. It uses classified papers with valid, nonfuture publication dates; default candidates need at least two library records and an ORCID or an unabbreviated name. Explicit searches may expose abbreviated names with a warning. Distinct ORCIDs and name-only identities stay separate. Filtering recomputes paper counts, tags and publication affiliations in the selected scope. A temporary directory assessment reads only that entry's paper records, preventing a name-only selection from silently absorbing records assigned to other ORCIDs. Saved personal teams retain their established full-library member matching and three user-assigned purpose categories. No directory entry is automatically saved into a user's watchlists.

## Revisions and outcomes

History begins when a browser actually displays a supported candidate set. It stores immutable earlier wording and compact content signatures. Identical refreshes do not create new versions; changes to evidence, window membership or assessment content can. Removed candidates remain in earlier revisions and are not automatically declared disproven.

History is private to the current browser under `medical-research-monitor:assessments:v1`, with at most twelve revisions per scope and forty scopes. It can be exported independently. Corrupt or unavailable storage fails closed without replacing saved history. Readers can record a manual outcome and supporting note; these outcomes are not automatic accuracy measurements. There is no historical backtest, probability calibration, notification channel or external personal-data upload in this release.

## Verification

Tests cover publication boundaries, linked-version deduplication, backfill invariance, preservation of original records, missing/negated/planned evidence, sources and comparison denominators, weak samples, team scope, horizon behavior and stable signatures. History tests verify unchanged refreshes, revisions, removal, manual reviews, retention and corrupt-storage rejection. Existing collector, source-snapshot, personal CRUD and backup tests continue to apply.
