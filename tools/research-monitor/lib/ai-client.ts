import { buildAiMessages, parseAiReport, type AiEvidence, type AiReport } from "./ai-evidence";
import { getLocalAiModel, isFreeApiModel } from "./ai-models";
import type { WebWorkerMLCEngine } from "@mlc-ai/web-llm";

export const LOCAL_AI_MODEL = "Qwen3-1.7B-q4f16_1-MLC";
export const FREE_API_MODEL = "openrouter/free";
export type AiSettings = {
  provider: "local" | "openrouter";
  apiKey: string;
  model: string;
  paid: boolean;
  localModel: string;
  freeModel: string;
};
export type AiAnalysisResult = { report: AiReport; model: string; generatedAt: string };
type RunOptions = { signal: AbortSignal; onProgress: (message: string) => void };
type Message = { role: "system" | "user"; content: string };

// Credentials and reports are never written to disk, URLs, localStorage or analytics.
let settings: AiSettings = {
  provider: "local",
  apiKey: "",
  model: FREE_API_MODEL,
  paid: false,
  localModel: LOCAL_AI_MODEL,
  freeModel: FREE_API_MODEL,
};
const listeners = new Set<() => void>();
export const getAiSettings = () => settings;
export function subscribeAiSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function updateAiSettings(patch: Partial<AiSettings>) {
  const next = { ...settings, ...patch };
  next.localModel = getLocalAiModel(next.localModel).id;
  if (!next.paid) next.model = FREE_API_MODEL;
  if (Object.keys(next).every((key) => next[key as keyof AiSettings] === settings[key as keyof AiSettings]))
    return;
  settings = next;
  listeners.forEach((listener) => listener());
}
export function aiModelLabel(value: AiSettings) {
  return value.provider === "local"
    ? `${getLocalAiModel(value.localModel).name} · WebLLM`
    : value.paid
      ? value.model || "OpenRouter"
      : `OpenRouter · ${value.freeModel || FREE_API_MODEL}`;
}

export const AI_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings", "limitations"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 500 },
    findings: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "kind", "observation", "forecast", "alternative", "nextStep", "paperIds"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 100 },
          kind: {
            type: "string",
            enum: ["direction", "task", "method", "data", "application", "opportunity"],
          },
          observation: { type: "string", minLength: 1, maxLength: 320 },
          forecast: { type: "string", minLength: 1, maxLength: 280 },
          alternative: { type: "string", minLength: 1, maxLength: 180 },
          nextStep: { type: "string", minLength: 1, maxLength: 260 },
          paperIds: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
        },
      },
    },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 200 },
    },
  },
};

// WebLLM 0.2.86 prepends this empty block for Qwen3's non-thinking mode.
// Strip only its empty transport prefix; arbitrary reasoning/text remains invalid JSON.
export function normalizeLocalContent(content: string) {
  return content.replace(/^\s*<think>\s*<\/think>\s*/, "");
}

function cancelled() {
  return new DOMException("Analysis cancelled", "AbortError");
}
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw cancelled();
}
function text(zh: string, en: string, locale: string) {
  return locale === "en" ? en : zh;
}
let localEngine: WebWorkerMLCEngine | null = null;
let localEngineModel: string | null = null;
let localWorker: Worker | null = null;
let busy = false;

function terminateLocal() {
  localWorker?.terminate();
  localWorker = null;
  localEngine = null;
  localEngineModel = null;
}

