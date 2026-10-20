import assert from "node:assert/strict";
import test from "node:test";
import { fetchResearchSignals, ResearchSignalsLoadError } from "../lib/signals-loader";
import { emptyResearchSignalsData, SIGNALS_MAX_BYTES } from "../lib/research-signals";

const snapshot = emptyResearchSignalsData("2026-10-14T02:00:00Z");
const responseWith = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const fakeFetch = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  fn as typeof fetch;

test("signal snapshots use the configured site base, no cache, and no credentials", async () => {
  const controller = new AbortController();
  let requests = 0;
  const data = await fetchResearchSignals(
    controller.signal,
    "/research-monitor",
    fakeFetch(async (input, init) => {
      requests++;
      assert.equal(input, "/research-monitor/data/research-signals.json");
      assert.equal(init?.signal, controller.signal);
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.cache, "no-cache");
      return responseWith(snapshot);
    }),
  );
  assert.equal(requests, 1);
  assert.deepEqual(data, snapshot);
});

test("failed and non-JSON responses produce safe errors without reflecting remote content", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(async () => new Response("untrusted response secret", { status: 502 })),
    ),
    (error) =>
      error instanceof ResearchSignalsLoadError &&
      error.kind === "request" &&
      !error.message.includes("secret"),
  );
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(async () => new Response("<html>untrusted page</html>")),
    ),
    (error) => error instanceof ResearchSignalsLoadError && error.kind === "format",
  );
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(async () => {
        throw new Error("network detail with secret");
      }),
    ),
    (error) => error instanceof ResearchSignalsLoadError && !error.message.includes("secret"),
  );
});

test("signal snapshots reject unsupported versions and invalid source relationships", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(async () => responseWith({ ...snapshot, schemaVersion: 9 })),
    ),
    (error) => error instanceof ResearchSignalsLoadError && error.kind === "format",
  );
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(async () =>
        responseWith({
          ...snapshot,
          records: [{ id: "github:example/repo", kind: "github", url: "javascript:alert(1)" }],
        }),
      ),
    ),
    (error) => error instanceof ResearchSignalsLoadError && error.kind === "format",
  );
});

test("signal snapshots reject an oversized declared or actual UTF-8 payload", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(
        async () => new Response("{}", { headers: { "content-length": String(SIGNALS_MAX_BYTES + 1) } }),
      ),
    ),
    (error) => error instanceof ResearchSignalsLoadError && error.kind === "format",
  );
  const oversized = JSON.stringify({ ...snapshot, extra: "文".repeat(Math.ceil(SIGNALS_MAX_BYTES / 3)) });
  assert.ok(oversized.length < SIGNALS_MAX_BYTES);
  await assert.rejects(
    fetchResearchSignals(
      signal,
      "/",
      fakeFetch(async () => new Response(oversized)),
    ),
    (error) => error instanceof ResearchSignalsLoadError && error.kind === "format",
  );
});

test("cancellation preserves its reason instead of displaying a source error", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled by caller");
  const request = fetchResearchSignals(
    controller.signal,
    "/",
    fakeFetch(async () => {
      controller.abort(reason);
      throw new Error("fetch aborted");
    }),
  );
  await assert.rejects(request, (error) => error === reason);
});
