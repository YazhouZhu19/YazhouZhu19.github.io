import test from "node:test";
import assert from "node:assert/strict";
import { buildForesight } from "../lib/foresight";
import type { Paper, Team } from "../lib/types";

const now = new Date("2026-10-14T04:00:00Z");
const DAY = 86400000;
function day(from: string, offset: number): string {
  return new Date(Date.parse(from) + offset * DAY).toISOString().slice(0, 10);
}
function paper(id: string, patch: Partial<Paper> = {}): Paper {
  return {
    id,
    title: "Medical imaging research",
    abstract: "We studied medical images.",
    authors: [],
    affiliations: [],
    doi: null,
    source: "Europe PMC",
    sources: ["Europe PMC"],
    status: "published",
    publishedAt: "2026-10-01",
    updatedAt: null,
    firstSeenAt: "2026-10-14T01:00:00Z",
    venue: null,
    url: `https://example.org/${id}`,
    tasks: [],
    modalities: [],
    organs: [],
    methods: [],
    humanSignals: [],
    evidence: [],
    tracks: [],
    reviewStatus: "unreviewed",
    provenance: [],
    ...patch,
  };
}
function trio(patch: Partial<Paper> = {}): Paper[] {
  return ["a", "b", "c"].map((id) => paper(id, patch));
}
const foundation = {
  title: "Foundation model for MRI segmentation",
  tracks: ["segmentation", "foundation"],
  modalities: ["MRI"],
  methods: ["基础模型"],
};

test("uses adjacent 90 publication days in Beijing and never discovery dates", () => {
  const rows = [
    paper("today", { publishedAt: "2026-10-14", firstSeenAt: "2020-01-01" }),
    paper("current-start", { publishedAt: "2026-07-17" }),
    paper("previous-end", { publishedAt: "2026-07-16" }),
    paper("previous-start", { publishedAt: "2026-04-18" }),
    paper("too-old", { publishedAt: "2026-04-17" }),
  ];
  const result = buildForesight(rows, { now });
  assert.deepEqual(
    [result.asOf, result.from, result.previousFrom, result.previousTo],
    ["2026-10-14", "2026-07-17", "2026-04-18", "2026-07-16"],
  );
  assert.deepEqual(
    result.current.map((row) => row.id),
    ["today", "current-start"],
  );
  assert.deepEqual(
    result.previous.map((row) => row.id),
    ["previous-end", "previous-start"],
  );
  const changed = buildForesight(
    rows.map((row) => ({ ...row, firstSeenAt: "2026-10-14T12:00:00Z", updatedAt: "2026-10-14" })),
    { now },
  );
  assert.equal(changed.fingerprint, result.fingerprint);
  assert.equal(buildForesight([], { now: new Date("2026-10-13T16:00:00Z") }).asOf, "2026-10-14");
});

test("rejects invalid, missing and future publication dates without interpreting them as current", () => {
  const result = buildForesight(
    [
      paper("valid"),
      paper("future", { publishedAt: "2026-10-15" }),
      paper("missing", { publishedAt: "" }),
      paper("rollover", { publishedAt: "2026-02-30" }),
      paper("short", { publishedAt: "2026-10" }),
      paper("text", { publishedAt: "not-a-date" }),
    ],
    { now },
  );
  assert.deepEqual(
    result.papers.map((row) => row.id),
    ["valid"],
  );
  assert.equal(result.excludedFuture, 1);
  assert.ok(result.caveats.some((row) => row.en.includes("4 records with invalid/missing dates")));
  assert.throws(() => buildForesight([], { now: new Date("invalid") }), /valid current date/);
});

test("transitive related DOI grouping retains earliest publication and does not mutate library records", () => {
  const rows = [
    paper("preprint", {
      ...foundation,
      status: "preprint",
      doi: "https://doi.org/10.1000/A",
      relatedDoi: "10.1000/B",
      publishedAt: "2026-06-01",
    }),
    paper("published", {
      ...foundation,
      doi: "10.1000/b",
      relatedDoi: "10.1000/c",
      publishedAt: "2026-09-01",
    }),
    paper("version", { ...foundation, doi: "doi: 10.1000/C", publishedAt: "2026-10-01" }),
  ];
  const before = JSON.stringify(rows),
    result = buildForesight(rows, { now });
  assert.equal(result.papers.length, 1);
  assert.equal(result.duplicatesRemoved, 2);
  assert.equal(result.previous.length, 1);
  assert.equal(result.current.length, 0);
  assert.equal(result.papers[0], rows[1]);
  assert.equal(result.papers[0].publishedAt, "2026-09-01");
  assert.equal(JSON.stringify(rows), before);
  assert.equal(result.cards.length, 0);
  assert.equal(buildForesight([...rows].reverse(), { now }).fingerprint, result.fingerprint);
});