/** Also settles a terminated worker's promise and releases every listener/timer. */
async function interruptible<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  milliseconds: number,
  onStop: () => void,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        abort = () => {
          onStop();
          reject(cancelled());
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
          onStop();
          reject(new Error(timeoutMessage));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function loadLocal(modelId: string, options: RunOptions, locale: string) {
  checkAbort(options.signal);
  const model = getLocalAiModel(modelId);
  if (localEngine && localEngineModel === model.id) return localEngine;
  // Keep only one model resident on the GPU; downloaded artifacts remain cached.
  if (localEngine || localWorker) terminateLocal();
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    throw new Error(
      text(
        "此浏览器不支持 WebGPU。可切换免费云端模型并填写自己的 API Key，或使用支持 WebGPU 的桌面浏览器。",
        "This browser does not support WebGPU. Select a free cloud model with your own API key, or use a compatible desktop browser.",
        locale,
      ),
    );
  }
  options.onProgress(
    text(
      `正在准备 ${model.name}；首次模型资源约 ${model.downloadLabel}，请保持页面打开。`,
      `Preparing ${model.name}; first-use model assets are approximately ${model.downloadLabel}. Keep this page open.`,
      locale,
    ),
  );
  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  checkAbort(options.signal);
  const worker = new Worker(new URL("./ai-worker.ts", import.meta.url), { type: "module" });
  localWorker = worker;
  let workerFailed: (event: ErrorEvent) => void = () => {};
  try {
    const loading = new Promise<WebWorkerMLCEngine>((resolve, reject) => {
      workerFailed = () => {
        worker.terminate();
        reject(new Error("Local AI worker failed"));
      };
      worker.addEventListener("error", workerFailed, { once: true });
      CreateWebWorkerMLCEngine(
        worker,
        model.id,
        {
          initProgressCallback: (progress) => {
            if (!options.signal.aborted)
              options.onProgress(
                text(
                  `加载 ${model.name}：${Math.round(progress.progress * 100)}% · 首次加载可能需要几分钟。`,
                  `Loading ${model.name}: ${Math.round(progress.progress * 100)}% · The first load may take a few minutes.`,
                  locale,
                ),
              );
          },
        },
        { context_window_size: 8192 },
      ).then(resolve, reject);
    });
    const engine = await interruptible(
      loading,
      options.signal,
      10 * 60_000,
      terminateLocal,
      text("模型加载超时，请重试。", "Model loading timed out; please retry.", locale),
    );
    checkAbort(options.signal);
    localEngine = engine;
    localEngineModel = model.id;
    return engine;
  } catch (error) {
    terminateLocal();
    if (options.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw cancelled();
    throw new Error(
      text(
        `${model.name} 未能加载。请检查下载网络、WebGPU 与设备内存，或切换免费云端模型并填写自己的 API Key。`,
        `${model.name} could not load. Check download access, WebGPU and device memory, or select a free cloud model with your own API key.`,
        locale,
      ),
    );
  } finally {
    worker.removeEventListener("error", workerFailed);
  }
}

/** The endpoint is fixed: personal credentials can never be redirected by model output. */
export async function callOpenRouter(
  messages: Message[],
  config: AiSettings,
  signal: AbortSignal,
  locale = "zh",
  fetcher: typeof fetch = fetch,
): Promise<{ content: string; model: string }> {
  checkAbort(signal);
  if (!config.apiKey.trim())
    throw new Error(
      text("请先输入你自己的 OpenRouter API Key。", "Enter your own OpenRouter API key first.", locale),
    );
  const model = (config.paid ? config.model : config.freeModel)?.trim() ?? "";
  if (!config.paid && !isFreeApiModel(model))
    throw new Error(
      text(
        "免费模式只接受 openrouter/free 或以 :free 结尾的有效模型 ID，不会改用付费模型。",
        "Free mode requires openrouter/free or a valid model ID ending in :free. No paid model will be used.",
        locale,
      ),
    );
  if (!/^[\w.-]+\/[\w.:-]+$/.test(model))
    throw new Error(
      text(
        "请填写有效的 OpenRouter 模型 ID，例如 provider/model。",
        "Enter a valid OpenRouter model ID, such as provider/model.",
        locale,
      ),
    );
  const timeout = new AbortController();
  const relay = () => timeout.abort();
  signal.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => timeout.abort(), 150_000);
  try {
    const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: timeout.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey.trim()}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 2600,
        response_format: { type: "json_object" },
        provider: {
          data_collection: "deny",
          ...(!config.paid ? { max_price: { prompt: 0, completion: 0 } } : {}),
        },
      }),
    });
    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? text("API Key 无效或没有访问权限。", "The API key is invalid or does not have access.", locale)
          : response.status === 429
            ? text(
                "免费额度或请求频率已达上限，请稍后再试。",
                "The request quota or rate limit has been reached. Try again later.",
                locale,
              )
            : response.status === 402
              ? text(
                  "此账户额度不足，请检查 OpenRouter 账户。",
                  "The account has insufficient credits; check OpenRouter.",
                  locale,
                )
              : text(
                  "该模型或符合数据政策的服务暂时不可用，请稍后重试。",
                  "The model or a provider matching the data policy is unavailable. Try again later.",
                  locale,
                );
      throw new Error(`${hint} (HTTP ${response.status})`);
    }
    let value: any;
    try {
      value = await response.json();
    } catch {
      throw new Error(
        text(
          "API 返回了无效响应，本次结果未被接受。",
          "The API returned an invalid response; this result was not accepted.",
          locale,
        ),
      );
    }
    checkAbort(signal);
    const choice = value.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string")
      throw new Error(
        text(
          "模型未返回完整分析，未保存截断结果。请缩小日期范围后重试。",
          "The model did not return a complete analysis. Truncated output was not saved; narrow the date range and retry.",
          locale,
        ),
      );
    if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 200)
      throw new Error(
        text(
          "服务没有报告有效的实际模型名称，本次结果未被接受。",
          "The service did not identify a valid actual model; this result was not accepted.",
          locale,
        ),
      );
    return { content: choice.message.content, model: value.model };
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (timeout.signal.aborted)
      throw new Error(
        text("API 请求超时，请稍后重试。", "The API request timed out. Try again later.", locale),
      );
    if (error instanceof TypeError)
      throw new Error(
        text(
          "无法连接 OpenRouter，请检查网络或浏览器连接限制。",
          "Could not connect to OpenRouter. Check network access or browser connection restrictions.",
          locale,
        ),
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", relay);
  }
}

