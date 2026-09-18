import { INTEREST_TAXONOMY_VERSION, classify, normalizeDoi, textOnly } from "./classify";
import type { MonitorData, Paper, RequestLog, SyncRun } from "./types";

type Raw = Record<string, any>;
const unique = <T>(items: T[]) => [...new Set(items)];
const uniqueObjects = <T>(items: T[]) => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
export const COVERAGE = "有限范围的官方元数据采集，不代表完整文献库。Europe PMC：10个感兴趣方向的发表/首次收录重叠窗口，每方向最多300条；arXiv：10个方向各按版本更新时间最近100条，成功后同一UTC日复用缓存；medRxiv：radiology and imaging分类，最多240条版本记录。方向间可能重叠，关键词规则允许一文多类。保留历史入库论文，不据此推断发文趋势。";

/** arXiv's journal DOI is a relationship, not the preprint's identity. */
export function normalizeRecord(raw: Raw, firstSeenFallback: string): Paper {
  const title = textOnly(raw.title), abstract = textOnly(raw.abstract);
  const doi = normalizeDoi(raw.doi);
  const rawArxivId = raw.arxivId ?? (typeof raw.id === "string" && raw.id.startsWith("arxiv:") ? raw.id.slice(6) : null);
  const arxivId = rawArxivId ? String(rawArxivId).replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "") : null;
  const id = arxivId ? `arxiv:${arxivId}` : doi ? `doi:${doi}` : String(raw.id ?? "");
  if (!id) throw new Error("论文缺少稳定标识，停止写入以保护原有数据");
  const source = String(raw.source ?? "unknown");
  const authors = (Array.isArray(raw.authors) ? raw.authors : []).map((author: Raw | string) => {
    const a = typeof author === "string" ? { name: author } : author;
    return { ...a, name: textOnly(a.name), orcid: a.orcid ?? null,
      affiliations: unique((a.affiliations ?? []).map(textOnly)) as string[] };
  });
  return {
    ...raw, id, title, abstract, originalAbstract: raw.originalAbstract ?? raw.abstract ?? null, authors, doi, arxivId, pmid: raw.pmid ?? null, source,
    sources: unique([...(raw.sources ?? []), source]),
    affiliations: unique([...(raw.affiliations ?? []).map(textOnly), ...authors.flatMap((a: any) => a.affiliations)]),
    status: raw.status ?? raw.publicationStatus ?? "unknown",
    publishedAt: raw.publishedAt ?? raw.publicationDate ?? "",
    updatedAt: raw.updatedAt ?? raw.updatedDate ?? null,
    firstSeenAt: raw.firstSeenAt ?? firstSeenFallback,
    venue: raw.venue ?? raw.journal ?? null, url: raw.url ?? "",
    version: raw.version ?? null,
    relatedDoi: normalizeDoi(raw.relatedDoi ?? raw.publishedDoi ?? (arxivId ? doi : null)),
    versions: raw.versions ?? [], provenance: raw.provenance ?? [],
    ...classify(title, abstract), reviewStatus: raw.reviewStatus ?? "keyword_candidate",
  };
}

