import type { MonitorData } from "./types";

export class SnapshotRequestError extends Error {
  constructor(public readonly kind: "timeout" | "cancelled") {
    super(kind === "timeout" ? "检查超时，请检查网络后重试" : "检查已取消");
    this.name = "SnapshotRequestError";
  }
}

/** One active snapshot request, shared by manual and background refreshes. */
export function createSnapshotLoader<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs = 60_000) {
  let pending: { controller: AbortController; promise: Promise<T> } | null = null;
  return {
    load(): Promise<T> {
      if (pending) return pending.promise;
      const controller = new AbortController();
      let onAbort: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      const timer = setTimeout(() => controller.abort(new SnapshotRequestError("timeout")), timeoutMs);
      const request = { controller, promise: null as unknown as Promise<T> };
      request.promise = Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw controller.signal.reason; return read(controller.signal); }), cancelled]).finally(() => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        if (pending === request) pending = null;
      });
      pending = request;
      return request.promise;
    },
    cancel() { const request = pending; pending = null; request?.controller.abort(new SnapshotRequestError("cancelled")); },
  };
}

/** Collection timestamps identify metadata updates even when record count is unchanged. */
export function compareSnapshots(previous: MonitorData | null, next: MonitorData) {
  const ids = new Set(previous?.papers.map(p => p.id));
  const added = previous ? next.papers.filter(p => !ids.has(p.id)).length : 0;
  const changed = !previous || previous.collectedAt !== next.collectedAt
    || previous.lastSuccessfulSync !== next.lastSuccessfulSync
    || previous.papers.length !== next.papers.length || added > 0;
  return { changed, added };
}
