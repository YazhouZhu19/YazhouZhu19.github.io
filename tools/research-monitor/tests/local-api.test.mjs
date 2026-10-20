import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import {
  api,
  exportBackup,
  importBackup,
  validateBackup,
  clearLocalData,
  getLocalStorageStatus,
  getLoadedPaperSnapshot,
  searchPublicPapers,
  disposePaperData,
  LOCAL_DATA_KEY,
  BACKUP_SCHEMA,
  LOCAL_ERRORS,
  MAX_BACKUP_BYTES,
  monitorDataSchema,
} from "../.test-build/local-api.mjs";

class MemoryStorage {
  values = new Map();
  quota = false;
  silentlyDiscard = false;
  getItem(key) {
    return this.values.get(String(key)) ?? null;
  }
  setItem(key, value) {
    if (this.quota) throw new DOMException("full", "QuotaExceededError");
    if (!this.silentlyDiscard) this.values.set(String(key), String(value));
  }
  removeItem(key) {
    this.values.delete(String(key));
  }
}

const now = "2026-09-17T12:00:00.000Z";
const paper = {
  id: "paper:1",
  title: "Research",
  abstract: "Evidence",
  authors: [],
  affiliations: [],
  doi: null,
  source: "arXiv",
  sources: ["arXiv"],
  status: "preprint",
  publishedAt: "2026-09-16",
  updatedAt: null,
  firstSeenAt: now,
  venue: null,
  url: "https://arxiv.org/abs/1234.56789",
  tasks: [],
  modalities: [],
  organs: [],
  methods: [],
  humanSignals: [],
  evidence: [],
  tracks: [],
  reviewStatus: "candidate",
  provenance: [],
};
const publicSnapshot = {
  papers: [paper],
  runs: [],
  queryRuns: [],
  collectedAt: now,
  lastSuccessfulSync: null,
  coverage: "sample",
  storageAvailable: false,
};
const manifestUrls = ["public-papers-v3.json", "public-papers-v2.json", "papers.json"].map(
  (name) => `/research-monitor/data/${name}`,
);
const preferredManifestUrl = manifestUrls[0];
const isManifestUrl = (url) => manifestUrls.includes(String(url));
function shardedSnapshot(groups) {
  const files = new Map();
  const shards = groups.map((records) => {
    const text = JSON.stringify(records);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const path = `papers/${sha256}.json`;
    files.set(`/research-monitor/data/${path}`, text);
    return { path, count: records.length, bytes: Buffer.byteLength(text), sha256 };
  });
  const { papers, ...metadata } = publicSnapshot;
  const totalStored = groups.reduce((count, records) => count + records.length, 0);
  return {
    manifest: {
      schema: "research-monitor-shards-v1",
      metadata: { ...metadata, totalStored },
      totalStored,
      shards,
    },
    files,
  };
}
const backup = () => ({
  schema: BACKUP_SCHEMA,
  version: 1,
  exportedAt: now,
  collections: [{ paperId: "paper:1", note: "笔记 ✨", stage: "选题候选", createdAt: now, updatedAt: now }],
  teams: [
    {
      id: "6f9a1b4a-6e8e-4436-9809-d6586830482b",
      name: "团队",
      members: ["Author", "0000-0001-0000-0000"],
      institution: "Institute",
      kind: "合作候选",
      createdAt: now,
    },
  ],
});
let local;
let fetchCalls;

beforeEach(() => {
  disposePaperData();
  local = new MemoryStorage();
  Object.defineProperty(globalThis, "window", { value: { localStorage: local }, configurable: true });
  fetchCalls = [];
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    return new Response(JSON.stringify(publicSnapshot));
  };
});

