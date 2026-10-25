import test from "node:test";
import assert from "node:assert/strict";
import { aiSampleLimit, fetchFreeAiModels, isFreeApiModel, parseFreeAiModels } from "../lib/ai-models";

function model(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    pricing: { prompt: "0", completion: "0" },
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["response_format"],
    context_length: 32768,
    ...overrides,
  };
}

test("free catalog excludes paid, malformed, undersized and incompatible model entries", () => {
  const data = [
    model("vendor/valid:free"),
    model("vendor/also-valid:free", { pricing: { prompt: "0.0", completion: 0, request: "0" } }),
    model("vendor/paid"),
    model("https://attacker.invalid/model:free"),
    model("vendor/charged:free", { pricing: { prompt: "0", completion: "0.01" } }),
    model("vendor/request-charge:free", { pricing: { prompt: "0", completion: "0", request: "0.01" } }),
    model("vendor/missing:free", { pricing: { prompt: "0" } }),
    model("vendor/empty-price:free", { pricing: { prompt: "", completion: "0" } }),
    model("vendor/null-price:free", { pricing: { prompt: null, completion: "0" } }),
    model("vendor/image:free", {
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
    }),
    model("vendor/no-json:free", { supported_parameters: ["tools"] }),
    model("vendor/short:free", { context_length: 8192 }),
    model("vendor/provider-short:free", { top_provider: { context_length: 8192 } }),
    model("vendor/output-short:free", { top_provider: { max_completion_tokens: 1024 } }),
    model("vendor/nonfinite:free", { context_length: Infinity }),
    model("vendor/no-name:free", { name: "" }),
    model("openrouter/free"),
    null,
  ];
  assert.deepEqual(
    parseFreeAiModels({ data }).map((m) => m.id),
    ["vendor/also-valid:free", "vendor/valid:free"],
  );
});

test("catalog deduplicates IDs and rejects an invalid envelope instead of presenting paid choices", () => {
  assert.equal(
    parseFreeAiModels({ data: [model("vendor/valid:free"), model("vendor/valid:free")] }).length,
    1,
  );
  for (const value of [null, {}, { data: null }, { data: "bad" }])
    assert.throws(() => parseFreeAiModels(value), /Invalid model catalog/);
  assert.deepEqual(parseFreeAiModels({ data: [] }), []);
});

test("free route validation rejects URL injection and paid variants", () => {
  for (const value of ["openrouter/free", "google/gemma-4-31b-it:free"])
    assert.equal(isFreeApiModel(value), true);
  for (const value of [
    "vendor/paid",
    "vendor/paid:free?model=paid",
    "https://example.com/x:free",
    "vendor/m:free:paid",
    "vendor/m:free\n",
  ])
    assert.equal(isFreeApiModel(value), false);
});

test("catalog fetch sends no credentials, uses fixed endpoint, and sanitizes failures", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(input, "https://openrouter.ai/api/v1/models");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.equal(init?.headers, undefined);
    assert.equal(init?.body, undefined);
    return new Response(JSON.stringify({ data: [model("vendor/model:free")] }));
  };
  assert.equal((await fetchFreeAiModels(undefined, fetcher)).length, 1);
  assert.equal(calls, 1);
  await assert.rejects(
    fetchFreeAiModels(undefined, async () => new Response("PRIVATE SERVER DETAIL", { status: 500 })),
    { message: "Free model catalog unavailable" },
  );
  await assert.rejects(
    fetchFreeAiModels(undefined, async () => new Response("PRIVATE SERVER DETAIL")),
    { message: "Free model catalog unavailable" },
  );
});

test("catalog cancellation prevents initial request and relays an in-flight abort", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    fetchFreeAiModels(before.signal, async () => {
      assert.fail("Request should not be sent");
    }),
    { name: "AbortError" },
  );
  const active = new AbortController();
  const pending = fetchFreeAiModels(
    active.signal,
    async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      }),
  );
  active.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("quick mode lowers evidence volume without claiming expanded coverage", () => {
  assert.equal(aiSampleLimit("quick", "local"), 6);
  assert.equal(aiSampleLimit("quick", "openrouter"), 12);
  assert.equal(aiSampleLimit("expanded", "local"), 24);
  assert.equal(aiSampleLimit("expanded", "openrouter"), 80);
});
