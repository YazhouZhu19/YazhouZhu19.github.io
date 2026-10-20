import type { MonitorData } from "./types";

/** Request failures are distinct from intentionally capped source coverage. */
export function collectionNotice(
  data: MonitorData | null | undefined,
): { severity: "warning" | "error"; sources: string[] } | null {
  if (!data) return null;
  const latest = new Map<string, MonitorData["runs"][number]>();
  for (const run of data.runs) {
    const previous = latest.get(run.source);
    if (!previous || run.completedAt > previous.completedAt) latest.set(run.source, run);
  }
  const sources = [
    ...new Set([
      ...(data.errors ?? []).map((error) => error.source),
      ...[...latest.values()].filter((run) => run.status === "error" || run.error).map((run) => run.source),
    ]),
  ];
  if (data.status !== "error" && !data.error && sources.length === 0) return null;
  return { severity: data.status === "error" ? "error" : "warning", sources };
}
