import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisStore } from "../lib/analysis-store";
import { createAnalysisSnapshot } from "../scripts/analysis-snapshot";
import { createAnalysisManifestV2 } from "../scripts/analysis-transport";
import { encodeAnalysisTransport } from "../lib/analysis-transport";
import { monitorDataSchema } from "../lib/public-data-schema";
import { normalizeRecord } from "../lib/record";

const web = "https://web.example/research-monitor/";
const data = "https://data.example/";
const bootstrapUrl = `${web}analysis-bootstrap-v2.json`;
const manifestUrl = `${data}data/analysis-manifest-v2.json`;
const summaryUrl = `${data}data/analysis-summary-v2.json`;
function packet(n = 1, generatedAt = "2026-11-17T00:00:00Z", collectedAt = `2026-11-${14 + n}T00:00:00Z`) {
  const papers = monitorDataSchema.parse({
    papers: Array.from({ length: n }, (_, i) =>
      normalizeRecord(
        {
          id: `paper-${i}`,
          title: "MRI brain segmentation",
          abstract: "A U-Net for medical MRI brain segmentation with limited annotations.",
          authors: [],
          doi: null,
          source: "Europe PMC",
          status: "published",
          publishedAt: "2026-01-01",
          firstSeenAt: collectedAt,
          url: `https://example.org/paper-${i}`,
          provenance: [],
        },
        collectedAt,
      ),
    ),
    collectedAt,
    lastSuccessfulSync: collectedAt,
    runs: [],
    queryRuns: [],
    coverage: "Synthetic fixture",
  });
  const snapshot = createAnalysisSnapshot({
    papers,
    signals: { schemaVersion: 1, generatedAt: collectedAt, records: [], sources: [], limitations: [] },
    paperManifestSha256: String(n).repeat(64),
    signalsManifestSha256: "b".repeat(64),
    generatedAt,
  });
  const text = JSON.stringify(encodeAnalysisTransport(snapshot)) + "\n";
  return { snapshot, text, manifest: createAnalysisManifestV2(snapshot, text) };
}
const response = (value: unknown) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal?.reason ?? new Error("Aborted"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
  });
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise<void>((done) => setImmediate(done));
  assert.ok(predicate(), "Expected store state did not become observable");
}
function store(fetcher: typeof fetch, timeoutMs = 1000) {
  return createAnalysisStore({ webBaseUrl: web, dataBaseUrl: data, fetcher, timeoutMs });
}

test("bootstrap is observable while the remote manifest is pending; the same generation never downloads a summary", async () => {
  const pack = packet(),
    remote = deferred<Response>(),
    paths: string[] = [];
  const current = store(async (input, init) => {
    const path = String(input);
    paths.push(path);
    if (path === bootstrapUrl) return response(pack.text);
    if (path === manifestUrl) return abortable(remote.promise, init?.signal);
    throw new Error(`Unexpected full-data request: ${path}`);
  });
  const pending = current.load();
  await until(() => current.getSnapshot().data !== null);
  assert.deepEqual(current.getSnapshot().data, pack.snapshot);
  assert.equal(current.getSnapshot().loading, true);
  assert.equal(current.getSnapshot().current, false);
  remote.resolve(response(pack.manifest));
  await pending;
  assert.equal(current.getSnapshot().current, true);
  assert.equal(current.getSnapshot().loading, false);
  assert.deepEqual(paths.sort(), [bootstrapUrl, manifestUrl].sort());
});

test("a newer verified publication replaces result and source metadata atomically", async () => {
  const old = packet(),
    next = packet(2),
    summary = deferred<Response>(),
    seen: unknown[] = [],
    paths: string[] = [];
  const current = store(async (input, init) => {
    const path = String(input);
    paths.push(path);
    if (path === bootstrapUrl) return response(old.text);
    if (path === manifestUrl) return response(next.manifest);
    if (path === summaryUrl) return abortable(summary.promise, init?.signal);
    throw new Error(`Unexpected request: ${path}`);
  });
  const stop = current.subscribe(() => {
    if (current.getSnapshot().data) seen.push(current.getSnapshot().data);
  });
  const pending = current.load();
  await until(() => paths.includes(summaryUrl));
  assert.deepEqual(current.getSnapshot().data, old.snapshot);
  summary.resolve(response(next.text));
  await pending;
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
  assert.equal(current.getSnapshot().current, true);
  assert.ok(current.getSnapshot().checkedAt);
  assert.ok(
    seen.every(
      (value) =>
        JSON.stringify(value) === JSON.stringify(old.snapshot) ||
        JSON.stringify(value) === JSON.stringify(next.snapshot),
    ),
  );
  assert.deepEqual(paths.sort(), [bootstrapUrl, manifestUrl, summaryUrl].sort());
  stop();
});

