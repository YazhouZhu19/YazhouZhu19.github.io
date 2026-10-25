import { useEffect, useRef } from "react";
import { getLoadedPaperSnapshot } from "@/lib/local-api";
import { createWorkspaceHistory, serializeWorkspaceHash, type WorkspaceUrlState } from "@/lib/url-state";
import type { DashboardDrill } from "@/lib/dashboard";

export function useWorkspaceUrlState(
  state: WorkspaceUrlState,
  drill: DashboardDrill | null,
  onRestore: (state: WorkspaceUrlState, drill: DashboardDrill | null) => void,
  sourceGenerations?: Partial<Record<"github" | "news", string>>,
) {
  const generation = useRef(sourceGenerations);
  generation.current = sourceGenerations;
  const restore = useRef(onRestore);
  restore.current = onRestore;
  const controller = useRef<ReturnType<typeof createWorkspaceHistory> | null>(null);
  useEffect(() => {
    const current = createWorkspaceHistory(
      {
        read: () => ({ hash: window.location.hash, historyState: window.history.state }),
        write: (method, hash, historyState) => {
          window.history[method === "push" ? "pushState" : "replaceState"](historyState, "", hash);
        },
      },
      (view) =>
        view === "github" || view === "news"
          ? generation.current?.[view]
          : getLoadedPaperSnapshot()?.generation,
      (next, nextDrill) => restore.current(next, nextDrill),
    );
    controller.current = current;
    window.addEventListener("popstate", current.restore);
    window.addEventListener("hashchange", current.restore);
    return () => {
      window.removeEventListener("popstate", current.restore);
      window.removeEventListener("hashchange", current.restore);
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.commit(state, drill);
  }, [state, drill]);
  return serializeWorkspaceHash(state);
}