function earliest(a: string, b: string): string {
  if (!Number.isFinite(Date.parse(a))) return b;
  if (!Number.isFinite(Date.parse(b))) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export function mergeRecord(old: Paper, incoming: Paper): Paper {
  const oldTime = Date.parse(old.updatedAt ?? old.publishedAt) || 0;
  const newTime = Date.parse(incoming.updatedAt ?? incoming.publishedAt) || 0;
  const newer = newTime > oldTime || (newTime === oldTime && Number(incoming.version ?? 0) >= Number(old.version ?? 0));
  const base = newer ? incoming : old, fallback = newer ? old : incoming;
  const title = base.title || fallback.title, abstract = base.abstract || fallback.abstract;
  return {
    ...fallback, ...base, id: incoming.id.startsWith("doi:") ? incoming.id : old.id,
    title, abstract, doi: base.doi ?? fallback.doi, pmid: base.pmid ?? fallback.pmid,
    arxivId: base.arxivId ?? fallback.arxivId,
    authors: base.authors.length ? base.authors : fallback.authors,
    authorString: base.authorString || fallback.authorString,
    originalAbstract: base.abstract ? (base.originalAbstract ?? base.abstract) : (fallback.originalAbstract ?? fallback.abstract),
    affiliations: unique([...old.affiliations, ...incoming.affiliations]),
    sources: unique([...old.sources, ...incoming.sources]),
    firstSeenAt: earliest(old.firstSeenAt, incoming.firstSeenAt),
    venue: base.venue ?? fallback.venue,
    relatedDoi: base.relatedDoi ?? fallback.relatedDoi,
    provenance: uniqueObjects([...old.provenance, ...incoming.provenance]).slice(-20),
    versions: uniqueObjects([...(old.versions ?? []), ...(incoming.versions ?? [])]),
    ...classify(title, abstract),
  };
}

/** Native identifiers also connect a previously DOI-less record when its DOI arrives. */
function identityKeys(p: Paper): string[] {
  if (p.arxivId || p.id.startsWith("arxiv:")) return [`arxiv:${(p.arxivId ?? p.id.slice(6)).replace(/v\d+$/, "")}`];
  const keys = [p.id];
  if (p.doi) keys.push(`doi:${p.doi}`);
  if (p.pmid) keys.push(`pmid:${p.pmid}`);
  for (const item of p.provenance) {
    if (item.sourceRecordId && item.queryUrl?.startsWith("https://www.ebi.ac.uk/europepmc/")) {
      keys.push(`epmc:${p.sourceCollection ?? ""}:${item.sourceRecordId}`);
    }
  }
  return unique(keys);
}

export function mergePapers(existing: Paper[], incoming: Paper[]): { papers: Paper[]; added: number; updated: number } {
  const records = new Map<number, Paper>(), aliases = new Map<string, number>();
  let next = 0, added = 0, updated = 0;
  function insert(p: Paper, count: boolean) {
    const keys = identityKeys(p);
    const matches = unique(keys.map(key => aliases.get(key)).filter((id): id is number => id !== undefined));
    if (!matches.length) {
      const id = next++; records.set(id, p); keys.forEach(key => aliases.set(key, id));
      if (count) added++;
      return;
    }
    const id = matches[0];
    let old = records.get(id)!;
    for (const duplicate of matches.slice(1)) {
      old = mergeRecord(old, records.get(duplicate)!); records.delete(duplicate);
      for (const [alias, target] of aliases) if (target === duplicate) aliases.set(alias, id);
    }
    const merged = mergeRecord(old, p);
    if (count && ["title", "abstract", "version", "relatedDoi", "authors", "sources"].some(key => JSON.stringify((old as any)[key]) !== JSON.stringify((merged as any)[key]))) updated++;
    records.set(id, merged);
    [...keys, ...identityKeys(merged)].forEach(key => aliases.set(key, id));
  }
  existing.forEach(p => insert(p, false)); incoming.forEach(p => insert(p, true));
  return { papers: [...records.values()].sort((a,b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)), added, updated };
}

/** Reject invalid input rather than silently creating an empty public library. */
export function parseMonitorData(value: unknown): MonitorData {
  const data = value as Partial<MonitorData>;
  if (!data || !Array.isArray(data.papers) || typeof data.collectedAt !== "string") throw new Error("输入文件不是有效的 MonitorData：需要 papers 数组和 collectedAt");
  const normalized = data.papers.map(p => normalizeRecord(p, data.collectedAt!));
  const papers = mergePapers(normalized, []).papers;
  return {
    ...data, papers, totalStored: papers.length,
    runs: Array.isArray(data.runs) ? data.runs : [], queryRuns: Array.isArray(data.queryRuns) ? data.queryRuns : [],
    collectedAt: data.collectedAt, storageAvailable: true,
    lastSuccessfulSync: data.lastSuccessfulSync ?? null, coverage: data.coverage ?? COVERAGE,
  };
}

export type SourceOutcome = { papers: Paper[]; run: SyncRun; requestLogs: RequestLog[]; taxonomyVersion?:string };

/** Preserve actual source fetch timestamps even when a daily source is cached. */
function retainedRuns(runs:SyncRun[]):SyncRun[] {
 const ordered = [...runs].sort((a,b) => b.completedAt.localeCompare(a.completedAt));
 const protectedRuns = new Set<SyncRun>();
 const latestSources = new Set<string>(), successfulSources = new Set<string>();
 for(const run of ordered) {
  if(!latestSources.has(run.source)) { protectedRuns.add(run); latestSources.add(run.source); }
  if(run.status !== "error" && !run.error && !successfulSources.has(run.source)) {
   protectedRuns.add(run); successfulSources.add(run.source);
  }
 }
 const kept = ordered.filter(run => !protectedRuns.has(run)).slice(0,Math.max(0,45-protectedRuns.size));
 return [...protectedRuns,...kept].sort((a,b) => b.completedAt.localeCompare(a.completedAt)).slice(0,45);
}

export function applyOutcomes(previous: MonitorData, outcomes: SourceOutcome[], completedAt: string): MonitorData {
  let papers = previous.papers;
  const runs = outcomes.map(outcome => {
    const merged = mergePapers(papers, outcome.papers); papers = merged.papers;
    return { ...outcome.run, added: merged.added, updated: merged.updated };
  });
  const sourceTaxonomyVersions: Record<string,string> = {};
  if(previous.sourceTaxonomyVersions && typeof previous.sourceTaxonomyVersions === "object") {
    for(const [source,version] of Object.entries(previous.sourceTaxonomyVersions)) if(typeof version === "string") sourceTaxonomyVersions[source] = version;
  }
  for(const outcome of outcomes) if(outcome.taxonomyVersion && !outcome.run.error && outcome.run.status !== "error") sourceTaxonomyVersions[outcome.run.source] = outcome.taxonomyVersion;
  const errors = runs.filter(run => run.error).map(run => ({ source: run.source, message: run.error! }));
  const allFailed = runs.length > 0 && runs.every(run => run.status === "error");
  const hadSuccessfulSync = runs.some(run => run.status !== "error" && !run.error);
  return {
    ...previous, papers, totalStored: papers.length, interestTaxonomyVersion:INTEREST_TAXONOMY_VERSION, sourceTaxonomyVersions,
    runs: retainedRuns([...runs, ...previous.runs]),
    queryRuns: previous.queryRuns,
    requestLogs: [...(previous.requestLogs ?? []), ...outcomes.flatMap(item => item.requestLogs)].slice(-500),
    collectedAt: completedAt, lastSuccessfulSync: hadSuccessfulSync ? completedAt : previous.lastSuccessfulSync,
    storageAvailable: true, coverage: COVERAGE,
    status: allFailed ? "error" : runs.some(run => run.status !== "ok") ? "partial" : "ok",
    errors, error: errors.length ? errors.map(e => `${e.source}: ${e.message}`).join("；") : undefined,
  };
}
