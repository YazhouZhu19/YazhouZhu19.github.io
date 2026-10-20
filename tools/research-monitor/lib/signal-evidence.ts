import { beijingDay } from "./dashboard";
import { publicationDay } from "./foresight";
import {
  evidenceFingerprint,
  prepareAiEvidence,
  type AiEvidence,
  type AiEvidenceItem,
  type AiSourceCoverage,
  type AiSourceKind,
  type AiSpec,
} from "./ai-evidence";
import { signalDate, type ResearchSignal } from "./research-signals";
import type { Paper } from "./types";

export type SignalAssociation = { signal: ResearchSignal; paperIds: string[]; basis: string[] };
const kinds: AiSourceKind[] = ["paper", "github", "news"];
const clean = (value: string) => value.replace(/[.,;:!?\])}>。；，]+$/g, "");

/** Exact identifiers and explicit links only; names, topics and owners never identify a PI. */
export function explicitEvidenceKeys(values: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const input of values) {
    if (!input) continue;
    const value = input.replace(/&amp;/g, "&");
    for (const match of value.matchAll(/\b10\.\d{4,9}\/[^\s<>"'\[\]]+/gi))
      keys.add(`doi:${clean(match[0]).toLowerCase()}`);
    const native = value
      .trim()
      .replace(/^arxiv:/i, "")
      .replace(/v\d+$/i, "");
    if (/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/i.test(native)) keys.add(`arxiv:${native.toLowerCase()}`);
    for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      try {
        const url = new URL(clean(match[0]));
        if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) continue;
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        let path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
        if (["doi.org", "dx.doi.org"].includes(host) && /^\/10\.\d{4,9}\//i.test(path))
          keys.add(`doi:${clean(path.slice(1)).toLowerCase()}`);
        if (host === "arxiv.org") {
          const id = path
            .replace(/^\/(?:abs|pdf)\//, "")
            .replace(/\.pdf$/i, "")
            .replace(/v\d+$/i, "");
          if (/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/i.test(id)) keys.add(`arxiv:${id.toLowerCase()}`);
        }
        if (host === "github.com") {
          const parts = path.split("/").filter(Boolean);
          if (
            parts.length >= 2 &&
            !["topics", "search", "orgs", "users", "settings", "features", "collections"].includes(
              parts[0].toLowerCase(),
            )
          ) {
            path = `/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`.toLowerCase();
            keys.add(`url:github.com${path}`);
          }
        } else if (path && path !== "/") {
          // Keep query strings for publisher record identities; discard tracking-only parameters.
          for (const name of [...url.searchParams.keys()])
            if (/^(?:utm_|gclid$|fbclid$)/i.test(name)) url.searchParams.delete(name);
          url.searchParams.sort();
          keys.add(`url:${host}${path}${url.search}`);
        }
      } catch {
        /* An invalid URL cannot form an identity link. */
      }
    }
  }
  return [...keys].sort();
}

export function findRelatedSignals(papers: Paper[], signals: ResearchSignal[]): SignalAssociation[] {
  const byKey = new Map<string, Set<string>>();
  for (const paper of papers)
    for (const key of explicitEvidenceKeys([
      paper.url,
      paper.doi,
      paper.relatedDoi,
      paper.arxivId,
      /^arxiv:/i.test(paper.id) ? paper.id : "",
      paper.abstract,
      paper.originalAbstract,
    ])) {
      const ids = byKey.get(key) ?? new Set<string>();
      ids.add(paper.id);
      byKey.set(key, ids);
    }
  return signals.flatMap((signal) => {
    const keys = explicitEvidenceKeys([
      signal.url,
      ...signal.relatedUrls,
      signal.kind === "news" ? signal.originalUrl : null,
    ]);
    const basis = keys.filter((key) => byKey.has(key));
    const paperIds = [...new Set(basis.flatMap((key) => [...byKey.get(key)!]))].sort();
    return paperIds.length ? [{ signal, paperIds, basis }] : [];
  });
}

function signalItem(signal: ResearchSignal, association?: SignalAssociation): AiEvidenceItem {
  return {
    id: `signal:${signal.kind}:${signal.id}`,
    title: signal.title,
    abstract: signal.summary,
    authors: [],
    affiliations: [],
    doi: null,
    source: signal.publisher,
    sources: [signal.publisher],
    status: "unknown",
    publishedAt: signalDate(signal) ?? "",
    updatedAt: signal.updatedAt,
    firstSeenAt: signal.firstSeenAt,
    venue: null,
    url: signal.url,
    tasks: [],
    modalities: [],
    organs: [],
    methods: [],
    humanSignals: [],
    evidence: [],
    tracks: [],
    reviewStatus: "unreviewed",
    provenance: [],
    signal,
    relatedPaperIds: association?.paperIds ?? [],
    associationBasis: association?.basis ?? [],
  };
}

/** Equal time strata within a signal kind; no star ranking or implicit popularity estimate. */
function sampleSignals(rows: AiEvidenceItem[], spec: AiSpec, limit: number): AiEvidenceItem[] {
  const bins = new Map<number, AiEvidenceItem[]>();
  const start = Date.parse(spec.from),
    span = Date.parse(spec.to) - start + 86400000;
  for (const row of rows) {
    const bin = Math.min(5, Math.floor(((Date.parse(row.publishedAt.slice(0, 10)) - start) / span) * 6));
    const bucket = bins.get(bin) ?? [];
    bucket.push(row);
    bins.set(bin, bucket);
  }
  const queues = [...bins]
    .sort(([a], [b]) => a - b)
    .map(([, bucket]) =>
      bucket.sort((a, b) => evidenceFingerprint(a.id).localeCompare(evidenceFingerprint(b.id))),
    );
  const chosen: AiEvidenceItem[] = [];
  for (let round = 0; chosen.length < limit; round++) {
    const active = queues.filter((queue) => queue[round]);
    if (!active.length) break;
    const count = Math.min(active.length, limit - chosen.length);
    for (let index = 0; index < count; index++)
      chosen.push(active[Math.floor(((index + 0.5) * active.length) / count)][round]);
  }
  return chosen;
}

export function prepareCombinedAiEvidence(
  papers: Paper[],
  signals: ResearchSignal[],
  spec: AiSpec,
  sources: AiSourceKind[],
  limit = 48,
  now = new Date(),
): AiEvidence {
  const selected = new Set(sources);
  const base = prepareAiEvidence(selected.has("paper") ? papers : [], spec, limit, now);
  if (sources.length === 1 && sources[0] === "paper") return base;
  const today = beijingDay(now),
    to = base.spec.to;
  const historicalPapers = papers.filter((paper) => {
    const day = publicationDay(paper.publishedAt);
    return day && day <= to;
  });
  const associations = new Map(
    findRelatedSignals(historicalPapers, signals).map((item) => [item.signal.id, item]),
  );
  let excludedUnobserved = 0,
    excludedInvalid = base.excludedInvalid,
    excludedFuture = base.excludedFuture,
    signalRecords = 0;
  const eligible: Record<"github" | "news", AiEvidenceItem[]> = { github: [], news: [] };
  const seen = new Set<string>();
  for (const signal of [...signals].sort(
    (a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id),
  )) {
    if (!selected.has(signal.kind)) continue;
    // Candidates and older unassessed snapshots remain browsing leads. Only
    // explicitly direct matches enter evidence, consistent with the library UI.
    if (signal.relevance?.level !== "direct") continue;
    if (spec.mode === "team" && !associations.has(signal.id)) continue;
    const day = publicationDay(signalDate(signal) ?? "");
    if (!day) {
      excludedInvalid++;
      continue;
    }
    if (day > today) {
      excludedFuture++;
      continue;
    }
    if (day < spec.from || day > to) continue;
    const observedDay = beijingDay(new Date(signal.observedAt));
    // Mutable repository metadata and search snippets cannot be backdated to an earlier window.
    if (!observedDay || observedDay > to) {
      excludedUnobserved++;
      continue;
    }
    signalRecords++;
    let canonical = signal.kind === "news" ? signal.originalUrl || signal.url : signal.url;
    try {
      const url = new URL(canonical);
      url.hash = "";
      canonical = url.href.replace(/\/$/, "");
    } catch {
      /* Schema validation normally prevents this. */
    }
    const key = `${signal.kind}:${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    eligible[signal.kind].push(signalItem(signal, associations.get(signal.id)));
  }
  const queues: Record<AiSourceKind, AiEvidenceItem[]> = {
    paper: base.papers,
    github: sampleSignals(eligible.github, spec, limit),
    news: sampleSignals(eligible.news, spec, limit),
  };
  const items: AiEvidenceItem[] = [];
  for (let round = 0; items.length < limit; round++) {
    const active = kinds.filter((kind) => queues[kind][round]);
    if (!active.length) break;
    for (const kind of active) {
      if (items.length >= limit) break;
      items.push(queues[kind][round]);
    }
  }
  const sourceCoverage: AiSourceCoverage = {
    paper: { eligible: base.totalWorks, supplied: 0 },
    github: { eligible: eligible.github.length, supplied: 0 },
    news: { eligible: eligible.news.length, supplied: 0 },
  };
  for (const item of items) sourceCoverage[item.signal?.kind ?? "paper"].supplied++;
  const totalWorks = base.totalWorks + eligible.github.length + eligible.news.length;
  const totalRecords = base.totalRecords + signalRecords;
  return {
    ...base,
    papers: items,
    sourceCoverage,
    excludedUnobserved,
    excludedInvalid,
    excludedFuture,
    totalWorks,
    totalRecords,
    duplicatesRemoved: totalRecords - totalWorks,
    sampled: items.length < totalWorks,
    key: `ai-combined:${evidenceFingerprint(JSON.stringify({ base: base.key, sources: [...selected].sort(), items, sourceCoverage, excludedUnobserved, totalRecords }))}`,
  };
}
