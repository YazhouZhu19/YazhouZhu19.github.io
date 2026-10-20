import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { getLoadedPaperSnapshot, searchPublicPapers } from "@/lib/local-api";
import type { Paper } from "@/lib/types";
import type { WorkspaceUrlState } from "@/lib/url-state";
const EMPTY_PAPERS: Paper[] = [];
const EMPTY_FACETS: string[] = [];
export function usePaperLibrary({
  papers,
  view,
  savedIds,
  drillIds,
  clearDrill,
  initialFilters = {},
}: {
  papers: Paper[];
  view: string;
  savedIds: Set<string>;
  drillIds: Set<string> | null;
  clearDrill: () => void;
  initialFilters?: Partial<WorkspaceUrlState>;
}) {
  const [track, setTrack] = useState(initialFilters.track ?? "all"),
    [search, setSearch] = useState(initialFilters.search ?? ""),
    [task, setTask] = useState(initialFilters.task ?? "all"),
    [modality, setModality] = useState(initialFilters.modality ?? "all"),
    [organ, setOrgan] = useState(initialFilters.organ ?? "all"),
    [method, setMethod] = useState(initialFilters.method ?? "all"),
    [source, setSource] = useState(initialFilters.source ?? "all"),
    [status, setStatus] = useState(initialFilters.status ?? "all"),
    [period, setPeriod] = useState(initialFilters.period ?? "all"),
    [sort, setSort] = useState(initialFilters.sort ?? "newest"),
    [human, setHuman] = useState(initialFilters.human ?? "all"),
    [limit, setLimit] = useState(30);
  const [scope, setScope] = useState<string | undefined>(initialFilters.scope);
  const deferredSearch = useDeferredValue(search);
  const [advanced, setAdvanced] = useState(false);
  useEffect(
    () => setLimit(30),
    [view, search, track, task, modality, organ, method, source, status, period, human],
  );
  const needsFilteredPapers = view === "feed" || view === "saved";
  const query = deferredSearch.trim().toLowerCase();
  const [searchResult, setSearchResult] = useState<{
    papers: Paper[];
    query: string;
    ids: Set<string>;
    failed?: boolean;
  } | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  useEffect(() => {
    if (!needsFilteredPapers || !query) return;
    const controller = new AbortController();
    const generation = getLoadedPaperSnapshot()?.generation;
    void searchPublicPapers(query, controller.signal, generation)
      .then((ids) => {
        if (!controller.signal.aborted) setSearchResult({ papers, query, ids: new Set(ids) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSearchResult({ papers, query, ids: new Set(), failed: true });
      });
    return () => controller.abort();
  }, [papers, query, needsFilteredPapers, searchAttempt]);
  const searchReady = !query || (searchResult?.papers === papers && searchResult.query === query);
  const searchFailed = searchReady && !!query && searchResult?.failed;
  const paperFacets = getLoadedPaperSnapshot()?.index;
  const filtered = useMemo(() => {
    if (!needsFilteredPapers || !searchReady) return EMPTY_PAPERS;
    const boundary = period === "all" ? null : Date.now() - Number(period) * 86400000;
    const today = new Date().toISOString().slice(0, 10);
    return papers
      .filter(
        (p) =>
          (view !== "feed" || !drillIds || drillIds.has(p.id)) &&
          (view !== "saved" || savedIds.has(p.id)) &&
          (track === "all" || p.tracks.includes(track)) &&
          (task === "all" || p.tasks.includes(task)) &&
          (modality === "all" || p.modalities.includes(modality)) &&
          (organ === "all" || p.organs.includes(organ)) &&
          (method === "all" || p.methods.includes(method)) &&
          (source === "all" || p.sources.includes(source)) &&
          (status === "all" || p.status === status) &&
          (human === "all" || p.humanSignals.includes(human)) &&
          (!boundary || (Date.parse(p.publishedAt) >= boundary && p.publishedAt <= today)) &&
          (!query || searchResult?.ids.has(p.id)),
      )
      .sort((a, b) =>
        sort === "oldest"
          ? a.publishedAt.localeCompare(b.publishedAt)
          : sort === "discovered"
            ? b.firstSeenAt.localeCompare(a.firstSeenAt)
            : b.publishedAt.localeCompare(a.publishedAt),
      );
  }, [
    papers,
    query,
    searchResult,
    searchReady,
    needsFilteredPapers,
    track,
    task,
    modality,
    organ,
    method,
    source,
    status,
    period,
    view,
    savedIds,
    sort,
    human,
    drillIds,
  ]);
  const modalities = paperFacets?.modalities ?? EMPTY_FACETS;
  const organs = paperFacets?.organs ?? EMPTY_FACETS;
  const methods = paperFacets?.methods ?? EMPTY_FACETS;
  const reset = useCallback(() => {
    clearDrill();
    setSearch("");
    setTrack("all");
    setTask("all");
    setModality("all");
    setOrgan("all");
    setMethod("all");
    setSource("all");
    setStatus("all");
    setPeriod("all");
    setHuman("all");
  }, [clearDrill]);
  const chooseTrack = useCallback(
    (id: string, leaveDrill = false) => {
      if (leaveDrill) clearDrill();
      setTrack(id);
      if (id !== "human_loop") setHuman("all");
    },
    [clearDrill],
  );

  const restoreFilters = useCallback((next: WorkspaceUrlState) => {
    setTrack(next.track);
    setSearch(next.search);
    setPeriod(next.period);
    setSource(next.source);
    setScope(next.scope);
    setTask(next.task ?? "all");
    setModality(next.modality ?? "all");
    setOrgan(next.organ ?? "all");
    setMethod(next.method ?? "all");
    setStatus(next.status ?? "all");
    setHuman(next.human ?? "all");
    setSort(next.sort ?? "newest");
  }, []);
  const sources = paperFacets?.sources ?? EMPTY_FACETS;
  return {
    scope,
    setScope,
    restoreFilters,
    track,
    setTrack,
    search,
    setSearch,
    task,
    setTask,
    modality,
    setModality,
    organ,
    setOrgan,
    method,
    setMethod,
    source,
    setSource,
    status,
    setStatus,
    period,
    setPeriod,
    sort,
    setSort,
    human,
    setHuman,
    limit,
    setLimit,
    advanced,
    setAdvanced,
    needsFilteredPapers,
    searchReady,
    searchFailed,
    setSearchAttempt,
    filtered,
    modalities,
    organs,
    methods,
    sources,
    reset,
    chooseTrack,
  };
}
export type PaperLibraryState = ReturnType<typeof usePaperLibrary>;
