import { groupWorks } from "./paper-works";
import { paperScope } from "./paper-scope";
import type { Paper } from "./types";
import type { ResearchSignal } from "./research-signals";

export type CodeReference = { id: string; title: string; url: string };
export type CodeCandidate = CodeReference & {
  tfidf: number;
  bm25: number;
  rankTfidf: number;
  rankBm25: number;
  sharedTerms: string[];
};
export type PaperCodeLink = {
  paperId: string;
  paperTitle: string;
  paperUrl: string;
  explicit: CodeReference[];
  candidates: CodeCandidate[];
};
export type PaperCodeResult = {
  version: string;
  asOf: string;
  stats: {
    papers: number;
    repositories: number;
    explicitPapers: number;
    candidatePapers: number;
    unmatchedPapers: number;
  };
  links: PaperCodeLink[];
};
export const PAPER_CODE_LINK_VERSION = "2026-11-16-lexical-v1";
// Frozen local stoplist, including generic academic words. No external models or requests.
const stops = new Set(
  (
    "a an and are as at be been being but by can could did do does for from had has have he her here his how i if in into is it its may more most no nor not of on only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up use used using very was we were what when where which while who why will with within without would you your " +
    "about above across after again against all almost alone along already also although always among amongst another any anyhow anyone anything anyway anywhere around back became because become becomes becoming before behind below beside besides between beyond both bottom call cannot co con de describe detail done down due during each either else elsewhere empty enough etc even ever every everyone everything everywhere except few find first former formerly found front full further get give go hence however inc indeed interest itself keep last latter least less ltd made make many meanwhile might mill mine moreover mostly move much must name namely neither nevertheless next nobody none nothing now nowhere often once one onto others otherwise part per perhaps please put rather re said say see seem seems serious several show side since sincere still system take ten therefore therein together top toward towards un upon via well whatever whenever wherever whether whose yet yourselves " +
    "study studies paper papers research results result method methods approach proposed propose based model models learning deep data dataset datasets image images imaging medical analysis performance evaluated evaluate evaluation experiment experiments implementation repository code official github com org www http https undefined null available new novel presents present framework significantly demonstrate demonstrates compared comparison improve improved improvement"
  ).split(/\s+/),
);
export function codeLinkTokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/g, " ")
      .replace(/10\.\d{4,9}\/\S+|\b\d{4}\.\d{4,5}(?:v\d+)?\b/g, " ")
      .replace(/<[^>]*>/g, " ")
      .match(/[a-z][a-z0-9]{1,}/g) ?? []
  ).filter((t) => (t.length >= 3 || t === "ct" || t === "mr") && !stops.has(t));
}
function valid(v: string | null | undefined, asOf: string): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const day = v.slice(0, 10);
  return day <= asOf && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
