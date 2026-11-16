import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readSnapshotFile } from "../snapshot-files";
import { analyzeResearch, ANALYSIS_TAXONOMY as T } from "../../lib/integrated-analysis";
import { groupWorks } from "../../lib/paper-works";
import { paperScope } from "../../lib/paper-scope";
import { parseResearchSignalsData } from "../../lib/research-signals";
import type { Paper } from "../../lib/types";

// A separate audit implementation, reconciled against the production output below.
const protocol = JSON.parse(await readFile("eval/analysis-benchmark/protocol.json", "utf8"));
const asOf: string = protocol.asOf;
const snapshot = await readSnapshotFile("data/papers.json");
const source = parseResearchSignalsData(JSON.parse(await readFile("data/research-signals.json", "utf8")));
const rawPapers = snapshot.papers as Paper[];
const valid = (v: string | null | undefined): v is string =>
  Boolean(
    v &&
      /^\d{4}-\d{2}-\d{2}/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(`${v.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === v.slice(0, 10) &&
      v.slice(0, 10) <= asOf,
  );
const urlKey = (v: string) => {
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid)$/.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return "";
  }
};
const repoKey = (v: string) =>
  urlKey(v)
    .match(/^github\.com\/([^/]+\/[^/?#]+)/i)?.[1]
    .replace(/\.git$/i, "")
    .toLowerCase() ?? "";
const links = (v: string) =>
  v.match(/https?:\/\/[^\s<>"']+/g)?.map((s) => s.replace(/[.,;:)\]}]+$/, "")) ?? [];
const parts = (v: string) =>
  v
    .replace(/<[^>]*>/g, " ")
    .split(/(?<=[.!?。！？])\s+(?=[A-Z\p{Script=Han}])|(?<=[。！？])\s*/u)
    .filter(Boolean);
const keys = (urls: string[]) =>
  urls.flatMap((u) => {
    const k = urlKey(u);
    if (/^(?:dx\.)?doi.org\//i.test(k)) return [`doi:${k.replace(/^(?:dx\.)?doi.org\//i, "").toLowerCase()}`];
    if (/^arxiv.org\/abs\//i.test(k))
      return [`arxiv:${k.replace(/^arxiv.org\/abs\//i, "").replace(/v\d+$/, "")}`];
    return [];
  });
const papers = groupWorks(
  rawPapers.filter((p) => p.dateAnomaly !== "future" && valid(p.publishedAt) && paperScope(p) === "core"),
  { titleAuthors: false },
)
  .map((g) => [...g].sort((a, b) => b.abstract.length - a.abstract.length || a.id.localeCompare(b.id))[0])
  .sort((a, b) => a.id.localeCompare(b.id));
const medical =
  /\b(?:medical imag\w*|mri|ct|ultrasound|radiolog\w*|histopatholog\w*|retina\w*|fundus|mammogra\w*|x.ray|brain|tumou?r|lesion)\b|医学影像|超声|病理|脑|肿瘤|病灶/iu;
const eligible = source.records
  .filter(
    (s) =>
      valid(s.observedAt) &&
      (!s.publishedAt || valid(s.publishedAt)) &&
      (s.relevance?.level === "direct" || (!s.relevance && medical.test(`${s.title} ${s.summary}`))),
  )
  .sort((a, b) => a.id.localeCompare(b.id));
const parent = eligible.map((_, i) => i);
const root = (i: number): number => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
};
const seen = new Map<string, number>();
eligible.forEach((s, i) => {
  for (const u of [s.url, s.kind === "news" ? s.originalUrl : null]) {
    const k = u && (s.kind === "github" ? repoKey(u) : urlKey(u));
    if (!k) continue;
    const key = `${s.kind}:${k}`;
    const prev = seen.get(key);
    if (prev !== undefined) parent[root(i)] = root(prev);
    seen.set(key, i);
  }
});
const signals = eligible.filter((_, i) => root(i) === i);
const corpus = [
  ...papers.map((p) => ({
    id: p.id,
    kind: "paper",
    title: p.title,
    url: p.url,
    text: `${p.title}. ${p.originalAbstract || p.abstract}`,
    date: p.publishedAt,
    keys: [
      ...([p.doi, p.relatedDoi].filter(Boolean) as string[]).map(
        (v) => `doi:${v.replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "").toLowerCase()}`,
      ),
      ...(p.arxivId ? [`arxiv:${p.arxivId.replace(/v\d+$/, "")}`] : []),
      ...links(p.originalAbstract || p.abstract)
        .map(repoKey)
        .filter(Boolean)
        .map((v) => `repo:${v}`),
    ],
  })),
  ...signals.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    url: s.url,
    text: `${s.title}. ${s.summary} ${s.kind === "github" ? s.readmeExcerpt : ""}`,
    date: s.kind === "github" ? s.pushedAt : s.publishedAt,
    keys: [
      ...keys(s.relatedUrls),
      ...(s.kind === "github"
        ? [`repo:${repoKey(s.url)}`]
        : s.relatedUrls
            .map(repoKey)
            .filter(Boolean)
            .map((v) => `repo:${v}`)),
    ],
  })),
];
const start = performance.now();
const baseline = analyzeResearch({ papers: rawPapers, signals: source.records, asOf });
const elapsedMs = performance.now() - start;
const counts = Object.fromEntries(
  ["paper", "github", "news"].map((k) => [
    k,
    corpus.filter((r) => r.kind === k && valid(r.date) && r.date.slice(0, 10) >= baseline.windowStart).length,
  ]),
);
assert.deepEqual(counts, baseline.totals);
assert.equal(papers.length, baseline.historyTotal);
const codeByKey = new Map<string, string[]>();
for (const s of signals)
  if (
    s.kind === "github" &&
    !s.archived &&
    valid(s.publishedAt) &&
    Date.parse(asOf) - Date.parse(s.publishedAt) >= 730 * 86400000 &&
    valid(s.pushedAt) &&
    Date.parse(asOf) - Date.parse(s.pushedAt) <= 365 * 86400000
  )
    for (const key of [`repo:${repoKey(s.url)}`, ...keys(s.relatedUrls)]) {
      const a = codeByKey.get(key) ?? [];
      a.push(s.id);
      codeByKey.set(key, a);
    }