test("DOI, PMID, arXiv version and source-native identities deduplicate while unrelated titles stay separate", () => {
  const rows = [
    paper("pmid-a", { pmid: "123456" }),
    paper("pubmed:123456", { source: "PubMed" }),
    paper("arxiv-a", { source: "arXiv", arxivId: "2609.12345v1" }),
    paper("arxiv-b", { source: "arXiv", arxivId: "https://arxiv.org/abs/2609.12345v3" }),
    paper("native-a", {
      source: "Example",
      provenance: [{ sourceRecordId: "same-native-id", collectedAt: "2026-10-01" }],
    }),
    paper("native-b", {
      source: "Example",
      provenance: [{ sourceRecordId: "same-native-id", collectedAt: "2026-10-14" }],
    }),
    paper("separate-a", {
      title: "First imaging study",
      authors: [{ name: "Same Author", affiliations: ["Same Hospital"] }],
    }),
    paper("separate-b", {
      title: "Another imaging study",
      authors: [{ name: "Same Author", affiliations: ["Same Hospital"] }],
    }),
  ];
  const result = buildForesight(rows, { now });
  assert.equal(result.papers.length, 5);
  assert.equal(result.duplicatesRemoved, 3);
  assert.ok(result.papers.some((row) => row.id === "separate-a"));
  assert.ok(result.papers.some((row) => row.id === "separate-b"));
  assert.ok(result.caveats.some((row) => row.en.includes("do not establish independent teams")));
});

test("a later journal version of old work cannot create a recent trend, even with a new firstSeenAt", () => {
  const rows = [
    paper("old", {
      ...foundation,
      doi: "10.1000/preprint",
      relatedDoi: "10.1000/article",
      status: "preprint",
      publishedAt: "2025-01-01",
    }),
    paper("new", { ...foundation, doi: "10.1000/article", publishedAt: "2026-10-01" }),
  ];
  assert.equal(buildForesight(rows, { now }).papers.length, 0);
});

test("requires three distinct works per card and never turns duplicates into support", () => {
  assert.equal(buildForesight(trio(foundation).slice(0, 2), { now }).cards.length, 0);
  assert.equal(buildForesight(trio({ ...foundation, doi: "10.1000/one" }), { now }).cards.length, 0);
  const result = buildForesight(trio(foundation), { now });
  assert.ok(result.cards.length > 0);
  for (const card of result.cards) {
    assert.equal(card.currentCount, 3);
    assert.equal(card.strength, "limited");
    assert.equal(card.delta, null);
    assert.equal(new Set(card.paperIds).size, 3);
    assert.ok(card.observation.en.includes("clues") || card.observation.en.includes("co-occur"));
    for (const evidence of card.evidence)
      assert.ok(`${foundation.title}. We studied medical images.`.includes(evidence.excerpt));
  }
});

test("missing abstracts are unknown and cannot create validation or availability evidence", () => {
  const result = buildForesight(trio({ ...foundation, abstract: "", originalAbstract: null }), { now });
  assert.equal(result.missingAbstracts, 3);
  assert.ok(result.cards.some((card) => card.dimension === "method"));
  assert.ok(result.cards.every((card) => !["validation", "output"].includes(card.dimension)));
  assert.ok(result.caveats.some((row) => row.en.includes("not evidence of absent validation")));
});

test("validation excludes background, negation, plans, protocols, reviews and annotation-only descriptions", () => {
  const misleading = [
    "No external validation was performed. Our code is not available.",
    "We will conduct prospective external validation in a multicentre reader study.",
    "BACKGROUND: Prior studies performed external validation. Code will be released later.",
    "Radiologists annotated the training images. We used data that are publicly available.",
  ];
  for (const abstract of misleading) {
    const result = buildForesight(trio({ abstract }), { now });
    assert.ok(
      result.cards.every((card) => !["validation", "output"].includes(card.dimension)),
      abstract,
    );
  }
  for (const title of [
    "A systematic review of external validation",
    "A study protocol for a prospective trial",
  ]) {
    const result = buildForesight(
      trio({
        title,
        abstract: "We conducted a prospective multicentre study and externally validated a model.",
      }),
      { now },
    );
    assert.ok(
      result.cards.every((card) => card.dimension !== "validation"),
      title,
    );
  }
});

