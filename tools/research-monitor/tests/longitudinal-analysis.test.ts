import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLongitudinalHistory, historyDate, historyLogicCues } from "../lib/longitudinal-analysis";
import type { Paper } from "../lib/types";

const asOf = "2026-11-17";
const completeAbstract =
  "Spinal cord segmentation is challenging across scanners. We propose a convolutional neural network pipeline. We evaluated this method against a reference segmentation. The method achieved a Dice coefficient of 0.92.";
const archivePaper = (id: string, patch: Partial<Paper> = {}): Paper => ({
  id,
  title: "Retinal vessel topology tracing",
  abstract: "Retinal vessel tracing and connectivity reconstruction.",
  authors: [],
  affiliations: [],
  doi: `10.1000/${id}`,
  source: "Europe PMC",
  sources: ["Europe PMC"],
  status: "published",
  publishedAt: "2026-01-01",
  updatedAt: null,
  firstSeenAt: "2026-01-01",
  venue: null,
  url: `https://doi.org/10.1000/${id}`,
  tasks: [],
  modalities: [],
  organs: [],
  methods: [],
  humanSignals: [],
  evidence: [],
  tracks: [],
  scope: "core",
  reviewStatus: "unreviewed",
  provenance: [],
  ...patch,
});
const archive = () => Array.from({ length: 20 }, (_, i) => archivePaper(`base-${i}`));

// Deliberately synthetic provenance records test mechanics, never production findings.
const fixture = () => ({
  candidate: { id: "spinal-cord-mri", title: "Test spinal cord MRI" },
  sources: [{ id: "primary", url: "https://example.org/primary", retrievedAt: asOf }],
  papers: ["2018-01-01", "2021-01-01", "2024-01-01"].map((publishedAt, i) => ({
    id: `work-${i}`,
    doi: `10.1000/work-${i}`,
    title: `Spinal cord segmentation study ${i}`,
    publishedAt,
    url: `https://doi.org/10.1000/work-${i}`,
    rawAbstract: completeAbstract,
    sourceIds: ["primary"],
    explicitResourceLinks: [] as {
      url: string;
      sourceIds: string[];
      urlLiteralInFullText?: boolean;
      urlLiteralInAbstract?: boolean;
    }[],
  })),
  datasets: [
    {
      id: "spinal-data",
      title: "Test spinal cord images",
      url: "https://github.com/lab/spinal-data",
      versions: [
        {
          version: "v1",
          releasedAt: "2020-01-01",
          url: "https://github.com/lab/spinal-data/releases/tag/v1",
          sourceIds: ["primary"],
          participantCountObserved: 20,
          changeType: "initial-release",
          changeDescription: "Initial images.",
        },
        {
          version: "v2",
          releasedAt: "2022-01-01",
          url: "https://github.com/lab/spinal-data/releases/tag/v2",
          sourceIds: ["primary"],
          participantCountObserved: 25,
          changeType: "cohort-growth",
          changeDescription: "Add five participants and their images.",
        },
      ],
      growthEvidence: {
        fromVersion: "v1",
        toVersion: "v2",
        participantRowsBefore: 20,
        participantRowsAfter: 25,
        addedImagingFilePaths: 15,
        sourceIds: ["primary"],
      },
      paperLinks: [{ doi: "10.1000/work-0", sourceIds: ["primary"] }],
    },
  ],
  code: [
    {
      repository: "lab/spinal-code",
      url: "https://github.com/lab/spinal-code",
      archived: false,
      createdAt: "2000-01-01",
      sourceIds: ["primary"],
      releases: ["2020-01-01", "2023-01-01", "2026-10-01"].map((publishedAt, i) => ({
        version: `v${i + 1}`,
        publishedAt,
        url: `https://github.com/lab/spinal-code/releases/tag/v${i + 1}`,
        sourceIds: ["primary"],
      })),
      commits: [] as { sha: string; date: string; url: string; sourceIds: string[] }[],
      officialPaperLinks: [{ doi: "10.1000/work-0", sourceIds: ["primary"] }],
    },
  ],
});
const run = (pack = fixture(), papers = archive()) =>
  analyzeLongitudinalHistory({ packs: [pack], papers, asOf });
const direction = (pack = fixture(), papers = archive()) => run(pack, papers).directions[0];
const passed = (pack: ReturnType<typeof fixture>, id: string) =>
  direction(pack).checks.find((check) => check.id === id)?.passed;

test("a closed source-backed longitudinal chain passes all six explicit gates", () => {
  const result = run();
  assert.equal(result.basePaperCount, 20);
  assert.equal(result.enrichedPaperCount, 3);
  assert.equal(result.directions[0].evidenceStatus, "sufficient");
  assert.deepEqual(
    result.directions[0].checks.map((c) => [c.id, c.passed]),
    [
      ["niche", true],
      ["papers", true],
      ["logic", true],
      ["data", true],
      ["code", true],
      ["chain", true],
    ],
  );
  assert.deepEqual(result.directions[0].gaps, []);
});