test("public data stays readable when browser storage is blocked; writes fail", async () => {
  Object.defineProperty(window, "localStorage", {
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const result = await api("/api/papers");
  assert.equal(result.publicDataAvailable, true);
  assert.equal(result.storageAvailable, true);
  assert.equal(result.personalStorageAvailable, false);
  assert.equal(result.personalStorageReadable, false);
  assert.equal(result.personalStorageError, LOCAL_ERRORS.unavailable);
  assert.equal(fetchCalls[0][0], preferredManifestUrl);
  assert.equal(fetchCalls[0][1].credentials, "omit");
  assert.equal(
    getLoadedPaperSnapshot().mode,
    "main",
    "Node has no module Worker; the verified fallback must remain usable",
  );
  assert.deepEqual(await searchPublicPapers("evidence"), [paper.id]);
  await assert.rejects(
    api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"] }) }),
    { message: LOCAL_ERRORS.unavailable },
  );
});

test("personal CRUD remains local, persists stages, defaults and timestamps", async () => {
  await api("/api/papers");
  fetchCalls.length = 0;
  await api("/api/collections", {
    method: "POST",
    body: JSON.stringify({ paperId: paper.id, note: "first" }),
  });
  const first = (await api("/api/collections")).collections[0];
  await api("/api/collections", {
    method: "POST",
    body: JSON.stringify({ paperId: paper.id, note: "第二次", stage: "已读" }),
  });
  const second = (await api("/api/collections")).collections[0];
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.stage, "已读");
  assert.equal(second.note, "第二次");
  const added = await api("/api/teams", {
    method: "POST",
    body: JSON.stringify({ name: " Team ", members: [" Author "] }),
  });
  assert.equal(added.team.name, "Team");
  assert.equal(added.team.kind, "持续关注");
  assert.deepEqual(added.team.members, ["Author"]);
  assert.equal((await api("/api/teams")).teams.length, 1);
  await api("/api/collections", { method: "DELETE", body: JSON.stringify({ paperId: paper.id }) });
  await api("/api/teams", { method: "DELETE", body: JSON.stringify({ id: added.team.id }) });
  assert.deepEqual((await api("/api/collections")).collections, []);
  assert.deepEqual((await api("/api/teams")).teams, []);
  assert.equal(fetchCalls.length, 0);
});

test("backup round-trip restores only personal records and preserves stored values", () => {
  const source = backup();
  assert.deepEqual(importBackup(source), { collections: 1, teams: 1 });
  const exported = exportBackup();
  assert.deepEqual(
    Object.keys(exported).sort(),
    ["schema", "version", "exportedAt", "collections", "teams"].sort(),
  );
  assert.deepEqual(exported.collections, source.collections);
  assert.deepEqual(exported.teams, source.teams);
  clearLocalData();
  importBackup(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(exportBackup().collections, source.collections);
  assert.deepEqual(exportBackup().teams, source.teams);
  assert.equal(fetchCalls.length, 0);
});

test("malformed, privilege-bearing and prototype keys are rejected without mutation", () => {
  importBackup(backup());
  const before = local.getItem(LOCAL_DATA_KEY);
  const bad = [
    { ...backup(), version: 2 },
    { ...backup(), papers: [paper] },
    { ...backup(), secret: "private" },
    { ...backup(), collections: [{ ...backup().collections[0], userId: "other" }] },
    { ...backup(), teams: [{ ...backup().teams[0], admin: true }] },
    { ...backup(), collections: [{ ...backup().collections[0], stage: "Read" }] },
    { ...backup(), teams: [{ ...backup().teams[0], createdAt: "not a date" }] },
    { ...backup(), collections: [...backup().collections, ...backup().collections] },
    { ...backup(), teams: [...backup().teams, ...backup().teams] },
    JSON.parse(JSON.stringify(backup()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}')),
    JSON.parse(
      JSON.stringify(backup()).replace(
        '"stage":"选题候选"',
        '"stage":"选题候选","constructor":{"prototype":{"polluted":true}}',
      ),
    ),
  ];
  for (const value of bad) {
    assert.throws(() => importBackup(value), { message: LOCAL_ERRORS.backup });
    assert.equal(local.getItem(LOCAL_DATA_KEY), before);
  }
  assert.equal({}.polluted, undefined);
});

test("length limits reject oversized content before modifying storage", () => {
  importBackup(backup());
  const before = local.getItem(LOCAL_DATA_KEY);
  assert.throws(
    () =>
      importBackup({ ...backup(), collections: [{ ...backup().collections[0], note: "a".repeat(20001) }] }),
    { message: LOCAL_ERRORS.backup },
  );
  const large = {
    ...backup(),
    collections: Array.from({ length: 250 }, (_, index) => ({
      ...backup().collections[0],
      paperId: `paper:${index}`,
      note: "a".repeat(20000),
    })),
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength > MAX_BACKUP_BYTES);
  assert.throws(() => validateBackup(large), { message: LOCAL_ERRORS.tooLarge });
  assert.equal(local.getItem(LOCAL_DATA_KEY), before);
});

test("quota failures preserve both lists; existing data can still be exported", async () => {
  importBackup(backup());
  const before = local.getItem(LOCAL_DATA_KEY);
  local.quota = true;
  assert.deepEqual(getLocalStorageStatus(), { available: false, readable: true, error: LOCAL_ERRORS.quota });
  assert.throws(() => importBackup({ ...backup(), teams: [] }), { message: LOCAL_ERRORS.quota });
  await assert.rejects(
    api("/api/teams", { method: "DELETE", body: JSON.stringify({ id: backup().teams[0].id }) }),
    { message: LOCAL_ERRORS.quota },
  );
  assert.equal(local.getItem(LOCAL_DATA_KEY), before);
  assert.deepEqual(exportBackup().teams, backup().teams);
});

test("corrupt local data never becomes empty data or gets silently overwritten", async () => {
  local.setItem(LOCAL_DATA_KEY, "{broken json");
  assert.equal(getLocalStorageStatus().error, LOCAL_ERRORS.corrupt);
  await assert.rejects(api("/api/collections"), { message: LOCAL_ERRORS.corrupt });
  await assert.rejects(
    api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"] }) }),
    { message: LOCAL_ERRORS.corrupt },
  );
  assert.equal(local.getItem(LOCAL_DATA_KEY), "{broken json");
  assert.throws(() => exportBackup(), { message: LOCAL_ERRORS.corrupt });
  // An explicitly confirmed valid restore can repair a corrupted local record.
  importBackup(backup());
  assert.equal(exportBackup().teams.length, 1);
});

test("writes that a storage shim silently discards cannot report success", async () => {
  local.silentlyDiscard = true;
  assert.equal(getLocalStorageStatus().available, false);
  await assert.rejects(
    api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"] }) }),
    { message: LOCAL_ERRORS.unavailable },
  );
  assert.throws(() => importBackup(backup()), { message: LOCAL_ERRORS.unavailable });
});

test("mutations reject extra fields and unknown papers; unsupported endpoints never fetch", async () => {
  await api("/api/papers");
  fetchCalls.length = 0;
  await assert.rejects(
    api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: "missing" }) }),
    { message: LOCAL_ERRORS.missingPaper },
  );
  await assert.rejects(
    api("/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "Team", members: ["Author"], id: "injected", userId: "other" }),
    }),
    { message: LOCAL_ERRORS.input },
  );
  await assert.rejects(api("/api/sync", { method: "POST" }), { message: LOCAL_ERRORS.unsupported });
  await assert.rejects(api("https://example.com/api/collections"), { message: LOCAL_ERRORS.unsupported });
  assert.equal(fetchCalls.length, 0);
  assert.equal(local.getItem(LOCAL_DATA_KEY), null);
});