test("affirmative signals cite original abstracts and use only available abstracts as denominator", () => {
  const originalAbstract =
    "We externally validated the model on an external cohort. Our code is publicly available at https://example.org/code.";
  const result = buildForesight(
    [
      ...trio({ abstract: "Display text only", originalAbstract }),
      paper("unmentioned"),
      paper("missing", { abstract: "" }),
    ],
    { now },
  );
  const validation = result.cards.find((card) => card.dimension === "validation")!;
  const output = result.cards.find((card) => card.dimension === "output")!;
  assert.ok(validation);
  assert.ok(output);
  assert.deepEqual([validation.currentCount, validation.currentDenominator], [3, 4]);
  for (const card of [validation, output])
    for (const evidence of card.evidence) {
      assert.equal(evidence.kind, "abstract");
      assert.ok(originalAbstract.includes(evidence.excerpt));
      assert.notEqual(evidence.paperId, "missing");
    }
});

test("comparisons require enough publication-time coverage and report share differences, not better methods", () => {
  const rows = ["2026-07-17", "2026-04-18"].flatMap((start, period) =>
    Array.from({ length: 12 }, (_, index) =>
      paper(`${period}-${index}`, {
        publishedAt: day(start, index * 5),
        title: index < (period ? 3 : 5) ? foundation.title : "Medical imaging study",
        abstract: "We studied medical images.",
      }),
    ),
  );
  const result = buildForesight(rows, { now }),
    card = result.cards.find((card) => card.dimension === "method")!;
  assert.equal(result.comparisonReady, true);
  assert.deepEqual(
    [card.currentCount, card.previousCount, card.currentDenominator, card.previousDenominator],
    [5, 3, 12, 12],
  );
  assert.equal(card.delta, 16.7);
  assert.equal(card.paperIds.length, 8);
  assert.ok(card.paperIds.includes("1-0"));
  assert.ok(card.evidence.some((row) => row.paperId.startsWith("1-")));
  assert.ok(card.observation.en.includes("not a field-wide growth rate or evidence of superiority"));
  assert.ok(card.title.en.includes("rising share in the sample"));
  assert.ok(card.forecast.en.includes("rose by 16.7 percentage points"));
  assert.ok(card.forecast.en.includes("do not establish a sustained trend"));
  const concentrated = rows.map((row) => ({
    ...row,
    publishedAt: row.id.startsWith("0") ? "2026-10-01" : "2026-07-01",
  }));
  const narrow = buildForesight(concentrated, { now });
  assert.equal(narrow.comparisonReady, false);
  assert.ok(narrow.cards.every((card) => card.delta === null));
  assert.ok(
    narrow.cards[0].forecast.en.includes("insufficient to infer growth, decline or a change of direction"),
  );
});

test("stable, declining and watchlist outlooks follow observed shares without guessing PI intent", () => {
  const team: Team = {
    id: "team",
    name: "Research group",
    members: ["Same Author"],
    institution: "",
    kind: "team",
    createdAt: "2026-01-01",
  };
  const rows = (previousMatches: number) =>
    ["2026-07-17", "2026-04-18"].flatMap((start, period) =>
      Array.from({ length: 12 }, (_, index) =>
        paper(`${period}-${index}`, {
          authors: [{ name: "Same Author", affiliations: [] }],
          publishedAt: day(start, index * 5),
          title: `${index < (period ? previousMatches : 3) ? foundation.title : "Medical imaging study"} ${period}-${index}`,
        }),
      ),
    );
  const stable = buildForesight(rows(3), { now, team }).cards[0];
  assert.equal(stable.delta, 0);
  assert.ok(stable.title.en.includes("extend an existing line"));
  assert.ok(stable.forecast.en.includes("Within works matched to this watchlist"));
  assert.ok(stable.forecast.en.includes("not a team's or PI's research plans"));
  const declining = buildForesight(rows(6), { now, team }).cards[0];
  assert.equal(declining.delta, -25);
  assert.ok(declining.title.en.includes("declining-share"));
  assert.ok(declining.forecast.en.includes("does not establish abandonment"));
});