test("a deploy between manifest and summary retries the manifest once and verifies the new complete package", async () => {
  const old = packet(),
    next = packet(2),
    newest = packet(3, "2026-11-18T00:00:00Z");
  let manifestReads = 0,
    summaryReads = 0;
  const current = store(async (input) => {
    if (String(input) === bootstrapUrl) return response(old.text);
    if (String(input) === manifestUrl)
      return response(++manifestReads === 1 ? next.manifest : newest.manifest);
    if (String(input) === summaryUrl) {
      summaryReads++;
      return response(newest.text);
    }
    throw new Error("Unexpected request");
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, newest.snapshot);
  assert.equal(current.getSnapshot().error, false);
  assert.equal(manifestReads, 2);
  assert.equal(summaryReads, 2);
});

test("incorrect hashes retry once, preserve last-good data and can recover on explicit reload", async () => {
  const old = packet(),
    next = packet(2);
  let valid = false,
    manifestReads = 0,
    summaryReads = 0;
  const current = store(async (input) => {
    if (String(input) === bootstrapUrl) return response(old.text);
    if (String(input) === manifestUrl) {
      manifestReads++;
      return response(next.manifest);
    }
    if (String(input) === summaryUrl) {
      summaryReads++;
      return response(valid ? next.text : old.text);
    }
    throw new Error("Unexpected request");
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, old.snapshot);
  assert.equal(current.getSnapshot().error, true);
  assert.equal(current.getSnapshot().current, false);
  assert.equal(manifestReads, 2);
  assert.equal(summaryReads, 2);
  valid = true;
  await current.load();
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
  assert.equal(current.getSnapshot().error, false);
  assert.equal(manifestReads, 3);
});

test("incompatible versions and older publications retain the verified web result without fetching full data", async () => {
  const old = packet(),
    older = packet(0, "2026-11-16T00:00:00Z");
  for (const manifest of [{ ...old.manifest, ruleVersion: "unsupported" }, older.manifest]) {
    const paths: string[] = [];
    const current = store(async (input) => {
      const path = String(input);
      paths.push(path);
      if (path === bootstrapUrl) return response(old.text);
      if (path === manifestUrl) return response(manifest);
      throw new Error(`Unexpected full-data request: ${path}`);
    });
    await current.load();
    assert.deepEqual(current.getSnapshot().data, old.snapshot);
    assert.equal(current.getSnapshot().error, true);
    assert.deepEqual(paths.sort(), [bootstrapUrl, manifestUrl].sort());
  }
});

test("missing bootstrap recovers from the independently verified data publication", async () => {
  const next = packet(2);
  const current = store(async (input) => {
    if (String(input) === bootstrapUrl) return new Response("Not found", { status: 404 });
    if (String(input) === manifestUrl) return response(next.manifest);
    if (String(input) === summaryUrl) return response(next.text);
    throw new Error("Unexpected request");
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
  assert.equal(current.getSnapshot().current, true);
});

test("cancellation cannot publish a late response or prevent a subsequent load", async () => {
  const old = packet(),
    never = deferred<Response>();
  let paused = true;
  const current = store(async (input, init) => {
    if (paused) return abortable(never.promise, init?.signal);
    if (String(input) === bootstrapUrl) return response(old.text);
    if (String(input) === manifestUrl) return response(old.manifest);
    throw new Error("Unexpected request");
  });
  const abandoned = current.load();
  current.cancel();
  paused = false;
  await current.load();
  never.resolve(response(packet(2).text));
  await abandoned;
  assert.deepEqual(current.getSnapshot().data, old.snapshot);
  assert.equal(current.getSnapshot().current, true);
  assert.equal(current.getSnapshot().loading, false);
});

test("timeout is recoverable and does not leave a permanent pending request", async () => {
  const old = packet(),
    never = deferred<Response>();
  let paused = true;
  const current = store(async (input, init) => {
    if (paused) return abortable(never.promise, init?.signal);
    if (String(input) === bootstrapUrl) return response(old.text);
    if (String(input) === manifestUrl) return response(old.manifest);
    throw new Error("Unexpected request");
  }, 30);
  assert.equal(await current.load(), null);
  assert.equal(current.getSnapshot().error, true);
  assert.equal(current.getSnapshot().loading, false);
  paused = false;
  await current.load();
  assert.deepEqual(current.getSnapshot().data, old.snapshot);
  assert.equal(current.getSnapshot().error, false);
});

test("source freshness compares instants rather than timestamp strings with different UTC offsets", async () => {
  const old = packet(1, "2026-11-17T00:00:00Z", "2026-11-16T01:00:00+08:00");
  const next = packet(2, "2026-11-17T00:00:00Z", "2026-11-15T18:00:00Z");
  const current = store(async (input) => {
    if (String(input) === bootstrapUrl) return response(old.text);
    if (String(input) === manifestUrl) return response(next.manifest);
    if (String(input) === summaryUrl) return response(next.text);
    throw new Error("Unexpected request");
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
});

test("manifest timeout retains immediately available bootstrap data and marks freshness unconfirmed", async () => {
  const pack = packet(),
    remote = deferred<Response>();
  const current = store(async (input, init) => {
    if (String(input) === bootstrapUrl) return response(pack.text);
    if (String(input) === manifestUrl) return abortable(remote.promise, init?.signal);
    throw new Error("Unexpected full-data request");
  }, 30);
  await current.load();
  assert.deepEqual(current.getSnapshot().data, pack.snapshot);
  assert.equal(current.getSnapshot().error, true);
  assert.equal(current.getSnapshot().current, false);
  assert.equal(current.getSnapshot().loading, false);
});

test("concurrent consumers share a single bootstrap and manifest transfer", async () => {
  const pack = packet(),
    remote = deferred<Response>(),
    paths: string[] = [];
  const current = store(async (input, init) => {
    const path = String(input);
    paths.push(path);
    if (path === bootstrapUrl) return response(pack.text);
    if (path === manifestUrl) return abortable(remote.promise, init?.signal);
    throw new Error("Unexpected full-data request");
  });
  const first = current.load(),
    second = current.load();
  await until(() => current.getSnapshot().data !== null);
  remote.resolve(response(pack.manifest));
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, pack.snapshot);
  assert.deepEqual(b, pack.snapshot);
  assert.deepEqual(paths.sort(), [bootstrapUrl, manifestUrl].sort());
});

test("a newer analysis date cannot regress either input snapshot", async () => {
  const pack = packet(),
    olderSource = packet(2, "2026-11-18T00:00:00Z", "2026-11-14T00:00:00Z");
  const paths: string[] = [];
  const current = store(async (input) => {
    const path = String(input);
    paths.push(path);
    if (path === bootstrapUrl) return response(pack.text);
    if (path === manifestUrl) return response(olderSource.manifest);
    throw new Error("Unexpected full-data request");
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, pack.snapshot);
  assert.equal(current.getSnapshot().error, true);
  assert.equal(paths.includes(summaryUrl), false);
});

test("a stalled bootstrap does not block a healthy remote publication or leave loading active", async () => {
  const next = packet(2),
    stalled = deferred<Response>(),
    paths: string[] = [];
  let bootstrapAborted = false;
  const current = createAnalysisStore({
    webBaseUrl: web,
    dataBaseUrl: data,
    timeoutMs: 500,
    bootstrapGraceMs: 0,
    fetcher: async (input, init) => {
      const path = String(input);
      paths.push(path);
      if (path === bootstrapUrl) {
        init?.signal?.addEventListener(
          "abort",
          () => {
            bootstrapAborted = true;
          },
          { once: true },
        );
        return abortable(stalled.promise, init?.signal);
      }
      if (path === manifestUrl) return response(next.manifest);
      if (path === summaryUrl) return response(next.text);
      throw new Error(`Unexpected full-data request: ${path}`);
    },
  });
  assert.deepEqual(await current.load(), next.snapshot);
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
  assert.equal(current.getSnapshot().loading, false);
  assert.equal(current.getSnapshot().current, true);
  assert.equal(current.getSnapshot().error, false);
  assert.equal(bootstrapAborted, true);
  assert.deepEqual(paths.sort(), [bootstrapUrl, manifestUrl, summaryUrl].sort());
});

test("a late older bootstrap cannot replace a newer remote result even when transport ignores cancellation", async () => {
  const old = packet(),
    next = packet(2),
    delayed = deferred<Response>();
  const published: unknown[] = [];
  const current = createAnalysisStore({
    webBaseUrl: web,
    dataBaseUrl: data,
    timeoutMs: 500,
    bootstrapGraceMs: 0,
    fetcher: async (input) => {
      if (String(input) === bootstrapUrl) return delayed.promise;
      if (String(input) === manifestUrl) return response(next.manifest);
      if (String(input) === summaryUrl) return response(next.text);
      throw new Error("Unexpected full-data request");
    },
  });
  const stop = current.subscribe(() => {
    if (current.getSnapshot().data) published.push(current.getSnapshot().data);
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
  delayed.resolve(response(old.text));
  // Allow the already-started bootstrap continuation to process its late response.
  await new Promise<void>((done) => setImmediate(done));
  assert.deepEqual(current.getSnapshot().data, next.snapshot);
  assert.equal(current.getSnapshot().loading, false);
  assert.equal(current.getSnapshot().current, true);
  assert.equal(current.getSnapshot().error, false);
  assert.ok(published.length > 0);
  for (const value of published) assert.deepEqual(value, next.snapshot);
  stop();
});

test("equal content with different storage layouts skips the remote payload and keeps coherent source metadata", async () => {
  const local = packet();
  const remote = structuredClone(local.snapshot);
  remote.generatedAt = "2026-11-17T01:00:00Z";
  remote.sources.papers.manifestSha256 = "c".repeat(64);
  remote.sources.signals.manifestSha256 = "d".repeat(64);
  const text = JSON.stringify(encodeAnalysisTransport(remote));
  const manifest = createAnalysisManifestV2(remote, text);
  assert.equal(manifest.contentSha256, local.manifest.contentSha256);
  const paths: string[] = [];
  const current = store(async (input) => {
    paths.push(String(input));
    if (String(input) === bootstrapUrl) return response(local.text);
    if (String(input) === manifestUrl) return response(manifest);
    throw new Error("An identical result must not be downloaded again");
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, local.snapshot);
  assert.equal(current.getSnapshot().current, true);
  assert.deepEqual(paths.sort(), [bootstrapUrl, manifestUrl].sort());
});

test("HTML prefetch is adopted once and subsequent refreshes only fetch the manifest", async () => {
  const pack = packet(),
    paths: string[] = [];
  const current = createAnalysisStore({
    webBaseUrl: web,
    dataBaseUrl: data,
    prefetchedBootstrap: {
      url: bootstrapUrl,
      promise: Promise.resolve(response(pack.text)),
      controller: new AbortController(),
    },
    fetcher: async (input) => {
      paths.push(String(input));
      assert.equal(String(input), manifestUrl);
      return response(pack.manifest);
    },
  });
  await current.load();
  await current.load();
  assert.deepEqual(current.getSnapshot().data, pack.snapshot);
  assert.deepEqual(paths, [manifestUrl, manifestUrl]);
});

test("a healthy slower prefetch completes before remote fallback, without a second payload", async () => {
  const pack = packet(),
    early = deferred<Response>(),
    paths: string[] = [];
  const current = createAnalysisStore({
    webBaseUrl: web,
    dataBaseUrl: data,
    bootstrapGraceMs: 200,
    timeoutMs: 1000,
    prefetchedBootstrap: { url: bootstrapUrl, promise: early.promise, controller: new AbortController() },
    fetcher: async (input) => {
      paths.push(String(input));
      assert.equal(String(input), manifestUrl);
      return response(pack.manifest);
    },
  });
  const pending = current.load();
  await new Promise((done) => setTimeout(done, 20));
  early.resolve(response(pack.text));
  await pending;
  assert.equal(current.getSnapshot().current, true);
  assert.deepEqual(paths, [manifestUrl]);
});

test("stalled prefetch is aborted before the remote payload starts", async () => {
  const pack = packet(),
    early = deferred<Response>(),
    controller = new AbortController();
  const current = createAnalysisStore({
    webBaseUrl: web,
    dataBaseUrl: data,
    bootstrapGraceMs: 0,
    prefetchedBootstrap: { url: bootstrapUrl, promise: early.promise, controller },
    fetcher: async (input) => {
      if (String(input) === manifestUrl) return response(pack.manifest);
      assert.equal(String(input), summaryUrl);
      assert.equal(controller.signal.aborted, true);
      return response(pack.text);
    },
  });
  await current.load();
  assert.deepEqual(current.getSnapshot().data, pack.snapshot);
  assert.equal(current.getSnapshot().current, true);
});

test("a remote content fingerprint mismatch is rejected despite a valid transport digest", async () => {
  const pack = packet(2),
    manifest = { ...pack.manifest, contentSha256: "0".repeat(64) };
  const current = store(async (input) => {
    if (String(input) === bootstrapUrl) return new Response("missing", { status: 404 });
    if (String(input) === manifestUrl) return response(manifest);
    if (String(input) === summaryUrl) return response(pack.text);
    throw new Error("Unexpected request");
  });
  await current.load();
  assert.equal(current.getSnapshot().data, null);
  assert.equal(current.getSnapshot().error, true);
});