test("history dates require a real exact day and reject future or malformed observations", () => {
  for (const value of [
    "2020",
    "2020-01",
    "r20200101",
    "2020-02-30",
    "2021-02-29",
    "2026-11-18",
    "2026-11-18T01:00:00+08:00",
    "2020-01-01T25:00:00Z",
    "yesterday",
    null,
  ]) {
    assert.equal(historyDate(value, asOf), null, String(value));
  }
  assert.equal(historyDate("2020-02-29", asOf), "2020-02-29");
  assert.equal(historyDate(`${asOf}T23:59:59Z`, asOf), asOf);
  assert.throws(() => analyzeLongitudinalHistory({ packs: [], papers: [], asOf: "2026" }), /asOf/);
});

test("logic cues require a quantitative result, not a DOI, year, promise, or absent evaluation", () => {
  assert.equal(historyLogicCues(completeAbstract).logicComplete, true);
  for (const abstract of [
    "Spinal cord segmentation is challenging. Our convolutional network was evaluated. Accuracy is described at https://doi.org/10.1000/1234 in 2020.",
    "Spinal cord segmentation is challenging. Our convolutional network was evaluated. We will achieve a Dice coefficient of 0.92.",
    "Spinal cord segmentation is challenging. We plan to evaluate this neural network and achieve a Dice coefficient of 0.92.",
    "Spinal cord segmentation is challenging. Our convolutional network has not yet been evaluated. No quantitative results are available; the anticipated Dice coefficient is unknown.",
    "Spinal cord segmentation is challenging. Our neural network has not yet been evaluated. We anticipate a Dice coefficient of 0.95.",
  ])
    assert.equal(historyLogicCues(abstract).logicComplete, false, abstract);
  const pack = fixture();
  pack.papers.slice(1).forEach((p) => {
    p.rawAbstract = "Spinal cord segmentation with a neural network.";
  });
  assert.equal(passed(pack, "logic"), false);
  assert.equal(direction(pack).evidenceStatus, "pending");
});

test("publication count, publication years and elapsed span are independent requirements", () => {
  const shortSpan = fixture();
  ["2024-12-31", "2025-01-01", "2026-01-01"].forEach((date, i) => {
    shortSpan.papers[i].publishedAt = date;
  });
  assert.equal(passed(shortSpan, "papers"), false);
  const twoYears = fixture();
  twoYears.papers[1].publishedAt = "2018-12-01";
  assert.equal(passed(twoYears, "papers"), false);
  for (const invalidDate of ["2027-01-01", "2021", "2021-02-30"]) {
    const pack = fixture();
    pack.papers[1].publishedAt = invalidDate;
    assert.equal(direction(pack).papers.length, 2);
    assert.equal(passed(pack, "papers"), false);
  }
});

test("inclusive day-span and maintenance freshness boundaries are explicit", () => {
  const papers = fixture();
  ["2024-11-17", "2025-06-01", "2026-11-17"].forEach((date, i) => {
    papers.papers[i].publishedAt = date;
  });
  assert.equal(passed(papers, "papers"), true);
  papers.papers[0].publishedAt = "2024-11-18";
  assert.equal(passed(papers, "papers"), false);

  const data = fixture();
  data.datasets[0].versions[1].releasedAt = "2020-12-31";
  assert.equal(passed(data, "data"), true);
  data.datasets[0].versions[1].releasedAt = "2020-12-30";
  assert.equal(passed(data, "data"), false);

  const code = fixture();
  ["2024-11-17", "2025-06-01", "2026-11-17"].forEach((date, i) => {
    code.code[0].releases[i].publishedAt = date;
  });
  assert.equal(passed(code, "code"), true);
  code.code[0].releases[0].publishedAt = "2024-11-18";
  assert.equal(passed(code, "code"), false);
  const recent = fixture();
  recent.code[0].releases[2].publishedAt = "2025-11-17";
  assert.equal(passed(recent, "code"), true);
  recent.code[0].releases[2].publishedAt = "2025-11-16";
  assert.equal(passed(recent, "code"), false);
});

test("DOI and preprint aliases count one underlying work across dates", () => {
  const pack = fixture();
  Object.assign(pack.papers[0], { arxivId: "https://arxiv.org/abs/1801.12345v2" });
  Object.assign(pack.papers[1], { doi: "10.48550/arXiv.1801.12345", arxivId: "arXiv:1801.12345v1" });
  const result = direction(pack);
  assert.equal(result.papers.length, 2);
  assert.equal(result.checks.find((c) => c.id === "papers")?.passed, false);
  assert.equal(result.evidenceStatus, "pending");
});

