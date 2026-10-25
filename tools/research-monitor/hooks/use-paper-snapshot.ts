import { useCallback, useEffect, useRef, useState } from "react";
import { api, disposePaperData, type LocalStorageStatus } from "@/lib/local-api";
import { compareSnapshots, createSnapshotLoader, SnapshotRequestError } from "@/lib/snapshot-refresh";
import { startManifestPolling } from "@/lib/manifest-polling";
import type { MonitorData } from "@/lib/types";
export type SnapshotCheckResult = {
  kind: "same" | "updated" | "loaded" | "error";
  checkedAt: string;
  added?: number;
  detail?: string;
};
export function usePaperSnapshot(pollOtherSources: () => Promise<boolean>) {
  const [data, setData] = useState<MonitorData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [checkResult, setCheckResult] = useState<SnapshotCheckResult | null>(null);
  const mounted = useRef(false);
  const latestData = useRef<MonitorData | null>(null);
  const snapshotLoader = useRef(createSnapshotLoader((signal) => api("/api/papers", { signal })));
  const activeLoad = useRef<{ manual: boolean; promise: Promise<MonitorData | null> | null } | null>(null);
  const load = useCallback((manual = false): Promise<MonitorData | null> => {
    if (manual) {
      setRefreshing(true);
      setCheckResult(null);
    }
    if (activeLoad.current) {
      activeLoad.current.manual ||= manual;
      return activeLoad.current.promise!;
    }
    const request = { manual, promise: null as Promise<MonitorData | null> | null };
    activeLoad.current = request;
    request.promise = (async () => {
      try {
        const next = await snapshotLoader.current.load();
        if (!mounted.current || activeLoad.current !== request) return null;
        const previous = latestData.current;
        const comparison = compareSnapshots(previous, next);
        latestData.current = next;
        setData(next);
        setError("");
        if (request.manual)
          setCheckResult({
            kind: !previous ? "loaded" : comparison.changed ? "updated" : "same",
            checkedAt: new Date().toISOString(),
            added: comparison.added,
          });
        return next;
      } catch (cause) {
        if (
          !mounted.current ||
          activeLoad.current !== request ||
          (cause instanceof SnapshotRequestError && cause.kind === "cancelled")
        )
          return null;
        const detail = cause instanceof Error ? cause.message : "公开论文数据加载失败，请稍后重试";
        if (request.manual) setCheckResult({ kind: "error", checkedAt: new Date().toISOString(), detail });
        else if (!latestData.current) setError(detail);
        return null;
      } finally {
        if (activeLoad.current === request) {
          activeLoad.current = null;
          if (mounted.current) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      }
    })();
    return request.promise;
  }, []);

  const updatePersonalStorageStatus = useCallback((local: LocalStorageStatus) => {
    setData((current) =>
      current
        ? {
            ...current,
            personalStorageAvailable: local.available,
            personalStorageReadable: local.readable,
            personalStorageError: local.error,
          }
        : current,
    );
  }, []);
  // This hook stays mounted with the workspace: one poller and one shared Worker owner.
  useEffect(() => {
    mounted.current = true;
    void load();
    const stopPolling = startManifestPolling(async () => {
      const [papers, otherSourcesOk] = await Promise.all([load(), pollOtherSources()]);
      return papers !== null && otherSourcesOk;
    });
    return () => {
      mounted.current = false;
      activeLoad.current = null;
      snapshotLoader.current.cancel();
      disposePaperData();
      stopPolling();
    };
  }, [load, pollOtherSources]);
  return { data, loading, error, refreshing, checkResult, load, updatePersonalStorageStatus };
}
