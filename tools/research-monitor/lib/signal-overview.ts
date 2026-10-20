import type { GitHubDashboardModel } from "./github-dashboard";
import type { NewsDashboardModel } from "./news-dashboard";
import type { GitHubSignalOverview, NewsSignalOverview } from "./signals-snapshot";

/** Empty ID arrays are lazy drill selectors, never invented record IDs. */
export function adaptSignalOverview(overview: GitHubSignalOverview | NewsSignalOverview, today?: string) {
  const selectors = new WeakMap<string[], (string | number)[]>();
  function expand(value: unknown, path: (string | number)[] = []): any {
    if (Array.isArray(value)) return value.map((item, index) => expand(item, [...path, index]));
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(row).map(([key, item]) => [key, expand(item, [...path, key])]));
    if (today && row.isToday && typeof row.date === "string") result.isToday = today.startsWith(row.date);
    const keys = typeof row.date === "string" && "observed" in row
      ? ["recordIds", "directRecordIds", "candidateRecordIds"]
      : typeof row.id === "string" && "count" in row ? ["recordIds"] : [];
    for (const key of keys) {
      const ids: string[] = [];
      selectors.set(ids, [...path, key]);
      result[key] = ids;
    }
    return result;
  }
  const model = { ...expand(overview.model), rows: overview.recent };
  return {
    github: model as GitHubDashboardModel,
    news: model as NewsDashboardModel,
    resolveIds(ids: string[], completeModel: GitHubDashboardModel | NewsDashboardModel): string[] {
      const path = selectors.get(ids);
      if (!path) return ids;
      let value: unknown = completeModel;
      for (const key of path) {
        if (!value || typeof value !== "object") return [];
        value = (value as Record<string | number, unknown>)[key];
      }
      return Array.isArray(value) && value.every(id => typeof id === "string") ? value : [];
    },
  };
}
