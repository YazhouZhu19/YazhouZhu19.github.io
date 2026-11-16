import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisState, PrefetchedAnalysisBootstrap, createAnalysisStore } from "@/lib/analysis-store";
import { startManifestPolling } from "@/lib/manifest-polling";

const initial: AnalysisState = { data: null, loading: false, error: false, current: false, checkedAt: null };

export function useAnalysisSnapshot(enabled: boolean) {
  const [state, setState] = useState(initial);
  const [reloadRequired, setReloadRequired] = useState(false);
  const store = useRef<ReturnType<typeof createAnalysisStore> | null>(null);
  const load = useCallback(async () => {
    if (store.current) return store.current.load();
    // A failed ES module URL may stay cached by the browser. A document reload
    // obtains the current asset manifest and preserves the route/local library.
    window.location.reload();
    return null;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined, stopPolling: (() => void) | undefined;
    setState((current) => ({ ...current, loading: true }));
    void import("@/lib/analysis-store")
      .then(({ createAnalysisStore }) => {
        if (disposed) return;
        const earlyWindow = window as Window & { __oevrynAnalysisBootstrap?: PrefetchedAnalysisBootstrap };
        const prefetchedBootstrap = earlyWindow.__oevrynAnalysisBootstrap;
        delete earlyWindow.__oevrynAnalysisBootstrap;
        store.current ??= createAnalysisStore({
          prefetchedBootstrap,
          webBaseUrl: import.meta.env.BASE_URL,
          dataBaseUrl: import.meta.env.VITE_MONITOR_DATA_BASE_URL || import.meta.env.BASE_URL,
        });
        const reader = store.current;
        unsubscribe = reader.subscribe(() => setState(reader.getSnapshot()));
        setState(reader.getSnapshot());
        void reader.load();
        stopPolling = startManifestPolling(async () => {
          await reader.load();
          return reader.getSnapshot().current;
        });
      })
      .catch(() => {
        if (!disposed) {
          setReloadRequired(true);
          setState((current) => ({ ...current, loading: false, error: true }));
        }
      });
    return () => {
      disposed = true;
      unsubscribe?.();
      stopPolling?.();
      store.current?.cancel();
    };
  }, [enabled]);
  return { ...state, load, reloadRequired };
}
