import { useEffect, useRef, useSyncExternalStore } from "react";
import { createSignalsStore } from "@/lib/signals-store";

export function useSignals() {
  const store = useRef<ReturnType<typeof createSignalsStore> | null>(null);
  if (!store.current)
    store.current = createSignalsStore(
      import.meta.env.VITE_MONITOR_DATA_BASE_URL || import.meta.env.BASE_URL,
    );
  const current = store.current;
  const state = useSyncExternalStore(current.subscribe, current.getSnapshot, current.getSnapshot);
  useEffect(() => () => current.cancel(), [current]);
  return { ...state, store: current };
}