test("zero or tiny previous counts never become an infinite or unsupported growth claim", () => {
  const rows = ["2026-07-17", "2026-04-18"].flatMap((start, period) =>
    Array.from({ length: 12 }, (_, index) =>
      paper(`${period}-${index}`, {
        publishedAt: day(start, index * 5),
        title: index < (period ? 2 : 5) ? foundation.title : "Medical imaging study",
      }),
    ),
  );
  const result = buildForesight(rows, { now });
  assert.equal(result.comparisonReady, true);
  assert.equal(result.cards.find((card) => card.dimension === "method")?.delta, null);
});

test("large sample expansion suppresses trends even when both periods have ample dates and works", () => {
  const rows = [1400, 80].flatMap((count, period) =>
    Array.from({ length: count }, (_, index) =>
      paper(`${period}-${index}`, {
        ...foundation,
        publishedAt: day(period ? "2026-04-18" : "2026-07-17", index % 90),
      }),
    ),
  );
  const result = buildForesight(rows, { now });
  assert.deepEqual([result.current.length, result.previous.length], [1400, 80]);
  assert.equal(result.comparisonReady, false);
  assert.ok(result.cards.length > 0);
  assert.ok(result.cards.every((card) => card.delta === null));
  assert.ok(
    result.cards.every(
      (card) => !card.title.en.includes("rising share") && !card.title.en.includes("declining-share"),
    ),
  );
  assert.ok(
    result.caveats.some((row) => row.en.includes("possibly because of backfills or collection changes")),
  );
});

test("a major source shift suppresses comparisons despite equal window sizes", () => {
  const rows = ["arXiv", "Europe PMC"].flatMap((source, period) =>
    Array.from({ length: 20 }, (_, index) =>
      paper(`${period}-${index}`, {
        ...foundation,
        source,
        sources: [source],
        publishedAt: day(period ? "2026-04-18" : "2026-07-17", index * 3),
      }),
    ),
  );
  const result = buildForesight(rows, { now });
  assert.equal(result.comparisonReady, false);
  assert.ok(result.cards.every((card) => card.delta === null));
  assert.ok(result.caveats.some((row) => row.en.includes("source composition")));
});

test("source comparability recognizes PubMed and Europe PMC MED aliases while keeping preprints distinct", () => {
  const rows = ["PubMed", "Europe PMC"].flatMap((source, period) =>
    Array.from({ length: 12 }, (_, index) =>
      paper(`${period}-${index}`, {
        ...foundation,
        source,
        sources: [source],
        sourceCollection: period ? "MED" : undefined,
        publishedAt: day(period ? "2026-04-18" : "2026-07-17", index * 5),
      }),
    ),
  );
  assert.equal(buildForesight(rows, { now }).comparisonReady, true);
  const changedCollection = rows.map((row) =>
    row.source === "Europe PMC" ? { ...row, sourceCollection: "PPR" } : row,
  );
  assert.equal(buildForesight(changedCollection, { now }).comparisonReady, false);
});

test("abstract-only comparisons have their own denominator and source coverage gate", () => {
  const rows = ["2026-07-17", "2026-04-18"].flatMap((start, period) =>
    Array.from({ length: 80 }, (_, index) =>
      paper(`${period}-${index}`, {
        ...foundation,
        publishedAt: day(start, index),
        abstract: period && index % 5 !== 0 ? "" : "We externally validated the model on an external cohort.",
      }),
    ),
  );
  const result = buildForesight(rows, { now });
  assert.equal(result.comparisonReady, true);
  assert.notEqual(result.cards.find((card) => card.dimension === "method")?.delta, null);
  const validation = result.cards.find((card) => card.dimension === "validation")!;
  assert.deepEqual([validation.currentDenominator, validation.previousDenominator], [80, 16]);
  assert.equal(validation.delta, null);
});

test("track, modality and AND keyword filters share one scope; metadata cannot invent missing keyword evidence", () => {
  const selected = paper("selected", {
    ...foundation,
    abstract: "We tested a contrastive learning approach.",
  });
  const result = buildForesight(
    [
      selected,
      paper("wrong-track", { ...foundation, tracks: ["diagnosis"] }),
      paper("wrong-modality", { ...foundation, modalities: ["CT"] }),
      paper("wrong-keyword", foundation),
    ],
    { now, track: "segmentation", modality: "MRI", query: "MRI contrastive" },
  );
  assert.deepEqual(
    result.papers.map((row) => row.id),
    ["selected"],
  );
  const inventedTags = buildForesight(
    trio({ methods: ["基础模型"], tracks: ["segmentation"], modalities: ["MRI"] }),
    { now },
  );
  assert.equal(inventedTags.cards.length, 0);
});

