import { parseResearchSignalsData, SIGNALS_MAX_BYTES, type ResearchSignalsData } from "./research-signals";

export class ResearchSignalsLoadError extends Error {
  constructor(public readonly kind: "request" | "format") {
    super(kind === "format" ? "The research signal snapshot has an unsupported format." : "The research signal snapshot could not be loaded.");
    this.name = "ResearchSignalsLoadError";
  }
}

/** Fetch independently of the paper snapshot so one source cannot block another. */
export async function fetchResearchSignals(
  signal: AbortSignal,
  baseUrl = "/research-monitor/",
  fetcher: typeof fetch = fetch,
): Promise<ResearchSignalsData> {
  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/?$/, "/")}data/research-signals.json`, {
      signal, cache: "no-cache", credentials: "omit",
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new ResearchSignalsLoadError("request");
  }
  if (!response.ok) throw new ResearchSignalsLoadError("request");
  try {
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > SIGNALS_MAX_BYTES) throw new Error("Snapshot too large");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > SIGNALS_MAX_BYTES) throw new Error("Snapshot too large");
    const value: unknown = JSON.parse(text);
    return parseResearchSignalsData(value);
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new ResearchSignalsLoadError("format");
  }
}
