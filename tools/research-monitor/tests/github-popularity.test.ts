import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GitHubSignal, ResearchSignal } from "../lib/research-signals";
import { buildGitHubDashboard } from "../lib/github-dashboard";
import { buildGitHubPopularity, compareGitHubPopularity } from "../lib/github-popularity";

const now = "2026-10-20T10:00:00.000Z";
function repo(id: string, overrides: Partial<GitHubSignal> = {}): GitHubSignal {
  return {
    id,
    kind: "github",
    title: id,
    fullName: `lab/${id}`,
    url: `https://github.com/lab/${id}`,
    summary: "Medical imaging",
    summaryKind: "repository-description",
    publisher: "lab",
    publishedAt: "2026-10-19T00:00:00Z",
    firstSeenAt: "2026-10-19T00:00:00Z",
    observedAt: now,
    updatedAt: now,
    topics: [],
    sourceId: "github-public",
    relatedUrls: [],
    stars: 0,
    forks: 0,
    openIssues: 0,
    license: null,
    language: null,
    archived: false,
    pushedAt: "2026-10-19T00:00:00Z",
    releasedAt: null,
    releaseUrl: null,
    readmeExcerpt: "",
    relevance: { level: "direct", reasons: ["medical-imaging"] },
    ...overrides,
  };
}

test("Stars and Forks produce independent exact totals, medians and rankings without mutating records", () => {
  const rows = [
    repo("alpha", { stars: 12500, forks: 2 }),
    repo("beta", { stars: 1, forks: 800 }),
    repo("gamma", { stars: 7, forks: 5 }),
    repo("zero"),
  ];
  const before = structuredClone(rows);
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  const result = buildGitHubPopularity(rows);
  assert.equal(result.stars.total, 12508);
  assert.equal(result.stars.median, 4);
  assert.equal(result.forks.total, 807);
  assert.equal(result.forks.median, 3.5);
  assert.deepEqual(
    result.stars.ranked.map((row) => [row.record.id, row.value, row.rank]),
    [
      ["alpha", 12500, 1],
      ["gamma", 7, 2],
      ["beta", 1, 3],
      ["zero", 0, 4],
    ],
  );
  assert.deepEqual(
    result.forks.ranked.map((row) => [row.record.id, row.value, row.rank]),
    [
      ["beta", 800, 1],
      ["gamma", 5, 2],
      ["alpha", 2, 3],
      ["zero", 0, 4],
    ],
  );
  assert.equal(result.stars.count, 4);
  assert.equal(result.stars.hasVariation, true);
  assert.deepEqual(rows, before);
});

test("ties share competition ranks and use stable name then ID order", () => {
  const rows = [
    repo("z", { stars: 10, fullName: "lab/zebra" }),
    repo("id-b", { stars: 10, fullName: "lab/Alpha" }),
    repo("id-a", { stars: 10, fullName: "lab/Alpha" }),
    repo("lower", { stars: 10, fullName: "lab/alpha" }),
    repo("last", { stars: 1 }),
  ];
  const result = buildGitHubPopularity(rows);
  assert.deepEqual(
    result.stars.ranked.map((row) => [row.record.id, row.rank]),
    [
      ["id-a", 1],
      ["id-b", 1],
      ["lower", 1],
      ["z", 1],
      ["last", 5],
    ],
  );
  assert.deepEqual(buildGitHubPopularity([...rows].reverse()).stars.ranked, result.stars.ranked);
  assert.deepEqual(
    [...rows].sort((a, b) => compareGitHubPopularity(a, b, "stars")),
    result.stars.ranked.map((row) => row.record),
  );
  assert.equal(result.stars.median, 10);
});

test("zero observations remain valid and are distinct from an empty population or equal positive values", () => {
  const empty = buildGitHubPopularity([]);
  assert.equal(empty.stars.total, 0);
  assert.equal(empty.stars.count, 0);
  assert.equal(empty.stars.median, null);
  assert.deepEqual(empty.stars.ranked, []);
  assert.equal(empty.stars.hasVariation, false);
  assert.equal(empty.observedFrom, null);
  assert.equal(empty.observedTo, null);
  assert.equal(empty.observedCount, 0);
  const zero = buildGitHubPopularity([repo("one"), repo("two")]);
  assert.equal(zero.stars.total, 0);
  assert.equal(zero.stars.count, 2);
  assert.equal(zero.stars.median, 0);
  assert.equal(zero.stars.hasVariation, false);
  assert.deepEqual(
    zero.stars.ranked.map((row) => row.rank),
    [1, 1],
  );
  const equal = buildGitHubPopularity([repo("one", { stars: 8 }), repo("two", { stars: 8 })]);
  assert.equal(equal.stars.total, 16);
  assert.equal(equal.stars.median, 8);
  assert.equal(equal.stars.hasVariation, false);
});

