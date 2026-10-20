import type { GitHubDashboardModel } from "./github-dashboard";
import type { NewsDashboardModel } from "./news-dashboard";
import type { ResearchSignal } from "./research-signals";
import { compareCategoryWindows, type WindowComparison } from "./trend-statistics";

/** Match source dashboards' exact cutoff and Beijing days; a chosen category narrows only numerators.
 * records must already reflect relevance, search and maturity restrictions, before category filtering.
 * Current windows stop at the observed date. Their actual displayed length determines the prior window.
 */
export function signalTrendStatistics(
  model: GitHubDashboardModel | NewsDashboardModel,
  records: readonly ResearchSignal[],
  datesById: ReadonlyMap<string, string | null>,
  categoriesById: ReadonlyMap<string, readonly string[]>,
  categoryIds: string[],
  selectedCategory = "all",
): { denominator: number; comparison: WindowComparison | null } {
  if (!model.rangeValid || !model.nowValid || !model.referenceDateValid || !model.start || !model.end)
    return { denominator: 0, comparison: null };
  const cutoff = Math.min(Date.parse(model.now ?? ""), Date.parse(model.asOf ?? ""));
  if (!Number.isFinite(cutoff)) return { denominator: 0, comparison: null };
  const discovery = model.scoped.kind === "news" && model.filters.clock === "discovery";
  const initial = Date.parse(model.initialAt ?? "");
  const currentIds = new Set<string>();
  const eligible: { id: string; day: string; categories: string[] }[] = [];
  for (const record of records) {
    if (record.kind !== model.scoped.kind) continue;
    const time = Date.parse(datesById.get(record.id) ?? "");
    if (!Number.isFinite(time) || time > cutoff || (discovery && time === initial)) continue;
    const day = new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if ((model.filters.range === "all" || day >= model.start) && day <= model.end) currentIds.add(record.id);
    const categories = categoriesById.get(record.id) ?? [];
    eligible.push({
      id: record.id,
      day,
      categories: selectedCategory === "all" || categories.includes(selectedCategory) ? [...categories] : [],
    });
  }
  const end = model.observedTo;
  const comparison =
    model.filters.range !== "all" && end && model.start <= end
      ? compareCategoryWindows(eligible, model.start, end, categoryIds)
      : null;
  return { denominator: currentIds.size, comparison };
}
