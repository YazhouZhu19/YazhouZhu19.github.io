# Bundle splitting (P2.2)

Measured on the 8,326-paper archive after P3/P4 integration. All measurements use gzip level 9 per resource. The complete final resource inventory is in [resource-measurements.json](resource-measurements.json).

| Resource | P0 baseline gzip | Current gzip |
|---|---:|---:|
| Main JS | 176,919 B | 49,300 B |
| All initial JS (including Worker and vendors) | 176,919 B | 215,802 B |
| Main CSS | 43,892 B | 19,966 B |
| Initial paper data | 11,215,528 B | 10,649,085 B |
| Initial signals data | 7,847,487 B | 0 B |

The main file meets the 110,000-byte gzip target. Main CSS is 119,567 raw bytes, below its unchanged 120,000-byte cap. Total startup JS is higher because Worker isolation duplicates validation/classification, independently compressed shared chunks carry overhead, and P4 adds grouping/comparison logic. This is explicit in the startup budget, not hidden by moving bytes to another file.

Total measured startup JS, CSS and data is 10,884,853 gzip bytes versus 19,283,826 at baseline (43.6% lower). This excludes HTML, images, headers and model weights, and is not a measured download time. Optional CSS grows because view styles moved out of the entry stylesheet; the final optional total is 137,796 raw / 25,858 gzip bytes. Reviewed ceilings allow about 2% headroom for those new totals, while the main-file targets remain fixed. Named new chunks and their feature/relocation reasons are recorded in `budget.json`; unknown chunks still fail.

React/React DOM/Scheduler and Radix/Floating UI have separate vendor groups. Paper library, filters, detail drawer, GitHub/news dashboards and source AI settings are lazy. The default research dashboard remains eager. The optional WebLLM runtime and model downloads still start only after analysis is requested. Recharts was unreachable and removed in P2.1.

`dist/stats.html` is a self-contained report generated from Rolldown's module contributions, with the complete `dist/bundle-report.json` alongside it. These contributions are not final minified/gzip sizes.

## Ten largest modules in main at the P2 split (historical)

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