const knownData =
  /^(?:zenodo\.org|figshare\.com|openneuro\.org|physionet\.org|kaggle\.com|grand-challenge\.org)\//i;
const features = papers.map((p, i) => {
  const body = p.originalAbstract || p.abstract;
  const text = corpus[i].text;
  const affirmative = parts(body)
    .filter(
      (s) =>
        !/\b(?:not|no|never|without|cannot|lack|will|plan|aims?)\b|未进行|未验证|没有|计划|旨在/iu.test(s),
    )
    .join(" ");
  const logic =
    T.problems.some((r) => r.pattern.test(body)) &&
    T.methods.some((r) => r.pattern.test(affirmative)) &&
    /\b(?:evaluat\w*|experiment\w*|validation|benchmark\w*)\b|实验|验证|评估/iu.test(affirmative) &&
    /\b(?:results|achiev\w*|dice|auc|accuracy)\b|结果|准确率/iu.test(affirmative);
  const sentence = parts(body).find(
    (s) =>
      !/\b(?:not|no|unavailable|will|plan|future)\b|不公开|未开放|将开放/iu.test(s) &&
      (links(s).some((u) => knownData.test(urlKey(u))) ||
        (/\b(?:data|dataset)\w*\b.{0,100}\b(?:available|released|accessible)\b/iu.test(s) &&
          links(s).length > 0)),
  );
  const all = sentence ? links(sentence) : [];
  const known = all.filter((u) => knownData.test(urlKey(u)));
  const data = (known.length ? known : all.length === 1 ? all : []).map(urlKey);
  return {
    id: p.id,
    date: p.publishedAt.slice(0, 10),
    logic,
    data,
    hasDataSentence: !!sentence,
    code: [...new Set(corpus[i].keys.flatMap((k) => codeByKey.get(k) ?? []))],
    niches: T.directions
      .filter((d) => d.pattern.test(text))
      .flatMap((d) =>
        T.problems
          .filter((r) => r.pattern.test(text))
          .flatMap((r) =>
            T.scenarios.filter((s) => s.pattern.test(text)).map((s) => `${d.id}:${r.id}:${s.id}`),
          ),
      ),
  };
});
for (const n of baseline.niches) {
  const f = features.filter((p) => p.niches.includes(n.id));
  assert.equal(f.length, n.count);
  assert.equal(f.filter((p) => p.logic).length, n.logicPapers);
  const ds = new Map<string, string[]>();
  for (const p of f)
    for (const d of p.data) {
      const a = ds.get(d) ?? [];
      a.push(p.date);
      ds.set(d, a);
    }
  const span = Math.max(
    0,
    ...[...ds.values()].map((d) => (Date.parse(d.sort().at(-1)!) - Date.parse(d[0])) / 86400000),
  );
  assert.equal(span, n.dataSpanDays);
  assert.equal(
    f.some((p) => p.code.length),
    !!n.code.length,
  );
}
const maskIdentifiers = (s: string) =>
  s
    .replace(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/g, " ")
    .replace(/10\.\d{4,9}\/\S+|\b\d{4}\.\d{4,5}(?:v\d+)?\b/g, " ")
    .replace(/<[^>]*>/g, " ");
