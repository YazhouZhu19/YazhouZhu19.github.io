# GitHub maturity and direct-relevance audit

Status: **provisional metadata review; pending human confirmation**. No change to
`directEvidence` or `SIGNAL_RELEVANCE_VERSION` is included.

Snapshot: 2026-10-20T14:35:32.144Z. The full archive retains 48,410 repositories,
including 42,021 currently marked direct. Maturity version: `2026-10-21-v1`.

| View | Before | After |
| --- | ---: | ---: |
| Stored repositories | 48,410 | 48,410 |
| Established | — | 2,376 |
| Active (including capped archived repositories) | — | 4,864 |
| Early | — | 41,170 |
| All-date mature selection | — | 7,240 |
| Default 30-day overview | 5,229 | 2,255 |

The unchanged global library/addition totals include all maturity levels. The
resource library and the “Include early repositories” control retain access to
every original record. Metadata maturity does not grade scientific quality.

The direct audit uses seed `oevryn-github-direct-review-2026-10-21-v1`, balanced
round-robin sampling across maturity × star band × one deterministically assigned
browse category. The 200 frozen records are in `github-direct-review-evidence.json`;
`github-direct-review.csv` includes provisional labels and empty human-review
columns. `github-direct-review-provisional.json` records the exact annotation set
and source SHA-256. Codex reviewed names, descriptions, topics and available README
excerpts; repository contents and functional claims were not independently tested.

Provisional outcomes: 171 yes, 8 no, 21 uncertain. The undecided cases must not be
dropped when claiming accuracy. Treating them as all negative or all positive gives
an unweighted sample range of 85.5–96.0%, not a population estimate or a confirmed
precision result. P0.2 contains papers and is not a repository evaluation set.
Before/after direct classifications are identical; the 0.9 target remains pending
human-reviewed labels. Negative examples include a generic image-resizing service
named Retinal, document-only repositories and non-imaging administrative software.

Unit checks cover exact star/fork/link boundaries, 180-day dates, future/impossible
dates, placeholder licenses, README length, archive capping, deterministic sampling,
input preservation, manifest-only overview counts and exact lazy drill recovery.
