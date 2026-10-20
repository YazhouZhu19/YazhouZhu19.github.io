import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { normalizeRecord } from "../lib/record";
import { monitorDataSchema } from "../lib/public-data-schema";
import {
  emptyResearchSignalsData,
  ResearchSignalsDataSchema,
  type GitHubSignal,
  type NewsSignal,
  type SignalSourceState,
} from "../lib/research-signals";
import { writeSnapshotFile, readSnapshotFile } from "../scripts/snapshot-files";
import { writePublicSnapshot, writePublicSnapshotV3 } from "../scripts/public-snapshot";
import { writeSignalsSnapshot } from "../scripts/signals-snapshot";

// Synthetic local evidence only; dates remain recent without changing browser clocks.
const now = new Date().toISOString();
const ago = (days: number) => new Date(Date.parse(now) - days * 86400000).toISOString();
const institution = "Department of Medical Image Analysis, Example University";
const descriptions = [
  [
    "Atlas interactive segmentation",
    "A deep learning method for interactive CT liver segmentation. Radiologists correct masks with clicks and evaluate the algorithm.",
  ],
  [
    "Beacon MRI reconstruction",
    "A neural network algorithm reconstructs accelerated MRI brain images from undersampled k-space.",
  ],
  [
    "Cedar diagnostic model",
    "An artificial intelligence model classifies breast lesions in ultrasound images and assesses diagnostic accuracy.",
  ],
  [
    "Delta CT segmentation",
    "A transformer algorithm segments liver tumors in CT images using a public benchmark dataset.",
  ],
  [
    "Echo interactive annotation",
    "Human-in-the-loop annotation for MRI brain segmentation uses expert feedback to refine a neural network.",
  ],
  [
    "Flora image registration",
    "A deep learning framework for deformable CT and MRI medical image registration.",
  ],
  [
    "Grove image quality",
    "An automated neural network measures quality and uncertainty in medical image segmentation.",
  ],
  [
    "Harbor lung diagnosis",
    "A machine learning method classifies lung cancer from chest CT images with a validation dataset.",
  ],
  [
    "Iris foundation model",
    "A foundation model for medical image segmentation learns from CT and MRI benchmark datasets.",
  ],
  [
    "Juniper quantitative imaging",
    "An automated algorithm measures CT liver volume with deep learning and external validation.",
  ],
  [
    "Keystone diagnostic agreement",
    "Diagnostic accuracy and interobserver agreement for radiologists interpreting lung CT images.",
  ],
  [
    "Laurel clinical trial",
    "A randomized placebo controlled cohort study measures treatment dose and serial lung CT images.",
  ],
] as const;
const papers = descriptions.map(([title, abstract], i) =>
  normalizeRecord(
    {
      id: `fixture:paper-${i + 1}`,
      title,
      abstract,
      originalAbstract: abstract,
      authors: [
        { name: "Alex Example", affiliations: [institution] },
        { name: `Researcher ${i + 1}`, affiliations: [institution] },
      ],
      doi: null,
      source: i % 2 ? "arXiv" : "Europe PMC",
      status: i % 2 ? "preprint" : "published",
      publishedAt: ago(i + 1).slice(0, 10),
      firstSeenAt: ago(i + 1),
      venue: "Synthetic fixture journal",
      url: `https://example.org/fixture/paper-${i + 1}`,
      provenance: [{ queryUrl: "https://example.org/fixture/query", collectedAt: now }],
    },
    now,
  ),
);
const data = monitorDataSchema.parse({
  totalStored: papers.length,
  papers,
  collectedAt: now,
  lastSuccessfulSync: now,
  status: "ok",
  coverage: "Synthetic local test fixture; not research evidence or a performance dataset.",
  queryRuns: [],
  runs: ["arXiv", "Europe PMC"].map((source) => ({
    id: `fixture:${source}`,
    source,
    startedAt: now,
    completedAt: now,
    status: "ok",
    received: 6,
    kept: 6,
    added: 6,
    updated: 0,
    total: 6,
    query: "synthetic fixture",
    dateFrom: ago(30).slice(0, 10),
    dateTo: now.slice(0, 10),
    coverage: "Synthetic local fixture",
  })),
});
const repos: GitHubSignal[] = ["atlas-segmentation", "beacon-reconstruction", "iris-medical-model"].map(
  (name, i) => ({
    id: `github:fixture-lab/${name}`,
    kind: "github",
    title: name,
    fullName: `fixture-lab/${name}`,
    url: `https://github.com/fixture-lab/${name}`,
    summary: "Open source deep learning medical image segmentation for CT and MRI.",
    summaryKind: "repository-description",
    publisher: "fixture-lab",
    publishedAt: ago(i + 2),
    firstSeenAt: ago(i + 1),
    observedAt: now,
    updatedAt: now,
    topics: ["medical-imaging", "segmentation"],
    sourceId: "github-public",
    relatedUrls: [],
    stars: 120 + i * 40,
    forks: 12,
    openIssues: 3,
    license: "Apache-2.0",
    language: "Python",
    archived: false,
    pushedAt: ago(1),
    releasedAt: ago(2),
    releaseUrl: null,
    readmeExcerpt: "Synthetic fixture for medical image segmentation.",
    relevance: { level: "direct", reasons: ["medical-imaging"] },
    discoveryGroups: ["segmentation"],
  }),
);
const news: NewsSignal[] = ["Atlas imaging benchmark", "Beacon MRI model", "Iris medical dataset"].map(
  (title, i) => ({
    id: `news:fixture-${i + 1}`,
    kind: "news",
    title,
    url: `https://example.org/fixture/news-${i + 1}`,
    summary: "A medical image segmentation model for CT and MRI with open benchmark evaluation.",
    summaryKind: "publisher-excerpt",
    publisher: "Example Research Lab",
    publishedAt: ago(i + 1),
    firstSeenAt: ago(i + 1),
    observedAt: now,
    updatedAt: null,
    topics: ["medical-imaging", "segmentation"],
    sourceId: "news-example",
    relatedUrls: [],
    newsType: "model",
    discoveryUrl: null,
    originalUrl: `https://example.org/fixture/news-${i + 1}`,
    relevance: { level: "direct", reasons: ["medical-imaging"] },
  }),
);
const sources: SignalSourceState[] = (["github", "news"] as const).map((kind) => ({
  id: kind === "github" ? "github-public" : "news-example",
  kind,
  name: kind === "github" ? "GitHub fixture" : "News fixture",
  url: "https://example.org/fixture",
  status: "ok",
  checkedAt: now,
  lastSuccessAt: now,
  received: 3,
  retained: 3,
  error: null,
  coverage: "Synthetic local fixture",
}));
const signals = ResearchSignalsDataSchema.parse({
  ...emptyResearchSignalsData(now),
  records: [...repos, ...news],
  sources,
});
const target = resolve(".e2e-dist/data");
await mkdir(target, { recursive: true });
await writeSnapshotFile(join(target, "papers.json"), data);
await writePublicSnapshot(join(target, "public-papers-v2.json"), data);
await writePublicSnapshotV3(join(target, "public-papers-v3.json"), data);
await mkdir(join(target, "signals-v2"), { recursive: true });
await writeSignalsSnapshot(join(target, "signals-v2/manifest.json"), signals);
await writeFile(join(target, "research-signals.json"), JSON.stringify(signals));
for (const file of ["papers.json", "public-papers-v2.json", "public-papers-v3.json"])
  assert.equal((await readSnapshotFile(join(target, file))).papers.length, descriptions.length);
await writeFile(
  resolve(".e2e-dist/fixture-info.json"),
  JSON.stringify({ synthetic: true, papers: papers.length, signals: signals.records.length }),
);
console.log(
  `Local fixture: ${papers.length} papers, ${signals.records.length} signals; v1/v2/v3 + signals v2.`,
);
