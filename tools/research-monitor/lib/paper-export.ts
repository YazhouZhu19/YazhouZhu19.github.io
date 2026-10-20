import type { Paper, Collection } from "./types";
import { TRACKS, TASKS } from "./classify";
export function exportPaperCsv(
  filtered: Paper[],
  collectionById: Map<string, Collection>,
  tr: (key: string, values?: unknown[]) => string,
) {
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [
    [
      "标题",
      "作者",
      "来源日期",
      "来源",
      "状态",
      "DOI",
      "原文链接",
      "感兴趣方向",
      "任务标签",
      "模态",
      "笔记",
    ].map((v) => tr(v)),
    ...filtered.map((p) => [
      p.title,
      p.authors.map((a) => a.name).join("; "),
      p.publishedAt,
      p.sources.join("; "),
      p.status,
      p.doi,
      p.url,
      p.tracks.map((t) => tr(TRACKS[t] ?? t)).join("; "),
      p.tasks.map((t) => tr(TASKS[t])).join("; "),
      p.modalities.map((v) => tr(v)).join("; "),
      collectionById.get(p.id)?.note ?? "",
    ]),
  ];
  const blob = new Blob(["\uFEFF" + rows.map((r) => r.map(safe).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medical-image-papers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
