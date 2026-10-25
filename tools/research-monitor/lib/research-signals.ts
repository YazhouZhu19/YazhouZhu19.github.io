import { z } from "zod";

// A complete snapshot is loaded atomically. Reject oversized updates rather than
// silently dropping older discoveries to make a publication fit.
// The live archive reached 63.6 MiB; keep ingestion bounded while allowing growth.
// Split browser loading and the complete-site publication budgets remain enforced.
export const SIGNALS_MAX_BYTES = 96 * 1024 * 1024;
export const SIGNALS_MAX_RECORDS = 100000;
export const SIGNALS_MAX_SOURCES = 160;

/** Public metadata only. This module is safe to import in the browser. */
export function safeSignalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !/^(localhost|.*\.localhost|.*\.local|\[.*\]|\d+(?:\.\d+){0,3})$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}
const url = z.string().refine(safeSignalUrl, "Expected a public HTTPS URL");
const date = z
  .string()
  .max(40)
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    "Invalid timestamp",
  );
const discoveryGroups = z
  .array(
    z
      .string()
      .max(80)
      .regex(/^[a-z][a-z0-9-]*$/),
  )
  .max(96)
  .refine((values) => new Set(values).size === values.length, "Duplicate discovery groups")
  .optional();
export const SignalRelevanceSchema = z
  .object({
    level: z.enum(["direct", "candidate"]),
    reasons: z
      .array(z.string().min(1).max(180))
      .min(1)
      .max(12)
      .refine((values) => new Set(values).size === values.length, "Duplicate relevance reasons"),
  })
  .strict();
export type SignalRelevance = z.infer<typeof SignalRelevanceSchema>;
const common = {
  id: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  url,
  summary: z.string().max(1200),
  summaryKind: z.enum(["repository-description", "publisher-excerpt", "search-snippet"]),
  publisher: z.string().min(1).max(200),
  publishedAt: date.nullable(),
  firstSeenAt: date,
  observedAt: date,
  updatedAt: date.nullable(),
  topics: z.array(z.string().max(100)).max(30),
  sourceId: z.string().min(1).max(100),
  relatedUrls: z.array(url).max(40),
  // Retrieval routes and relevance clues are not quality or clinical validation.
  discoveryGroups,
  relevance: SignalRelevanceSchema.optional(),
};
export const GitHubSignalSchema = z
  .object({
    ...common,
    kind: z.literal("github"),
    fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    openIssues: z.number().int().nonnegative(),
    license: z.string().max(100).nullable(),
    language: z.string().max(100).nullable(),
    archived: z.boolean(),
    pushedAt: date.nullable(),
    releasedAt: date.nullable(),
    releaseUrl: url.nullable(),
    readmeExcerpt: z.string().max(1000),
  })
  .strict();
export const NewsSignalSchema = z
  .object({
    ...common,
    kind: z.literal("news"),
    newsType: z.enum(["model", "research", "tooling"]),
    discoveryUrl: url.nullable(),
    originalUrl: url.nullable(),
  })
  .strict();
export const ResearchSignalSchema = z.discriminatedUnion("kind", [GitHubSignalSchema, NewsSignalSchema]);
export type GitHubSignal = z.infer<typeof GitHubSignalSchema>;
export type NewsSignal = z.infer<typeof NewsSignalSchema>;
export type ResearchSignal = z.infer<typeof ResearchSignalSchema>;
export const SignalSourceStateSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    kind: z.enum(["github", "news"]),
    url,
    status: z.enum(["ok", "partial", "error", "pending"]),
    checkedAt: date.nullable(),
    lastSuccessAt: date.nullable(),
    received: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
    error: z.string().max(1600).nullable(),
    coverage: z.string().max(1200),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (source.status === "pending") {
      if (
        source.checkedAt !== null ||
        source.lastSuccessAt !== null ||
        source.received !== 0 ||
        source.error !== null
      )
        ctx.addIssue({
          code: "custom",
          message: "An unattempted source cannot claim a check, success, response or error",
        });
    } else if (source.checkedAt === null)
      ctx.addIssue({
        code: "custom",
        path: ["checkedAt"],
        message: "An attempted source requires a check timestamp",
      });
  });
