import { groupWorks } from "./paper-works";
import { paperScope } from "./paper-scope";
import type { Paper } from "./types";

// Explicit, versioned screening rules. No model inference or learned scores.
export const HISTORY_RULE_VERSION = "2026-11-17-history-v1";
export const HISTORY_THRESHOLDS = {
  maxArchiveShare: 0.1,
  papers: 3,
  paperYears: 3,
  paperSpanDays: 730,
  logicPapers: 2,
  datasetSpanDays: 365,
  codeYears: 3,
  codeSpanDays: 730,
  recentCodeDays: 365,
} as const;

type Row = Record<string, unknown>;
const row = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(row) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const unique = <T>(v: T[]): T[] => [...new Set(v)];
const DAY = 86_400_000;
const scopes: Record<string, { scope: string; pattern: RegExp }> = {
  "spinal-cord-mri": {
    scope: "脊髓 MRI 的分割、神经根定位与跨中心定量测量；不包含椎骨影像。",
    pattern: /\bspinal (?:cord|nerve rootlet)/i,
  },
  "fetal-brain-mri": {
    scope: "胎儿脑 MRI 的运动校正、超分辨重建与组织分割。",
    pattern:
      /\bfetal\b[\s\S]{0,120}\b(?:brain|mri|magnetic resonance)\b|\b(?:brain|mri)\b[\s\S]{0,120}\bfetal\b/i,
  },
  "qsm-reconstruction": {
    scope: "定量磁化率成像的掩膜、背景场去除、偶极反演与重建可重复性。",
    pattern: /\b(?:quantitative susceptibility mapping|qsm)\b/i,
  },
};

/** Reject partial/invalid dates rather than inventing a day from a version label. */
export function historyDate(value: unknown, asOf: string): string | null {
  const s = str(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(s)) return null;
  const day = s.slice(0, 10);
  if (day > asOf.slice(0, 10)) return null;
  const n = Date.parse(s);
  if (!Number.isFinite(n) || new Date(Date.parse(day)).toISOString().slice(0, 10) !== day) return null;
  return n < Date.parse(asOf.slice(0, 10)) + DAY ? day : null;
}
const span = (dates: string[]) =>
  dates.length > 1
    ? Math.round((Date.parse([...dates].sort().at(-1)!) - Date.parse([...dates].sort()[0])) / DAY)
    : 0;
