import { type AnalysisSnapshot } from "./analysis-snapshot";
import {
  ANALYSIS_TRANSPORT_MAX_BYTES,
  parseAnalysisManifestV2,
  parseAnalysisTransport,
  stableAnalysisContent,
  type AnalysisManifestV2,
} from "./analysis-transport";

export type PrefetchedAnalysisBootstrap = {
  url: string;
  promise: Promise<Response>;
  controller: AbortController;
};

export type AnalysisState = {
  data: AnalysisSnapshot | null;
  loading: boolean;
  error: boolean;
  current: boolean;
  checkedAt: string | null;
};

/** A complete, dated calculation is the publication unit; never mix source generations. */
export function createAnalysisStore(options: {
  webBaseUrl: string;
  dataBaseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  bootstrapGraceMs?: number;
  prefetchedBootstrap?: PrefetchedAnalysisBootstrap;
}) {
  let state: AnalysisState = { data: null, loading: false, error: false, current: false, checkedAt: null };
  let controller: AbortController | undefined;
  let pending: Promise<AnalysisSnapshot | null> | undefined;
  let contentSha256: string | undefined;
  let prefetched = options.prefetchedBootstrap;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<AnalysisState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const root = (value: string) => value.replace(/\/?$/, "/");
  const web = root(options.webBaseUrl),
    data = root(options.dataBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  // Also settle when an embedding fetcher ignores AbortSignal; late data is never published.
  function abortable<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new Error("Analysis request aborted"));
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  async function read(path: string, maxBytes: number, signal: AbortSignal, early?: Promise<Response>) {
    const response = await abortable(
      early ?? fetcher(path, { cache: "no-cache", credentials: "omit", signal }),
      signal,
    );
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`Analysis request failed: ${response.status}`);
    if (Number(response.headers.get("Content-Length")) > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error("Analysis response exceeds its size limit");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Analysis response has no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await abortable(reader.read(), signal);
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) throw new Error("Analysis response exceeds its size limit");
        chunks.push(next.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  function sameCalculation(snapshot: AnalysisSnapshot, manifest: AnalysisManifestV2) {
    return (
      snapshot.result.version === manifest.ruleVersion &&
      snapshot.result.asOf === manifest.asOf &&
      snapshot.sources.papers.manifestSha256 === manifest.sources.papers.manifestSha256 &&
      snapshot.sources.signals.manifestSha256 === manifest.sources.signals.manifestSha256 &&
      snapshot.sources.papers.totalStored === manifest.sources.papers.totalStored &&
      snapshot.sources.signals.totalStored === manifest.sources.signals.totalStored &&
      snapshot.sources.papers.collectedAt === manifest.sources.papers.collectedAt &&
      snapshot.sources.signals.generatedAt === manifest.sources.signals.generatedAt
    );
  }
  function noRegression(next: Pick<AnalysisManifestV2, "asOf" | "sources">) {
    return (
      !state.data ||
      (next.asOf >= state.data.result.asOf &&
        Date.parse(next.sources.papers.collectedAt) >= Date.parse(state.data.sources.papers.collectedAt) &&
        Date.parse(next.sources.signals.generatedAt) >= Date.parse(state.data.sources.signals.generatedAt))
    );
  }
  async function sha256(value: Uint8Array | string) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  async function load() {
    if (pending) return pending;
    const active = new AbortController();
    controller = active;
    const signal = active.signal;
    const timer = setTimeout(() => active.abort(), options.timeoutMs ?? 60_000);
    publish({ loading: true, error: false });
    pending = (async () => {
      // Start the tiny manifest check alongside the web copy. On the first web
      // rollout the data site may not publish this format yet; history and the
      // web calculation must remain usable in that case.
      const manifestRequest = read(`${data}data/analysis-manifest-v2.json`, 32_768, signal).then((bytes) =>
        parseAnalysisManifestV2(json(bytes)),
      );
      void manifestRequest.catch(() => {});
      const bootstrapPath = `${web}analysis-bootstrap-v2.json`;
      const bootstrapUrl =
        typeof location === "undefined" ? bootstrapPath : new URL(bootstrapPath, location.href).href;
      const early =
        prefetched?.url === bootstrapUrl && !prefetched.controller.signal.aborted ? prefetched : undefined;
      prefetched = undefined;
      const bootstrapController = early?.controller ?? new AbortController();
      const abortBootstrap = () => bootstrapController.abort();
      signal.addEventListener("abort", abortBootstrap, { once: true });
      const bootstrapSignal = AbortSignal.any([signal, bootstrapController.signal]);
      const bootstrapRequest = state.data
        ? Promise.resolve()
        : (async () => {
            try {
              const bootstrap = parseAnalysisTransport(
                json(
                  await read(bootstrapPath, ANALYSIS_TRANSPORT_MAX_BYTES, bootstrapSignal, early?.promise),
                ),
              );
              const hash = await sha256(stableAnalysisContent(bootstrap));
              if (
                controller === active &&
                !bootstrapSignal.aborted &&
                noRegression({ asOf: bootstrap.result.asOf, sources: bootstrap.sources })
              ) {
                contentSha256 = hash;
                publish({ data: bootstrap });
              }
            } catch {
              /* The data package can recover a missing or slow web copy. */
            } finally {
              signal.removeEventListener("abort", abortBootstrap);
            }
          })();
      try {
        let manifest = await manifestRequest;
        // HTML starts the compact web copy before React. Wait for that one
        // payload, then cancel a stalled transfer before trying the remote copy.
        await new Promise<void>((resolve) => {
          const grace = setTimeout(
            resolve,
            options.bootstrapGraceMs ?? Math.min(1500, (options.timeoutMs ?? 60_000) / 4),
          );
          void bootstrapRequest.finally(() => {
            clearTimeout(grace);
            resolve();
          });
        });
        bootstrapController.abort();
        for (let attempt = 0; attempt < 2; attempt++) {
          signal.throwIfAborted();
          if (!noRegression(manifest)) throw new Error("Older analysis publication");
          if (state.data && contentSha256 === manifest.contentSha256) {
            if (controller === active)
              publish({ current: true, error: false, checkedAt: new Date().toISOString() });
            bootstrapController.abort();
            return state.data;
          }
          const bytes = await read(
            `${data}data/analysis-summary-v2.json`,
            ANALYSIS_TRANSPORT_MAX_BYTES,
            signal,
          );
          const hash = await sha256(bytes);
          if (hash === manifest.snapshotSha256 && bytes.length === manifest.snapshotBytes) {
            const next = parseAnalysisTransport(json(bytes));
            const contentHash = await sha256(stableAnalysisContent(next));
            if (
              !sameCalculation(next, manifest) ||
              next.generatedAt !== manifest.generatedAt ||
              contentHash !== manifest.contentSha256
            )
              throw new Error("Analysis metadata mismatch");
            signal.throwIfAborted();
            if (!noRegression(manifest)) throw new Error("Older analysis publication");
            if (controller === active) {
              contentSha256 = contentHash;
              publish({ data: next, current: true, error: false, checkedAt: new Date().toISOString() });
            }
            bootstrapController.abort();
            return next;
          }
          // A deploy may occur between the two reads. Retry the small manifest
          // once rather than accepting an unverified or mixed-generation result.
          if (attempt === 0)
            manifest = parseAnalysisManifestV2(
              json(await read(`${data}data/analysis-manifest-v2.json`, 32_768, signal)),
            );
        }
        throw new Error("Analysis digest mismatch");
      } catch {
        await bootstrapRequest;
        if (controller === active) publish({ error: true, current: false });
        return state.data;
      }
    })().finally(() => {
      clearTimeout(timer);
      if (controller === active) {
        controller = undefined;
        pending = undefined;
        publish({ loading: false });
      }
    });
    return pending;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    cancel() {
      controller?.abort();
      controller = undefined;
      pending = undefined;
      publish({ loading: false });
    },
  };
}