export type SignalSourceState = z.infer<typeof SignalSourceStateSchema>;
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, "Invalid calendar date");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const GitHubDiscoveryStateSchema = z
  .object({
    catalogVersion: z.string().min(1).max(200),
    cursor: count,
    queue: z
      .array(
        z
          .object({
            groupId: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[a-z][a-z0-9-]*$/),
            query: z.string().min(1).max(1000),
            sort: z.enum(["best-match", "updated"]),
            page: z.number().int().min(1).max(10),
            from: day.optional(),
            to: day.optional(),
          })
          .strict()
          .refine((item) => !item.from || !item.to || item.from <= item.to, "Invalid discovery window"),
      )
      .max(2000),
    completedQueries: count,
    repositoryCursor: count,
    cycles: count,
    lastRun: z
      .object({
        searchRequests: count,
        requests: count,
        truncatedQueries: count,
        incompleteQueries: count,
        splitQueries: count,
        pendingQueries: count,
      })
      .strict()
      .optional(),
  })
  .strict();
export const NewsDiscoveryStateSchema = z
  .object({
    catalogVersion: z.string().min(1).max(200),
    cursor: count,
    queue: z
      .array(
        z
          .object({ queryId: z.string().min(1).max(160), from: day, to: day })
          .strict()
          .refine((item) => item.from < item.to, "Invalid discovery window"),
      )
      .max(6000),
    completedWindows: count,
    recentCheckedAt: z
      .record(z.string().min(1).max(160), date)
      .refine((value) => Object.keys(value).length <= SIGNALS_MAX_SOURCES, "Too many recent query timestamps")
      .optional(),
  })
  .strict();
export type GitHubDiscoveryState = z.infer<typeof GitHubDiscoveryStateSchema>;
export type NewsDiscoveryState = z.infer<typeof NewsDiscoveryStateSchema>;
export const ResearchSignalsDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: date,
    records: z.array(ResearchSignalSchema).max(SIGNALS_MAX_RECORDS),
    sources: z.array(SignalSourceStateSchema).max(SIGNALS_MAX_SOURCES),
    limitations: z.array(z.string().max(1200)).max(20),
    discoveryState: z
      .object({ github: GitHubDiscoveryStateSchema.optional(), news: NewsDiscoveryStateSchema.optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (const field of ["records", "sources"] as const) {
      const ids = data[field].map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", path: [field], message: "Duplicate IDs" });
    }
    const sourceIds = new Set(data.sources.map((source) => source.id));
    if (data.records.some((record) => !sourceIds.has(record.sourceId)))
      ctx.addIssue({ code: "custom", path: ["records"], message: "Unknown source" });
  });
export type ResearchSignalsData = z.infer<typeof ResearchSignalsDataSchema>;
export const SIGNALS_LIMITATIONS = [
  "GitHub 通过多组方向、任务、模态和主题检索，分批翻页与时间分窗持续补充。受索引、检索上限、API 配额和公开描述完整性影响，不能保证收录所有相关项目；star、fork、提交日期不代表科研质量、性能或临床有效性。",
  "GitHub 许可证字段仅来自仓库元数据，不保证模型权重、训练数据或衍生应用采用同一许可；请核对项目原文。",
  "新闻结合 Google News 公开搜索 RSS 与发布者公开 RSS/Atom 订阅发现。Google 搜索 RSS 不是承诺稳定的官方开发者 API；搜索受语言、地区、索引及查询上限影响，独立订阅仅覆盖发布者当前公开的条目，两者均不代表全行业进展。",
  "相关性按公开标题、简介、主题等线索分为高相关与待复核；检索标签和规则匹配理由不构成经过人工验证的任务分类。待复核记录保留供探索，不作为默认研判证据；仍可能误收或漏收。",
  "Google 新闻条目标注为检索摘要，独立订阅条目标注为发布者内容摘录；均未核验完整文章或研究结论。发布方可能包括媒体和企业，宣传与转载不可作为独立验证。Google 是发现渠道，不是原始发布者。",
  "论文、仓库、新闻可能描述同一工作；联合研判应去重，不将多渠道报道当作多次独立证据。首次发现时间不等于发布时间。",
];
export function emptyResearchSignalsData(now = new Date().toISOString()): ResearchSignalsData {
  return {
    schemaVersion: 1,
    generatedAt: now,
    records: [],
    sources: [],
    limitations: [...SIGNALS_LIMITATIONS],
  };
}
export function parseResearchSignalsData(value: unknown): ResearchSignalsData {
  return ResearchSignalsDataSchema.parse(value);
}
export function signalDate(record: ResearchSignal): string | null {
  if (record.kind === "news") return record.publishedAt;
  return (
    [record.pushedAt, record.releasedAt, record.publishedAt]
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? null
  );
}