function repoKey(value: string) {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && /^(?:www\.)?github\.com$/i.test(u.hostname)
      ? (u.pathname.match(/^\/([^/]+\/[^/]+)/)?.[1] ?? "").replace(/\.git$/i, "").toLowerCase()
      : "";
  } catch {
    return "";
  }
}
function links(text: string) {
  return (text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map((s) => s.replace(/[.,;:)\]}]+$/, ""));
}
function doi(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(trimmed)) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname.slice(1)).toLowerCase();
    } catch {
      return "";
    }
  }
  return trimmed.toLowerCase();
}
function arxiv(value: string) {
  let id = value
    .trim()
    .toLowerCase()
    .replace(/^arxiv:/, "");
  if (/^https?:\/\//.test(id)) {
    try {
      const u = new URL(id);
      id = /^(?:www\.)?arxiv\.org$/.test(u.hostname) ? u.pathname.replace(/^\/(?:abs|pdf)\//, "") : "";
    } catch {
      return "";
    }
  }
  id = id.replace(/\.pdf$/, "").replace(/v\d+$/, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/.test(id) ? id : "";
}
function paperKeys(p: Paper) {
  return [
    ...[p.doi, p.relatedDoi].filter((v): v is string => !!v).map((v) => `doi:${doi(v)}`),
    ...[p.arxivId, /^arxiv:/i.test(p.id) ? p.id : ""]
      .filter(Boolean)
      .map((v) => arxiv(v!))
      .filter(Boolean)
      .map((v) => `arxiv:${v}`),
    ...links(p.originalAbstract || p.abstract)
      .map(repoKey)
      .filter(Boolean)
      .map((v) => `repo:${v}`),
  ];
}
function referenceKeys(urls: string[]) {
  return urls.flatMap((value) => {
    try {
      const u = new URL(value);
      if (!/^https?:$/.test(u.protocol)) return [];
      if (/^(?:dx\.)?doi\.org$/i.test(u.hostname)) return [`doi:${doi(value)}`];
      if (/^(?:www\.)?arxiv\.org$/i.test(u.hostname)) {
        const id = arxiv(value);
        return id ? [`arxiv:${id}`] : [];
      }
    } catch {
      /* malformed evidence is ignored */
    }
    return [];
  });
}
const frequencies = (tokens: string[]) => {
  const f = new Map<string, number>();
  for (const t of tokens) f.set(t, (f.get(t) ?? 0) + 1);
  return f;
};
type Repo = Extract<ResearchSignal, { kind: "github" }>;
const medical =
  /\b(?:medical imag\w*|mri|ct|ultrasound|radiolog\w*|histopatholog\w*|retina\w*|fundus|mammogra\w*|x.ray|brain|tumou?r|lesion)\b|医学影像|超声|病理|脑|肿瘤|病灶/iu;

/** Offline candidate retrieval. Scores are similarity measures, never probabilities or evidence gates. */
export function analyzePaperCodeLinks(input: {
  papers: Paper[];
  signals: ResearchSignal[];
  asOf: string;
}): PaperCodeResult {
  const { asOf } = input;
  if (asOf.length !== 10 || !valid(asOf, asOf)) throw new Error("Invalid association date");
  const groups = groupWorks(
    input.papers.filter(
      (p) => p.dateAnomaly !== "future" && valid(p.publishedAt, asOf) && paperScope(p) === "core",
    ),
    { titleAuthors: false },
  );
  const works = groups
    .map((g) => ({
      paper: [...g].sort((a, b) => b.abstract.length - a.abstract.length || a.id.localeCompare(b.id))[0],
      keys: [...new Set(g.flatMap(paperKeys))],
    }))
    .sort((a, b) => a.paper.id.localeCompare(b.paper.id));
  const buckets = new Map<string, Repo[]>();
  for (const s of input.signals)
    if (
      s.kind === "github" &&
      valid(s.observedAt, asOf) &&
      (!s.publishedAt || valid(s.publishedAt, asOf)) &&
      (s.relevance?.level === "direct" || (!s.relevance && medical.test(`${s.title} ${s.summary}`)))
    ) {
      const key = repoKey(s.url);
      if (!key) continue;
      const b = buckets.get(key) ?? [];
      b.push(s);
      buckets.set(key, b);
    }
  const repos = [...buckets.values()]
    .map((g) => ({
      repo: [...g].sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))[0],
      keys: [...new Set(g.flatMap((s) => [`repo:${repoKey(s.url)}`, ...referenceKeys(s.relatedUrls)]))],
    }))
    .sort((a, b) => a.repo.id.localeCompare(b.repo.id));
  const known = new Map<string, number[]>();
  repos.forEach((r, i) =>
    r.keys.forEach((k) => {
      const list = known.get(k) ?? [];
      list.push(i);
      known.set(k, list);
    }),
  );
  const docs = repos.map(({ repo: r }) =>
    codeLinkTokens(`${r.title}. ${r.summary} ${r.readmeExcerpt ?? ""}`),
  );
  const queries = works.map(({ paper: p }) =>
    codeLinkTokens(`${p.title}. ${p.originalAbstract || p.abstract}`),
  );
  const df = new Map<string, number>();
  for (const tokens of [...docs, ...queries])
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length + queries.length;
  const vocabulary = [...df]
    .filter(([, v]) => v >= 2 && v <= Math.max(2, n * 0.95))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6000)
    .map(([t]) => t);
  const vocab = new Set(vocabulary);
  const idf = new Map(vocabulary.map((t) => [t, Math.log((1 + n) / (1 + df.get(t)!)) + 1]));
  // Posting lists avoid scanning all repositories for every paper.
  const posting = new Map<string, Array<{ doc: number; tfidf: number; bm25: number }>>();
  const repoDf = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) if (vocab.has(t)) repoDf.set(t, (repoDf.get(t) ?? 0) + 1);
  const avg = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1) || 1;
  docs.forEach((tokens, i) => {
    const f = frequencies(tokens);
    let norm = 0;
    for (const [t, c] of f) if (vocab.has(t)) norm += ((1 + Math.log(c)) * idf.get(t)!) ** 2;
    norm = Math.sqrt(norm) || 1;
    for (const [t, c] of f)
      if (vocab.has(t)) {
        const list = posting.get(t) ?? [];
        list.push({
          doc: i,
          tfidf: ((1 + Math.log(c)) * idf.get(t)!) / norm,
          bm25:
            (Math.log(1 + (docs.length - (repoDf.get(t) ?? 0) + 0.5) / ((repoDf.get(t) ?? 0) + 0.5)) *
              c *
              2.2) /
            (c + 1.2 * (0.25 + (0.75 * tokens.length) / avg)),
        });
        posting.set(t, list);
      }
  });
  const sims = new Float64Array(repos.length),
    bm = new Float64Array(repos.length),
    shared = new Uint16Array(repos.length),
    tfRank = new Uint32Array(repos.length),
    bmRank = new Uint32Array(repos.length);
  const ref = (i: number): CodeReference => ({
    id: repos[i].repo.id,
    title: repos[i].repo.title,
    url: repos[i].repo.url,
  });
  const result: PaperCodeLink[] = works.map(({ paper: p, keys }, index) => {
    const explicitIds = [...new Set(keys.flatMap((k) => known.get(k) ?? []))].sort((a, b) => a - b);
    const explicitSet = new Set(explicitIds);
    const f = frequencies(queries[index]);
    const q = [...f]
      .filter(([t]) => vocab.has(t))
      .map(([t, c]) => ({ t, weight: (1 + Math.log(c)) * idf.get(t)! }))
      .sort((a, b) => b.weight - a.weight || a.t.localeCompare(b.t))
      .slice(0, 64);
    const norm = Math.sqrt(q.reduce((s, t) => s + t.weight * t.weight, 0)) || 1;
    const touched: number[] = [];
    for (const term of q)
      for (const hit of posting.get(term.t) ?? []) {
        if (!shared[hit.doc]) touched.push(hit.doc);
        shared[hit.doc]++;
        sims[hit.doc] += (term.weight / norm) * hit.tfidf;
        bm[hit.doc] += hit.bm25;
      }
    const eligible = touched.filter((i) => shared[i] >= 2 && !explicitSet.has(i) && !repos[i].repo.archived);
    // Repository indices are already sorted by ID. Reuse rank buffers to avoid
    // allocating two large Maps for each paper in a full-archive run.
    const tie = (a: number, b: number) => a - b;
    const tfOrder = [...eligible].sort((a, b) => sims[b] - sims[a] || tie(a, b));
    const bmOrder = [...eligible].sort((a, b) => bm[b] - bm[a] || tie(a, b));
    for (let j = 0; j < tfOrder.length; j++) tfRank[tfOrder[j]] = j + 1;
    for (let j = 0; j < bmOrder.length; j++) bmRank[bmOrder[j]] = j + 1;
    // RRF uses only each retriever's top 20; unsupported tail ranks contribute zero.
    const fused = (i: number) =>
      (tfRank[i] <= 20 ? 1 / (60 + tfRank[i]) : 0) + (bmRank[i] <= 20 ? 1 / (60 + bmRank[i]) : 0);
    const best = [...new Set([...tfOrder.slice(0, 20), ...bmOrder.slice(0, 20)])]
      .sort((a, b) => fused(b) - fused(a) || tie(a, b))
      .slice(0, 3);
    const candidates = best.map((i) => ({
      ...ref(i),
      tfidf: Math.min(1, sims[i]),
      bm25: bm[i],
      rankTfidf: tfRank[i],
      rankBm25: bmRank[i],
      sharedTerms: q
        .filter((t) => docs[i].includes(t.t))
        .slice(0, 8)
        .map((t) => t.t),
    }));
    for (const i of touched) {
      sims[i] = 0;
      bm[i] = 0;
      shared[i] = 0;
    }
    return {
      paperId: p.id,
      paperTitle: p.title,
      paperUrl: p.url,
      explicit: explicitIds.map(ref),
      candidates,
    };
  });
  return {
    version: PAPER_CODE_LINK_VERSION,
    asOf,
    stats: {
      papers: works.length,
      repositories: repos.length,
      explicitPapers: result.filter((r) => r.explicit.length).length,
      candidatePapers: result.filter((r) => !r.explicit.length && r.candidates.length).length,
      unmatchedPapers: result.filter((r) => !r.explicit.length && !r.candidates.length).length,
    },
    links: result,
  };
}
