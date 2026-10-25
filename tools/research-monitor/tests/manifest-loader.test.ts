import assert from "node:assert/strict";
import test from "node:test";
import { createManifestLoader } from "../lib/manifest-loader";

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
