import test from "node:test";
import assert from "node:assert/strict";
import {
  wilsonInterval,
  compareProportions,
  compareCategoryWindows,
  precedingWindow,
  paperCollectionMarkers,
  signalCollectionMarkers,
  markersInBuckets,
} from "../lib/trend-statistics";

test("Wilson 95% intervals match known proportions and remain bounded at zero and one", () => {
  const middle = wilsonInterval(50, 100)!;
  assert.ok(Math.abs(middle.lower - 0.40383153) < 1e-7);
  assert.ok(Math.abs(middle.upper - 0.59616847) < 1e-7);
  assert.equal(wilsonInterval(0, 30)!.lower, 0);
  assert.ok(wilsonInterval(0, 30)!.upper > 0);
  assert.equal(wilsonInterval(30, 30)!.upper, 1);
  assert.ok(wilsonInterval(30, 30)!.lower < 1);
  assert.equal(wilsonInterval(0, 0), null);
  for (const [n, d] of [
    [-1, 30],
    [31, 30],
    [0.5, 1],
    [0, -1],
    [NaN, 2],
  ])
    assert.throws(() => wilsonInterval(n, d));
});

test("fewer than 30 in either window suppresses direction even with large observed differences", () => {
  const small = compareProportions(29, 29, 0, 100);
  assert.equal(small.sufficient, false);
  assert.equal(small.direction, null);
  assert.equal(compareProportions(30, 30, 0, 30).direction, "increase");
  assert.equal(compareProportions(0, 30, 30, 30).direction, "decrease");
  assert.equal(compareProportions(15, 30, 15, 30).direction, "uncertain");
  assert.equal(compareProportions(0, 0, 15, 30).interval, null);
});

test("difference confidence intervals are symmetric when comparison order reverses", () => {
  const a = compareProportions(40, 100, 20, 80),
    b = compareProportions(20, 80, 40, 100);
  assert.ok(Math.abs(a.interval!.lower + b.interval!.upper) < 1e-12);
  assert.ok(Math.abs(a.interval!.upper + b.interval!.lower) < 1e-12);
});

test("adjacent equal windows include leap dates and shares use distinct records with overlapping labels", () => {
  assert.deepEqual(precedingWindow("2024-03-01", "2024-03-30"), {
    from: "2024-03-01",
    to: "2024-03-30",
    previousFrom: "2024-01-31",
    previousTo: "2024-02-29",
  });
  const rows = [
    { id: "a", day: "2024-03-01", categories: ["seg", "diagnosis"] },
    { id: "a", day: "2024-03-01", categories: ["seg"] },
    { id: "b", day: "2024-03-30", categories: [] },
    { id: "c", day: "2024-02-29", categories: ["seg"] },
    { id: "invalid", day: "2024-02-30", categories: ["seg"] },
    { id: "future", day: "2024-03-31", categories: ["seg"] },
  ];
  const result = compareCategoryWindows(rows, "2024-03-01", "2024-03-30", ["seg", "diagnosis"]);
  assert.equal(result.currentTotal, 2);
  assert.equal(result.previousTotal, 1);
  assert.equal(result.categories[0].current!.count, 1);
  assert.equal(result.categories[1].current!.estimate, 0.5);
  assert.throws(() => precedingWindow("2024-03-30", "2024-03-01"));
  assert.throws(() => precedingWindow("", ""));
});

test("markers use explicit version dates and never infer source introduction from recent run timestamps", () => {
  const markers = paperCollectionMarkers({
    interestTaxonomyVersion: "2026-09-18-ten-interests-v1",
    scopeClassifierVersion: "2026-10-21-scope-v1",
    sourceTaxonomyVersions: { "Europe PMC": "2026-09-18-ten-interests-v1", unknown: "v2" },
    runs: [{ source: "new-looking-source", startedAt: "2026-10-20T00:00:00Z" }],
  });
  assert.equal(markers.length, 3);
  assert.ok(markers.every((marker) => marker.kind === "rule-version"));
  assert.equal(
    signalCollectionMarkers({ discoveryState: { github: { catalogVersion: "2026-10-15-v3" } } }, "github")[0]
      .day,
    "2026-10-15",
  );
  assert.deepEqual(signalCollectionMarkers(undefined, "news"), []);
  assert.deepEqual(signalCollectionMarkers({ discoveryState: { news: { catalogVersion: "" } } }, "news"), []);
  assert.deepEqual(
    markersInBuckets(markers, ["2026-10"]).map((m) => m.id),
    ["scope-classifier"],
  );
  assert.equal(markersInBuckets(markers, ["2026-10-20", "2026-10-21"])[0].index, 1);
});
