import assert from "node:assert/strict";
import test from "node:test";
import { createSignalsStore } from "../lib/signals-store";
import { adaptSignalOverview } from "../lib/signal-overview";
import { buildGitHubDashboard } from "../lib/github-dashboard";
import { buildSignalOverviews, createSignalsSnapshot } from "../scripts/signals-snapshot";
import { emptyResearchSignalsData, type GitHubSignal } from "../lib/research-signals";
import type { SignalsManifest, createSignalsSnapshotLoader } from "../lib/signals-snapshot";

const now = "2026-10-21T00:00:00Z";
const repo: GitHubSignal = {
  id: "github:lab/a",
  kind: "github",
  title: "A",
  fullName: "lab/a",
  url: "https://github.com/lab/a",
  summary: "MRI segmentation",
  summaryKind: "repository-description",
  publisher: "lab",
  publishedAt: "2026-10-01T00:00:00Z",
  firstSeenAt: "2026-10-02T00:00:00Z",
  observedAt: now,
  updatedAt: null,
  topics: ["segmentation"],
  sourceId: "github",
  relatedUrls: [],
  stars: 50,
  forks: 10,
  openIssues: 1,
  license: "MIT",
  language: "Python",
  archived: false,
  pushedAt: now,
  releasedAt: null,
  releaseUrl: null,
  readmeExcerpt: "",
};
function data() {
  return {
    ...emptyResearchSignalsData(now),
    records: [repo],
    sources: [
      {
        id: "github",
        kind: "github" as const,
        name: "GitHub",
        url: "https://github.com",
        status: "ok" as const,
        checkedAt: now,
        lastSuccessAt: now,
        received: 1,
        retained: 1,
        error: null,
        coverage: "test",
      },
    ],
  };
}
type Loader = ReturnType<typeof createSignalsSnapshotLoader>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("signals remain untouched until requested, overview is manifest-only, and kinds load independently", async () => {
  const manifest = createSignalsSnapshot(data()).manifest;
  let manifestReads = 0,
    initializations = 0;
  const kinds: string[] = [];
  const store = createSignalsStore("/", async () => {
    initializations++;
    return {
      loadManifest: async () => {
        manifestReads++;
        return manifest;
      },
      loadKind: async (_manifest, kind) => {
        kinds.push(kind);
        return kind === "github" ? [repo] : [];
      },
    };
  });
  assert.equal(initializations, 0);
  assert.equal(store.getSnapshot().snapshot, null);
  await store.ensureManifest();
  assert.equal(manifestReads, 1);
  assert.deepEqual(kinds, []);
  assert.equal(store.getSnapshot().snapshot?.records.length, 0);
  await Promise.all([store.ensureKind("github"), store.ensureKind("github")]);
  assert.equal(manifestReads, 1);
  assert.deepEqual(kinds, ["github"]);
  assert.deepEqual(store.getSnapshot().loaded, { github: true, news: false });
  await store.refresh();
  assert.deepEqual(kinds, ["github"]);
  assert.equal(manifestReads, 2);
});

test("a changed manifest atomically refreshes only loaded kinds, retaining prior data on failure", async () => {
  let manifest: SignalsManifest = createSignalsSnapshot(data()).manifest;
  let fail = false,
    reads = 0;
  const reader: Loader = {
    loadManifest: async () => manifest,
    loadKind: async (_manifest, kind) => {
      assert.equal(kind, "github");
      reads++;
      if (fail) throw new Error("missing shard");
      return [{ ...repo, stars: reads * 50 }];
    },
  };
  const store = createSignalsStore("/", async () => reader);
  await store.ensureKind("github");
  const old = store.getSnapshot().snapshot;
  manifest = structuredClone(manifest);
  fail = true;
  assert.equal(await store.refresh(), null);
  assert.equal(store.getSnapshot().snapshot, old);
  assert.equal(store.getSnapshot().error, true);
  fail = false;
  await store.refresh();
  assert.equal(store.getSnapshot().snapshot?.records[0].kind, "github");
  assert.notEqual(store.getSnapshot().snapshot, old);
  assert.equal(store.getSnapshot().error, false);
  assert.equal(reads, 3);
  assert.equal(store.getSnapshot().loaded.news, false);
});

test("retry queues the explicitly requested kind after refresh even when its first load failed", async () => {
  let manifest = createSignalsSnapshot(data()).manifest;
  let fail = true;
  const seen: SignalsManifest[] = [];
  const store = createSignalsStore("/", async () => ({
    loadManifest: async () => manifest,
    loadKind: async (current, kind) => {
      assert.equal(kind, "github");
      seen.push(current);
      if (fail) throw new Error("temporary shard failure");
      return [repo];
    },
  }));
  await store.ensureManifest();
  assert.equal(await store.ensureKind("github"), null);
  assert.equal(store.getSnapshot().loaded.github, false);
  assert.equal(store.getSnapshot().error, true);
  // The view queues both operations: a manifest-only retry cannot recover the missing kind.
  fail = false;
  manifest = { ...manifest, generatedAt: "2026-10-22T00:00:00Z" };
  const refresh = store.refresh();
  const retry = store.ensureKind("github");
  await refresh;
  assert.deepEqual((await retry)?.records, [repo]);
  assert.equal(seen.at(-1), manifest);
  assert.equal(store.getSnapshot().loaded.github, true);
  assert.equal(store.getSnapshot().loaded.news, false);
  assert.equal(store.getSnapshot().error, false);
});