test("clear removes only this app's key", () => {
  local.setItem("another-app", "keep");
  importBackup(backup());
  clearLocalData();
  assert.equal(local.getItem(LOCAL_DATA_KEY), null);
  assert.equal(local.getItem("another-app"), "keep");
});

test("public snapshot is schema-validated, including safe outbound URL protocols", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ...publicSnapshot, papers: [{ ...paper, url: "javascript:alert(1)" }] }));
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.publicData });
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.network });
});

test("shards load the complete ordered library with bounded requests, current labels and unchanged metadata", async () => {
  const records = Array.from({ length: 6 }, (_, index) => ({
    ...paper,
    id: `sharded:${index}`,
    title: `Research ${index} 中文`,
  }));
  const fixture = shardedSnapshot(records.map((record) => [record]));
  const controller = new AbortController();
  let active = 0;
  let peak = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push([url, options]);
    if (url === preferredManifestUrl) return new Response(JSON.stringify(fixture.manifest));
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    assert.ok(fixture.files.has(url), `Unexpected shard URL: ${url}`);
    return new Response(fixture.files.get(url));
  };
  const result = await api("/api/papers", { signal: controller.signal });
  const { withPaperScope } = await import("../.test-build/classify.mjs");
  assert.deepEqual(result.papers, records.map(withPaperScope));
  assert.equal(result.totalStored, records.length);
  assert.deepEqual(result.runs, publicSnapshot.runs);
  assert.deepEqual(result.queryRuns, publicSnapshot.queryRuns);
  assert.equal(result.collectedAt, publicSnapshot.collectedAt);
  assert.equal(result.coverage, publicSnapshot.coverage);
  assert.equal(result.lastSuccessfulSync, publicSnapshot.lastSuccessfulSync);
  assert.equal(fetchCalls.length, 7);
  assert.equal(fetchCalls[0][1].cache, "no-cache");
  assert.ok(peak > 1 && peak <= 4, `Expected at most four concurrent shard requests, got ${peak}`);
  for (const [, options] of fetchCalls) {
    assert.equal(options.credentials, "omit");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    assert.equal(
      options.signal,
      fetchCalls[0][1].signal,
      "The manifest and shards share one cancellable attempt",
    );
  }
  assert.ok(fetchCalls.slice(1).every(([, options]) => options.cache === "force-cache"));
  await api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: records.at(-1).id }) });
  assert.equal((await api("/api/collections")).collections[0].paperId, records.at(-1).id);
});

