import test from "node:test";
import assert from "node:assert/strict";
import { aiEvidenceBatches, buildAiSynthesis, callOpenRouter, FREE_API_MODEL, getAiSettings, normalizeLocalContent, runAiAnalysis, updateAiSettings, type AiSettings } from "../lib/ai-client";
import { parseAiReport, prepareAiEvidence, type AiReport, type AiSpec } from "../lib/ai-evidence";
import type { Paper } from "../lib/types";

const personalKey = "test-only-private-key-never-print";
const config: AiSettings = { provider: "openrouter", apiKey: personalKey, model: "vendor/paid-model", paid: false };
const messages = [{ role: "user" as const, content: "Public paper evidence" }];
const controller = () => new AbortController();
function complete(content = "{}", model: string | null = "actual/free-model", finishReason = "stop") {
  return new Response(JSON.stringify({ model, choices: [{ finish_reason: finishReason, message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function fetchMock(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return handler as typeof fetch;
}
const spec: AiSpec = { mode: "landscape", from: "2026-09-01", to: "2026-10-14", horizonMonths: 6, question: "", locale: "en" };
function paper(id: string): Paper {
  return { id, title: "An imaging method", abstract: "We tested a medical imaging method.", authors: [], affiliations: [], doi: null,
    source: "Europe PMC", sources: ["Europe PMC"], status: "published", publishedAt: "2026-10-01", updatedAt: null,
    firstSeenAt: "2026-10-14T01:00:00Z", venue: null, url: `https://example.org/${id}`, tasks: [], modalities: [], organs: [], methods: [], humanSignals: [], evidence: [], tracks: [], reviewStatus: "unreviewed", provenance: [] };
}
function report(ids: string[]): AiReport {
  return { summary: "The supplied sample supports a conditional method assessment.", findings: ids.length ? [{
    title: "Test transfer", kind: "method", observation: "The cited work tests an imaging method.", forecast: "A transfer study could test its wider utility.",
    alternative: "The sample may be selective.", nextStep: "Evaluate a held-out site.", paperIds: ids,
  }] : [], limitations: ["Limited source coverage."] };
}
function evidence(count = 1) {
  return prepareAiEvidence(Array.from({ length: count }, (_, index) => paper(`paper-${index}`)), spec, 48, new Date("2026-10-14T04:00:00Z"));
}

test("free API calls use one fixed endpoint, a zero-price router and no model fallback", async () => {
  let calls = 0;
  const fetcher = fetchMock((input, init) => {
    calls++;
    assert.equal(input, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${personalKey}`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, FREE_API_MODEL);
    assert.deepEqual(body.provider, { data_collection: "deny", max_price: { prompt: 0, completion: 0 } });
    assert.equal(body.models, undefined);
    assert.ok(!String(init?.body).includes(personalKey));
    return complete("{}", "actual/free-model");
  });
  const result = await callOpenRouter(messages, config, controller().signal, "en", fetcher);
  assert.deepEqual(result, { content: "{}", model: "actual/free-model" });
  assert.equal(calls, 1);
});

test("paid model selection is explicit, and endpoint-like model IDs are rejected before sending", async () => {
  let calls = 0;
  const fetcher = fetchMock((_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "vendor/selected-model");
    assert.deepEqual(body.provider, { data_collection: "deny" });
    return complete();
  });
  await callOpenRouter(messages, { ...config, paid: true, model: "vendor/selected-model" }, controller().signal, "en", fetcher);
  await assert.rejects(callOpenRouter(messages, { ...config, paid: true, model: "https://attacker.invalid/collect" }, controller().signal, "en", fetcher), /valid OpenRouter model ID/);
  await assert.rejects(callOpenRouter(messages, { ...config, apiKey: " " }, controller().signal, "en", fetcher), /API key/);
  assert.equal(calls, 1);
});

test("disabling paid mode removes the previously selected paid model", () => {
  const previous = { ...getAiSettings() };
  try {
    updateAiSettings({ provider: "openrouter", paid: true, model: "vendor/paid-model", apiKey: personalKey });
    assert.equal(getAiSettings().model, "vendor/paid-model");
    updateAiSettings({ paid: false, model: "vendor/ignored-paid-model" });
    assert.equal(getAiSettings().model, FREE_API_MODEL);
  } finally { updateAiSettings(previous); }
});

test("truncation, filtered output and missing actual model are rejected", async () => {
  for (const finishReason of ["length", "content_filter", "tool_calls", ""]) {
    await assert.rejects(callOpenRouter(messages, config, controller().signal, "en", fetchMock(() => complete("partial", "actual/model", finishReason))), /complete analysis/);
  }
  for (const model of [null, "", "   "]) {
    await assert.rejects(callOpenRouter(messages, config, controller().signal, "en", fetchMock(() => complete("{}", model))), /actual model/);
  }
});

test("HTTP errors never expose response messages, credentials or paid fallback requests", async () => {
  for (const status of [401, 403, 402, 429, 500]) {
    let calls = 0;
    const fetcher = fetchMock(() => {
      calls++;
      return new Response(JSON.stringify({ error: { message: `SERVER-PRIVATE-TEXT ${personalKey}` } }), { status });
    });
    await assert.rejects(callOpenRouter(messages, config, controller().signal, "en", fetcher), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.ok(!error.message.includes(personalKey));
      assert.ok(!error.message.includes("SERVER-PRIVATE-TEXT"));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("malformed successful responses cannot expose raw server body text", async () => {
  await assert.rejects(callOpenRouter(messages, config, controller().signal, "en", fetchMock(() => new Response(`SERVER-PRIVATE-TEXT ${personalKey}`, { status: 200 }))), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(personalKey));
    assert.ok(!error.message.includes("SERVER-PRIVATE-TEXT"));
    assert.ok(!error.message.includes("SERVER-PRI"));
    return true;
  });
});

test("abort before a request prevents transmission; abort in flight relays to fetch", async () => {
  const early = controller();
  early.abort();
  let calls = 0;
  await assert.rejects(callOpenRouter(messages, config, early.signal, "en", fetchMock(() => { calls++; return complete(); })), { name: "AbortError" });
  assert.equal(calls, 0);
  const active = controller();
  let requestSignal: AbortSignal | undefined;
  const pending = callOpenRouter(messages, config, active.signal, "en", fetchMock((_input, init) => new Promise((_resolve, reject) => {
    requestSignal = init?.signal ?? undefined;
    requestSignal?.addEventListener("abort", () => reject(new DOMException("private transport detail", "AbortError")), { once: true });
  })));
  active.abort();
  await assert.rejects(pending, { name: "AbortError", message: "Analysis cancelled" });
  assert.equal(requestSignal?.aborted, true);
});

test("network failures are sanitized and trigger no alternate provider", async () => {
  let calls = 0;
  await assert.rejects(callOpenRouter(messages, config, controller().signal, "en", fetchMock(() => {
    calls++;
    throw new TypeError(`NETWORK-PRIVATE-TEXT ${personalKey}`);
  })), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Could not connect/);
    assert.ok(!error.message.includes(personalKey));
    return true;
  });
  assert.equal(calls, 1);
});

test("evidence-to-model-to-report integration validates citations and records the actual model", async () => {
  const originalFetch = globalThis.fetch;
  const data = evidence(3);
  try {
    globalThis.fetch = fetchMock((_input, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.messages.find((item: { role: string }) => item.role === "user").content);
      assert.equal(input.papers.length, 3);
      assert.deepEqual(Object.keys(input.papers[0]).sort(), ["abstract", "date", "id", "source", "status", "title"]);
      return complete(JSON.stringify(report([input.papers[0].id])), "actual/verified-free-model");
    });
    const result = await runAiAnalysis(data, config, { signal: controller().signal, onProgress: () => {} });
    assert.equal(result.model, "actual/verified-free-model");
    assert.equal(result.report.findings[0].paperIds[0], data.papers[0].id);
    assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  } finally { globalThis.fetch = originalFetch; }
});

test("sequential batch synthesis only permits citations actually preserved in preliminary reports", async () => {
  const originalFetch = globalThis.fetch;
  const data = evidence(45);
  let calls = 0;
  const cited: string[] = [];
  try {
    globalThis.fetch = fetchMock((_input, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.messages.find((item: { role: string }) => item.role === "user").content);
      calls++;
      if (input.papers) {
        assert.ok(input.papers.length <= 40);
        assert.equal(input.coverage.sampled, input.papers.length < input.coverage.totalWorks);
        cited.push(input.papers[0].id);
        return complete(JSON.stringify(report([input.papers[0].id])), `actual/batch-model-${calls}`);
      }
      assert.equal(input.reports.length, 2);
      return complete(JSON.stringify(report(cited)), "actual/synthesis-model");
    });
    const result = await runAiAnalysis(data, config, { signal: controller().signal, onProgress: () => {} });
    assert.equal(calls, 3);
    assert.deepEqual(result.report.findings[0].paperIds, cited);
    assert.match(result.model, /batch-model-1/);
    assert.match(result.model, /batch-model-2/);
    assert.match(result.model, /synthesis-model/);

    calls = 0;
    globalThis.fetch = fetchMock((_input, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.messages.find((item: { role: string }) => item.role === "user").content);
      calls++;
      return complete(JSON.stringify(report([input.papers ? input.papers[0].id : data.papers[1].id])));
    });
    await assert.rejects(runAiAnalysis(data, config, { signal: controller().signal, onProgress: () => {} }), /paper-citation validation/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("a failed analysis releases the global run lock and local unavailability does not call an API", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = fetchMock(() => { calls++; return complete(JSON.stringify(report(["invented"]))); });
    await assert.rejects(runAiAnalysis(evidence(), config, { signal: controller().signal, onProgress: () => {} }), /paper-citation validation/);
    globalThis.fetch = fetchMock(() => { calls++; return complete(JSON.stringify(report(["paper-0"]))); });
    await runAiAnalysis(evidence(), config, { signal: controller().signal, onProgress: () => {} });
    assert.equal(calls, 2);
    await assert.rejects(runAiAnalysis(evidence(), { ...config, provider: "local" }, { signal: controller().signal, onProgress: () => {} }), /WebGPU/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("adaptive batches preserve every selected paper while respecting local and API count limits", () => {
  const data = evidence(45);
  const before = JSON.stringify(data);
  const local = aiEvidenceBatches(data, true);
  const cloud = aiEvidenceBatches(data, false);
  assert.ok(local.every(batch => batch.length >= 1 && batch.length <= 6));
  assert.deepEqual(cloud.map(batch => batch.length), [40, 5]);
  assert.deepEqual(local.flat(), data.papers);
  assert.deepEqual(cloud.flat(), data.papers);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(aiEvidenceBatches({ ...data, papers: [] }, true), []);
});

test("Chinese source text shrinks local batches and retains full paper evidence without silent truncation", () => {
  const data = prepareAiEvidence(Array.from({ length: 8 }, (_, index) => ({
    ...paper(`chinese-${index}`), abstract: "临床研究证据".repeat(150),
  })), { ...spec, locale: "zh" }, 48, new Date("2026-10-14T04:00:00Z"));
  const local = aiEvidenceBatches(data, true);
  assert.deepEqual(local.map(batch => batch.length), Array.from({ length: 8 }, () => 1));
  assert.deepEqual(local.flat(), data.papers);
  assert.equal(aiEvidenceBatches(data, false).length, 1);
  assert.equal(data.papers[0].abstract.length, 900);
});

test("an oversized independent question rejects local batching but remains usable with API batching", () => {
  const data = prepareAiEvidence([paper("question")], {
    ...spec, mode: "interest", question: "研究问题".repeat(450),
  }, 48, new Date("2026-10-14T04:00:00Z"));
  assert.throws(() => aiEvidenceBatches(data, true), /exceeds the local model context/);
  assert.deepEqual(aiEvidenceBatches(data, false).flat(), data.papers);
});

test("context validation precedes local model initialization or download", async () => {
  const data = prepareAiEvidence([paper("question")], {
    ...spec, mode: "interest", question: "研究问题".repeat(450),
  }, 48, new Date("2026-10-14T04:00:00Z"));
  const progress: string[] = [];
  await assert.rejects(runAiAnalysis(data, { ...config, provider: "local" }, {
    signal: controller().signal, onProgress: message => progress.push(message),
  }), /exceeds the local model context/);
  assert.deepEqual(progress, []);
});

test("three evidence batches synthesize pairwise and carry observations with only their cited paper IDs", async () => {
  const originalFetch = globalThis.fetch;
  const data = prepareAiEvidence(Array.from({ length: 81 }, (_, index) => paper(`many-${index}`)), spec, 100, new Date("2026-10-14T04:00:00Z"));
  let paperCalls = 0, synthesisCalls = 0;
  const originalCitations: string[] = [];
  try {
    globalThis.fetch = fetchMock((_input, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.messages.find((item: { role: string }) => item.role === "user").content);
      if (input.papers) {
        paperCalls++;
        assert.equal(input.coverage.sampled, true);
        originalCitations.push(input.papers[0].id);
        return complete(JSON.stringify(report([input.papers[0].id])));
      }
      synthesisCalls++;
      assert.equal(input.reports.length, 2);
      const ids = input.reports.flatMap((item: { findings: { paperIds: string[] }[] }) => item.findings.flatMap(finding => finding.paperIds));
      for (const item of input.reports) for (const finding of item.findings) {
        assert.deepEqual(Object.keys(finding).sort(), ["kind", "observation", "paperIds", "title"]);
        assert.ok(finding.observation.length <= 120);
      }
      return complete(JSON.stringify(report([...new Set<string>(ids)])));
    });
    const result = await runAiAnalysis(data, config, { signal: controller().signal, onProgress: () => {} });
    assert.equal(paperCalls, 3);
    assert.equal(synthesisCalls, 2);
    assert.deepEqual(new Set(result.report.findings[0].paperIds), new Set(originalCitations));
  } finally { globalThis.fetch = originalFetch; }
});

test("long Chinese observation pairs compress for local synthesis without changing the question or citation IDs", () => {
  const question = "针对罕见疾病评估跨中心泛化与数据适配。".repeat(5);
  const data = prepareAiEvidence([paper("source")], { ...spec, mode: "interest", question, locale: "zh" }, 48, new Date("2026-10-14T04:00:00Z"));
  const reports: AiReport[] = Array.from({ length: 2 }, (_, batch) => ({
    summary: "研究总结".repeat(100),
    findings: Array.from({ length: 3 }, (_, index) => ({
      title: "研究方向".repeat(25), kind: "direction" as const, observation: "公开论文观察".repeat(50),
      forecast: "尚待验证的未来预测", alternative: "不同的解释", nextStep: "设计验证实验",
      paperIds: Array.from({ length: 4 }, (_, id) => `doi:10.1000/${batch}-${index}-${id}`),
    })),
    limitations: ["样本并不代表全部研究方向和任务。".repeat(10)],
  }));
  const before = JSON.stringify(reports);
  const synthesis = buildAiSynthesis(data, reports, true);
  const user = JSON.parse(synthesis.messages.find(message => message.role === "user")!.content);
  const expectedIds = reports.flatMap(item => item.findings.flatMap(finding => finding.paperIds));
  assert.equal(user.question, question);
  assert.equal(user.reports.length, 2);
  assert.deepEqual(new Set(synthesis.ids), new Set(expectedIds));
  const includedIds = user.reports.flatMap((item: { findings: { paperIds: string[] }[] }) => item.findings.flatMap(finding => finding.paperIds));
  assert.deepEqual(new Set(includedIds), new Set(expectedIds));
  for (const item of user.reports) for (const finding of item.findings) {
    assert.ok(finding.observation.length <= 80);
    assert.ok(finding.title.length <= 40);
    assert.equal(finding.forecast, undefined);
  }
  assert.match(synthesis.messages[0].content, /details and findings may be omitted/);
  assert.equal(JSON.stringify(reports), before);
});

test("synthesis never silently truncates an oversized independent question", () => {
  const question = "研究问题".repeat(450);
  const data = prepareAiEvidence([paper("source")], { ...spec, mode: "interest", question }, 48, new Date("2026-10-14T04:00:00Z"));
  const reports = [report(["source"]), report(["source"])];
  assert.throws(() => buildAiSynthesis(data, reports, true), /question is too long for local synthesis/);
  const cloud = buildAiSynthesis(data, reports, false);
  assert.equal(JSON.parse(cloud.messages.find(message => message.role === "user")!.content).question, question);
  assert.deepEqual(cloud.ids, ["source"]);
});

test("the official empty Qwen3 non-thinking prefix is removed before strict JSON report validation", () => {
  const value = report(["paper-0"]);
  const json = JSON.stringify(value);
  const raw = "<think>\n\n</think>\n\n" + json;
  assert.equal(normalizeLocalContent(raw), json);
  assert.deepEqual(parseAiReport(normalizeLocalContent(raw), ["paper-0"]), value);
  assert.equal(normalizeLocalContent(json), json);
  assert.equal(normalizeLocalContent(" \n<think>\n\n</think>\n\n" + json), json);
});

test("nonempty reasoning and arbitrary leading or internal markup are not silently stripped", () => {
  const json = JSON.stringify(report(["paper-0"]));
  const invalid = [
    "<think>Private reasoning text</think>\n" + json,
    "<think>\nReasoning\n</think>\n" + json,
    "The answer is:\n" + json,
    "Leading text <think>\n\n</think>\n" + json,
    json + "\n<think>\n\n</think>",
    json.replace('"findings":', '"findings":<think></think>'),
  ];
  for (const raw of invalid) {
    assert.equal(normalizeLocalContent(raw), raw);
    assert.throws(() => parseAiReport(normalizeLocalContent(raw), ["paper-0"]), /not valid report JSON/);
  }
  const repeated = "<think>\n\n</think>\n\n<think>\n\n</think>\n\n" + json;
  assert.throws(() => parseAiReport(normalizeLocalContent(repeated), ["paper-0"]), /not valid report JSON/);
});

test("literal think tags inside valid JSON strings remain source text rather than transport prefixes", () => {
  const value = report(["paper-0"]);
  value.summary = "The literal string <think></think> occurs in this text.";
  const raw = JSON.stringify(value);
  assert.equal(normalizeLocalContent(raw), raw);
  assert.deepEqual(parseAiReport(normalizeLocalContent(raw), ["paper-0"]), value);
});

test("cloud responses retain their original content and do not receive local-prefix repair", async () => {
  const raw = "<think>\n\n</think>\n\n" + JSON.stringify(report(["paper-0"]));
  const response = await callOpenRouter(messages, config, controller().signal, "en", fetchMock(() => complete(raw)));
  assert.equal(response.content, raw);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetchMock(() => complete(raw));
    await assert.rejects(runAiAnalysis(evidence(), config, { signal: controller().signal, onProgress: () => {} }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /paper-citation validation/);
      assert.match(error.message, /output format is invalid/);
      assert.ok(!error.message.includes("<think>"));
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
