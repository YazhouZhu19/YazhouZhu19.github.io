# Shared source overview layout — Task P3.4

`DashboardShell` owns the common title, one-sentence description and snapshot
time; summary/filter slots; scope and contextual notes; metric grid; chart area;
and resource-library entry. Paper, repository and news overviews pass their
existing counts, charts, drill-down actions and limitations through this shell.
Snapshot times use the existing Beijing-time convention. An invalid timestamp
is explicitly shown as unknown.

The metric grid has four columns above 768 px and two at smaller widths. All
three use `DashboardMetric`: label, value, optional comparison and the complete
original explanatory text in a tooltip. A zero comparison remains visible.
Unavailable metric controls retain keyboard focus so their explanation remains
accessible, while `aria-disabled` and an absent action prevent a drill-down.
Tooltip content is also included in each control's accessible name.

`DashboardSlots` exposes `summary?: ReactNode` and `filters?: ReactNode` for the
source-view parent to pass existing summary and filtering controls. Library mode
continues to render its own filters. This changes presentation only; date bases,
metric definitions, sampled coverage, ranking and warning language are retained.

Validation: an AST comparison preserves all original translation expressions in
the three dashboard components (98 paper, 63 repository, 69 news). A server
render smoke check verifies bilingual slot ordering, timestamp semantics,
keyboard-readable unavailable metrics and zero comparison values. The parent
integration still requires browser viewport checks for the final common layout.