test("missing shards reject the whole snapshot without accepting partial paper IDs", async () => {
  await api("/api/papers");
  const partialPaper = { ...paper, id: "partial:1" };
  const fixture = shardedSnapshot([[partialPaper], [{ ...paper, id: "partial:2" }]]);
  globalThis.fetch = async (url) => {
    if (isManifestUrl(url)) return new Response(JSON.stringify(fixture.manifest));
    if (url.endsWith(fixture.manifest.shards[1].path)) return new Response("not found", { status: 404 });
    return new Response(fixture.files.get(url));
  };
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.network });
  await assert.rejects(
    api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: partialPaper.id }) }),
    { message: LOCAL_ERRORS.missingPaper },
  );
  assert.equal(local.getItem(LOCAL_DATA_KEY), null);
});

test("shard fetch failures preserve the public network error", async () => {
  const fixture = shardedSnapshot([[paper]]);
  globalThis.fetch = async (url) => {
    if (isManifestUrl(url)) return new Response(JSON.stringify(fixture.manifest));
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.network });
});

test("malformed manifests are rejected before fetching any shards", async () => {
  const fixture = shardedSnapshot([[paper]]);
  for (const invalid of [
    { ...fixture.manifest, totalStored: 2 },
    { ...fixture.manifest, shards: [{ ...fixture.manifest.shards[0], sha256: { toString: 1 } }] },
    { ...fixture.manifest, shards: [{ ...fixture.manifest.shards[0], path: "../private.json" }] },
  ]) {
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return new Response(JSON.stringify(invalid));
    };
    await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.publicData });
    assert.deepEqual(
      requests,
      manifestUrls,
      "Every compatible manifest fails validation before any shard or unsafe path is requested",
    );
  }
});

test("corrupt shard content and invalid assembled records report format errors", async () => {
  const corrupt = shardedSnapshot([[paper]]);
  globalThis.fetch = async (url) => {
    if (isManifestUrl(url)) return new Response(JSON.stringify(corrupt.manifest));
    return new Response(corrupt.files.get(url).replace('"title":"Research"', '"title":"Reseurch"'));
  };
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.publicData });
  const invalidRecords = shardedSnapshot([[{ ...paper, url: "javascript:alert(1)" }]]);
  globalThis.fetch = async (url) =>
    new Response(
      isManifestUrl(url) ? JSON.stringify(invalidRecords.manifest) : invalidRecords.files.get(url),
    );
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.publicData });
});

test("aborting shard downloads propagates the caller's AbortError", async () => {
  const fixture = shardedSnapshot([[paper], [{ ...paper, id: "paper:2" }]]);
  const controller = new AbortController();
  let started;
  const shardStarted = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (url, options) => {
    fetchCalls.push([url, options]);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal, fetchCalls[0][1].signal);
    if (url === preferredManifestUrl) return new Response(JSON.stringify(fixture.manifest));
    options.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      started();
    });
  };
  const rejected = assert.rejects(api("/api/papers", { signal: controller.signal }), { name: "AbortError" });
  await shardStarted;
  controller.abort();
  await rejected;
  assert.ok(fetchCalls.length > 1);
  for (const [, options] of fetchCalls) {
    assert.equal(options.signal.aborted, true);
    assert.equal(options.signal.reason, controller.signal.reason);
  }
  assert.deepEqual(
    fetchCalls.filter(([url]) => isManifestUrl(url)).map(([url]) => url),
    [preferredManifestUrl],
    "Cancellation must stop fallback requests",
  );
});

