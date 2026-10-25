export type FetchText = (url: string) => Promise<{ body: string; httpStatus: number; attempts: number }>;

export const ARXIV_REQUEST_INTERVAL_MS = 3100;
const ARXIV_TIMEOUT_MS = 60000;
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_RETRY_WAIT_MS = 60000;
const ARXIV_HOST = "export.arxiv.org";

export class SourceRequestError extends Error {
  constructor(
    message: string,
    public httpStatus: number | undefined,
    public attempts: number,
  ) {
    super(message);
    this.name = "SourceRequestError";
  }
}

type OfficialResponse = Pick<Response, "status" | "ok" | "url" | "headers" | "text"> & {
  body?: Pick<ReadableStream, "cancel"> | null;
};
type RequestDependencies = {
  fetch?: (url: string, init: RequestInit) => Promise<OfficialResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeout?: (milliseconds: number) => AbortSignal;
};

/** Only official HTTPS hosts are accepted; fetch never follows redirects. */
function officialUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["www.ebi.ac.uk", ARXIV_HOST, "api.biorxiv.org", "api.medrxiv.org"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function retryAfterMilliseconds(value: string | null, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  const delay = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

/** The injected dependencies keep retry/timeout tests deterministic and offline. */
export function createOfficialTextFetcher(dependencies: RequestDependencies = {}): FetchText {
  const request = dependencies.fetch ?? ((url, init) => fetch(url, init));
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const timeout = dependencies.timeout ?? ((ms) => AbortSignal.timeout(ms));
  const cooldowns = new Map<string, { until: number; status: number }>();
  let arxivLastStarted: number | undefined;
  let arxivQueue: Promise<unknown> = Promise.resolve();

  const execute: FetchText = async (url) => {
    const hostname = new URL(url).hostname;
    const isArxiv = hostname === ARXIV_HOST;
    const timeoutMs = isArxiv ? ARXIV_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const cooldown = cooldowns.get(hostname);
    if (cooldown && cooldown.until > now()) {
      throw new SourceRequestError(
        `来源暂处冷却期，${new Date(cooldown.until).toISOString()} 后可重试；本次未再次发送请求`,
        cooldown.status,
        0,
      );
    }
    cooldowns.delete(hostname);
    for (let attempt = 1; attempt <= 3; attempt++) {
      let status: number | undefined;
      let retryMs = (isArxiv ? 5000 : 1500) * 2 ** (attempt - 1);
      let signal: AbortSignal | undefined;
      try {
        if (isArxiv) {
          const remaining =
            arxivLastStarted === undefined ? 0 : ARXIV_REQUEST_INTERVAL_MS - (now() - arxivLastStarted);
          if (remaining > 0) await sleep(remaining);
          arxivLastStarted = now();
        }
        signal = timeout(timeoutMs);
        const response = await request(url, {
          headers: {
            "User-Agent": "MedicalImageResearchMonitor/2.0 (GitHub Pages public metadata collector)",
            Accept: "application/json, application/atom+xml, application/xml",
          },
          signal,
          redirect: "error",
        });
        status = response.status;
        if (!response.ok || (response.url && !officialUrl(response.url))) {
          // Release error responses before retrying, rather than leaving a
          // body/connection open while another arXiv request starts.
          try {
            await response.body?.cancel();
          } catch {
            /* The HTTP status still describes this failure. */
          }
        }
        if (response.url && !officialUrl(response.url))
          throw new SourceRequestError("来源重定向到非官方地址", status, attempt);
        if (!response.ok) {
          const message = `来源返回 HTTP ${status}`;
          if (status !== 429 && status < 500) throw new SourceRequestError(message, status, attempt);
          const requestedWait = retryAfterMilliseconds(response.headers.get("retry-after"), now());
          if (requestedWait !== undefined) retryMs = Math.max(retryMs, requestedWait);
          if (retryMs > MAX_RETRY_WAIT_MS || (attempt === 3 && status === 429)) {
            const wait = Math.max(retryMs, status === 429 ? MAX_RETRY_WAIT_MS : 0);
            const until = now() + wait;
            cooldowns.set(hostname, { until, status });
            throw new SourceRequestError(
              `${message}；来源要求或需要冷却至 ${new Date(until).toISOString()}，已暂停后续同源请求（已尝试 ${attempt} 次）`,
              status,
              attempt,
            );
          }
          // A final 5xx response can also ask later queries to wait.
          if (attempt === 3 && requestedWait) cooldowns.set(hostname, { until: now() + retryMs, status });
          throw new Error(message);
        }
        // The same abort signal remains active while the response body is read.
        const body = await response.text();
        signal.throwIfAborted();
        if (!body.trim()) throw new Error(`来源返回 HTTP ${status} 但响应体为空；无法判定是否有新论文`);
        return { body, httpStatus: status, attempts: attempt };
      } catch (error) {
        if (error instanceof SourceRequestError) throw error;
        const cause =
          error instanceof Error
            ? (error.cause as { code?: string; message?: string } | undefined)
            : undefined;
        const timedOut = signal?.aborted && signal.reason?.name === "TimeoutError";
        const detail = timedOut
          ? `来源请求超时（${timeoutMs / 1000} 秒，包含响应读取）`
          : (error instanceof Error ? error.message : String(error)) +
            (cause ? ` (${cause.code ?? cause.message ?? "unknown cause"})` : "");
        if (attempt === 3) throw new SourceRequestError(`${detail}（已尝试 ${attempt} 次）`, status, attempt);
        await sleep(retryMs);
      }
    }
    throw new SourceRequestError("请求失败", undefined, 3);
  };

  return (url) => {
    if (!officialUrl(url))
      return Promise.reject(new SourceRequestError("采集地址不是支持的官方 HTTPS 来源", undefined, 0));
    if (new URL(url).hostname !== ARXIV_HOST) return execute(url);
    // Keep the entire arXiv attempt, body read and retries serial, even when
    // several callers request different directions at the same time.
    const pending = arxivQueue.then(() => execute(url));
    arxivQueue = pending.catch(() => {});
    return pending;
  };
}

export const fetchOfficialText: FetchText = createOfficialTextFetcher();
