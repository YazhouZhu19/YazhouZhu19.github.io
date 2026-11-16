import {
  ANALYSIS_SNAPSHOT_MAX_BYTES,
  parseAnalysisManifest,
  parseAnalysisSnapshot,
  type AnalysisManifest,
  type AnalysisSnapshot,
} from "./analysis-snapshot";

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
}) {
  let state: AnalysisState = { data: null, loading: false, error: false, current: false, checkedAt: null };
  let controller: AbortController | undefined;
  let pending: Promise<AnalysisSnapshot | null> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<AnalysisState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const root = (value: string) => value.replace(/\/?$/, "/");
  const web = root(options.webBaseUrl),
    data = root(options.dataBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  async function read(path: string, maxBytes: number, signal: AbortSignal) {
    const response = await fetcher(path, { cache: "no-cache", credentials: "omit", signal });
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`Analysis request failed: ${response.status}`);
    if (Number(response.headers.get("Content-Length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("Analysis response exceeds its size limit");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Analysis response has no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) throw new Error("Analysis response exceeds its size limit");
        chunks.push(next.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
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
  function sameCalculation(snapshot: AnalysisSnapshot, manifest: AnalysisManifest) {
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
  function noRegression(next: Pick<AnalysisManifest, "asOf" | "sources">) {
    return (
      !state.data ||
      (next.asOf >= state.data.result.asOf &&
        Date.parse(next.sources.papers.collectedAt) >= Date.parse(state.data.sources.papers.collectedAt) &&
        Date.parse(next.sources.signals.generatedAt) >= Date.parse(state.data.sources.signals.generatedAt))
    );
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
      const manifestRequest = read(`${data}data/analysis-manifest.json`, 32_768, signal).then((bytes) =>
        parseAnalysisManifest(json(bytes)),
      );
      void manifestRequest.catch(() => {});
      const bootstrapController = new AbortController();
      const bootstrapSignal = AbortSignal.any([signal, bootstrapController.signal]);
      const bootstrapRequest = state.data
        ? Promise.resolve()
        : (async () => {
            try {
              const bootstrap = parseAnalysisSnapshot(
                json(
                  await read(`${web}analysis-bootstrap.json`, ANALYSIS_SNAPSHOT_MAX_BYTES, bootstrapSignal),
                ),
              );
              if (
                controller === active &&
                !bootstrapSignal.aborted &&
                noRegression({ asOf: bootstrap.result.asOf, sources: bootstrap.sources })
              )
                publish({ data: bootstrap });
            } catch {
              /* The data package can recover a missing or slow web copy. */
            }
          })();
      try {
        let manifest = await manifestRequest;
        // Give an already-arriving web copy a brief chance to avoid a duplicate
        // transfer, but never let a stalled copy block the healthy data site.
        await new Promise<void>((resolve) => {
          const grace = setTimeout(
            resolve,
            options.bootstrapGraceMs ?? Math.min(250, (options.timeoutMs ?? 60_000) / 4),
          );
          void bootstrapRequest.finally(() => {
            clearTimeout(grace);
            resolve();
          });
        });
        for (let attempt = 0; attempt < 2; attempt++) {
          signal.throwIfAborted();
          if (!noRegression(manifest)) throw new Error("Older analysis publication");
          if (state.data && sameCalculation(state.data, manifest)) {
            if (controller === active)
              publish({ current: true, error: false, checkedAt: new Date().toISOString() });
            bootstrapController.abort();
            return state.data;
          }
          const bytes = await read(`${data}data/analysis-summary.json`, ANALYSIS_SNAPSHOT_MAX_BYTES, signal);
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          if (hash === manifest.snapshotSha256 && bytes.length === manifest.snapshotBytes) {
            const next = parseAnalysisSnapshot(json(bytes));
            if (!sameCalculation(next, manifest) || next.generatedAt !== manifest.generatedAt)
              throw new Error("Analysis metadata mismatch");
            signal.throwIfAborted();
            if (!noRegression(manifest)) throw new Error("Older analysis publication");
            if (controller === active)
              publish({ data: next, current: true, error: false, checkedAt: new Date().toISOString() });
            bootstrapController.abort();
            return next;
          }
          // A deploy may occur between the two reads. Retry the small manifest
          // once rather than accepting an unverified or mixed-generation result.
          if (attempt === 0)
            manifest = parseAnalysisManifest(
              json(await read(`${data}data/analysis-manifest.json`, 32_768, signal)),
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
