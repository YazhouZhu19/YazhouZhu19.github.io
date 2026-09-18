import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, beforeEach } from "node:test";
import { api, exportBackup, importBackup, validateBackup, clearLocalData, getLocalStorageStatus, LOCAL_DATA_KEY, BACKUP_SCHEMA, LOCAL_ERRORS, MAX_BACKUP_BYTES, monitorDataSchema } from "../.test-build/local-api.mjs";

class MemoryStorage {
  values = new Map();
  quota = false;
  silentlyDiscard = false;
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) {
    if (this.quota) throw new DOMException("full", "QuotaExceededError");
    if (!this.silentlyDiscard) this.values.set(String(key), String(value));
  }
  removeItem(key) { this.values.delete(String(key)); }
}

const now = "2026-09-17T12:00:00.000Z";
const paper = {
  id: "paper:1", title: "Research", abstract: "Evidence", authors: [], affiliations: [], doi: null,
  source: "arXiv", sources: ["arXiv"], status: "preprint", publishedAt: "2026-09-16", updatedAt: null,
  firstSeenAt: now, venue: null, url: "https://arxiv.org/abs/1234.56789", tasks: [], modalities: [], organs: [],
  methods: [], humanSignals: [], evidence: [], tracks: [], reviewStatus: "candidate", provenance: [],
};
const publicSnapshot = { papers: [paper], runs: [], queryRuns: [], collectedAt: now, lastSuccessfulSync: null, coverage: "sample", storageAvailable: false };
const backup = () => ({ schema: BACKUP_SCHEMA, version: 1, exportedAt: now, collections: [{ paperId: "paper:1", note: "笔记 ✨", stage: "选题候选", createdAt: now, updatedAt: now }], teams: [{ id: "6f9a1b4a-6e8e-4436-9809-d6586830482b", name: "团队", members: ["Author", "0000-0001-0000-0000"], institution: "Institute", kind: "合作候选", createdAt: now }] });
let local;
let fetchCalls;

beforeEach(() => {
  local = new MemoryStorage();
  Object.defineProperty(globalThis, "window", { value: { localStorage: local }, configurable: true });
  fetchCalls = [];
  globalThis.fetch = async (...args) => { fetchCalls.push(args); return new Response(JSON.stringify(publicSnapshot)); };
});

test("public data stays readable when browser storage is blocked; writes fail", async () => {
  Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  const result = await api("/api/papers");
  assert.equal(result.publicDataAvailable, true);
  assert.equal(result.storageAvailable, true);
  assert.equal(result.personalStorageAvailable, false);
  assert.equal(result.personalStorageReadable, false);
  assert.equal(result.personalStorageError, LOCAL_ERRORS.unavailable);
  assert.equal(fetchCalls[0][0], "/research-monitor/data/papers.json");
  assert.equal(fetchCalls[0][1].credentials, "omit");
  await assert.rejects(api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"] }) }), { message: LOCAL_ERRORS.unavailable });
});

test("personal CRUD remains local, persists stages, defaults and timestamps", async () => {
  await api("/api/papers");
  fetchCalls.length = 0;
  await api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: paper.id, note: "first" }) });
  const first = (await api("/api/collections")).collections[0];
  await api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: paper.id, note: "第二次", stage: "已读" }) });
  const second = (await api("/api/collections")).collections[0];
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.stage, "已读");
  assert.equal(second.note, "第二次");
  const added = await api("/api/teams", { method: "POST", body: JSON.stringify({ name: " Team ", members: [" Author "] }) });
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
  assert.deepEqual(Object.keys(exported).sort(), ["schema", "version", "exportedAt", "collections", "teams"].sort());
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
    JSON.parse(JSON.stringify(backup()).replace('"stage":"选题候选"', '"stage":"选题候选","constructor":{"prototype":{"polluted":true}}')),
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
  assert.throws(() => importBackup({ ...backup(), collections: [{ ...backup().collections[0], note: "a".repeat(20001) }] }), { message: LOCAL_ERRORS.backup });
  const large = { ...backup(), collections: Array.from({ length: 250 }, (_, index) => ({ ...backup().collections[0], paperId: `paper:${index}`, note: "a".repeat(20000) })) };
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
  await assert.rejects(api("/api/teams", { method: "DELETE", body: JSON.stringify({ id: backup().teams[0].id }) }), { message: LOCAL_ERRORS.quota });
  assert.equal(local.getItem(LOCAL_DATA_KEY), before);
  assert.deepEqual(exportBackup().teams, backup().teams);
});

test("corrupt local data never becomes empty data or gets silently overwritten", async () => {
  local.setItem(LOCAL_DATA_KEY, "{broken json");
  assert.equal(getLocalStorageStatus().error, LOCAL_ERRORS.corrupt);
  await assert.rejects(api("/api/collections"), { message: LOCAL_ERRORS.corrupt });
  await assert.rejects(api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"] }) }), { message: LOCAL_ERRORS.corrupt });
  assert.equal(local.getItem(LOCAL_DATA_KEY), "{broken json");
  assert.throws(() => exportBackup(), { message: LOCAL_ERRORS.corrupt });
  // An explicitly confirmed valid restore can repair a corrupted local record.
  importBackup(backup());
  assert.equal(exportBackup().teams.length, 1);
});

test("writes that a storage shim silently discards cannot report success", async () => {
  local.silentlyDiscard = true;
  assert.equal(getLocalStorageStatus().available, false);
  await assert.rejects(api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"] }) }), { message: LOCAL_ERRORS.unavailable });
  assert.throws(() => importBackup(backup()), { message: LOCAL_ERRORS.unavailable });
});

test("mutations reject extra fields and unknown papers; unsupported endpoints never fetch", async () => {
  await api("/api/papers");
  fetchCalls.length = 0;
  await assert.rejects(api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: "missing" }) }), { message: LOCAL_ERRORS.missingPaper });
  await assert.rejects(api("/api/teams", { method: "POST", body: JSON.stringify({ name: "Team", members: ["Author"], id: "injected", userId: "other" }) }), { message: LOCAL_ERRORS.input });
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
  globalThis.fetch = async () => new Response(JSON.stringify({ ...publicSnapshot, papers: [{ ...paper, url: "javascript:alert(1)" }] }));
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.publicData });
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  await assert.rejects(api("/api/papers"), { message: LOCAL_ERRORS.network });
});

test("real existing public snapshot passes validation", async () => {
  const existing = JSON.parse(await readFile(process.env.PUBLIC_SNAPSHOT_PATH ?? new URL("../data/papers.json", import.meta.url), "utf8"));
  const result = monitorDataSchema.safeParse(existing);
  assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error.issues));
  assert.equal(result.data.papers.length, existing.papers.length);
});
