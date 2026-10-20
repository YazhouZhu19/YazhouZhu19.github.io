import { test } from "node:test";
import assert from "node:assert/strict";
import { createDataWorkerClient, type DataWorkerPort, type DataWorkerRequest, type DataWorkerResponse } from "../lib/data-worker-client";
import { createDataWorkerRuntime } from "../lib/data-worker";
import { buildPaperIndex, buildPaperIndexAsync, paperSearchText, searchPaperIndex } from "../lib/paper-index";
import { PublicDataLoadError, type PublicPaperSnapshot } from "../lib/public-paper-loader";
import type { VerifiedPublicData } from "../lib/public-data-schema";

const baseUrl = "https://example.org/research-monitor/";
function paper(id: string): VerifiedPublicData["papers"][number] {
  return { id, title: `Medical ${id}`, abstract: "MRI segmentation 医学影像", authors: [{ name: "Ada Example", affiliations: [] }],
    affiliations: ["Example University"], doi: `10.1234/${id}`, source: "arXiv", sources: ["arXiv"], status: "preprint",
    publishedAt: "2026-10-20", updatedAt: null, firstSeenAt: "2026-10-21T00:00:00.000Z", venue: null,
    url: "https://example.org/paper", tasks: ["segmentation"], modalities: ["MRI"], organs: ["脑"], methods: ["模型"],
    humanSignals: [], evidence: [], tracks: ["segmentation"], reviewStatus: "unreviewed", provenance: [] };
}
function snapshot(generation = "g1", count = 5): PublicPaperSnapshot {
  return { generation, data: { papers: Array.from({ length: count }, (_, index) => paper(`${generation}-${index}`)), runs: [],
    queryRuns: [], collectedAt: "2026-10-21T00:00:00.000Z", lastSuccessfulSync: null, coverage: "fixture", totalStored: count } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class LoopbackWorker extends EventTarget {
  dead = false;
  replies: DataWorkerResponse[] = [];
  requests: DataWorkerRequest[] = [];
  runtime: ReturnType<typeof createDataWorkerRuntime>;
  constructor(load: (base: string, signal: AbortSignal) => Promise<PublicPaperSnapshot>, ready = true) {
    super();
    this.runtime = createDataWorkerRuntime(message => {
      this.replies.push(message);
      queueMicrotask(() => { if (!this.dead) this.dispatchEvent(new MessageEvent("message", { data: structuredClone(message) })); });
    }, { load });
    if (ready) queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } })));
  }
  postMessage(message: DataWorkerRequest) {
    this.requests.push(message);
    queueMicrotask(() => { if (!this.dead) this.runtime.handle(message); });
  }
  terminate() { this.dead = true; this.runtime.dispose(); }
}
const port = (worker: LoopbackWorker) => worker as unknown as DataWorkerPort;

test("paper indexing preserves substring semantics and collects all facets in one traversal", async () => {
  const papers = [paper("one"), { ...paper("two"), modalities: ["CT", "MRI"], sources: ["Europe PMC", "arXiv"] }];
  const before = structuredClone(papers);
  const index = buildPaperIndex(papers);
  assert.deepEqual(index.summary.modalities, ["CT", "MRI"]);
  assert.deepEqual(index.summary.sources, ["Europe PMC", "arXiv"]);
  assert.deepEqual(index.summary.organs, ["脑"]);
  assert.deepEqual(await buildPaperIndexAsync(papers), index);
  for (const query of [" ADA ", "10.1234/one", "医学", "example university", "segmentation", "no match", ""]) {
    const expected = papers.filter(row => paperSearchText(row).includes(query.trim().toLowerCase())).map(row => row.id);
    assert.deepEqual(await searchPaperIndex(index, query), expected);
  }
  assert.deepEqual(papers, before);
});

test("Worker sends bounded paper chunks, returns search IDs and reuses unchanged data", async () => {
  const data = snapshot("many", 650);
  const worker = new LoopbackWorker(async () => data);
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker) });
  try {
    const first = await client.load();
    assert.equal(first.mode, "worker");
    assert.deepEqual(first.data, data.data);
    const chunks = worker.replies.filter(message => message.type === "papers");
    assert.equal(chunks.length, 6);
    assert.ok(chunks.every(message => message.type === "papers" && message.papers.length <= 128));
    assert.deepEqual(await client.search("10.1234/many-649", { generation: first.generation }), { generation: "many", ids: ["many-649"] });
    const again = await client.load();
    assert.equal(again.data, first.data);
    assert.equal(worker.replies.filter(message => message.type === "papers").length, 6);
  } finally { client.dispose(); }
});

test("a cancelled old load cannot publish after a newer snapshot or trigger fallback", async () => {
  const slow = deferred<PublicPaperSnapshot>();
  let requests = 0, fallbacks = 0;
  const worker = new LoopbackWorker(async () => ++requests === 1 ? slow.promise : snapshot("new"));
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker),
    fallbackLoad: async () => { fallbacks++; return snapshot("fallback"); } });
  try {
    const first = client.load();
    const firstRejected = assert.rejects(first, { name: "AbortError" });
    while (!worker.requests.some(message => message.type === "load")) await new Promise(resolve => setTimeout(resolve, 0));
    const second = await client.load();
    await firstRejected;
    slow.resolve(snapshot("old"));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(second.generation, "new");
    assert.deepEqual((await client.search("new-4", { generation: "new" })).ids, ["new-4"]);
    assert.equal(fallbacks, 0);
  } finally { client.dispose(); }
});

