import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildGitHubDashboard, githubDashboardDate } from "../lib/github-dashboard";
import { buildNewsDashboard, newsDashboardDate, newsDashboardAsOf } from "../lib/news-dashboard";
import { signalTrendStatistics } from "../lib/signal-trends";
import { getSignalBrowseCategoryIds, getSignalBrowseCategories } from "../lib/signal-browse-categories";
import { matureGitHubRecords } from "../lib/github-quality";
import type { ResearchSignal, ResearchSignalsData } from "../lib/research-signals";
const data = JSON.parse(
  readFileSync(new URL("../data/research-signals.json", import.meta.url), "utf8"),
) as ResearchSignalsData;
for (const kind of ["github", "news"] as const) {
  for (const clock of kind === "github"
    ? (["activity", "creation"] as const)
    : (["publication", "discovery"] as const)) {
    test(`${kind} ${clock}: denominator and current window agree with dashboard after category filtering`, () => {
      const records = data.records.filter((record) => record.kind === kind);
      const base = kind === "github" ? matureGitHubRecords(records, data.generatedAt) : records;
      const categories = getSignalBrowseCategories(kind);
      const categoryById = new Map(base.map((record) => [record.id, getSignalBrowseCategoryIds(record)]));
      const selectedCategory = categories[0].id;
      const selected = base.filter((record) => categoryById.get(record.id)!.includes(selectedCategory));
      const asOf = kind === "github" ? data.generatedAt : (newsDashboardAsOf(data) ?? "");
      const date = (record: ResearchSignal) =>
        record.kind === "github"
          ? githubDashboardDate(record, clock as "activity" | "creation")
          : newsDashboardDate(record, clock as "publication" | "discovery");
      const dates = new Map(records.map((record) => [record.id, date(record)]));
      const build = (baseRecords: ResearchSignal[], range: 30 | "all" = 30) =>
        kind === "github"
          ? buildGitHubDashboard(
              records,
              { baseRecords, clock: clock as "activity" | "creation", range },
              data.generatedAt,
              asOf,
            )
          : buildNewsDashboard(
              records,
              { baseRecords, clock: clock as "publication" | "discovery", range },
              data.generatedAt,
              asOf,
            );
      const model = build(selected);
      const full = build(base);
      const stats = signalTrendStatistics(
        model,
        base,
        dates,
        categoryById,
        categories.map((c) => c.id),
        selectedCategory,
      );
      assert.equal(stats.denominator, full.scoped.total);
      assert.equal(stats.comparison?.currentTotal, full.scoped.total);
      const categoryStat = stats.comparison!.categories.find((c) => c.id === selectedCategory)!;
      assert.equal(categoryStat.current?.count ?? 0, model.scoped.total);
      assert.equal(signalTrendStatistics(build(base, "all"), base, dates, categoryById, []).comparison, null);
      assert.equal(
        signalTrendStatistics(build(selected, "all"), base, dates, categoryById, [], selectedCategory)
          .denominator,
        build(base, "all").scoped.total,
      );
    });
  }
}
test("stale observation keeps displayed start, clips comparison end, rejects exact future and missing dates", () => {
  const original = data.records.find((r) => r.kind === "news")!;
  const records = [
    { ...original, id: "initial", firstSeenAt: "2026-01-01T00:00:00Z", publishedAt: "2026-10-15T02:00:00Z" },
    { ...original, id: "valid", firstSeenAt: "2026-10-15T04:00:00Z", publishedAt: "2026-10-15T04:00:00Z" },
    {
      ...original,
      id: "same-day-future",
      firstSeenAt: "2026-10-15T06:00:00Z",
      publishedAt: "2026-10-15T06:00:00Z",
    },
    { ...original, id: "missing", firstSeenAt: "2026-10-15T04:00:00Z", publishedAt: null },
  ];
  const model = buildNewsDashboard(records, { range: 7 }, "2026-10-16T04:00:00Z", "2026-10-15T05:00:00Z");
  const dates = new Map(records.map((r) => [r.id, newsDashboardDate(r, "publication")]));
  const stats = signalTrendStatistics(model, records, dates, new Map(), []);
  assert.equal(stats.denominator, 2);
  assert.equal(stats.comparison?.currentTotal, 2);
  assert.equal(stats.comparison?.from, model.start);
  assert.equal(stats.comparison?.to, "2026-10-15");
  assert.equal(stats.comparison?.previousFrom, "2026-10-04");
  assert.equal(stats.comparison?.previousTo, "2026-10-09");
  const discovery = buildNewsDashboard(
    records,
    { range: 7, clock: "discovery" },
    "2026-10-16T04:00:00Z",
    "2026-10-15T05:00:00Z",
  );
  const discoveryDates = new Map(records.map((r) => [r.id, newsDashboardDate(r, "discovery")]));
  assert.equal(signalTrendStatistics(discovery, records, discoveryDates, new Map(), []).denominator, 2);
  const invalid = buildNewsDashboard(
    records,
    { range: "custom", from: "2026-10-25", to: "2026-10-20" },
    "2026-10-16T04:00:00Z",
    "2026-10-15T05:00:00Z",
  );
  assert.deepEqual(signalTrendStatistics(invalid, records, dates, new Map(), []), {
    denominator: 0,
    comparison: null,
  });
});

test("all-date denominator includes older records outside the selected category", () => {
  const original = data.records.find((r) => r.kind === "news")!;
  const records = [
    { ...original, id: "old-other", publishedAt: "2020-01-01T00:00:00Z" },
    { ...original, id: "recent-selected", publishedAt: "2026-10-15T00:00:00Z" },
  ];
  const model = buildNewsDashboard(
    records,
    { range: "all", baseRecords: [records[1]] },
    "2026-10-16T00:00:00Z",
    "2026-10-16T00:00:00Z",
  );
  const dates = new Map(records.map((r) => [r.id, newsDashboardDate(r, "publication")]));
  const categories = new Map([
    [records[0].id, ["other"]],
    [records[1].id, ["selected"]],
  ]);
  assert.equal(model.start, "2026-10-15");
  const stats = signalTrendStatistics(model, records, dates, categories, ["selected"], "selected");
  assert.deepEqual(stats, { denominator: 2, comparison: null });
});
