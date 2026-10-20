import type { ResearchSignal, ResearchSignalsData } from "./research-signals";
import type { SignalKind, SignalsManifest, createSignalsSnapshotLoader } from "./signals-snapshot";

type Loader = ReturnType<typeof createSignalsSnapshotLoader>;
export type SignalsState = {
  manifest: SignalsManifest | null;
  snapshot: ResearchSignalsData | null;
  loaded: Record<SignalKind, boolean>;
  loading: boolean;
  error: boolean;
  checkedAt: string | null;
};
const emptyState = (): SignalsState => ({
  manifest: null, snapshot: null, loaded: { github: false, news: false },
  loading: false, error: false, checkedAt: null,
});

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Public signals stay unloaded until a view or an explicit source selection asks for them. */
export function createSignalsStore(baseUrl: string, loaderFactory?: () => Promise<Loader>, options: { timeoutMs?: number } = {}) {
  let state = emptyState();
  const listeners = new Set<() => void>();
  let loader: Promise<Loader> | undefined;
  let queue = Promise.resolve<unknown>(null);
  const pending = new Map<string, Promise<ResearchSignalsData | null>>();
  let active: AbortController | undefined;
  let epoch = 0;
  const publish = (next: Partial<SignalsState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const getLoader = () => {
    if (!loader) {
      const request = Promise.resolve().then(() => loaderFactory ? loaderFactory() :
        import("./signals-snapshot").then(module => module.createSignalsSnapshotLoader({ baseUrl })))
        .catch(error => { if (loader === request) loader = undefined; throw error; });
      loader = request;
    }
    return loader;
  };
  const dataFor = (manifest: SignalsManifest, records: ResearchSignal[]): ResearchSignalsData => ({
    schemaVersion: 1, generatedAt: manifest.generatedAt, sources: manifest.sources,
    limitations: manifest.limitations,
    ...(manifest.discoveryState ? { discoveryState: manifest.discoveryState } : {}),
    records,
  });
  function operation(key: string, kind?: SignalKind) {
    if (pending.has(key)) return pending.get(key)!;
    const currentEpoch = epoch;
    const request = queue.catch(() => null).then(async () => {
      if (currentEpoch !== epoch) return null;
      const controller = new AbortController();
      active = controller;
      const timer = setTimeout(() => controller.abort(new Error("Signal loading timed out")), options.timeoutMs ?? 60_000);
      publish({ loading: true, error: false });
      try {
        const initialization = getLoader();
        const reader = await untilAborted(initialization, controller.signal).catch(error => {
          // A timed-out import/factory must not keep the next request waiting on it.
          if (controller.signal.aborted && loader === initialization) loader = undefined;
          throw error;
        });
        controller.signal.throwIfAborted();
        const manifest = key === "manifest" && state.manifest ? state.manifest
          : kind && state.manifest ? state.manifest : await untilAborted(reader.loadManifest(controller.signal), controller.signal);
        const changed = manifest !== state.manifest;
        const kinds = (["github", "news"] as const).filter(item => item === kind || (changed && state.loaded[item]));
        const loaded = { ...state.loaded };
        let records = state.snapshot?.records ?? [];
        for (const item of kinds) {
          if (!changed && loaded[item]) continue;
          const next = await untilAborted(reader.loadKind(manifest, item, controller.signal), controller.signal);
          records = [...records.filter(record => record.kind !== item), ...next];
          loaded[item] = true;
        }
        controller.signal.throwIfAborted();
        if (currentEpoch !== epoch) return null;
        const snapshot = !changed && records === state.snapshot?.records ? state.snapshot : dataFor(manifest, records);
        publish({ manifest, snapshot, loaded, checkedAt: new Date().toISOString(), error: false });
        return snapshot;
      } catch {
        if (currentEpoch === epoch) publish({ error: true });
        return null;
      } finally {
        clearTimeout(timer);
        if (active === controller) active = undefined;
        if (currentEpoch === epoch) publish({ loading: false });
      }
    });
    pending.set(key, request);
    queue = request;
    void request.finally(() => { if (pending.get(key) === request) pending.delete(key); });
    return request;
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ensureManifest: () => operation("manifest"),
    ensureKind: (kind: SignalKind) => operation(kind, kind),
    refresh: () => operation("refresh"),
    cancel() {
      epoch++;
      active?.abort();
      active = undefined;
      pending.clear();
      queue = Promise.resolve(null);
      loader = undefined;
      publish({ loading: false });
    },
  };
}