test("dashboard popularity uses the canonical deduplicated population after all filters and date exclusions", () => {
  const visible = repo("visible", { stars: 12, forks: 3 });
  const filteredOut = repo("filtered-out", { stars: 5000, forks: 5000 });
  const outside = repo("old", {
    stars: 1000,
    publishedAt: "2020-01-01T00:00:00Z",
    pushedAt: "2020-01-01T00:00:00Z",
  });
  const missing = repo("missing", { stars: 1000, publishedAt: null, pushedAt: null });
  const future = repo("future", { stars: 1000, pushedAt: "2026-10-21T00:00:00Z" });
  const duplicate = { ...visible, stars: 9000, forks: 9000 };
  const fakeNews = { ...visible, kind: "news", id: "news", stars: 10000 } as unknown as ResearchSignal;
  const model = buildGitHubDashboard(
    [visible, filteredOut, outside, missing, future, duplicate, fakeNews],
    {
      range: 7,
      baseRecords: [duplicate, outside, missing, future, repo("not-in-library", { stars: 1000 })],
    },
    now,
    now,
  );
  assert.deepEqual(model.popularity.stars.recordIds, ["visible"]);
  assert.equal(model.popularity.stars.total, 12);
  assert.equal(model.popularity.forks.total, 3);
  assert.equal(model.popularity.stars.count, model.rows.length);
  assert.equal(model.popularity.stars.ranked[0].record, visible);
  assert.deepEqual(model.excluded.outside.recordIds, ["old"]);
  assert.deepEqual(model.excluded.missing.recordIds, ["missing"]);
  assert.deepEqual(model.excluded.future.recordIds, ["future"]);
});

test("activity and creation select populations but never reinterpret cumulative snapshots as period growth", () => {
  const existing = repo("existing", {
    stars: 12345,
    forks: 456,
    publishedAt: "2018-01-01T00:00:00Z",
    observedAt: "2026-10-18T00:00:00Z",
  });
  const newRepo = repo("new", { stars: 10, forks: 1, observedAt: "2026-10-19T23:00:00+08:00" });
  const activity = buildGitHubDashboard([existing, newRepo], { range: 7, clock: "activity" }, now, now);
  const creation = buildGitHubDashboard([existing, newRepo], { range: 7, clock: "creation" }, now, now);
  assert.equal(activity.popularity.stars.total, 12355);
  assert.equal(activity.popularity.forks.total, 457);
  assert.equal(creation.popularity.stars.total, 10);
  assert.equal(activity.popularity.observedFrom, "2026-10-18T00:00:00.000Z");
  assert.equal(activity.popularity.observedTo, "2026-10-19T15:00:00.000Z");
  assert.equal(activity.popularity.observedCount, 2);
  assert.notEqual(
    activity.popularity.observedTo,
    activity.asOf,
    "build generation does not replace the underlying record observation time",
  );
  assert.equal(creation.popularity.observedFrom, creation.popularity.observedTo);
  const invalid = buildGitHubDashboard(
    [existing, newRepo],
    { range: "custom", from: "2026-10-20", to: "2026-10-10" },
    now,
    now,
  );
  assert.equal(invalid.popularity.stars.count, 0);
  assert.equal(invalid.popularity.stars.median, null);
});

test("real archive totals and rankings reconcile with the selected dashboard records", () => {
  const data = JSON.parse(
    readFileSync(new URL("../data/research-signals.json", import.meta.url), "utf8"),
  ) as { generatedAt: string; records: ResearchSignal[] };
  const github = data.records.filter((record): record is GitHubSignal => record.kind === "github");
  for (const baseRecords of [github, github.filter((record) => record.relevance?.level === "direct")]) {
    const model = buildGitHubDashboard(
      data.records,
      { range: "all", baseRecords },
      data.generatedAt,
      data.generatedAt,
    );
    for (const metric of ["stars", "forks"] as const) {
      const stats = model.popularity[metric];
      assert.equal(stats.count, model.rows.length);
      assert.equal(
        stats.total,
        model.rows.reduce((total, record) => total + record[metric], 0),
      );
      assert.equal(new Set(stats.ranked.map((row) => row.record.id)).size, model.rows.length);
      assert.deepEqual(
        stats.recordIds,
        model.rows.map((record) => record.id),
      );
      assert.deepEqual(
        stats.ranked.map((row) => row.record.id).sort(),
        model.rows.map((record) => record.id).sort(),
      );
      for (let index = 1; index < stats.ranked.length; index++) {
        const previous = stats.ranked[index - 1],
          current = stats.ranked[index];
        assert(previous.value >= current.value);
        assert.equal(current.rank, previous.value === current.value ? previous.rank : index + 1);
      }
    }
    assert.equal(model.popularity.observedCount, model.rows.length);
  }
});
