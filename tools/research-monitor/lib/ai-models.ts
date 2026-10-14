// Model files are fetched only after an explicit analysis request by ai-client.
// Sizes are approximate model resources, excluding the WebLLM runtime.
export const LOCAL_AI_MODELS = [
  { id: "Qwen3-0.6B-q4f16_1-MLC", name: "Qwen3-0.6B", downloadLabel: "350 MB", tierZh: "轻量试用", tierEn: "Lightweight trial" },
  { id: "Qwen3-1.7B-q4f16_1-MLC", name: "Qwen3-1.7B", downloadLabel: "1 GB", tierZh: "均衡", tierEn: "Balanced" },
  { id: "Qwen3-4B-q4f16_1-MLC", name: "Qwen3-4B", downloadLabel: "2.3 GB", tierZh: "较大模型", tierEn: "Larger model" },
] as const;

export function getLocalAiModel(id: string) {
  return LOCAL_AI_MODELS.find(model => model.id === id) ?? LOCAL_AI_MODELS[1];
}

/** A syntactic guard; requests also enforce a zero-price provider ceiling. */
export function isFreeApiModel(id: string) {
  return id === "openrouter/free" || id.trim() === id && /^[\w.-]+\/[\w.-]+:free$/.test(id);
}

export function aiSampleLimit(profile: "quick" | "expanded", provider: "local" | "openrouter") {
  return profile === "quick" ? (provider === "local" ? 6 : 12) : (provider === "local" ? 24 : 80);
}

export type FreeAiModel = { id: string; name: string; contextLength: number };
const MODEL_CATALOG_URL = "https://openrouter.ai/api/v1/models";
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function zeroPrice(value: unknown) {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number(value) === 0;
}

/** The public catalog is untrusted data. Only compatible, explicitly free text models qualify. */
export function parseFreeAiModels(value: unknown): FreeAiModel[] {
  const data = record(value)?.data;
  if (!Array.isArray(data)) throw new Error("Invalid model catalog");
  const models = new Map<string, FreeAiModel>();
  for (const item of data) {
    const model = record(item);
    if (!model || typeof model.id !== "string" || model.id.length > 200 || model.id === "openrouter/free" || !isFreeApiModel(model.id)) continue;
    const pricing = record(model.pricing);
    if (!pricing || !zeroPrice(pricing.prompt) || !zeroPrice(pricing.completion) || pricing.request !== undefined && !zeroPrice(pricing.request)) continue;
    const architecture = record(model.architecture);
    if (!Array.isArray(architecture?.input_modalities) || !architecture.input_modalities.includes("text") || !Array.isArray(architecture.output_modalities) || !architecture.output_modalities.includes("text")) continue;
    if (!Array.isArray(model.supported_parameters) || !model.supported_parameters.includes("response_format")) continue;
    if (typeof model.context_length !== "number" || !Number.isFinite(model.context_length) || model.context_length < 32768) continue;
    const provider = record(model.top_provider);
    if (typeof provider?.context_length === "number" && provider.context_length < 32768 || typeof provider?.max_completion_tokens === "number" && provider.max_completion_tokens < 2600) continue;
    if (typeof model.name !== "string" || !model.name.trim() || model.name.length > 200) continue;
    models.set(model.id, { id: model.id, name: model.name.trim(), contextLength: model.context_length });
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** No key, paper content or user question is transmitted when loading the catalog. */
export async function fetchFreeAiModels(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<FreeAiModel[]> {
  if (signal?.aborted) throw new DOMException("Catalog request cancelled", "AbortError");
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(MODEL_CATALOG_URL, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    if (!response.ok) throw new Error("Catalog unavailable");
    const models = parseFreeAiModels(await response.json());
    if (signal?.aborted) throw new DOMException("Catalog request cancelled", "AbortError");
    return models;
  } catch {
    if (signal?.aborted) throw new DOMException("Catalog request cancelled", "AbortError");
    throw new Error("Free model catalog unavailable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}
