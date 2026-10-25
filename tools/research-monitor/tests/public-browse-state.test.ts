import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_CATEGORY_IDS,
  sourceBrowseGeneration,
  publicTeamState,
  teamPreferencesFromPublic,
  type PublicTeamState,
} from "../lib/public-browse-state";
import { getSignalBrowseCategories } from "../lib/signal-browse-categories";

test("lightweight URL category validation stays aligned with both lazy browse catalogs", () => {
  for (const kind of ["github", "news"] as const) {
    assert.deepEqual(
      SOURCE_CATEGORY_IDS[kind],
      getSignalBrowseCategories(kind).map((category) => category.id),
    );
  }
});

test("PI public state restoration does not carry saved team identifiers or private fields", () => {
  const original = {
    teamId: "directory:name:alexexample",
    query: "Alex",
    directoryTrack: "segmentation",
    directorySort: "works" as const,
    listSource: "directory" as const,
    apiKey: "private-key",
    aiPrompt: "unsubmitted question",
    savedKind: "合作候选",
  };
  const state = publicTeamState(original);
  assert.deepEqual(state, {
    query: "Alex",
    track: "segmentation",
    sort: "works",
    author: "directory:name:alexexample",
    tab: "directory",
  });
  assert.deepEqual(teamPreferencesFromPublic(state), {
    teamId: original.teamId,
    query: original.query,
    directoryTrack: original.directoryTrack,
    directorySort: "works",
    listSource: "directory",
  });
  const saved = publicTeamState({ ...original, listSource: "saved", teamId: "private-team-1" });
  assert.equal(saved.author, "");
  assert.equal(teamPreferencesFromPublic({ ...saved, author: "private-team-1" }).teamId, "");
  assert.ok(!JSON.stringify(state).includes("private") && !JSON.stringify(state).includes("unsubmitted"));
  const malformed = { ...state, author: "private-team-1" } satisfies PublicTeamState;
  assert.equal(teamPreferencesFromPublic(malformed).teamId, "");
});

test("source generations detect same-timestamp shard updates without invalidating the other source", () => {
  const manifest = {
    schema: "research-monitor-signals-v2",
    generatedAt: "2026-10-20T00:00:00Z",
    counts: { github: 1, news: 1 },
    overview: { github: {}, news: {} },
    shards: [
      { kind: "github", bucket: "2026-10", sha256: "a", count: 1 },
      { kind: "news", bucket: "2026-10", sha256: "b", count: 1 },
    ],
  } as unknown as import("../lib/signals-snapshot").SignalsManifest;
  const github = sourceBrowseGeneration(manifest, "github");
  const news = sourceBrowseGeneration(manifest, "news");
  const changed = structuredClone(manifest);
  changed.shards[0].sha256 = "c";
  assert.notEqual(sourceBrowseGeneration(changed, "github"), github);
  assert.equal(sourceBrowseGeneration(changed, "news"), news);
  changed.generatedAt = "2026-10-21T00:00:00Z";
  assert.equal(sourceBrowseGeneration(changed, "news"), news);
  assert.equal(sourceBrowseGeneration(null, "github"), undefined);
});