test("cancelled signal loads do not publish, and a subsequent mount can load again", async () => {
  const manifest = createSignalsSnapshot(data()).manifest;
  let finish!: (value: SignalsManifest) => void;
  let first = true;
  const store = createSignalsStore("/", async () => ({
    loadManifest: async () => {
      if (!first) return manifest;
      first = false;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    loadKind: async () => [repo],
  }));
  const request = store.ensureManifest();
  await new Promise((resolve) => setImmediate(resolve));
  store.cancel();
  finish(manifest);
  assert.equal(await request, null);
  assert.equal(store.getSnapshot().manifest, null);
  await store.ensureManifest();
  assert.equal(store.getSnapshot().manifest, manifest);
});

test(
  "cancellation releases the queue even when the old manifest reader never settles",
  { timeout: 1000 },
  async () => {
    const manifest = createSignalsSnapshot(data()).manifest;
    const stalled = deferred<SignalsManifest>();
    let reads = 0;
    const store = createSignalsStore("/", async () => ({
      loadManifest: async () => (++reads === 1 ? stalled.promise : manifest),
      loadKind: async () => [repo],
    }));
    const first = store.ensureManifest();
    await new Promise((resolve) => setImmediate(resolve));
    store.cancel();
    assert.equal(await first, null);
    await store.ensureKind("github");
    assert.equal(reads, 2);
    assert.equal(store.getSnapshot().manifest, manifest);
    assert.equal(store.getSnapshot().loaded.github, true);
    assert.equal(store.getSnapshot().loading, false);
    assert.equal(store.getSnapshot().error, false);
    // Leave the old read unresolved: it cannot hold the new epoch or keep a timeout alive.
  },
);

test(
  "late initialization failure cannot clear a newer loader or overwrite recovered state",
  { timeout: 1000 },
  async () => {
    const manifest = createSignalsSnapshot(data()).manifest;
    const old = deferred<Loader>();
    let initializations = 0;
    const reader: Loader = { loadManifest: async () => manifest, loadKind: async () => [repo] };
    const store = createSignalsStore("/", async () => (++initializations === 1 ? old.promise : reader));
    const first = store.ensureManifest();
    await new Promise((resolve) => setImmediate(resolve));
    store.cancel();
    await store.ensureManifest();
    old.reject(new Error("late import failure"));
    assert.equal(await first, null);
    await new Promise((resolve) => setImmediate(resolve));
    await store.ensureKind("github");
    assert.equal(initializations, 2);
    assert.equal(store.getSnapshot().manifest, manifest);
    assert.equal(store.getSnapshot().error, false);
  },
);

for (const phase of ["initialization", "manifest", "records"] as const) {
  test(
    `a timed-out ${phase} read releases the queue and cannot publish after retry`,
    { timeout: 1000 },
    async () => {
      const manifest = createSignalsSnapshot(data()).manifest;
      const pendingReader = deferred<Loader>(),
        pendingManifest = deferred<SignalsManifest>(),
        pendingRecords = deferred<GitHubSignal[]>();
      let fail = true;
      const reader: Loader = {
        loadManifest: async () => (fail && phase === "manifest" ? pendingManifest.promise : manifest),
        loadKind: async () => (fail && phase === "records" ? pendingRecords.promise : [repo]),
      };
      const store = createSignalsStore(
        "/",
        async () => (fail && phase === "initialization" ? pendingReader.promise : reader),
        { timeoutMs: 10 },
      );
      assert.equal(await store.ensureKind("github"), null);
      assert.equal(store.getSnapshot().error, true);
      assert.equal(store.getSnapshot().loading, false);
      assert.equal(store.getSnapshot().loaded.github, false);
      fail = false;
      await store.ensureKind("github");
      const recovered = store.getSnapshot().snapshot;
      pendingReader.resolve(reader);
      pendingManifest.resolve({ ...manifest, generatedAt: "2020-01-01T00:00:00Z" });
      pendingRecords.resolve([{ ...repo, id: "late:old", title: "Stale result" }]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(store.getSnapshot().snapshot, recovered);
      assert.deepEqual(store.getSnapshot().snapshot?.records, [repo]);
      assert.equal(store.getSnapshot().error, false);
      assert.equal(store.getSnapshot().loading, false);
    },
  );
}

test("compact overview drills resolve the exact complete bucket and series IDs after kind loading", () => {
  const input = data();
  const compact = buildSignalOverviews(input).github;
  const adapter = adaptSignalOverview(compact);
  const complete = buildGitHubDashboard(input.records, {}, now, now);
  assert.deepEqual(adapter.github.global.total.recordIds, []);
  assert.deepEqual(adapter.resolveIds(adapter.github.global.total.recordIds, complete), [repo.id]);
  assert.deepEqual(
    adapter.resolveIds(adapter.github.scoped.metrics[0].recordIds, complete),
    complete.scoped.metrics[0].recordIds,
  );
  const point = adapter.github.series.find((row) => row.date === "2026-10-21")!;
  assert.deepEqual(adapter.resolveIds(point.recordIds, complete), [repo.id]);
  assert.deepEqual(adapter.resolveIds(point.directRecordIds, complete), []);
  assert.deepEqual(adapter.resolveIds(point.candidateRecordIds, complete), [repo.id]);
  const explicit = [repo.id];
  assert.equal(adapter.resolveIds(explicit, complete), explicit);
  assert.equal(adapter.github.scoped.total, complete.rows.length);
});
