"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignals } from "@/hooks/use-signals";
import { usePaperSnapshot } from "@/hooks/use-paper-snapshot";
import { usePersonalData } from "@/hooks/use-personal-data";
import { usePaperLibrary } from "@/hooks/use-paper-library";
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
  const [view, setView] = useState("dashboard");
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
    track: "segmentation",
    modality: "",
    query: "",
    horizon: "6–12",
  });
  const [teamPreferences, setTeamPreferences] = useState<TeamForesightPreferences>({
    teamId: "",
    horizon: "6–12",
  });
  const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>(defaultDashboardFilters);
  const [analysisFilters, setAnalysisFilters] = useState<DashboardFilters>(defaultDashboardFilters);
  const [drillOrigin, setDrillOrigin] = useState<string>("foresight");

  const [dashboardDrill, setDashboardDrill] = useState<DashboardDrill | null>(null);
  const drillIds = useMemo(() => (dashboardDrill ? new Set(dashboardDrill.ids) : null), [dashboardDrill]);
  const clearDrill = useCallback(() => setDashboardDrill(null), []);
  const library = usePaperLibrary({ papers, view, savedIds: personal.savedIds, drillIds, clearDrill });
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
  const viewFallback = (
    <div
      className="loading-papers"
      role="status"
      aria-label={ui("正在加载内容", "Loading content")}
      aria-busy="true"
    >
      {[1, 2, 3].map((n) => (
        <Skeleton key={n} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );

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
          <WorkspaceTopbar view={view} accountControl={accountControl} />
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
            {library.needsFilteredPapers && (
              <Suspense fallback={viewFallback}>
                <PaperFilters library={library} />
              </Suspense>
            )}
            <Suspense fallback={viewFallback}>
              {signalsView ? (
                <ResearchSignalsView
                  key={view}
                  kind={view as "github" | "news"}
                  snapshot={signals}
                  manifest={signalsManifest}
                  recordsLoaded={signalsLoaded[view as "github" | "news"]}
                  onLoadRecords={signalsStore.ensureKind}
                  loading={signalsLoading}
                  error={signalsError}
                  onRefresh={() => void loadSignals()}
                  papers={papers}
                  onPaper={openPaper}
                  onDrill={(d) => openDrill(d, view)}
                />
              ) : loading ? (
                viewFallback
              ) : view === "dashboard" && data ? (
                <ResearchDashboard
                  authenticated={authenticated}
                  data={data}
                  teams={teams}
                  collections={collections}
                  filters={dashboardFilters}
                  onFilters={setDashboardFilters}
                  onDrill={(d) => openDrill(d, "dashboard")}
                  onNavigate={setView}
                  onPaper={openPaper}
                />
              ) : view === "analysis" && data ? (
                <PreliminaryAnalysisView
                  data={data}
                  teams={teams}
                  filters={analysisFilters}
                  onFilters={setAnalysisFilters}
                  onDrill={(d) => openDrill(d, "analysis")}
                  onPaper={openPaper}
                />
              ) : view === "foresight" && data ? (
                <ForesightView
                  data={data}
                  signals={sourceRecords}
                  preferences={directionPreferences}
                  onPreferencesChange={setDirectionPreferences}
                  onPaper={openPaper}
                  onDrill={(d) => openDrill(d, "foresight")}
                />
              ) : view === "teams" && data ? (
                <TeamForesight
                  data={data}
                  signals={sourceRecords}
                  preferences={teamPreferences}
                  onPreferencesChange={setTeamPreferences}
                  teams={teams}
                  onChange={refreshPersonal}
                  openPaper={openPaper}
                  onDrill={(d) => openDrill(d, "teams")}
                  storageAvailable={!!data.personalStorageAvailable}
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
