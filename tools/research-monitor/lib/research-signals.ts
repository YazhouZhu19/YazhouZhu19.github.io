import { z } from "zod";

export const SIGNALS_MAX_BYTES = 4 * 1024 * 1024;

/** Public metadata only. This module is safe to import in the browser. */
export function safeSignalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      !/^(localhost|.*\.localhost|.*\.local|\[.*\]|\d+(?:\.\d+){0,3})$/i.test(url.hostname);
  } catch { return false; }
}
const url = z.string().refine(safeSignalUrl, "Expected a public HTTPS URL");
const date = z.string().max(40).refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), "Invalid timestamp");
const common = {
  id: z.string().min(1).max(300), title: z.string().min(1).max(500), url,
  summary: z.string().max(1200), summaryKind: z.enum(["repository-description", "publisher-excerpt", "search-snippet"]),
  publisher: z.string().min(1).max(200), publishedAt: date.nullable(), firstSeenAt: date, observedAt: date,
  updatedAt: date.nullable(), topics: z.array(z.string().max(100)).max(30), sourceId: z.string().min(1).max(100),
  relatedUrls: z.array(url).max(40),
};
export const GitHubSignalSchema = z.object({
  ...common, kind: z.literal("github"), fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  stars: z.number().int().nonnegative(), forks: z.number().int().nonnegative(), openIssues: z.number().int().nonnegative(),
  license: z.string().max(100).nullable(), language: z.string().max(100).nullable(), archived: z.boolean(),
  pushedAt: date.nullable(), releasedAt: date.nullable(), releaseUrl: url.nullable(), readmeExcerpt: z.string().max(1000),
}).strict();
export const NewsSignalSchema = z.object({
  ...common, kind: z.literal("news"), newsType: z.enum(["model", "research", "tooling"]),
  discoveryUrl: url.nullable(), originalUrl: url.nullable(),
}).strict();
export const ResearchSignalSchema = z.discriminatedUnion("kind", [GitHubSignalSchema, NewsSignalSchema]);
export type GitHubSignal = z.infer<typeof GitHubSignalSchema>;
export type NewsSignal = z.infer<typeof NewsSignalSchema>;
export type ResearchSignal = z.infer<typeof ResearchSignalSchema>;
export const SignalSourceStateSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(200), kind: z.enum(["github", "news"]), url,
  status: z.enum(["ok", "partial", "error"]), checkedAt: date, lastSuccessAt: date.nullable(),
  received: z.number().int().nonnegative(), retained: z.number().int().nonnegative(),
  error: z.string().max(1600).nullable(), coverage: z.string().max(1200),
}).strict();
export type SignalSourceState = z.infer<typeof SignalSourceStateSchema>;
export const ResearchSignalsDataSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: date, records: z.array(ResearchSignalSchema).max(3000),
  sources: z.array(SignalSourceStateSchema).max(30), limitations: z.array(z.string().max(1200)).max(20),
}).strict().superRefine((data, ctx) => {
  for (const field of ["records", "sources"] as const) {
    const ids = data[field].map(item => item.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: [field], message: "Duplicate IDs" });
  }
  const sourceIds = new Set(data.sources.map(source => source.id));
  if (data.records.some(record => !sourceIds.has(record.sourceId))) ctx.addIssue({ code: "custom", path: ["records"], message: "Unknown source" });
});
export type ResearchSignalsData = z.infer<typeof ResearchSignalsDataSchema>;
export const SIGNALS_LIMITATIONS = [
  "GitHub 为精选公开项目及有限关键词搜索快照，未覆盖所有项目；star、fork、提交日期仅反映平台活动，不代表科研质量、性能或临床有效性。",
  "GitHub 许可证字段仅来自仓库元数据，不保证模型权重、训练数据或衍生应用采用同一许可；请核对项目原文。",
  "新闻通过 Google News 公开搜索 RSS 发现；该入口不是承诺稳定的官方开发者 API。结果受语言、地区、索引及查询上限影响，不代表全行业进展。",
  "检索使用有限关键词，排除明显的课程作业、个人主页、财报、上市与人事任命；仍可能误收或漏收，浏览与分析时请核对原始链接。",
  "新闻标题与摘要是检索线索，未经原始文章核验；发布方可能包括媒体和企业，宣传与转载不可作为独立验证。Google 是发现渠道，不是原始发布者。",
  "论文、仓库、新闻可能描述同一工作；联合研判应去重，不将多渠道报道当作多次独立证据。首次发现时间不等于发布时间。",
];
export function emptyResearchSignalsData(now = new Date().toISOString()): ResearchSignalsData {
  return { schemaVersion: 1, generatedAt: now, records: [], sources: [], limitations: [...SIGNALS_LIMITATIONS] };
}
export function parseResearchSignalsData(value: unknown): ResearchSignalsData { return ResearchSignalsDataSchema.parse(value); }
export function signalDate(record: ResearchSignal): string | null {
  if (record.kind === "news") return record.publishedAt;
  return [record.pushedAt, record.releasedAt, record.publishedAt].filter((value): value is string => !!value).sort().at(-1) ?? null;
}