test("team scope matches people plus optional institution, never institution alone", () => {
  const team: Team = {
    id: "team",
    name: "Research group",
    members: ["Alice A"],
    institution: "Example Hospital",
    kind: "team",
    createdAt: "2026-01-01",
  };
  const rows = [
    paper("member", { ...foundation, authors: [{ name: "Alice A", affiliations: ["Example Hospital"] }] }),
    paper("same-institution", {
      ...foundation,
      authors: [{ name: "Bob B", affiliations: ["Example Hospital"] }],
      affiliations: ["Example Hospital"],
    }),
    paper("wrong-institution", {
      ...foundation,
      authors: [{ name: "Alice A", affiliations: ["Other Hospital"] }],
    }),
  ];
  const result = buildForesight(rows, { now, team });
  assert.deepEqual(
    result.papers.map((row) => row.id),
    ["member"],
  );
  assert.equal(result.cards.length, 0);
  assert.equal(buildForesight(rows, { now, team: { ...team, name: "Renamed" } }).key, result.key);
  assert.notEqual(buildForesight(rows, { now, team: { ...team, members: ["Bob B"] } }).key, result.key);
  assert.notEqual(
    buildForesight(rows, { now, team: { ...team, institution: "Other Hospital" } }).key,
    result.key,
  );
  assert.ok(result.caveats.some((row) => row.en.includes("shared institution alone")));
});

test("horizon changes conditional scenarios and weakens long-range support without changing evidence", () => {
  const rows = Array.from({ length: 5 }, (_, index) => paper(String(index), foundation));
  const short = buildForesight(rows, { now, horizon: "3–6" }),
    medium = buildForesight(rows, { now, horizon: "6–12" }),
    long = buildForesight(rows, { now, horizon: "12–24" });
  assert.equal(short.cards[0].strength, "supported");
  assert.equal(long.cards[0].strength, "limited");
  assert.deepEqual(short.cards[0].paperIds, long.cards[0].paperIds);
  assert.notEqual(short.cards[0].forecast.en, medium.cards[0].forecast.en);
  assert.ok(long.cards[0].forecast.en.includes("cannot predict a dominant approach"));
  assert.notEqual(short.key, long.key);
});

test("content signatures are compact and order-stable; freshness alone never creates a revision", () => {
  const rows = trio(foundation),
    first = buildForesight(rows, { now });
  const reordered = buildForesight([...rows].reverse(), { now: new Date("2026-10-15T03:00:00Z") });
  assert.equal(first.fingerprint, reordered.fingerprint);
  assert.deepEqual(
    first.cards.map((card) => card.signature),
    reordered.cards.map((card) => card.signature),
  );
  assert.equal(first.fingerprint.length, 16);
  assert.ok(first.cards.every((card) => card.signature.length === 16));
  const changed = buildForesight(
    rows.map((row, index) => (index ? row : { ...row, title: row.title + " with supervised adaptation" })),
    { now },
  );
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.notEqual(first.cards[0].signature, changed.cards[0].signature);
  assert.equal(
    buildForesight(rows, { now, query: "MRI  segmentation MRI" }).key,
    buildForesight(rows, { now, query: "segmentation mri" }).key,
  );
});

test("cards remain bounded and opportunity suggestions never assert an unproved research gap", () => {
  const abstract =
    "We developed a self-supervised foundation model for MRI segmentation under domain shift and missing modality conditions. We externally validated the model on an external cohort. Our code is publicly available at https://example.org/code.";
  const rows = Array.from({ length: 20 }, (_, index) => paper(String(index), { ...foundation, abstract }));
  const result = buildForesight(rows, { now });
  assert.equal(result.cards.length, 6);
  assert.equal(new Set(result.cards.map((card) => card.dimension)).size, 6);
  assert.ok(
    result.cards.every((card) => card.evidence.length <= 6 && card.paperIds.length === card.currentCount),
  );
  assert.ok(
    result.cards
      .find((card) => card.dimension === "opportunity")
      ?.action.en.includes("not a demonstrated literature gap"),
  );
});