test("search rejects superseded queries and generation mismatches", async () => {
  let current = snapshot("first", 2000);
  const worker = new LoopbackWorker(async () => current);
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker) });
  try {
    const first = await client.load();
    const oldQuery = client.search("first", { generation: first.generation });
    const oldRejected = assert.rejects(oldQuery, { name: "AbortError" });
    const latestQuery = await client.search("first-1999", { generation: first.generation });
    await oldRejected;
    assert.deepEqual(latestQuery.ids, ["first-1999"]);
    current = snapshot("second");
    await client.load();
    await assert.rejects(client.search("first", { generation: first.generation }), { name: "StalePaperGenerationError" });
  } finally { client.dispose(); }
});

test("unsupported module Workers use the verified main-thread fallback", async () => {
  let fallbackLoads = 0;
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => { throw new Error("Modules unavailable"); },
    fallbackLoad: async () => { fallbackLoads++; return snapshot("fallback"); } });
  try {
    const loaded = await client.load();
    assert.equal(loaded.mode, "main");
    assert.equal(fallbackLoads, 1);
    assert.deepEqual((await client.search("fallback-3", { generation: loaded.generation })).ids, ["fallback-3"]);
  } finally { client.dispose(); }
});

test("a module Worker that never becomes ready times out to fallback", async () => {
  const worker = new LoopbackWorker(async () => snapshot("unused"), false);
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker), startupTimeoutMs: 5,
    fallbackLoad: async () => snapshot("fallback") });
  try {
    assert.equal((await client.load()).mode, "main");
    assert.equal(worker.dead, true);
  } finally { client.dispose(); }
});

test("Worker network/validation failures remain visible rather than silently retrying on the UI thread", async () => {
  let fallbacks = 0;
  const worker = new LoopbackWorker(async () => { throw new PublicDataLoadError("format"); });
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker),
    fallbackLoad: async () => { fallbacks++; return snapshot(); } });
  try {
    await assert.rejects(client.load(), (error: any) => error.name === "PublicDataLoadError" && error.kind === "format");
    assert.equal(fallbacks, 0);
  } finally { client.dispose(); }
});

test("Worker failure after loading keeps search usable without downloading the snapshot again", async () => {
  const worker = new LoopbackWorker(async () => snapshot());
  let fallbacks = 0;
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker),
    fallbackLoad: async () => { fallbacks++; return snapshot(); } });
  try {
    const loaded = await client.load();
    worker.dispatchEvent(new Event("error"));
    assert.deepEqual((await client.search("g1-2", { generation: loaded.generation })).ids, ["g1-2"]);
    assert.equal(fallbacks, 0);
  } finally { client.dispose(); }
});

test("abort during startup rejects immediately and does not invoke fallback", async () => {
  const worker = new LoopbackWorker(async () => snapshot(), false);
  let fallbacks = 0;
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => port(worker), startupTimeoutMs: 1000,
    fallbackLoad: async () => { fallbacks++; return snapshot(); } });
  const controller = new AbortController();
  const request = client.load(controller.signal);
  controller.abort(new DOMException("stopped", "AbortError"));
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(fallbacks, 0);
  client.dispose();
});

test("cancelling a partially transferred snapshot preserves the accepted generation", async () => {
  const replies: DataWorkerResponse[] = [];
  let data = snapshot("accepted");
  let cancelNew = false;
  const runtime = createDataWorkerRuntime(message => {
    replies.push(message);
    if (cancelNew && message.type === "papers") runtime.handle({ type: "cancel", id: message.id });
  }, { load: async () => data });
  const waitFor = async (predicate: () => boolean) => {
    for (let index = 0; !predicate() && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(predicate(), "Worker protocol response did not arrive");
  };
  try {
    runtime.handle({ type: "load", id: 1, baseUrl });
    await waitFor(() => replies.some(row => row.type === "loaded" && row.id === 1));
    runtime.handle({ type: "accept", id: 1, generation: "accepted" });
    data = snapshot("cancelled", 300);
    cancelNew = true;
    runtime.handle({ type: "load", id: 2, baseUrl });
    await waitFor(() => replies.some(row => row.type === "error" && row.id === 2));
    assert.ok(!replies.some(row => row.type === "loaded" && row.id === 2));
    runtime.handle({ type: "search", id: 3, generation: "accepted", query: "accepted-4" });
    await waitFor(() => replies.some(row => row.type === "searched" && row.id === 3));
    assert.deepEqual(replies.find(row => row.type === "searched" && row.id === 3),
      { type: "searched", id: 3, generation: "accepted", ids: ["accepted-4"] });
  } finally { runtime.dispose(); }
});

test("fallback cancellation rejects even when an injected reader ignores AbortSignal", async () => {
  const delayed = deferred<PublicPaperSnapshot>();
  const entered = deferred<void>();
  const client = createDataWorkerClient({ baseUrl, workerFactory: () => { throw new Error("unsupported"); },
    fallbackLoad: async () => { entered.resolve(); return delayed.promise; } });
  const controller = new AbortController();
  const pending = client.load(controller.signal);
  await entered.promise;
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
  delayed.resolve(snapshot("too-late"));
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(client.search("too-late", { generation: "too-late" }), { name: "StalePaperGenerationError" });
  client.dispose();
});
