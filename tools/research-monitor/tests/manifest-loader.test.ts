import assert from "node:assert/strict";
import test from "node:test";
import { createManifestLoader } from "../lib/manifest-loader";
import { createSnapshotLoader } from "../lib/snapshot-refresh";

test("ETag revalidation uses a bodyless 304 and preserves the validated object", async () => {
  let requests = 0,
    validations = 0;
  const loader = createManifestLoader("/manifest.json", {
    validate: (raw) => {
      validations++;
      return raw as { version: number };
    },
    fetcher: async (_url, init) => {
      assert.equal(init?.cache, "no-cache");
      assert.equal(init?.credentials, "omit");
      assert.equal(new Headers(init?.headers).get("If-None-Match"), requests ? '"revision-1"' : null);
      return requests++
        ? new Response(null, { status: 304 })
        : new Response('{"version":1}', { headers: { ETag: '"revision-1"' } });
    },
  });
  const first = await loader.load();
  assert.equal(await loader.load(), first);
  assert.equal(validations, 1);
  assert.equal(requests, 2);
});

test("identical 200 responses reuse validation; a changed ETag and body replace it", async () => {
  let validations = 0,
    version = 1;
  const loader = createManifestLoader("/manifest", {
    validate: (raw) => {
      validations++;
      return raw;
    },
    fetcher: async () => new Response(JSON.stringify({ version }), { headers: { ETag: String(version) } }),
  });
  const first = await loader.load();
  assert.equal(await loader.load(), first);
  assert.equal(validations, 1);
  version = 2;
  assert.notEqual(await loader.load(), first);
  assert.equal(validations, 2);
});

test("invalid or aborted updates cannot replace the last validated manifest or ETag", async () => {
  let mode = "valid";
  const controller = new AbortController();
  const seen: (string | null)[] = [];
  const loader = createManifestLoader("/manifest", {
    validate: (raw) => {
      if (mode === "abort") controller.abort();
      if (mode === "invalid") throw new Error("bad schema");
      return raw;
    },
    fetcher: async (_url, init) => {
      seen.push(new Headers(init?.headers).get("If-None-Match"));
      return mode === "304"
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify({ mode }), { headers: { ETag: mode } });
    },
  });
  const first = await loader.load();
  mode = "invalid";
  await assert.rejects(loader.load(), /bad schema/);
  mode = "abort";
  await assert.rejects(loader.load(controller.signal), { name: "AbortError" });
  mode = "304";
  assert.equal(await loader.load(), first);
  assert.deepEqual(seen, [null, "valid", "valid", "valid"]);
});

test("manifest requests bound actual streamed bytes and reject incoherent responses", async () => {
  for (const response of [
    new Response("12345"),
    new Response("1", { headers: { "Content-Length": "100" } }),
    new Response(null, { status: 304 }),
    new Response("unavailable", { status: 503 }),
  ]) {
    const loader = createManifestLoader("/manifest", {
      maxBytes: 4,
      validate: (raw) => raw,
      fetcher: async () => response,
    });
    await assert.rejects(loader.load());
  }
});

function brokenBody(error: Error = new TypeError("terminated")) {
  let chunks = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunks++ === 0) controller.enqueue(new TextEncoder().encode('{"version":'));
      else controller.error(error);
    },
  });
}

test("an interrupted overview stream retries once without caching its partial body or ETag", async () => {
  const signal = new AbortController().signal;
  const etags: (string | null)[] = [];
  let validations = 0;
  const loader = createManifestLoader("/overview", {
    retryTransport: true,
    validate: (raw) => {
      validations++;
      return raw;
    },
    fetcher: async (_url, init) => {
      assert.equal(init?.signal, signal);
      etags.push(new Headers(init?.headers).get("If-None-Match"));
      if (etags.length === 1) return new Response(brokenBody(), { headers: { ETag: "partial" } });
      if (etags.length === 2) return new Response('{"version":1}', { headers: { ETag: "verified" } });
      return new Response(null, { status: 304 });
    },
  });
  const first = await loader.load(signal);
  assert.deepEqual(first, { version: 1 });
  assert.equal(await loader.load(signal), first);
  assert.deepEqual(etags, [null, null, "verified"]);
  assert.equal(validations, 1);
});