test("unidentified or unsourced papers cannot inflate independent works", () => {
  const noIdentity = fixture();
  noIdentity.papers.forEach((p) => {
    p.id = "";
    p.doi = "";
  });
  assert.equal(direction(noIdentity).papers.length, 0);
  const noSource = fixture();
  noSource.papers[0].sourceIds = [];
  assert.equal(direction(noSource).papers.length, 2);
});

test("source references must resolve uniquely to valid nonfuture HTTP sources", () => {
  const missing = fixture();
  missing.datasets[0].growthEvidence.sourceIds = ["missing"];
  assert.throws(() => run(missing), /Unknown source ID/);
  const duplicates = fixture();
  duplicates.sources.push({ ...duplicates.sources[0] });
  assert.throws(() => run(duplicates), /Duplicate source ID/);
  for (const patch of [{ url: "file:///private/evidence" }, { retrievedAt: "2026-11-18" }]) {
    const invalid = fixture();
    Object.assign(invalid.sources[0], patch);
    assert.throws(() => run(invalid), /Invalid history source/);
  }
});

test("dataset labels, metadata edits and participant counters alone do not establish content growth", () => {
  for (const patch of [
    { sourceIds: [] },
    { fromVersion: "other-v1" },
    { toVersion: "other-v2" },
    { participantRowsBefore: 19 },
    { participantRowsAfter: 26 },
    { addedImagingFilePaths: 0 },
  ]) {
    const pack = fixture();
    Object.assign(pack.datasets[0].growthEvidence, patch);
    assert.equal(passed(pack, "data"), false, JSON.stringify(patch));
  }
  const metadata = fixture();
  Object.assign(metadata.datasets[0], { growthEvidence: undefined });
  Object.assign(metadata.datasets[0].versions[1], {
    changeType: "metadata-correction",
    changedDataFilesCount: 50,
    comparedWithVersion: "v1",
  });
  assert.equal(passed(metadata, "data"), false);
  const versionLabels = fixture();
  versionLabels.datasets[0].versions.forEach((v, i) => {
    v.version = `r${2020 + i * 2}0101`;
    v.releasedAt = "";
  });
  assert.equal(passed(versionLabels, "data"), false);
  assert.deepEqual(
    direction(versionLabels).datasets[0].versions.map((v) => v.date),
    [null, null],
  );
});

test("paired annotation changes can qualify without falsely requiring new participants", () => {
  const pack = fixture();
  pack.datasets[0].versions[1].participantCountObserved = 20;
  Object.assign(pack.datasets[0], { growthEvidence: undefined });
  Object.assign(pack.datasets[0].versions[1], {
    changeType: "annotation-growth",
    changedDataFilesCount: 10,
    comparedWithVersion: "v1",
  });
  assert.equal(passed(pack, "data"), true);
  Object.assign(pack.datasets[0].versions[1], { comparedWithVersion: "unknown" });
  assert.equal(passed(pack, "data"), false);
});

test("dataset history cannot borrow a version from a different repository family", () => {
  const pack = fixture();
  pack.datasets[0].versions[1].url = "https://github.com/unrelated/brain-data/releases/tag/v2";
  assert.equal(passed(pack, "data"), false);
  assert.equal(direction(pack).evidenceStatus, "pending");
});

test("DOI-hosted versions require the same declared concept DOI", () => {
  const pack = fixture();
  pack.datasets[0].url = "https://zenodo.org/records/100";
  Object.assign(pack.datasets[0], { doi: "10.5281/zenodo.100" });
  pack.datasets[0].versions.forEach((version, i) => {
    version.url = `https://zenodo.org/records/${101 + i}`;
    Object.assign(version, { conceptDoi: "https://doi.org/10.5281/zenodo.100" });
  });
  assert.equal(passed(pack, "data"), true);
  Object.assign(pack.datasets[0].versions[1], { conceptDoi: "10.5281/zenodo.999" });
  assert.equal(passed(pack, "data"), false);
  Object.assign(pack.datasets[0].versions[1], { conceptDoi: undefined });
  assert.equal(passed(pack, "data"), false);
});

test("each resource must link explicitly and the qualifying data and code must share a selected work", () => {
  const disjoint = fixture();
  disjoint.code[0].officialPaperLinks[0].doi = "10.1000/work-1";
  assert.equal(passed(disjoint, "data"), true);
  assert.equal(passed(disjoint, "code"), true);
  assert.equal(passed(disjoint, "chain"), false);
  const externalPaper = fixture();
  externalPaper.code[0].officialPaperLinks[0].doi = "10.1000/not-selected";
  assert.equal(passed(externalPaper, "code"), false);
  const similarityOnly = fixture();
  similarityOnly.code[0].officialPaperLinks = [];
  similarityOnly.papers[0].explicitResourceLinks.push({
    url: similarityOnly.code[0].url,
    sourceIds: ["primary"],
  });
  assert.equal(passed(similarityOnly, "code"), false);
});