test("cancellation during shard verification cannot publish the assembled snapshot", async () => {
  await api("/api/papers");
  const record = { ...paper, id: "cancelled:1" };
  const fixture = shardedSnapshot([[record]]);
  const controller = new AbortController();
  globalThis.fetch = async (url) => {
    if (url === preferredManifestUrl) return new Response(JSON.stringify(fixture.manifest));
    return {
      ok: true,
      text: async () => {
        controller.abort();
        return fixture.files.get(url);
      },
    };
  };
  await assert.rejects(api("/api/papers", { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(
    api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: record.id }) }),
    { message: LOCAL_ERRORS.missingPaper },
  );
});

test("a superseded response cannot replace the public snapshot, index or known paper IDs", async () => {
  await api("/api/papers");
  let releaseOld;
  let started;
  const oldStarted = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = () =>
    new Promise((resolve) => {
      releaseOld = resolve;
      started();
    });
  const rejected = assert.rejects(api("/api/papers"), { name: "AbortError" });
  await oldStarted;
  const newest = { ...paper, id: "latest:1", title: "Newest MRI evidence", modalities: ["MRI"] };
  globalThis.fetch = async () => new Response(JSON.stringify({ ...publicSnapshot, papers: [newest] }));
  const accepted = await api("/api/papers");
  const generation = getLoadedPaperSnapshot().generation;
  releaseOld(
    new Response(
      JSON.stringify({ ...publicSnapshot, papers: [{ ...paper, id: "late:1", title: "Late response" }] }),
    ),
  );
  await rejected;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getLoadedPaperSnapshot().generation, generation);
  assert.equal(getLoadedPaperSnapshot().data.papers, accepted.papers);
  assert.deepEqual(await searchPublicPapers("newest mri"), [newest.id]);
  assert.deepEqual(await searchPublicPapers("late response"), []);
  await assert.rejects(
    api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: "late:1" }) }),
    { message: LOCAL_ERRORS.missingPaper },
  );
  await api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: newest.id }) });
  assert.equal((await api("/api/collections")).collections[0].paperId, newest.id);
});

test("unchanged manifests reuse verified papers and recheck current personal storage", async () => {
  const fixture = shardedSnapshot([[{ ...paper, id: "cache:unchanged" }]]);
  globalThis.fetch = async (url, options) => {
    fetchCalls.push([url, options]);
    return new Response(
      url === preferredManifestUrl ? JSON.stringify(fixture.manifest) : fixture.files.get(url),
    );
  };
  const first = await api("/api/papers");
  assert.equal(first.personalStorageAvailable, true);
  assert.equal(fetchCalls.length, 2);
  fetchCalls.length = 0;
  local.quota = true;
  const second = await api("/api/papers");
  assert.equal(second.papers, first.papers);
  assert.equal(second.runs, first.runs);
  assert.equal(second.personalStorageAvailable, false);
  assert.equal(second.personalStorageError, LOCAL_ERRORS.quota);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], preferredManifestUrl);
  assert.equal(fetchCalls[0][1].cache, "no-cache");
});

test("manifest metadata and shard changes invalidate cache even at the same timestamp and count", async () => {
  let fixture = shardedSnapshot([[{ ...paper, id: "cache:changed", title: "Before" }]]);
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return new Response(
      url === preferredManifestUrl ? JSON.stringify(fixture.manifest) : fixture.files.get(url),
    );
  };
  const first = await api("/api/papers");
  fixture.manifest.metadata.coverage = "Changed coverage";
  fetchCalls.length = 0;
  const metadataUpdate = await api("/api/papers");
  assert.equal(metadataUpdate.coverage, "Changed coverage");
  assert.equal(metadataUpdate.collectedAt, first.collectedAt);
  assert.equal(fetchCalls.length, 2);
  fixture = shardedSnapshot([[{ ...paper, id: "cache:changed", title: "After" }]]);
  fetchCalls.length = 0;
  const paperUpdate = await api("/api/papers");
  assert.equal(paperUpdate.papers[0].title, "After");
  assert.equal(paperUpdate.collectedAt, first.collectedAt);
  assert.equal(paperUpdate.papers.length, first.papers.length);
  assert.equal(fetchCalls.length, 2);
});