const rows = corpus.map((r) => ({
  ...r,
  inWindow: valid(r.date) && r.date.slice(0, 10) >= baseline.windowStart,
  rule: T.directions.map((d) => Number(d.pattern.test(r.text))),
  maskedRule: T.directions.map((d) => Number(d.pattern.test(maskIdentifiers(r.text)))),
  facets: Object.fromEntries(
    ["problems", "methods", "scenarios"].map((k) => [
      k,
      T[k as "problems"].filter((d) => d.pattern.test(r.text)).map((d) => d.id),
    ]),
  ),
}));
for (const d of baseline.directions)
  for (const kind of ["paper", "github", "news"] as const)
    assert.equal(
      rows.filter(
        (r) => r.inWindow && r.kind === kind && r.rule[T.directions.findIndex((x) => x.id === d.id)],
      ).length,
      d.counts[kind],
    );
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const digest = hash(JSON.stringify(rows));
const metadata = {
  asOf,
  windowStart: baseline.windowStart,
  collectedAt: snapshot.collectedAt,
  signalsGeneratedAt: source.generatedAt,
  inputPapers: rawPapers.length,
  inputSignals: source.records.length,
  corpusSha256: digest,
  protocolSha256: hash(JSON.stringify(protocol)),
  engineSha256: hash(await readFile("lib/integrated-analysis.ts", "utf8")),
  summaryKinds: Object.fromEntries(
    [...new Set(source.records.map((s) => s.summaryKind))].map((k) => [
      k,
      source.records.filter((s) => s.summaryKind === k).length,
    ]),
  ),
  sourceStates: source.sources,
  productionElapsedMs: elapsedMs,
};
const output = process.argv[2] ?? "/private/tmp/oevryn-analysis-corpus.json";
await writeFile(
  output,
  JSON.stringify({
    metadata,
    rows,
    features,
    baseline,
    ruleNames: T.directions.map((d) => ({ id: d.id, label: d.label.zh })),
  }),
);
await writeFile(
  "eval/analysis-benchmark/manifest.json",
  JSON.stringify(
    {
      ...metadata,
      totals: baseline.totals,
      historyTotal: baseline.historyTotal,
      excluded: baseline.excluded,
      duplicates: baseline.duplicates,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output,
    rows: rows.length,
    papers: papers.length,
    counts,
    niches: baseline.niches.length,
    corpusSha256: digest,
  }),
);