test("literal URLs match exact canonical repository identity and keep source provenance", () => {
  const pack = fixture();
  pack.datasets[0].paperLinks = [];
  pack.code[0].officialPaperLinks = [];
  pack.papers[0].explicitResourceLinks.push(
    { url: "https://github.com/LAB/SPINAL-DATA/tree/v2", sourceIds: ["primary"], urlLiteralInFullText: true },
    {
      url: "https://github.com/LAB/SPINAL-CODE.git/tree/v2",
      sourceIds: ["primary"],
      urlLiteralInAbstract: true,
    },
  );
  assert.equal(passed(pack, "chain"), true);
  pack.papers[0].explicitResourceLinks[1].url = "https://github.com/lab/spinal-code-other";
  assert.equal(passed(pack, "code"), false);
  pack.papers[0].explicitResourceLinks[1].url = "https://github.com.evil.example/lab/spinal-code";
  assert.equal(passed(pack, "code"), false);
});

test("code requires real multiyear events, recent activity and a nonarchived repository", () => {
  for (const mutate of [
    (pack: ReturnType<typeof fixture>) => {
      pack.code[0].releases = pack.code[0].releases.slice(1);
    },
    (pack: ReturnType<typeof fixture>) => {
      pack.code[0].releases[2].publishedAt = "2025-01-01";
    },
    (pack: ReturnType<typeof fixture>) => {
      pack.code[0].archived = true;
    },
    (pack: ReturnType<typeof fixture>) => {
      Object.assign(pack.code[0], { archived: undefined });
    },
    (pack: ReturnType<typeof fixture>) => {
      pack.code[0].releases[2].publishedAt = "2026-11-18";
    },
    (pack: ReturnType<typeof fixture>) => {
      pack.code[0].releases[0].url = "https://github.com/other/repo/releases/tag/v1";
    },
    (pack: ReturnType<typeof fixture>) => {
      pack.code[0].releases[0].publishedAt = "2020";
    },
  ]) {
    const pack = fixture();
    mutate(pack);
    assert.equal(passed(pack, "code"), false);
  }
  const commits = fixture();
  commits.code[0].commits = commits.code[0].releases.map((release, i) => ({
    sha: `sha${i}`,
    date: release.publishedAt,
    url: `https://github.com/lab/spinal-code/commit/sha${i}`,
    sourceIds: ["primary"],
  }));
  commits.code[0].releases = [];
  assert.equal(passed(commits, "code"), true);
  commits.code[0].commits[0].sha = commits.code[0].commits[1].sha;
  assert.equal(passed(commits, "code"), false);
});

test("local niche share uses deduplicated eligible archive works and excludes supplementation", () => {
  const spinal = archivePaper("spinal", { title: "Spinal cord MRI segmentation" });
  const atThreshold = direction(fixture(), [spinal, ...archive().slice(0, 9)]);
  assert.equal(atThreshold.archiveShare, 0.1);
  assert.equal(atThreshold.checks.find((c) => c.id === "niche")?.passed, false);
  const papers = [
    spinal,
    ...archive(),
    { ...spinal, id: "duplicate-spinal" },
    archivePaper("future", { title: "Spinal cord MRI", publishedAt: "2027-01-01" }),
    archivePaper("invalid", { title: "Spinal cord MRI", publishedAt: "2020" }),
    archivePaper("adjacent", { title: "Spinal cord MRI", scope: "adjacent" }),
  ];
  const result = run(fixture(), papers);
  assert.equal(result.basePaperCount, 21);
  assert.equal(result.directions[0].archiveCount, 1);
  assert.equal(result.directions[0].archiveShare, 1 / 21);
  assert.equal(direction(fixture(), []).checks.find((c) => c.id === "niche")?.passed, false);
});

test("duplicate source records and reordered inputs do not change longitudinal counts or decisions", () => {
  const baseline = fixture();
  const duplicated = fixture();
  duplicated.papers.push({
    ...duplicated.papers[0],
    id: "another-record",
    doi: "https://doi.org/10.1000/work-0",
  });
  duplicated.datasets[0].versions.push({ ...duplicated.datasets[0].versions[0] });
  duplicated.code[0].releases.push({ ...duplicated.code[0].releases[0] });
  duplicated.papers.reverse();
  duplicated.datasets[0].versions.reverse();
  duplicated.code[0].releases.reverse();
  const a = direction(baseline),
    b = direction(duplicated);
  assert.equal(b.papers.length, a.papers.length);
  assert.equal(b.datasets[0].versions.length, a.datasets[0].versions.length);
  assert.equal(b.repositories[0].events.length, a.repositories[0].events.length);
  assert.deepEqual(b.checks, a.checks);
  assert.equal(b.evidenceStatus, a.evidenceStatus);
});
