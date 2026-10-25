"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LoadingState } from "./state-views";
import { useSignals } from "@/hooks/use-signals";
import { usePaperSnapshot } from "@/hooks/use-paper-snapshot";
import { usePersonalData } from "@/hooks/use-personal-data";
import { usePaperLibrary } from "@/hooks/use-paper-library";
import { useWorkspaceUrlState } from "@/hooks/use-workspace-url-state";
import { initialWorkspaceUrlState, workspaceView } from "@/lib/url-state";
import {
  defaultPublicTeamState,
  defaultSourceBrowseState,
  publicTeamState,
  sourceBrowseGeneration,
  teamPreferencesFromPublic,
  type SourceBrowseState,
  type SourceBrowseDrill,
  type SourceKind,
} from "@/lib/public-browse-state";
import { SignalsContext } from "./signals-context";
import { LocalDataControls } from "./local-data-controls";
import { useI18n } from "./locale-provider";
import { AppSidebar } from "./app-sidebar";
import { WorkspaceTopbar, WorkspaceHeader } from "./workspace-header";
import { WorkspaceNavigation } from "./workspace-navigation";
const PaperFilters = lazy(() =>
  import("./paper-filters").then((module) => ({ default: module.PaperFilters })),
);
const PaperLibrary = lazy(() =>
  import("./paper-library").then((module) => ({ default: module.PaperLibrary })),
);
const PaperDetailSheet = lazy(() =>
  import("./paper-detail-sheet").then((module) => ({ default: module.PaperDetailSheet })),
);
import { PaperScopeControl } from "./paper-scope-control";
import { matchesPaperScope, paperScopeCounts } from "@/lib/paper-scope";
import { ResearchDashboard } from "./research-dashboard";
import { exportPaperCsv } from "@/lib/paper-export";
import { defaultDashboardFilters, type DashboardFilters, type DashboardDrill } from "@/lib/dashboard";
import type { Paper } from "@/lib/types";
import type { ResearchSignal } from "@/lib/research-signals";
import type { ForesightPreferences } from "./foresight-view";
import type { TeamForesightPreferences } from "./team-foresight";
import "@/styles/workspace-dashboards.css";
export { api } from "@/lib/local-api";
export { fmtDate, fmtTime } from "@/lib/workspace-format";
const ForesightView = lazy(() =>
  import("./foresight-view").then((module) => ({ default: module.ForesightView })),
);
const TeamForesight = lazy(() =>
  import("./team-foresight").then((module) => ({ default: module.TeamForesight })),
);
const SourcesView = lazy(() => import("./monitor-views").then((module) => ({ default: module.SourcesView })));
const PreliminaryAnalysisView = lazy(() =>
  import("./preliminary-analysis").then((module) => ({ default: module.PreliminaryAnalysis })),
);
const ResearchSignalsView = lazy(() =>
  import("./research-signals-view").then((module) => ({ default: module.ResearchSignalsView })),
);
const EMPTY_PAPERS: Paper[] = [];
const EMPTY_SIGNALS: ResearchSignal[] = [];
export default function MonitorWorkspace() {
  const authenticated = true;
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [initialUrlState] = useState(() =>
    initialWorkspaceUrlState(typeof window === "undefined" ? "" : window.location.hash),
  );
  const [view, setView] = useState<string>(initialUrlState.view);
  const {
    snapshot: signals,
    manifest: signalsManifest,
    loading: signalsLoading,
    error: signalsError,
    checkedAt: signalsCheckedAt,
    loaded: signalsLoaded,
    store: signalsStore,
  } = useSignals();
  const loadSignals = signalsStore.refresh;
  const signalsAccess = useMemo(
    () => ({
      ensureKind: signalsStore.ensureKind,
      loaded: signalsLoaded,
      loading: signalsLoading,
      error: signalsError,
    }),
    [signalsStore, signalsLoaded, signalsLoading, signalsError],
  );

  const pollOtherSources = useCallback(
    async () => (signalsStore.getSnapshot().manifest ? (await signalsStore.refresh()) !== null : true),
    [signalsStore],
  );
  const snapshot = usePaperSnapshot(pollOtherSources);
  const { data, loading } = snapshot;
  const papers = data?.papers ?? EMPTY_PAPERS;
  const personal = usePersonalData({
    papers,
    storageAvailable: !!data?.personalStorageAvailable,
    onStorageStatus: snapshot.updatePersonalStorageStatus,
    tr,
  });
  const { collections, teams, openPaper, refreshPersonal } = personal;
  const [directionPreferences, setDirectionPreferences] = useState<ForesightPreferences>({
    track:
      initialUrlState.view === "foresight" && initialUrlState.track !== "all"
        ? initialUrlState.track
        : "segmentation",
    modality: initialUrlState.view === "foresight" ? (initialUrlState.modality ?? "") : "",
    query: initialUrlState.view === "foresight" ? initialUrlState.search : "",
    horizon: "6–12",
  });
  const [teamPreferences, setTeamPreferences] = useState<TeamForesightPreferences>({
    ...teamPreferencesFromPublic(initialUrlState.teamDirectory ?? defaultPublicTeamState()),
    horizon: "6–12",
  });
  const [sourcePreferences, setSourcePreferences] = useState<Record<SourceKind, SourceBrowseState>>(() => ({
    github:
      initialUrlState.view === "github" && initialUrlState.sourceBrowse
        ? initialUrlState.sourceBrowse
        : defaultSourceBrowseState("github"),
    news:
      initialUrlState.view === "news" && initialUrlState.sourceBrowse
        ? initialUrlState.sourceBrowse
        : defaultSourceBrowseState("news"),
  }));
  const sourceGenerations = useMemo(
    () => ({
      github: sourceBrowseGeneration(signalsManifest, "github"),
      news: sourceBrowseGeneration(signalsManifest, "news"),
    }),
    [signalsManifest],
  );
  const [sourceRestoreKey, setSourceRestoreKey] = useState(0);
  const [sourceDrills, setSourceDrills] = useState<Record<SourceKind, SourceBrowseDrill | null>>({
    github: null,
    news: null,
  });
  const changeGitHubDrill = useCallback(
    (drill: SourceBrowseDrill | null) => {
      setSourceDrills((current) => ({
        ...current,
        github: drill ? { ...drill, snapshotGeneration: sourceGenerations.github } : null,
      }));
    },
    [sourceGenerations.github],
  );
  const changeNewsDrill = useCallback(
    (drill: SourceBrowseDrill | null) => {
      setSourceDrills((current) => ({
        ...current,
        news: drill ? { ...drill, snapshotGeneration: sourceGenerations.news } : null,
      }));
    },
    [sourceGenerations.news],
  );
  useEffect(() => {
    const stale = (["github", "news"] as const).filter((kind) => {
      const drill = sourceDrills[kind];
      return drill && drill.snapshotGeneration !== sourceGenerations[kind];
    });
    if (!stale.length) return;
    setSourceDrills((current) => {
      const next = { ...current };
      for (const kind of stale) if (current[kind] === sourceDrills[kind]) next[kind] = null;
      return next;
    });
    setSourcePreferences((current) => {
      const next = { ...current };
      for (const kind of stale) next[kind] = { ...current[kind], tab: "overview" };
      return next;
    });
  }, [sourceDrills, sourceGenerations]);
  const changeGitHubPreferences = useCallback((update: React.SetStateAction<SourceBrowseState>) => {
    setSourcePreferences((current) => ({
      ...current,
      github: typeof update === "function" ? update(current.github) : update,
    }));
  }, []);
  const changeNewsPreferences = useCallback((update: React.SetStateAction<SourceBrowseState>) => {
    setSourcePreferences((current) => ({
      ...current,
      news: typeof update === "function" ? update(current.news) : update,
    }));
  }, []);
  const initialDashboardFilters = (target: string): DashboardFilters =>
    initialUrlState.view === target
      ? {
          days: initialUrlState.period,
          track: initialUrlState.track,
          source: initialUrlState.source,
          clock: initialUrlState.clock ?? "publication",
        }
      : defaultDashboardFilters;
  const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>(() =>
    initialDashboardFilters("dashboard"),
  );
  const [analysisFilters, setAnalysisFilters] = useState<DashboardFilters>(() =>
    initialDashboardFilters("analysis"),
  );
  const [drillOrigin, setDrillOrigin] = useState<string>("foresight");

  const [dashboardDrill, setDashboardDrill] = useState<DashboardDrill | null>(null);
  const drillIds = useMemo(() => (dashboardDrill ? new Set(dashboardDrill.ids) : null), [dashboardDrill]);
  const clearDrill = useCallback(() => setDashboardDrill(null), []);
  const library = usePaperLibrary({
    papers,
    view,
    savedIds: personal.savedIds,
    drillIds,
    clearDrill,
    initialFilters:
      initialUrlState.view === "feed" || initialUrlState.view === "saved"
        ? initialUrlState
        : { scope: initialUrlState.scope },
  });
  const scopeCounts = useMemo(() => paperScopeCounts(papers), [papers]);
  const scopedPapers = useMemo(
    () => papers.filter((paper) => matchesPaperScope(paper, library.scope)),
    [papers, library.scope],
  );
  const scopedData = useMemo(() => (data ? { ...data, papers: scopedPapers } : null), [data, scopedPapers]);
  const activeFilters =
    view === "dashboard" ? dashboardFilters : view === "analysis" ? analysisFilters : null;
  const urlHash = useWorkspaceUrlState(
    {
      view: workspaceView(view),
      track: view === "foresight" ? directionPreferences.track : (activeFilters?.track ?? library.track),
      period: activeFilters?.days ?? library.period,
      source: activeFilters?.source ?? library.source,
      clock: activeFilters?.clock,
      search: view === "foresight" ? directionPreferences.query : library.search,
      scope: library.scope,
      task: library.task,
      modality: view === "foresight" ? directionPreferences.modality : library.modality,
      organ: library.organ,
      method: library.method,
      status: library.status,
      human: library.human,
      sort: library.sort,
      ...(view === "github" || view === "news"
        ? {
            sourceBrowse: sourcePreferences[view],
            ...(sourceDrills[view] ? { drill: { label: sourceDrills[view].label, origin: view } } : {}),
          }
        : {}),
      ...(view === "teams" ? { teamDirectory: publicTeamState(teamPreferences) } : {}),
      ...(view === "feed" && dashboardDrill
        ? { drill: { label: dashboardDrill.label, origin: workspaceView(drillOrigin) } }
        : {}),
    },
    view === "github" || view === "news" ? sourceDrills[view] : dashboardDrill,
    (next, drill) => {
      setView(next.view);
      // Source/PI URLs carry their own filters; do not overwrite the remembered paper library.
      if (next.view === "github" || next.view === "news") {
        const kind = next.view;
        setSourcePreferences((current) => ({
          ...current,
          [kind]: next.sourceBrowse ?? defaultSourceBrowseState(kind),
        }));
        setSourceDrills((current) => ({ ...current, [kind]: drill }));
        // Only generation-validated document-local drills can return; analysis stays opt-in.
        setSourceRestoreKey((current) => current + 1);
        library.setScope(next.scope ?? "core");
      } else if (next.view === "teams") {
        setTeamPreferences((current) => ({
          ...current,
          ...teamPreferencesFromPublic(next.teamDirectory ?? defaultPublicTeamState()),
        }));
        library.setScope(next.scope ?? "core");
      } else {
        library.restoreFilters(next);
      }
      const filters: DashboardFilters = {
        days: next.period,
        track: next.track,
        source: next.source,
        clock: next.clock ?? "publication",
      };
      if (next.view === "dashboard") setDashboardFilters(filters);
      if (next.view === "analysis") setAnalysisFilters(filters);
      if (next.view === "foresight")
        setDirectionPreferences((current) => ({
          ...current,
          track: next.track === "all" ? "segmentation" : next.track,
          modality: next.modality ?? "",
          query: next.search,
        }));
      setDashboardDrill(next.view === "feed" ? drill : null);
      setDrillOrigin(next.drill?.origin ?? "foresight");
    },
    sourceGenerations,
  );
  const { reset, setSort } = library;
  const openDrill = useCallback(
    (drill: DashboardDrill, origin: string = "foresight") => {
      reset();
      setDrillOrigin(origin);
      setDashboardDrill({ ...drill, label: tr(drill.label) });
      setView("feed");
      setSort("discovered");
    },
    [reset, setSort, tr],
  );
  useEffect(() => {
    if (view === "github" || view === "news") void signalsStore.ensureManifest();
  }, [view, signalsStore]);

  const accountControl = <LocalDataControls onChange={refreshPersonal} />;
  const signalsView = view === "github" || view === "news";
  const sourceRecords = signals?.records ?? EMPTY_SIGNALS;
  const sourceRecordCount = signalsView ? (signalsManifest?.counts[view as "github" | "news"] ?? 0) : 0;
  const viewFallback = <LoadingState title={ui("正在加载内容", "Loading content")} />;
  return (
    <SignalsContext.Provider value={signalsAccess}>
      <SidebarProvider
        style={{ "--sidebar-width": locale === "en" ? "260px" : "248px" } as React.CSSProperties}
      >
        <Toaster richColors position="bottom-right" />
        <AppSidebar
          view={view}
          setView={setView}
          savedCount={collections.length}
          data={data}
          signals={signals}
          sourceRecordCount={sourceRecordCount}
        />
        <SidebarInset>
          <WorkspaceTopbar view={view} accountControl={accountControl} hash={urlHash} />
          <div className="workspace foresight-workspace">
            <WorkspaceHeader
              {...snapshot}
              view={view}
              setView={setView}
              signals={signals}
              signalsLoading={signalsLoading}
              signalsError={signalsError}
              signalsCheckedAt={signalsCheckedAt}
              loadSignals={loadSignals}
            />
            <WorkspaceNavigation
              view={view}
              setView={setView}
              paperCount={data ? papers.length : null}
              dashboardDrill={dashboardDrill}
              setDashboardDrill={setDashboardDrill}
              drillOrigin={drillOrigin}
              reset={reset}
            />
            {data && ["dashboard", "analysis", "feed", "teams", "foresight"].includes(view) && (
              <PaperScopeControl
                value={library.scope}
                counts={scopeCounts}
                onChange={(scope) => {
                  clearDrill();
                  library.setScope(scope);
                }}
              />
            )}
            {library.needsFilteredPapers && (
              <Suspense fallback={viewFallback}>
                <PaperFilters library={library} />
              </Suspense>
            )}
            <Suspense fallback={viewFallback}>
              {signalsView ? (
                <ResearchSignalsView
                  key={`${view}:${sourceRestoreKey}`}
                  kind={view as "github" | "news"}
                  preferences={sourcePreferences[view as SourceKind]}
                  drill={sourceDrills[view as SourceKind]}
                  onBrowseDrillChange={view === "github" ? changeGitHubDrill : changeNewsDrill}
                  onPreferencesChange={view === "github" ? changeGitHubPreferences : changeNewsPreferences}
                  snapshot={signals}
                  manifest={signalsManifest}
                  recordsLoaded={signalsLoaded[view as "github" | "news"]}
                  onLoadRecords={signalsStore.ensureKind}
                  loading={signalsLoading}
                  error={signalsError}
                  onRefresh={() => void loadSignals()}
                  papers={scopedPapers}
                  onPaper={openPaper}
                  onDrill={(d) => openDrill(d, view)}
                />
              ) : loading ? (
                viewFallback
              ) : view === "dashboard" && scopedData ? (
                <ResearchDashboard
                  authenticated={authenticated}
                  data={scopedData}
                  teams={teams}
                  collections={collections}
                  filters={dashboardFilters}
                  onFilters={setDashboardFilters}
                  onDrill={(d) => openDrill(d, "dashboard")}
                  onNavigate={setView}
                  onPaper={openPaper}
                />
              ) : view === "analysis" && scopedData ? (
                <PreliminaryAnalysisView
                  data={scopedData}
                  teams={teams}
                  filters={analysisFilters}
                  onFilters={setAnalysisFilters}
                  onDrill={(d) => openDrill(d, "analysis")}
                  onPaper={openPaper}
                />
              ) : view === "foresight" && scopedData ? (
                <ForesightView
                  data={scopedData}
                  signals={sourceRecords}
                  preferences={directionPreferences}
                  onPreferencesChange={setDirectionPreferences}
                  onPaper={openPaper}
                  onDrill={(d) => openDrill(d, "foresight")}
                />
              ) : view === "teams" && scopedData ? (
                <TeamForesight
                  data={scopedData}
                  signals={sourceRecords}
                  preferences={teamPreferences}
                  onPreferencesChange={setTeamPreferences}
                  teams={teams}
                  onChange={refreshPersonal}
                  openPaper={openPaper}
                  onDrill={(d) => openDrill(d, "teams")}
                  storageAvailable={!!scopedData.personalStorageAvailable}
                />
              ) : view === "sources" ? (
                <SourcesView data={data} />
              ) : (
                <PaperLibrary
                  view={view}
                  library={library}
                  personal={personal}
                  storageAvailable={!!data?.personalStorageAvailable}
                  onExport={() => exportPaperCsv(library.filtered, personal.collectionById, tr)}
                />
              )}
            </Suspense>
          </div>
        </SidebarInset>
        {personal.selected && (
          <Suspense fallback={viewFallback}>
            <PaperDetailSheet
              {...personal}
              papers={papers}
              authenticated={authenticated}
              accountControl={accountControl}
              storageAvailable={!!data?.personalStorageAvailable}
            />
          </Suspense>
        )}
      </SidebarProvider>
    </SignalsContext.Provider>
  );
}
