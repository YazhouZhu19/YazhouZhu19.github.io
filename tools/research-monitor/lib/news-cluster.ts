import type { NewsSignal } from "./research-signals";

export const NEWS_CLUSTER_VERSION = "2026-10-21-v1";
export const NEWS_CLUSTER_SIMILARITY = 0.6;
const WINDOW = 7 * 86_400_000;
const COMMON_PUBLISHERS = [
  "reuters",
  "medical xpress",
  "nature",
  "eurekalert!",
  "pr newswire",
  "business wire",
];

/** Remove only an identified publisher suffix, never an arbitrary trailing phrase. */
export function normalizeNewsTitle(title: string, publisher = ""): string {
  let normalized = title.normalize("NFKC").toLowerCase().trim();
  const suffix = normalized.match(/\s(?:[-–—|])\s+([^|]+)$/u);
  if (
    suffix &&
    [publisher.normalize("NFKC").toLowerCase().trim(), ...COMMON_PUBLISHERS].includes(suffix[1].trim())
  )
    normalized = normalized.slice(0, suffix.index);
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function newsTitleShingles(title: string): Set<string> {
  const points = [...title.replace(/\s/g, "")];
  const grams = new Set<string>();
  for (let index = 0; index + 2 < points.length; index++) grams.add(points.slice(index, index + 3).join(""));
  return grams;
}
export function newsTitleSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  const [small, large] = left.size < right.size ? [left, right] : [right, left];
  for (const gram of small) if (large.has(gram)) intersection++;
  return intersection / (left.size + right.size - intersection);
}
function publishedTime(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const day = value.slice(0, 10),
    time = Date.parse(value),
    midnight = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) &&
    Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === day
    ? time
    : null;
}
export type NewsEvent = {
  id: string;
  title: string;
  representative: NewsSignal;
  members: NewsSignal[];
  publishers: string[];
  sourceCount: number;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
};
type Item = { record: NewsSignal; time: number | null; grams: Set<string>; eligible: boolean };

/** Complete-link clustering prevents A~B~C chains from silently merging unrelated endpoints.
 * The input records remain intact. Invalid dates and short generic titles remain singletons.
 * The inverted index prunes impossible matches without changing the similarity threshold.
 */
export function clusterNews(records: readonly NewsSignal[]): NewsEvent[] {
  const ids = new Set<string>();
  const items: Item[] = records
    .map((record) => {
      if (ids.has(record.id)) throw new Error(`Duplicate news ID: ${record.id}`);
      ids.add(record.id);
      const title = normalizeNewsTitle(record.title, record.publisher);
      return {
        record,
        time: publishedTime(record.publishedAt),
        grams: newsTitleShingles(title),
        eligible: [...title.replace(/\s/g, "")].length >= 10,
      };
    })
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.record.id.localeCompare(b.record.id));
  const groups: Item[][] = [];
  const inverted = new Map<string, number[]>();
  for (const item of items) {
    let target = -1;
    if (item.eligible && item.time !== null) {
      const overlaps = new Map<number, number>();
      for (const gram of item.grams) {
        const indices = inverted.get(gram) ?? [];
        // Representatives enter the index in chronological order. Binary search
        // skips expired groups without altering which candidates can match.
        const earliest = item.time - WINDOW;
        let low = 0,
          high = indices.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (groups[indices[middle]][0].time! < earliest) low = middle + 1;
          else high = middle;
        }
        for (let cursor = low; cursor < indices.length; cursor++) {
          const index = indices[cursor];
          overlaps.set(index, (overlaps.get(index) ?? 0) + 1);
        }
      }
      for (const [index, overlap] of [...overlaps].sort((a, b) => a[0] - b[0])) {
        const group = groups[index];
        if (overlap / (item.grams.size + group[0].grams.size - overlap) < NEWS_CLUSTER_SIMILARITY) continue;
        if (
          group.every((member) => newsTitleSimilarity(item.grams, member.grams) >= NEWS_CLUSTER_SIMILARITY)
        ) {
          target = index;
          break;
        }
      }
    }
    if (target >= 0) groups[target].push(item);
    else {
      const index = groups.push([item]) - 1;
      if (item.eligible && item.time !== null)
        for (const gram of item.grams) {
          const entries = inverted.get(gram) ?? [];
          entries.push(index);
          inverted.set(gram, entries);
        }
    }
  }
  return groups.map((group) => {
    const representative = group[0].record;
    const publisherMap = new Map<string, string>();
    for (const { record } of group)
      publisherMap.set(record.publisher.normalize("NFKC").trim().toLowerCase(), record.publisher);
    const publishers = [...publisherMap.values()].sort();
    return {
      id: `news-event:${representative.id}`,
      title: representative.title,
      representative,
      members: group.map((item) => item.record),
      publishers,
      sourceCount: publishers.length,
      firstPublishedAt: group[0].time === null ? null : representative.publishedAt,
      lastPublishedAt: group.at(-1)!.time === null ? null : group.at(-1)!.record.publishedAt,
    };
  });
}