function concise(messages: Message[]): Message[] {
  return messages.map((message) =>
    message.role === "system"
      ? {
          ...message,
          content:
            message.content +
            "\nBe concise: at most 3 findings; each text field under 280 characters; summary under 500 characters. No markdown. /no_think",
        }
      : message,
  );
}

// Conservative size guard, followed by bounded model context. It is not a tokenizer.
function estimatedTokens(messages: Message[]) {
  return messages.reduce(
    (sum, message) =>
      sum +
      [...message.content].reduce((count, character) => count + (character.charCodeAt(0) < 128 ? 0.5 : 3), 0),
    200,
  );
}
export function aiEvidenceBatches(evidence: AiEvidence, local: boolean): AiEvidence["papers"][] {
  const batches: AiEvidence["papers"][] = [];
  const inputBudget = local ? 5200 : 28000;
  let current: AiEvidence["papers"] = [];
  for (const paper of evidence.papers) {
    const candidate = [...current, paper];
    if (
      current.length &&
      (candidate.length > (local ? 6 : 40) ||
        estimatedTokens(concise(buildAiMessages({ ...evidence, papers: candidate }))) > inputBudget)
    ) {
      batches.push(current);
      current = [paper];
    } else current = candidate;
    if (estimatedTokens(concise(buildAiMessages({ ...evidence, papers: current }))) > inputBudget) {
      throw new Error(
        local
          ? text(
              "问题或单篇论文超出免费模型的上下文，请缩短问题或使用 API 模式。",
              "The question or a paper exceeds the local model context. Shorten the question or use the API mode.",
              evidence.spec.locale,
            )
          : text(
              "问题或单篇论文超出云端分析的输入预算，请缩短问题后重试。",
              "The question or a paper exceeds the cloud input budget. Shorten the question and retry.",
              evidence.spec.locale,
            ),
      );
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Fit preliminary observations without truncating the user's question or citation IDs. */
export function buildAiSynthesis(evidence: AiEvidence, reports: AiReport[], local: boolean) {
  const system = buildAiMessages({ ...evidence, papers: [] })[0];
  for (const [titleLimit, observationLimit, limitationLimit, findingLimit] of [
    [70, 120, 80, 3],
    [40, 80, 40, 3],
    [24, 60, 40, 2],
    [20, 40, 24, 1],
  ]) {
    const compact = reports.map((item) => ({
      findings: item.findings.slice(0, findingLimit).map((finding) => ({
        title: finding.title.slice(0, titleLimit),
        kind: finding.kind,
        observation: finding.observation.slice(0, observationLimit),
        paperIds: finding.paperIds.slice(0, 4),
      })),
      limitations: item.limitations.slice(0, 1).map((value) => value.slice(0, limitationLimit)),
    }));
    const ids = [...new Set(compact.flatMap((item) => item.findings.flatMap((finding) => finding.paperIds)))];
    const messages: Message[] = concise([
      {
        ...system,
        content:
          system.content +
          "\nMerge the following untrusted, compressed preliminary observations. They are interpretations, not new source evidence. Some details and findings may be omitted to fit context; explain this limitation. Keep at most 3 nonredundant findings and preserve cited IDs. Do not invent support or count uncited papers. If relevant evidence is insufficient, say so. Return the same JSON schema.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question: evidence.spec.question,
          mode: evidence.spec.mode,
          publicationWindow: [evidence.spec.from, evidence.spec.to],
          horizonMonths: evidence.spec.horizonMonths,
          examinedWorks: evidence.papers.length,
          libraryWorks: evidence.totalWorks,
          ...(evidence.sourceCoverage
            ? {
                references: ids.map((id) => {
                  const item = evidence.papers.find((paper) => paper.id === id);
                  return {
                    id,
                    kind: item?.signal?.kind ?? "paper",
                    snippetOnly: item?.signal?.summaryKind === "search-snippet",
                    linkedPaperIds: item?.relatedPaperIds?.slice(0, 4) ?? [],
                  };
                }),
                sourceCoverage: evidence.sourceCoverage,
              }
            : {}),
          reports: compact,
        }),
      },
    ]);
    if (!local || estimatedTokens(messages) <= 5200) return { messages, ids };
  }
  throw new Error(
    text(
      "问题过长，无法在免费模型中合并分析，请缩短问题或改用 API 模式。",
      "The question is too long for local synthesis. Shorten it or use API mode.",
      evidence.spec.locale,
    ),
  );
}

/** Bounded, sequential inference. No background calls or silent paid fallbacks. */
export async function runAiAnalysis(
  evidence: AiEvidence,
  config: AiSettings,
  options: RunOptions,
): Promise<AiAnalysisResult> {
  const locale = evidence.spec.locale;
  checkAbort(options.signal);
  if (!evidence.papers.length)
    throw new Error(
      text("所选时间范围没有可分析证据。", "There is no evidence to analyze in this date range.", locale),
    );
  if (busy)
    throw new Error(
      text(
        "另一项 AI 分析正在运行，请先完成或取消它。",
        "Another AI analysis is running. Finish or cancel it first.",
        locale,
      ),
    );
  busy = true;
  const models = new Set<string>();
  const abortLocal = () => {
    if (config.provider === "local") terminateLocal();
  };
  options.signal.addEventListener("abort", abortLocal, { once: true });
  try {
    const batches = aiEvidenceBatches(evidence, config.provider === "local");
    const localModel = getLocalAiModel(config.localModel);
    const engine = config.provider === "local" ? await loadLocal(localModel.id, options, locale) : null;
    const parse = (raw: string, ids: string[]) => {
      try {
        return parseAiReport(raw, ids);
      } catch (error) {
        // Only static validation codes/paths are exposed, never rejected text or values.
        const issues = (error as { issues?: { code: string; path: (string | number)[] }[] })?.issues;
        const duplicate = issues?.some(
          (issue) => issue.code === "custom" && issue.path.at(-1) === "paperIds",
        );
        const detail =
          error instanceof Error && error.message === "The AI response contains unfilled template text"
            ? text(
                "模型只返回了模板内容；请换用较大模型或免费云端重试。",
                "The model returned unfilled template text; retry with a larger model or a free cloud model.",
                locale,
              )
            : duplicate
              ? text("存在重复的论文引用。", "Duplicate paper citations.", locale)
              : issues?.some((issue) => issue.code === "too_small")
                ? text("缺少必要内容。", "Required content is missing.", locale)
                : issues?.some((issue) => issue.code === "too_big")
                  ? text("输出超出篇幅限制。", "The output exceeds length limits.", locale)
                  : error instanceof Error &&
                      error.message === "The AI response cites a paper outside the supplied evidence"
                    ? text("引用了输入之外的论文。", "A cited paper was not supplied.", locale)
                    : text("输出格式不符合要求。", "The output format is invalid.", locale);
        throw new Error(
          text(
            "模型输出未通过结构或论文引用校验，本次结果未被接受。",
            "The response failed report structure or paper-citation validation and was not accepted.",
            locale,
          ) + detail,
        );
      }
    };
    const infer = async (messages: Message[], allowedIds: string[]) => {
      checkAbort(options.signal);
      if (!engine) {
        const reply = await callOpenRouter(messages, config, options.signal, locale);
        models.add(reply.model);
        return reply.content;
      }
      if (estimatedTokens(messages) > 5200)
        throw new Error(
          text(
            "合并内容超出免费模型上下文，请缩小范围或改用 API 模式。",
            "The synthesis exceeds the local model context. Narrow the scope or use API mode.",
            locale,
          ),
        );
      const schema = {
        ...AI_REPORT_SCHEMA,
        properties: {
          ...AI_REPORT_SCHEMA.properties,
          findings: {
            ...AI_REPORT_SCHEMA.properties.findings,
            items: {
              ...AI_REPORT_SCHEMA.properties.findings.items,
              properties: {
                ...AI_REPORT_SCHEMA.properties.findings.items.properties,
                paperIds: {
                  ...AI_REPORT_SCHEMA.properties.findings.items.properties.paperIds,
                  items: { type: "string", enum: allowedIds },
                },
              },
            },
          },
        },
      };
      const reply = await interruptible(
        engine.chat.completions.create({
          messages,
          temperature: 0.2,
          max_tokens: 2200,
          response_format: { type: "json_object", schema: JSON.stringify(schema) },
          ...(localModel.id.startsWith("Qwen3-") ? { extra_body: { enable_thinking: false } } : {}),
        }),
        options.signal,
        5 * 60_000,
        terminateLocal,
        text(
          "本批推理超时，请缩小范围或改用 API 模式。",
          "This batch timed out. Narrow the scope or use API mode.",
          locale,
        ),
      );
      checkAbort(options.signal);
      const choice = reply.choices[0];
      if (choice?.finish_reason !== "stop" || !choice.message.content)
        throw new Error(
          text(
            "本地模型没有生成完整结果，请缩小文献范围再试。",
            "The local model did not produce a complete result. Narrow the evidence window and retry.",
            locale,
          ),
        );
      models.add(localModel.id);
      return localModel.id.startsWith("Qwen3-")
        ? normalizeLocalContent(choice.message.content)
        : choice.message.content;
    };
    const reports: AiReport[] = [];
    for (let index = 0; index < batches.length; index++) {
      checkAbort(options.signal);
      options.onProgress(
        evidence.sourceCoverage
          ? text(
              `AI 正在阅读第 ${index + 1} / ${batches.length} 批公开证据…`,
              `AI is reading evidence batch ${index + 1} of ${batches.length}…`,
              locale,
            )
          : text(
              `AI 正在阅读第 ${index + 1} / ${batches.length} 批论文…`,
              `AI is reading paper batch ${index + 1} of ${batches.length}…`,
              locale,
            ),
      );
      const papers = batches[index];
      const messages = concise(
        buildAiMessages({
          ...evidence,
          papers,
          sampled: evidence.sampled || papers.length < evidence.totalWorks,
        }),
      );
      const raw = await infer(
        messages,
        papers.map((paper) => paper.id),
      );
      reports.push(
        parse(
          raw,
          papers.map((paper) => paper.id),
        ),
      );
    }
    let stage = reports;
    while (stage.length > 1) {
      options.onProgress(
        text("AI 正在合并各批证据并形成判断…", "AI is synthesizing the batches into an assessment…", locale),
      );
      const next: AiReport[] = [];
      for (let index = 0; index < stage.length; index += 2) {
        if (index + 1 === stage.length) {
          next.push(stage[index]);
          continue;
        }
        const { messages: synthesis, ids } = buildAiSynthesis(
          evidence,
          stage.slice(index, index + 2),
          !!engine,
        );
        if (!ids.length) {
          next.push(stage[index]);
          continue;
        }
        next.push(parse(await infer(synthesis, ids), ids));
      }
      stage = next;
    }
    checkAbort(options.signal);
    return { report: stage[0], model: [...models].join(" · "), generatedAt: new Date().toISOString() };
  } finally {
    busy = false;
    options.signal.removeEventListener("abort", abortLocal);
  }
}
