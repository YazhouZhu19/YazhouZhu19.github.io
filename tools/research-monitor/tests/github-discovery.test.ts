import { test } from "node:test";
import assert from "node:assert/strict";
import { GITHUB_DISCOVERY_GROUPS, GITHUB_DISCOVERY_VERSION, getGitHubDiscoveryGroup } from "../lib/github-discovery";
import { GitHubSignalSchema } from "../lib/research-signals";

test("discovery routes stay unique, independently searchable and within the collection budget", () => {
  const groups = GITHUB_DISCOVERY_GROUPS;
  assert(groups.length >= 14 && groups.length <= 18);
  assert.equal(new Set(groups.map(group => group.id)).size, groups.length);
  const queries = groups.flatMap(group => group.queries);
  assert(queries.length <= 24);
  assert.equal(new Set(queries).size, queries.length);
  assert(GITHUB_DISCOVERY_VERSION.length > 0);
  for (const group of groups) {
    assert.match(group.id, /^[a-z][a-z0-9-]*$/);
    assert(group.labelZh && group.labelEn);
    assert(group.queries.length >= 1 && group.queries.length <= 2);
    assert.equal(getGitHubDiscoveryGroup(group.id), group);
    for (const query of group.queries) {
      assert(query.length <= 256);
      assert.match(query, / fork:false archived:false$/);
      assert.match(query, /(?:in:(?:name|description|readme)(?:,(?:name|description|readme))*|topic:[a-z-]+)/);
      assert(!/\b(?:OR|AND|NOT)\b|[()]/.test(query));
      assert.equal((query.match(/"/g) ?? []).length % 2, 0);
    }
  }
  assert.equal(getGitHubDiscoveryGroup("unconfigured-route"), undefined);
});

const oldRecord = {
  id: "github:example/imaging", title: "example/imaging", url: "https://github.com/example/imaging",
  summary: "Medical imaging toolkit", summaryKind: "repository-description", publisher: "example",
  publishedAt: null, firstSeenAt: "2026-10-14T04:00:00Z", observedAt: "2026-10-14T04:00:00Z", updatedAt: null,
  topics: [], sourceId: "github-public", relatedUrls: [], kind: "github", fullName: "example/imaging",
  stars: 0, forks: 0, openIssues: 0, license: null, language: null, archived: false,
  pushedAt: null, releasedAt: null, releaseUrl: null, readmeExcerpt: "",
};

test("discovery groups preserve old snapshots and accept only bounded unique route identifiers", () => {
  assert.equal(GitHubSignalSchema.parse(oldRecord).discoveryGroups, undefined);
  assert.deepEqual(GitHubSignalSchema.parse({ ...oldRecord, discoveryGroups: ["segmentation", "future-route"] }).discoveryGroups, ["segmentation", "future-route"]);
  assert.deepEqual(GitHubSignalSchema.parse({ ...oldRecord, discoveryGroups: [] }).discoveryGroups, []);
  for (const discoveryGroups of [["segmentation", "segmentation"], [""], ["Untrusted Route"], ["<script>"], Array.from({ length: 33 }, (_, n) => `route-${n}`)]) {
    assert.equal(GitHubSignalSchema.safeParse({ ...oldRecord, discoveryGroups }).success, false);
  }
});
