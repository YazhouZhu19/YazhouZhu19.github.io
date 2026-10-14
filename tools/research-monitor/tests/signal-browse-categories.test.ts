import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GITHUB_DISCOVERY_GROUPS } from "../lib/github-discovery";
import { NEWS_DISCOVERY_GROUPS } from "../lib/news-discovery";
import type { ResearchSignal } from "../lib/research-signals";
import { getSignalBrowseCategories, getSignalBrowseCategoryIds } from "../lib/signal-browse-categories";

test("every configured retrieval route has exactly one explicit broad browsing category", () => {
  for (const [kind, discoveryGroups, expectedCount] of [
    ["github", GITHUB_DISCOVERY_GROUPS, 13], ["news", NEWS_DISCOVERY_GROUPS, 10],
  ] as const) {
    const categories = getSignalBrowseCategories(kind);
    assert.equal(categories.length, expectedCount);
    assert.equal(new Set(categories.map(category => category.id)).size, categories.length);
    assert.equal(categories.filter(category => category.fallback).length, 1);
    const routes = categories.flatMap(category => category.discoveryGroups);
    assert.equal(new Set(routes).size, routes.length, "a retrieval route must not be duplicated across categories");
    assert.deepEqual([...routes].sort(), discoveryGroups.map(group => group.id).sort(), "new retrieval routes need an intentional mapping");
    for (const category of categories) {
      assert(category.labelZh && category.labelEn);
      for (const route of category.discoveryGroups) {
        assert.deepEqual(getSignalBrowseCategoryIds({ kind, discoveryGroups: [route] }), [category.id]);
      }
    }
  }
});

test("related tasks share a bucket while cross-direction records remain discoverable in each relevant bucket", () => {
  assert.deepEqual(getSignalBrowseCategoryIds({ kind: "github", discoveryGroups: ["classification", "segmentation", "detection", "segmentation", "ct", "mri"] }),
    ["diagnostic-tasks", "radiology-nuclear"]);
  assert.deepEqual(getSignalBrowseCategoryIds({ kind: "news", discoveryGroups: ["toolkits", "datasets", "pathology", "microscopy"] }),
    ["pathology-microscopy", "data-software"]);
});

test("missing, unknown and general routes always remain browseable without diluting specific categories", () => {
  for (const kind of ["github", "news"] as const) {
    const fallback = getSignalBrowseCategories(kind).find(category => category.fallback)!;
    for (const discoveryGroups of [undefined, [], ["future-route"], ["medical-imaging"], ["medical-imaging", "future-route"]]) {
      assert.deepEqual(getSignalBrowseCategoryIds({ kind, discoveryGroups }), [fallback.id]);
    }
    const concrete = getSignalBrowseCategoryIds({ kind, discoveryGroups: ["segmentation"] });
    assert.deepEqual(getSignalBrowseCategoryIds({ kind, discoveryGroups: ["future-route", "medical-imaging", "segmentation"] }), concrete);
    assert(!concrete.includes(fallback.id));
  }
  assert.deepEqual(getSignalBrowseCategoryIds({ kind: "github", discoveryGroups: ["forked-projects"] }), ["general-resources"]);
});

test("the entire current GitHub and news archive is covered with valid nonduplicated categories", () => {
  const data = JSON.parse(readFileSync(new URL("../data/research-signals.json", import.meta.url), "utf8")) as { records: ResearchSignal[] };
  for (const kind of ["github", "news"] as const) {
    const records = data.records.filter(record => record.kind === kind);
    assert(records.length > 0, `${kind} archive is required for this coverage check`);
    const valid = new Set(getSignalBrowseCategories(kind).map(category => category.id));
    const covered = new Set<string>();
    for (const record of records) {
      const ids = getSignalBrowseCategoryIds(record);
      assert(ids.length > 0, `${record.id} would disappear from all direction filters`);
      assert.equal(new Set(ids).size, ids.length, `${record.id} would be counted twice within a category`);
      assert(ids.every(id => valid.has(id)), `${record.id} maps to an unavailable filter`);
      covered.add(record.id);
    }
    assert.equal(covered.size, records.length);
  }
});
