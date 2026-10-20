# Bundle splitting (P2.2)

Measured on the 8,326-paper archive with the P3 style split and P4 classifier draft present in the shared tree. All measurements use gzip level 9 per resource.

| Resource | P0 baseline gzip | Current gzip |
|---|---:|---:|
| Main JS | 176,919 B | 41,129 B |
| All initial JS (including Worker and vendors) | 176,919 B | 205,184 B |
| Initial paper data | 11,215,528 B | 10,649,085 B |
| Initial signals data | 7,847,487 B | 0 B |

The main file meets the 110 KB target. Total startup JS is higher because Worker isolation duplicates validation/classification and independently compressed vendor chunks carry overhead. This is explicit in the startup budget, not hidden by moving bytes to another file. The pre-P2/P4 Worker-inclusive initial JS was 195,386 B gzip.

React/React DOM/Scheduler and Radix/Floating UI have separate vendor groups. Paper library, filters, detail drawer, GitHub/news dashboards and source AI settings are lazy. The default research dashboard remains eager. The optional WebLLM runtime and model downloads still start only after analysis is requested. Recharts was unreachable and removed in P2.1.

`dist/stats.html` is a self-contained report generated from Rolldown's module contributions, with the complete `dist/bundle-report.json` alongside it. These contributions are not final minified/gzip sizes.

## Ten largest modules in main

| Module | Rendered contribution bytes |
|---|---:|
| `node_modules/sonner/dist/index.mjs` | 53,503 |
| `components/research-dashboard.tsx` | 26,420 |
| `components/spatial-chart.tsx` | 20,753 |
| `components/ui/sidebar.tsx` | 11,262 |
| `lib/local-api.ts` | 9,790 |
| `lib/data-worker-client.ts` | 9,555 |
| `components/monitor-workspace.tsx` | 9,191 |
| `components/workspace-header.tsx` | 8,489 |
| `lib/dashboard.ts` | 6,896 |
| `hooks/use-paper-library.ts` | 4,806 |

Full startup measurements remain in `dist/budget-report.json`. Unknown resources fail the budget gate; builds never raise their own ceilings. Local browser loading showed all 8,326 records and no console errors after the split. See OPTIMIZATION_STATUS.md for final shared-tree test and build evidence.