const yearsOf = (dates: string[]) => unique(dates.map((d) => Number(d.slice(0, 4)))).sort((a, b) => a - b);
function http(value: unknown): string {
  try {
    const u = new URL(str(value));
    return /^https?:$/.test(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
function repoKey(value: unknown): string {
  try {
    const u = new URL(str(value));
    const parts = u.pathname.split("/").filter(Boolean);
    return u.hostname.toLowerCase() === "github.com" && parts.length >= 2
      ? `${parts[0]}/${parts[1].replace(/\.git$/, "")}`.toLowerCase()
      : "";
  } catch {
    return "";
  }
}
function identity(value: unknown): string {
  return str(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .replace(/^10\.48550\/arxiv\./, "arxiv:")
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//, "arxiv:")
    .replace(/\.pdf$/, "")
    .replace(/^(arxiv:\d{4}\.\d{4,5})v\d+$/, "$1");
}
function paperIds(p: Row): string[] {
  const arxiv = identity(p.arxivId);
  return unique(
    [
      p.doi,
      p.relatedDoi,
      p.workId,
      p.id,
      arxiv ? (arxiv.startsWith("arxiv:") ? arxiv : `arxiv:${arxiv}`) : "",
      p.pmid ? `pmid:${p.pmid}` : "",
    ]
      .map(identity)
      .filter(Boolean),
  );
}
const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const cueRules = {
  problem: [
    ["运动与伪影", /\b(?:motion|artifact\w*|artefact\w*)\b/i],
    ["跨中心差异", /\b(?:variab\w*|heterogen\w*|domain shift|inter.site|inter.scanner)\b/i],
    ["可重复性", /\b(?:reproducib\w*|repeatab\w*)\b/i],
    [
      "数据或方法局限",
      /\b(?:challeng\w*|limited|lack\w*|difficult\w*|ill.posed|uncertain\w*|inconsisten\w*)\b/i,
    ],
  ],
  method: [
    ["神经网络", /\b(?:convolution\w*|neural networks?|deep learning|cnn|u.net|nnunet)\b/i],
    ["重建与反演", /\b(?:reconstruction|inversion|regulariz\w*|super.resolution)\b/i],
    ["分割与配准", /\b(?:segmentation|registration)\b/i],
    ["算法与处理流程", /\b(?:algorithm\w*|pipeline\w*|toolbox|framework|processing method)\b/i],
  ],
  validation: [
    ["测试或评估", /\b(?:validat\w*|evaluat\w*|test(?:ed|ing|s)?|assess\w*)\b/i],
    ["比较或基准实验", /\b(?:compar\w*|benchmark\w*|experiment\w*)\b/i],
    ["变异系数评估", /\bcoefficient of variation\b/i],
  ],
} satisfies Record<string, [string, RegExp][]>;
export function historyLogicCues(abstract: string) {
  const text = clean(abstract);
  // Do not count a promised experiment or an explicitly absent validation as completed evidence.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])|;\s*/);
  const observedSentences = sentences.filter(
    (s) =>
      !/\b(?:we will|we aim|we plan|we anticipate|anticipated|future work|not (?:yet )?(?:been )?(?:evaluated|validated|tested)|no (?:quantitative )?(?:validation|evaluation|results))\b/i.test(
        s,
      ),
  );
  const observed = observedSentences.join(" ");
  const cues = {
    problem: cueRules.problem.filter(([, re]) => re.test(text)).map(([label]) => label),
    method: cueRules.method.filter(([, re]) => re.test(observed)).map(([label]) => label),
    validation: cueRules.validation.filter(([, re]) => re.test(observed)).map(([label]) => label),
    result: [] as string[],
  };
  const metric =
    /\b(?:dice|accuracy|precision|sensitivity|specificity|error|coefficient|correlation|improv\w*|outperform\w*|achiev\w*)\b/i;
  const numericResult = observedSentences.some((s) => {
    if (!metric.test(s)) return false;
    const withoutIdentifiers = s
      .replace(/https?:\/\/\S+|\b10\.\d{4,9}\/\S+/g, "")
      .replace(/\b(?:19|20)\d{2}\b/g, "");
    return /\b\d+(?:\.\d+)?\s*(?:%|\b)/.test(withoutIdentifiers);
  });
  if (numericResult) cues.result.push("数值结果与性能指标共现");
  return { cues, logicComplete: Object.values(cues).every((v) => v.length > 0) };
}

export type HistorySource = { id: string; url: string; retrievedAt: string; sourceType?: string };
export type HistoryPaper = {
  id: string;
  title: string;
  date: string;
  url: string;
  doi?: string;
  cues: ReturnType<typeof historyLogicCues>["cues"];
  logicComplete: boolean;
};
export type HistoryDataset = {
  id: string;
  title: string;
  url: string;
  versions: {
    version: string;
    date: string | null;
    url: string;
    participants: number | null;
    changeDescription: string;
  }[];
  spanDays: number;
  contentGrowth: boolean;
  linked: boolean;
};
export type HistoryRepository = {
  repository: string;
  url: string;
  events: { date: string; label: string; kind: "release" | "commit"; url: string; description: string }[];
  years: number[];
  spanDays: number;
  recent: boolean;
  linked: boolean;
  archived: boolean | null;
};
export type HistoryDirection = {
  id: string;
  title: string;
  scope: string;
  archiveCount: number;
  archiveShare: number;
  evidenceStatus: "sufficient" | "pending";
  checks: { id: string; label: string; passed: boolean; detail: string }[];
  gaps: string[];
  papers: HistoryPaper[];
  datasets: HistoryDataset[];
  repositories: HistoryRepository[];
  sources: HistorySource[];
  limitations: string[];
};
export type LongitudinalHistory = {
  version: string;
  asOf: string;
  basePaperCount: number;
  enrichedPaperCount: number;
  directions: HistoryDirection[];
};

export function analyzeLongitudinalHistory(input: {
  packs: unknown[];
  papers: Paper[];
  asOf: string;
}): LongitudinalHistory {
  if (!historyDate(input.asOf, input.asOf)) throw new Error("Invalid history asOf date");
  const asOf = input.asOf.slice(0, 10);
  const core = input.papers.filter(
    (p) => p.dateAnomaly !== "future" && historyDate(p.publishedAt, asOf) && paperScope(p) === "core",
  );
  const archive = groupWorks(core, { titleAuthors: false }).map(
    (group) =>
      [...group].sort((a, b) => b.abstract.length - a.abstract.length || a.id.localeCompare(b.id))[0],
  );
  const enrichedIds = new Set<string>();
  const directions = input.packs
    .map((inputPack): HistoryDirection => {
      const pack = row(inputPack),
        candidate = row(pack.candidate),
        id = str(candidate.id),
        topic = scopes[id];
      if (!topic) throw new Error(`Unsupported history scope: ${id}`);
      const sources: HistorySource[] = rows(pack.sources).map((s) => {
        const url = http(s.url),
          retrievedAt = historyDate(s.retrievedAt, asOf);
        if (!str(s.id) || !url || !retrievedAt) throw new Error(`Invalid history source: ${str(s.id)}`);
        return { id: str(s.id), url, retrievedAt, sourceType: str(s.sourceType) || undefined };
      });
      if (new Set(sources.map((s) => s.id)).size !== sources.length)
        throw new Error(`Duplicate source ID: ${id}`);
      const sourceIds = new Set(sources.map((s) => s.id));
      const refs = (v: Row) => unique([str(v.sourceId), ...strings(v.sourceIds)].filter(Boolean));
      const sourced = (v: Row) => refs(v).length > 0 && refs(v).every((s) => sourceIds.has(s));
      const validateRefs = (v: unknown): void => {
        if (Array.isArray(v)) {
          v.forEach(validateRefs);
          return;
        }
        if (!v || typeof v !== "object") return;
        for (const [key, value] of Object.entries(v)) {
          if (/sourceIds?$/i.test(key)) {
            const values = Array.isArray(value) ? strings(value) : [str(value)].filter(Boolean);
            for (const sourceId of values)
              if (!sourceIds.has(sourceId)) throw new Error(`Unknown source ID: ${sourceId}`);
          } else validateRefs(value);
        }
      };
      validateRefs(pack);
      type Work = { records: Row[]; ids: string[]; view: HistoryPaper };
      const selected: Row[][] = [];
      for (const p of rows(pack.papers)) {
        if (
          !sourced(p) ||
          !historyDate(p.publishedAt, asOf) ||
          !http(p.url) ||
          !topic.pattern.test(`${str(p.title)} ${clean(str(p.rawAbstract))}`)
        )
          continue;
        const ids = paperIds(p);
        if (!ids.length) continue;
        const matches = selected.filter((g) =>
          g.some((item) => paperIds(item).some((value) => ids.includes(value))),
        );
        if (matches.length) {
          const merged = [p, ...matches.flat()];
          for (const g of matches) selected.splice(selected.indexOf(g), 1);
          selected.push(merged);
        } else selected.push([p]);
      }
      const works: Work[] = selected
        .map((records) => {
          records.sort((a, b) => str(a.publishedAt).localeCompare(str(b.publishedAt)));
          const p = records[0],
            ids = unique(records.flatMap(paperIds));
          const abstract = [...records].sort(
            (a, b) => str(b.rawAbstract).length - str(a.rawAbstract).length,
          )[0];
          const key = identity(p.workId) || identity(p.doi) || identity(p.id) || ids[0];
          enrichedIds.add(key);
          return {
            records,
            ids,
            view: {
              id: key,
              title: str(p.title),
              date: historyDate(p.publishedAt, asOf)!,
              url: http(p.url),
              doi: str(p.doi) || undefined,
              ...historyLogicCues(str(abstract.rawAbstract)),
            },
          };
        })
        .sort((a, b) => a.view.date.localeCompare(b.view.date));
      const matchLink = (link: Row, work: Work) =>
        sourced(link) &&
        [link.doi, link.paperDoi, link.paperId]
          .map(identity)
          .filter(Boolean)
          .some((value) => work.ids.includes(value));
      const literalLinks = (w: Work) =>
        w.records
          .flatMap((p) => rows(p.explicitResourceLinks))
          .filter(
            (link) =>
              sourced(link) && (link.urlLiteralInAbstract === true || link.urlLiteralInFullText === true),
          );
      const datasetResults = rows(pack.datasets).map((d) => {
        const seen = new Set<string>();
        const versions = rows(d.versions)
          .filter((v) => {
            if (!str(v.version) || seen.has(str(v.version)) || !sourced(v) || !http(v.url)) return false;
            if (repoKey(d.url) && repoKey(v.url) !== repoKey(d.url)) return false;
            seen.add(str(v.version));
            return true;
          })
          .map((v) => ({
            version: str(v.version),
            date: historyDate(v.releasedAt, asOf),
            url: http(v.url),
            participants:
              typeof v.participantCountObserved === "number"
                ? v.participantCountObserved
                : typeof v.participants === "number"
                  ? v.participants
                  : null,
            changeDescription: str(v.changeDescription) || "未核实该版本的内容变更",
            raw: v,
          }))
          .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
        const dated = versions.filter((v) => v.date !== null);
        // Count growth only between source-backed versions of this exact dataset. Metadata timestamps do not qualify.
        const observedGrowth = dated.some((after, index) =>
          dated.slice(0, index).some((before) => {
            if (
              !before.date ||
              !after.date ||
              span([before.date, after.date]) < HISTORY_THRESHOLDS.datasetSpanDays
            )
              return false;
            // GitHub owner/repository is an exact lineage key. DOI-hosted families require a declared shared concept DOI.
            const sameFamily =
              !!repoKey(d.url) ||
              (identity(d.doi) &&
                identity(before.raw.conceptDoi) === identity(d.doi) &&
                identity(after.raw.conceptDoi) === identity(d.doi));
            if (!sameFamily) return false;
            const growth = row(d.growthEvidence);
            const positiveRows =
              before.participants !== null &&
              after.participants !== null &&
              after.participants > before.participants &&
              sourced(growth) &&
              growth.fromVersion === before.version &&
              growth.toVersion === after.version &&
              growth.participantRowsBefore === before.participants &&
              growth.participantRowsAfter === after.participants &&
              typeof growth.addedImagingFilePaths === "number" &&
              growth.addedImagingFilePaths > 0;
            const annotationGrowth =
              after.raw.changeType === "annotation-growth" &&
              typeof after.raw.changedDataFilesCount === "number" &&
              after.raw.changedDataFilesCount > 0 &&
              str(after.raw.comparedWithVersion) === before.version;
            return positiveRows || annotationGrowth;
          }),
        );
        const linked = works
          .filter(
            (w) =>
              rows(d.paperLinks).some((l) => matchLink(l, w)) ||
              literalLinks(w).some((l) => repoKey(d.url) && repoKey(l.url) === repoKey(d.url)),
          )
          .map((w) => w.view.id);
        const view: HistoryDataset = {
          id: str(d.id),
          title: str(d.title),
          url: http(d.url),
          versions: versions.map(({ raw: _raw, ...v }) => v),
          spanDays: span(dated.map((v) => v.date!)),
          contentGrowth: observedGrowth,
          linked: linked.length > 0,
        };
        return {
          view,
          linked,
          qualifies:
            dated.length >= 2 &&
            view.spanDays >= HISTORY_THRESHOLDS.datasetSpanDays &&
            observedGrowth &&
            linked.length > 0,
        };
      });
      const repositoryResults = rows(pack.code).map((c) => {
        const events: HistoryRepository["events"] = [];
        const seen = new Set<string>();
        const add = (v: Row, kind: "release" | "commit") => {
          const date = historyDate(
            kind === "release" ? v.publishedAt : (v.date ?? v.committedAt ?? v.occurredAt),
            asOf,
          );
          const url = http(v.url),
            key = kind === "release" ? str(v.version) : str(v.sha || v.commitSha) || url;
          if (!date || !url || !key || seen.has(`${kind}:${key}`) || !(sourced(v) || sourced(c))) return;
          if (repoKey(url) !== repoKey(c.url) || !repoKey(url)) return;
          seen.add(`${kind}:${key}`);
          events.push({
            date,
            label: kind === "release" ? str(v.version) : key.slice(0, 8),
            kind,
            url,
            description: str(v.subject || v.text),
          });
        };
        rows(c.releases).forEach((v) => add(v, "release"));
        [...rows(c.commits), ...rows(c.maintenanceFacts)].forEach((v) => add(v, "commit"));
        events.sort((a, b) => a.date.localeCompare(b.date));
        const linked = works
          .filter(
            (w) =>
              rows(c.officialPaperLinks).some((l) => matchLink(l, w)) ||
              literalLinks(w).some((l) => repoKey(l.url) && repoKey(l.url) === repoKey(c.url)),
          )
          .map((w) => w.view.id);
        const dates = events.map((e) => e.date),
          years = yearsOf(dates);
        const archived = typeof c.archived === "boolean" ? c.archived : null;
        const latest = dates.at(-1);
        const recent =
          !!latest && (Date.parse(asOf) - Date.parse(latest)) / DAY <= HISTORY_THRESHOLDS.recentCodeDays;
        const view: HistoryRepository = {
          repository: str(c.repository),
          url: http(c.url),
          events,
          years,
          spanDays: span(dates),
          recent,
          linked: linked.length > 0,
          archived,
        };
        return {
          view,
          linked,
          qualifies:
            archived === false &&
            years.length >= HISTORY_THRESHOLDS.codeYears &&
            view.spanDays >= HISTORY_THRESHOLDS.codeSpanDays &&
            recent &&
            linked.length > 0,
        };
      });
      const papers = works.map((w) => w.view),
        dates = papers.map((p) => p.date),
        paperYears = yearsOf(dates),
        paperSpan = span(dates);
      const archiveCount = archive.filter((p) =>
        topic.pattern.test(`${p.title} ${p.originalAbstract || p.abstract}`),
      ).length;
      const archiveShare = archive.length ? archiveCount / archive.length : 0;
      const logicCount = papers.filter((p) => p.logicComplete).length;
      const chain = datasetResults.some(
        (d) =>
          d.qualifies &&
          repositoryResults.some(
            (c) => c.qualifies && d.linked.some((paperId) => c.linked.includes(paperId)),
          ),
      );
      const checks: HistoryDirection["checks"] = [
        {
          id: "niche",
          label: "补采前库内占比较低",
          passed: archive.length > 0 && archiveShare < HISTORY_THRESHOLDS.maxArchiveShare,
          detail: `${archiveCount} / ${archive.length} 篇（${(100 * archiveShare).toFixed(2)}%），阈值 <10%；仅代表本地库。`,
        },
        {
          id: "papers",
          label: "多年独立论文",
          passed:
            papers.length >= HISTORY_THRESHOLDS.papers &&
            paperYears.length >= HISTORY_THRESHOLDS.paperYears &&
            paperSpan >= HISTORY_THRESHOLDS.paperSpanDays,
          detail: `${papers.length} 个独立作品、${paperYears.length} 个年份、跨度 ${paperSpan} 天；要求 ≥3 / ≥3 / ≥730。`,
        },
        {
          id: "logic",
          label: "问题—方法—验证—数值结果线索",
          passed: logicCount >= HISTORY_THRESHOLDS.logicPapers,
          detail: `${logicCount} 篇原始摘要同时命中四类固定词法规则；要求 ≥2。仅检查文本线索，不验证科学结论。`,
        },
        {
          id: "data",
          label: "同一数据集的跨年内容积累",
          passed: datasetResults.some((d) => d.qualifies),
          detail:
            "要求明确论文关联、≥2 个已核实日期的版本、跨度 ≥365 天，并有配对版本的新增影像或标注证据；元数据改动不计。",
        },
        {
          id: "code",
          label: "论文关联与多年代码维护",
          passed: repositoryResults.some((c) => c.qualifies),
          detail:
            "要求非归档、明确论文关联、实际发布或提交覆盖 ≥3 年且跨度 ≥730 天，最近事件 ≤365 天；建库日期不计。",
        },
        {
          id: "chain",
          label: "数据—论文—代码证据链闭合",
          passed: chain,
          detail: "至少一个选中作品同时明确关联满足积累条件的数据集和代码库；文本相似候选不计。",
        },
      ];
      const gaps = checks.filter((c) => !c.passed).map((c) => `${c.label}：${c.detail}`);
      return {
        id,
        title: str(candidate.title),
        scope: topic.scope,
        archiveCount,
        archiveShare,
        evidenceStatus: gaps.length === 0 ? "sufficient" : "pending",
        checks,
        gaps,
        papers,
        datasets: datasetResults.map((d) => d.view),
        repositories: repositoryResults.map((c) => c.view),
        sources,
        limitations: [
          "这是定向补采的三个候选，不是对全领域的小众方向穷尽排名；补采论文不加入占比分母。",
          "证据充分表示达到当前规则门槛；不等于研究质量已获人工评审、数据已下载复现，或每年都持续维护。",
          ...strings(pack.limitations),
        ],
      };
    })
    .sort(
      (a, b) =>
        Number(b.evidenceStatus === "sufficient") - Number(a.evidenceStatus === "sufficient") ||
        b.checks.filter((c) => c.passed).length - a.checks.filter((c) => c.passed).length ||
        a.id.localeCompare(b.id),
    );
  if (new Set(directions.map((d) => d.id)).size !== directions.length)
    throw new Error("Duplicate history scope");
  return {
    version: HISTORY_RULE_VERSION,
    asOf,
    basePaperCount: archive.length,
    enrichedPaperCount: enrichedIds.size,
    directions,
  };
}