test("an interrupted update retries with the last validated ETag and can reuse a 304", async () => {
  const etags: (string | null)[] = [];
  const loader = createManifestLoader("/overview", {
    retryTransport: true,
    validate: (raw) => raw,
    fetcher: async (_url, init) => {
      etags.push(new Headers(init?.headers).get("If-None-Match"));
      if (etags.length === 1) return new Response('{"version":1}', { headers: { ETag: "verified" } });
      if (etags.length === 2) return new Response(brokenBody(), { headers: { ETag: "partial" } });
      return new Response(null, { status: 304 });
    },
  });
  const first = await loader.load();
  assert.equal(await loader.load(), first);
  assert.deepEqual(etags, [null, "verified", "verified"]);
});

test("transport retry is opt-in, accepts fetch rejection, and is capped at one attempt", async (t) => {
  for (const mode of ["default", "recover", "persistent", "persistent-stream"] as const) {
    await t.test(mode, async () => {
      let requests = 0;
      const failure = new TypeError("network request failed");
      const loader = createManifestLoader("/overview", {
        ...(mode === "default" ? {} : { retryTransport: true }),
        validate: (raw) => raw,
        fetcher: async () => {
          requests++;
          if (mode === "persistent-stream") return new Response(brokenBody(failure));
          if (mode === "recover" && requests === 2) return new Response('{"version":1}');
          throw failure;
        },
      });
      if (mode === "recover") assert.deepEqual(await loader.load(), { version: 1 });
      else await assert.rejects(loader.load(), (error) => error === failure);
      assert.equal(requests, mode === "default" ? 1 : 2);
    });
  }
});

test("response status, schema, JSON, UTF-8, and size errors never trigger transport retry", async (t) => {
  const cases = [
    {
      name: "schema",
      response: () => new Response("{}"),
      validate: () => {
        throw new TypeError("bad schema");
      },
    },
    { name: "JSON", response: () => new Response('{"broken":') },
    { name: "UTF-8", response: () => new Response(new Uint8Array([0xff])) },
    { name: "declared size", response: () => new Response("{}", { headers: { "Content-Length": "1000" } }) },
    { name: "streamed size", response: () => new Response(JSON.stringify("x".repeat(100))) },
    { name: "HTTP failure", response: () => new Response("unavailable", { status: 503 }) },
    { name: "unvalidated 304", response: () => new Response(null, { status: 304 }) },
    { name: "missing body", response: () => new Response(null) },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      let requests = 0;
      const loader = createManifestLoader("/overview", {
        retryTransport: true,
        maxBytes: 64,
        validate: item.validate ?? ((raw) => raw),
        fetcher: async () => {
          requests++;
          return item.response();
        },
      });
      await assert.rejects(loader.load());
      assert.equal(requests, 1);
    });
  }
});

test("aborted requests and abort errors cannot start a retry", async (t) => {
  for (const mode of [
    "already aborted",
    "fetch abort",
    "stream abort",
    "cancel during fetch",
    "cancel during stream",
  ] as const) {
    await t.test(mode, async () => {
      const controller = new AbortController();
      let requests = 0;
      if (mode === "already aborted") controller.abort();
      const loader = createManifestLoader("/overview", {
        retryTransport: true,
        validate: (raw) => raw,
        fetcher: async () => {
          requests++;
          if (mode === "cancel during fetch") {
            controller.abort();
            throw new TypeError("terminated");
          }
          if (mode === "stream abort")
            return new Response(brokenBody(new DOMException("Aborted", "AbortError")));
          if (mode === "cancel during stream")
            return new Response(
              new ReadableStream({
                pull(stream) {
                  controller.abort();
                  stream.error(new TypeError("terminated"));
                },
              }),
            );
          throw new DOMException("Aborted", "AbortError");
        },
      });
      await assert.rejects(loader.load(controller.signal), { name: "AbortError" });
      assert.equal(requests, mode === "already aborted" ? 0 : 1);
    });
  }
});

test("retry shares the overview's original 60-second deadline and AbortSignal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals: (AbortSignal | null | undefined)[] = [];
  let retryStarted!: () => void;
  const retry = new Promise<void>((resolve) => {
    retryStarted = resolve;
  });
  const manifest = createManifestLoader("/overview", {
    retryTransport: true,
    validate: (raw) => raw,
    fetcher: async (_url, init) => {
      signals.push(init?.signal);
      if (signals.length === 1) {
        t.mock.timers.tick(30_000);
        throw new TypeError("terminated");
      }
      retryStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    },
  });
  const snapshot = createSnapshotLoader((signal) => manifest.load(signal), 60_000);
  const pending = snapshot.load();
  const rejected = assert.rejects(
    pending,
    (error) => error instanceof Error && "kind" in error && error.kind === "timeout",
  );
  await retry;
  t.mock.timers.tick(29_999);
  assert.equal(signals[1]?.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signals[1]?.aborted, true);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals.length, 2);
});
