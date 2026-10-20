import { strictPublicationDay } from "./publication-date";

const DAY = 86_400_000;
export type ProportionInterval = {
  estimate: number;
  lower: number;
  upper: number;
  total: number;
  count: number;
};
export function wilsonInterval(count: number, total: number): ProportionInterval | null {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total) || count < 0 || total < 0 || count > total)
    throw new Error("A binomial count must be an integer between zero and its total");
  if (!total) return null;
  const z = 1.959963984540054,
    z2 = z * z,
    estimate = count / total;
  const denominator = 1 + z2 / total;
  const center = (estimate + z2 / (2 * total)) / denominator;
  const half = (z * Math.sqrt((estimate * (1 - estimate) + z2 / (4 * total)) / total)) / denominator;
  return {
    estimate,
    lower: count === 0 ? 0 : Math.max(0, center - half),
    upper: count === total ? 1 : Math.min(1, center + half),
    total,
    count,
  };
}

/** Newcombe's independent-proportion difference interval, derived from two Wilson intervals. */
export function compareProportions(
  currentCount: number,
  currentTotal: number,
  previousCount: number,
  previousTotal: number,
) {
  const current = wilsonInterval(currentCount, currentTotal),
    previous = wilsonInterval(previousCount, previousTotal);
  const sufficient = currentTotal >= 30 && previousTotal >= 30;
  if (!current || !previous)
    return { current, previous, sufficient: false, delta: null, interval: null, direction: null };
  const delta = current.estimate - previous.estimate;
  const lower = delta - Math.hypot(current.estimate - current.lower, previous.upper - previous.estimate);
  const upper = delta + Math.hypot(current.upper - current.estimate, previous.estimate - previous.lower);
  return {
    current,
    previous,
    sufficient,
    delta,
    interval: { lower: Math.max(-1, lower), upper: Math.min(1, upper) },
    direction: sufficient
      ? lower > 0
        ? ("increase" as const)
        : upper < 0
          ? ("decrease" as const)
          : ("uncertain" as const)
      : null,
  };
}
export type CategoryComparison = ReturnType<typeof compareProportions> & { id: string };
export type WindowComparison = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  currentTotal: number;
  previousTotal: number;
  categories: CategoryComparison[];
};
export function precedingWindow(from: string, to: string) {
  if (!from || !to || strictPublicationDay(from) !== from || strictPublicationDay(to) !== to || from > to)
    throw new Error("Invalid comparison window");
  const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  const shift = (date: string, offset: number) =>
    new Date(Date.parse(date) + offset * DAY).toISOString().slice(0, 10);
  return { from, to, previousFrom: shift(from, -days), previousTo: shift(from, -1) };
}

/** The caller supplies the same source/scope restrictions for both adjacent windows. */
export function compareCategoryWindows(
  records: { id: string; day: string; categories: string[] }[],
  from: string,
  to: string,
  categoryIds: string[],
): WindowComparison {
  const window = precedingWindow(from, to);
  const current = new Map<string, Set<string>>(),
    previous = new Map<string, Set<string>>();
  const validDays = new Map<string, boolean>();
  for (const record of records) {
    if (record.day < window.previousFrom || record.day > to) continue;
    let validDay = validDays.get(record.day);
    if (validDay === undefined) {
      validDay = strictPublicationDay(record.day) === record.day;
      validDays.set(record.day, validDay);
    }
    if (!validDay) continue;
    const target =
      record.day >= from && record.day <= to
        ? current
        : record.day >= window.previousFrom && record.day <= window.previousTo
          ? previous
          : null;
    if (!target) continue;
    const tags = target.get(record.id) ?? new Set<string>();
    for (const id of record.categories) tags.add(id);
    target.set(record.id, tags);
  }
  const countCategories = (records: Map<string, Set<string>>) => {
    const counts = new Map<string, number>();
    for (const tags of records.values()) for (const id of tags) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  };
  const currentCounts = countCategories(current),
    previousCounts = countCategories(previous);
  return {
    ...window,
    currentTotal: current.size,
    previousTotal: previous.size,
    categories: [...new Set(categoryIds)].map((id) => ({
      id,
      ...compareProportions(
        currentCounts.get(id) ?? 0,
        current.size,
        previousCounts.get(id) ?? 0,
        previous.size,
      ),
    })),
  };
}

export type CollectionChangeMarker = {
  id: string;
  day: string;
  labelZh: string;
  labelEn: string;
  evidence: string;
  kind: "rule-version" | "source-observation";
};
type CollectionMetadata = {
  interestTaxonomyVersion?: unknown;
  sourceTaxonomyVersions?: unknown;
  scopeClassifierVersion?: unknown;
  runs?: { source: string; startedAt: string }[];
};
function versionMarker(
  id: string,
  version: unknown,
  labelZh: string,
  labelEn: string,
): CollectionChangeMarker[] {
  if (typeof version !== "string") return [];
  const day = version.slice(0, 10);
  return day && strictPublicationDay(day) === day
    ? [{ id, day, labelZh, labelEn, evidence: version, kind: "rule-version" }]
    : [];
}
/** Version dates describe rule releases, never an inferred date of scientific growth. */
export function paperCollectionMarkers(metadata: CollectionMetadata): CollectionChangeMarker[] {
  const markers = [
    ...versionMarker(
      "interest-taxonomy",
      metadata.interestTaxonomyVersion,
      "研究方向采集口径",
      "Research-direction taxonomy",
    ),
    ...versionMarker(
      "scope-classifier",
      metadata.scopeClassifierVersion,
      "研究范围规则",
      "Research-scope rule",
    ),
  ];
  if (metadata.sourceTaxonomyVersions && typeof metadata.sourceTaxonomyVersions === "object") {
    for (const [source, version] of Object.entries(metadata.sourceTaxonomyVersions))
      markers.push(
        ...versionMarker(`source-taxonomy:${source}`, version, `${source} 检索规则`, `${source} query rules`),
      );
  }
  return markers.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}
export function signalCollectionMarkers(
  metadata:
    | { discoveryState?: { github?: { catalogVersion: string }; news?: { catalogVersion: string } } }
    | null
    | undefined,
  kind: "github" | "news",
): CollectionChangeMarker[] {
  return versionMarker(
    `${kind}-catalog`,
    metadata?.discoveryState?.[kind]?.catalogVersion,
    kind === "github" ? "GitHub 检索目录" : "新闻检索目录",
    kind === "github" ? "GitHub discovery catalog" : "News discovery catalog",
  );
}

/** Project dated markers onto the actual daily/monthly buckets; out-of-window markers stay hidden. */
export function markersInBuckets(markers: CollectionChangeMarker[], dates: string[]) {
  const buckets = new Map(dates.map((date, index) => [date, index]));
  return markers.flatMap((marker) => {
    const key = dates[0]?.length === 7 ? marker.day.slice(0, 7) : marker.day;
    const index = buckets.get(key);
    return index === undefined ? [] : [{ ...marker, index }];
  });
}
