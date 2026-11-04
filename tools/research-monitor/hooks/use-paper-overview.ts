import { useCallback, useEffect, useRef, useState } from "react";
import { createManifestLoader } from "@/lib/manifest-loader";
import { createSnapshotLoader, SnapshotRequestError } from "@/lib/snapshot-refresh";
import type { PaperOverviewData } from "@/lib/paper-overview";
import { startManifestPolling } from "@/lib/manifest-polling";
import { getLocalStorageStatus } from "@/lib/local-api";
import type { SnapshotCheckResult } from "./use-paper-snapshot";

export function usePaperOverview(enabled: boolean) {
  const [data, setData] = useState<PaperOverviewData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [checkResult, setCheckResult] = useState<SnapshotCheckResult | null>(null);
  const latest = useRef(data);
  const mounted = useRef(false);
  const reader = useRef<ReturnType<typeof createSnapshotLoader<PaperOverviewData>> | null>(null);
  if (!reader.current) {
    const root = import.meta.env.VITE_MONITOR_DATA_BASE_URL || import.meta.env.BASE_URL;
    let manifest: ReturnType<typeof createManifestLoader<PaperOverviewData>> | undefined;
    reader.current = createSnapshotLoader(async (signal) => {
      const { parsePaperOverview } = await import("@/lib/paper-overview");
      manifest ??= createManifestLoader(`${root}data/paper-overview.json`, {
        validate: parsePaperOverview,
        maxBytes: 64 * 1024 * 1024,
      });
      return manifest.load(signal);
    }, 60_000);
  }
  const load = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
      setCheckResult(null);
    }
    if (!latest.current) setLoading(true);
    try {
      const next = await reader.current!.load();
      if (!mounted.current) return null;
      const local = getLocalStorageStatus();
      const result = {
        ...next,
        personalStorageAvailable: local.available,
        personalStorageReadable: local.readable,
        personalStorageError: local.error,
      };
      const previous = latest.current;
      latest.current = result;
      setData(result);
      setError("");
      if (manual)
        setCheckResult({
          kind: !previous ? "loaded" : previous.collectedAt === next.collectedAt ? "same" : "updated",
          checkedAt: new Date().toISOString(),
        });
      return result;
    } catch (cause) {
      if (mounted.current && !(cause instanceof SnapshotRequestError && cause.kind === "cancelled"))
        setError(cause instanceof Error ? cause.message : "Overview unavailable");
      return null;
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reader.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    return startManifestPolling(async () => (await load()) !== null);
  }, [enabled, load]);
  return { data, loading, refreshing, error, checkResult, load };
}
