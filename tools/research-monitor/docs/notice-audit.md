# Notice inventory — Task P3.5

The reusable `NoticeStack` accepts complete React content and optional actions;
it does not rewrite or truncate messages. All errors occupy one banner.
Warnings use an expandable status item, and methodological information uses
an “About this data” disclosure. Both disclosures are native keyboard controls.
An empty list renders nothing.

Integrated in `workspace-header.tsx` and the three methodology notices in
`monitor-views.tsx`. Existing conditions, translated message
expressions, retry controls and sync-log actions are passed intact. The language
links continue to preserve the current URL state:

| Current notice                                              | Intended treatment                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Paper snapshot loading/check error                          | `error`, retaining retry action                                                   |
| Personal-storage failure                                    | `error`, in the same banner as any data error                                     |
| Collection failure with `sourceNotice.severity === "error"` | `error`, retaining sync-log action                                                |
| Partial source update                                       | `warning`, retaining source names, full message and sync-log action               |
| Stored count exceeds loaded sample                          | `info`, preserving both counts and all methodological text                        |
| Public-source snapshot failure                              | Local `error`; coordinate with the header to avoid a duplicate banner             |
| AI request error                                            | Keep beside its explicit analysis action; it is not a global source-status notice |
| Simulated-interaction limitation in paper details           | Keep with the paper evidence; never remove or reinterpret it                      |
| Source/team methodology notices in `monitor-views`          | `info` disclosures at the relevant section                                        |

Acceptance requires checking simultaneous data/storage/source failures produce
one banner, normal data produces none, and all existing limitation strings and
actions remain available after expanding the appropriate disclosure.