test("persistent verified shards survive a page reload and download only changed content", async () => {
  const entries = new Map();
  const cache = {
    async match(key) {
      return entries.get(typeof key === "string" ? key : key.url)?.clone();
    },
    async put(key, response) {
      entries.set(typeof key === "string" ? key : key.url, response.clone());
    },
    async delete(key) {
      return entries.delete(typeof key === "string" ? key : key.url);
    },
    async keys() {
      return [...entries.keys()].map((url) => new Request(url));
    },
  };
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      async open() {
        return cache;
      },
    },
  });
  try {
    const stable = { ...paper, id: "persistent:stable" };
    let fixture = shardedSnapshot([[stable], [{ ...paper, id: "persistent:changed", title: "Before" }]]);
    let downloads = 0;
    globalThis.fetch = async (url) => {
      if (url === preferredManifestUrl) return new Response(JSON.stringify(fixture.manifest));
      downloads += 1;
      assert.ok(fixture.files.has(url));
      return new Response(fixture.files.get(url));
    };
    const firstPage = await import("../.test-build/local-api.mjs?persistent-first");
    await firstPage.api("/api/papers");
    assert.equal(downloads, 2);
    downloads = 0;
    const secondPage = await import("../.test-build/local-api.mjs?persistent-second");
    assert.equal((await secondPage.api("/api/papers")).papers.length, 2);
    assert.equal(downloads, 0);
    fixture = shardedSnapshot([[stable], [{ ...paper, id: "persistent:changed", title: "After" }]]);
    const updated = await secondPage.api("/api/papers");
    assert.equal(downloads, 1);
    assert.equal(updated.papers[1].title, "After");
    fixture.manifest.metadata.coverage = "Metadata-only update";
    downloads = 0;
    assert.equal((await secondPage.api("/api/papers")).coverage, "Metadata-only update");
    assert.equal(downloads, 0);
  } finally {
    delete globalThis.caches;
  }
});

test("cached data never turns a corrupt new manifest or failed check into success", async () => {
  const fixture = shardedSnapshot([[{ ...paper, id: "cache:strict" }]]);
  globalThis.fetch = async (url) =>
    new Response(url === preferredManifestUrl ? JSON.stringify(fixture.manifest) : fixture.files.get(url));
  const first = await api("/api/papers");
  const invalid = { ...fixture.manifest, totalStored: 900 };
  globalThis.fetch = async () => new Response(JSON.stringify(invalid));
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.publicData });
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.network });
  globalThis.fetch = async (url) => {
    assert.equal(url, preferredManifestUrl);
    return new Response(JSON.stringify(fixture.manifest));
  };
  assert.equal((await api("/api/papers")).papers, first.papers);
});

test("an aborted manifest check cannot return a cached snapshot", async () => {
  const fixture = shardedSnapshot([[{ ...paper, id: "cache:abort" }]]);
  globalThis.fetch = async (url) =>
    new Response(url === preferredManifestUrl ? JSON.stringify(fixture.manifest) : fixture.files.get(url));
  await api("/api/papers");
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    return new Response(JSON.stringify(fixture.manifest));
  };
  await assert.rejects(api("/api/papers", { signal: controller.signal }), { name: "AbortError" });
});

test("real existing public snapshot passes validation", async () => {
  const snapshotPath =
    process.env.PUBLIC_SNAPSHOT_PATH ?? fileURLToPath(new URL("../data/papers.json", import.meta.url));
  const existing = JSON.parse(await readFile(snapshotPath, "utf8"));
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests += 1;
    if (url === preferredManifestUrl) return new Response(JSON.stringify(existing));
    const path = url.slice("/research-monitor/data/".length);
    return new Response(await readFile(join(dirname(snapshotPath), path), "utf8"));
  };
  const loaded = await api("/api/papers");
  const result = monitorDataSchema.safeParse(loaded);
  assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error.issues));
  assert.equal(result.data.papers.length, existing.papers?.length ?? existing.totalStored);
  if (existing.schema) {
    const previousRequests = requests;
    assert.equal((await api("/api/papers")).papers, loaded.papers);
    assert.equal(requests, previousRequests + 1);
  }
});
