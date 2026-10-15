"use client";
import { api, LOCAL_DATA_KEY, getLocalStorageStatus } from "@/lib/local-api";
import { compareSnapshots, createSnapshotLoader, SnapshotRequestError } from "@/lib/snapshot-refresh";
import { fetchResearchSignals } from "@/lib/signals-loader";
import type { ResearchSignal, ResearchSignalsData } from "@/lib/research-signals";
import { LocalDataControls } from "./local-data-controls";
import { useI18n } from "./locale-provider";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, Bookmark, BookmarkCheck, ChartNoAxesCombined, LayoutDashboard, Check, ChevronRight, Database, Download, Focus, GitBranch, Info, Layers3, Newspaper, RefreshCw, Search, SlidersHorizontal, Users, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast } from "sonner";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { HUMAN_LABELS, TASKS, TRACKS } from "@/lib/classify";
import type { Collection, MonitorData, Paper, Team } from "@/lib/types";
import type { ForesightPreferences } from "./foresight-view";
import type { TeamForesightPreferences } from "./team-foresight";
import { ResearchDashboard } from "./research-dashboard";
import "@/styles/workspace-dashboards.css";
import { defaultDashboardFilters, type DashboardFilters, type DashboardDrill } from "@/lib/dashboard";
const ForesightView = lazy(() => import("./foresight-view").then(module => ({ default: module.ForesightView })));
const TeamForesight = lazy(() => import("./team-foresight").then(module => ({ default: module.TeamForesight })));
const SourcesView = lazy(() => import("./monitor-views").then(module => ({ default: module.SourcesView })));
const PreliminaryAnalysisView = lazy(() => import("./preliminary-analysis").then(module => ({ default: module.PreliminaryAnalysis })));
const PaperPreliminaryAnalysis = lazy(() => import("./paper-analysis").then(module => ({ default: module.PaperPreliminaryAnalysis })));
const ResearchSignalsView = lazy(() => import("./research-signals-view").then(module => ({ default: module.ResearchSignalsView })));
const EMPTY_PAPERS: Paper[] = [];
const EMPTY_SIGNALS: ResearchSignal[] = [];
const nav = [
    { id: "dashboard", label: "论文仪表盘", en: "Paper dashboard", icon: LayoutDashboard },
    { id: "github", label: "GitHub 开源代码仪表盘", en: "GitHub code dashboard", icon: GitBranch },
    { id: "news", label: "公开进展消息仪表盘", en: "Public updates dashboard", icon: Newspaper },
    { id: "foresight", label: "方向研判", en: "Research outlook", icon: Focus },
    { id: "teams", label: "PI / 团队", en: "PI / Teams", icon: Users },
];
const auxiliaryNav = [{ id: "saved", label: "我的收藏", en: "Saved papers", icon: Bookmark }, { id: "sources", label: "数据与同步", en: "Data & sync", icon: Database }];
export function fmtDate(value?: string | null) {
    if (!value)
        return "未提供";
    return value.slice(0, 10);
}
export function fmtTime(value?: string | null) {
    if (!value)
        return "尚未同步";
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
export { api } from "@/lib/local-api";
function Picker({ label, value, onChange, options }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: [
        string,
        string
    ][];
}) { const { locale, tr } = useI18n(); return <Select value={value} onValueChange={onChange}><SelectTrigger className="filter-select" aria-label={tr(label)}><SelectValue /></SelectTrigger><SelectContent>{options.map(([v, t]) => <SelectItem key={v} value={v}>{tr(t)}</SelectItem>)}</SelectContent></Select>; }
function NavButton(props: React.ComponentProps<typeof SidebarMenuButton>) { const { setOpenMobile } = useSidebar(); return <SidebarMenuButton {...props} onClick={e => { props.onClick?.(e); setOpenMobile(false); }}/>; }
export default function MonitorWorkspace() {
    const authenticated = true;
    const { locale, tr } = useI18n();
    const [view, setView] = useState("dashboard"), [track, setTrack] = useState("all"), [search, setSearch] = useState(""), [task, setTask] = useState("all"), [modality, setModality] = useState("all"), [organ, setOrgan] = useState("all"), [method, setMethod] = useState("all"), [source, setSource] = useState("all"), [status, setStatus] = useState("all"), [period, setPeriod] = useState("all"), [sort, setSort] = useState("newest"), [human, setHuman] = useState("all"), [limit, setLimit] = useState(30);
    const deferredSearch = useDeferredValue(search);
    const [data, setData] = useState<MonitorData | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const [refreshing, setRefreshing] = useState(false);
    const [signals, setSignals] = useState<ResearchSignalsData | null>(null);
    const [signalsLoading, setSignalsLoading] = useState(true);
    const [signalsError, setSignalsError] = useState(false);
    const [signalsCheckedAt, setSignalsCheckedAt] = useState<string | null>(null);
    const signalsLoader = useRef(createSnapshotLoader(signal => fetchResearchSignals(signal, import.meta.env.BASE_URL)));
    const signalRequest = useRef<{ promise: Promise<ResearchSignalsData | null> | null } | null>(null);
    const [checkResult, setCheckResult] = useState<{ kind: "same" | "updated" | "loaded" | "error"; checkedAt: string; added?: number; detail?: string } | null>(null);
    const mounted = useRef(false);
    const latestData = useRef<MonitorData | null>(null);
    const snapshotLoader = useRef(createSnapshotLoader(signal => api("/api/papers", { signal })));
    const activeLoad = useRef<{ manual: boolean; promise: Promise<MonitorData | null> | null } | null>(null);
    const [collections, setCollections] = useState<Collection[]>([]), [teams, setTeams] = useState<Team[]>([]), [selected, setSelected] = useState<Paper | null>(null), [note, setNote] = useState(""), [stage, setStage] = useState("待读"), [saving, setSaving] = useState(false);
    const [directionPreferences, setDirectionPreferences] = useState<ForesightPreferences>({track:"segmentation",modality:"",query:"",horizon:"6–12"});
    const [teamPreferences, setTeamPreferences] = useState<TeamForesightPreferences>({teamId:"",horizon:"6–12"});
    const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>(defaultDashboardFilters);
    const [analysisFilters, setAnalysisFilters] = useState<DashboardFilters>(defaultDashboardFilters);
    const [drillOrigin, setDrillOrigin] = useState<string>("foresight");
    const [advanced, setAdvanced] = useState(false);
    const ui = (zh: string, en: string) => locale === "en" ? en : zh;
    const [dashboardDrill, setDashboardDrill] = useState<DashboardDrill | null>(null);
    const drillIds = useMemo(() => dashboardDrill ? new Set(dashboardDrill.ids) : null, [dashboardDrill]);
    const refreshPersonal = useCallback(async () => {
        const local = getLocalStorageStatus();
        setData(current => current ? { ...current, personalStorageAvailable: local.available, personalStorageReadable: local.readable, personalStorageError: local.error } : current);
        if (!local.readable) { setCollections([]); setTeams([]); return; }
        const settled = await Promise.allSettled([api("/api/collections"), api("/api/teams")]);
        if (settled[0].status === "fulfilled") setCollections(settled[0].value.collections);
        else toast.error(tr("收藏暂时无法读取"));
        if (settled[1].status === "fulfilled") setTeams(settled[1].value.teams);
        else toast.error(tr("关注名单暂时无法读取"));
    }, [tr]);
    const load = useCallback((manual = false): Promise<MonitorData | null> => {
        if (manual) { setRefreshing(true); setCheckResult(null); }
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
                if (request.manual) setCheckResult({
                    kind: !previous ? "loaded" : comparison.changed ? "updated" : "same",
                    checkedAt: new Date().toISOString(), added: comparison.added,
                });
                return next;
            } catch (cause) {
                if (!mounted.current || activeLoad.current !== request || cause instanceof SnapshotRequestError && cause.kind === "cancelled") return null;
                const detail = cause instanceof Error ? cause.message : "公开论文数据加载失败，请稍后重试";
                if (request.manual) setCheckResult({ kind: "error", checkedAt: new Date().toISOString(), detail });
                else if (!latestData.current) setError(detail);
                return null;
            } finally {
                if (activeLoad.current === request) {
                    activeLoad.current = null;
                    if (mounted.current) { setLoading(false); setRefreshing(false); }
                }
            }
        })();
        return request.promise;
    }, []);
    const loadSignals = useCallback((): Promise<ResearchSignalsData | null> => {
        if (signalRequest.current) return signalRequest.current.promise!;
        setSignalsLoading(true);
        const request = { promise: null as Promise<ResearchSignalsData | null> | null };
        signalRequest.current = request;
        request.promise = (async () => {
            try {
                const next = await signalsLoader.current.load();
                if (!mounted.current || signalRequest.current !== request) return null;
                setSignals(next);
                setSignalsError(false);
                setSignalsCheckedAt(new Date().toISOString());
                return next;
            } catch (cause) {
                if (mounted.current && signalRequest.current === request && !(cause instanceof SnapshotRequestError && cause.kind === "cancelled")) setSignalsError(true);
                return null;
            } finally {
                if (signalRequest.current === request) {
                    signalRequest.current = null;
                    if (mounted.current) setSignalsLoading(false);
                }
            }
        })();
        return request.promise;
    }, []);
    useEffect(() => {
        mounted.current = true;
        void load();
        void loadSignals();
        void refreshPersonal();
        const onStorage = (event: StorageEvent) => { if (event.key === LOCAL_DATA_KEY || event.key === null) void refreshPersonal(); };
        window.addEventListener("storage", onStorage);
        const timer = setInterval(() => { if (document.visibilityState === "visible") { void load(); void loadSignals(); } }, 300000);
        return () => {
            mounted.current = false;
            activeLoad.current = null;
            snapshotLoader.current.cancel();
            signalRequest.current = null;
            signalsLoader.current.cancel();
            clearInterval(timer);
            window.removeEventListener("storage", onStorage);
        };
    }, [load, loadSignals, refreshPersonal]);
    useEffect(() => setLimit(30), [view, search, track, task, modality, organ, method, source, status, period, human]);
    const savedIds = useMemo(() => new Set(collections.map(c => c.paperId)), [collections]);
    const collectionById = useMemo(() => new Map(collections.map(collection => [collection.paperId, collection])), [collections]);
    const papers = data?.papers ?? EMPTY_PAPERS;
    const needsFilteredPapers = view === "feed" || view === "saved";
    // Fill the index only when a text search needs it; keep it until the library changes.
    const searchableText = useMemo(() => {
        const index = new WeakMap<Paper, string>();
        return (paper: Paper) => {
            const existing = index.get(paper);
            if (existing !== undefined) return existing;
            const text = `${paper.title} ${paper.abstract} ${paper.authors.map(author => author.name).join(" ")} ${paper.affiliations.join(" ")} ${paper.doi ?? ""}`.toLowerCase();
            index.set(paper, text);
            return text;
        };
    }, [papers]);
    const failedSources = useMemo(() => {
        const latestRuns = new Map<string, MonitorData["runs"][number]>();
        for (const run of data?.runs ?? []) {
            const previous = latestRuns.get(run.source);
            if (!previous || run.completedAt > previous.completedAt) latestRuns.set(run.source, run);
        }
        return [...new Set([
            ...(data?.errors ?? []).map(error => error.source),
            ...[...latestRuns.values()].filter(run => run.status === "error" || run.error).map(run => run.source),
        ])];
    }, [data]);
    const filtered = useMemo(() => {
        if (!needsFilteredPapers) return EMPTY_PAPERS;
        const q = deferredSearch.trim().toLowerCase();
        const boundary = period === "all" ? null : Date.now() - Number(period) * 86400000;
        const today = new Date().toISOString().slice(0, 10);
        return papers.filter(p => (view !== "feed" || !drillIds || drillIds.has(p.id)) && (view !== "saved" || savedIds.has(p.id)) && (track === "all" || p.tracks.includes(track)) && (task === "all" || p.tasks.includes(task)) && (modality === "all" || p.modalities.includes(modality)) && (organ === "all" || p.organs.includes(organ)) && (method === "all" || p.methods.includes(method)) && (source === "all" || p.sources.includes(source)) && (status === "all" || p.status === status) && (human === "all" || p.humanSignals.includes(human)) && (!boundary || (Date.parse(p.publishedAt) >= boundary && p.publishedAt <= today)) && (!q || searchableText(p).includes(q)))
            .sort((a, b) => sort === "oldest" ? a.publishedAt.localeCompare(b.publishedAt) : sort === "discovered" ? b.firstSeenAt.localeCompare(a.firstSeenAt) : b.publishedAt.localeCompare(a.publishedAt));
    }, [papers, deferredSearch, searchableText, needsFilteredPapers, track, task, modality, organ, method, source, status, period, view, savedIds, sort, human, drillIds]);
    const modalities = useMemo(() => [...new Set(papers.flatMap(p => p.modalities))].sort(), [papers]);
    const organs = useMemo(() => [...new Set(papers.flatMap(p => p.organs))].sort(), [papers]);
    const methods = useMemo(() => [...new Set(papers.flatMap(p => p.methods))].sort(), [papers]);
    const reset = useCallback(() => { setDashboardDrill(null); setSearch(""); setTrack("all"); setTask("all"); setModality("all"); setOrgan("all"); setMethod("all"); setSource("all"); setStatus("all"); setPeriod("all"); setHuman("all"); }, []);
    const chooseTrack = useCallback((id: string, leaveDrill = false) => { if (leaveDrill) setDashboardDrill(null); setTrack(id); if (id !== "human_loop") setHuman("all"); }, []);
    const openDrill = useCallback((drill: DashboardDrill, origin: string = "foresight") => { reset(); setDrillOrigin(origin); setDashboardDrill({...drill,label:tr(drill.label)}); setView("feed"); setSort("discovered"); }, [reset, tr]);
    const paperById = useMemo(() => new Map(papers.map(p=>[p.id,p])), [papers]);
    const openPaper = useCallback((p: Paper) => { const original = paperById.get(p.id) ?? p; setSelected(original); const c = collectionById.get(original.id); setNote(c?.note ?? ""); setStage(c?.stage ?? "待读"); }, [collectionById,paperById]);
    const savePaper = async (p: Paper, withNote = false) => {
                if (!data?.personalStorageAvailable) {
            toast.error(tr("存储暂时不可用，请稍后再试"));
            return;
        }
        setSaving(true);
        try {
            const existing = collectionById.get(p.id);
            await api("/api/collections", { method: "POST", body: JSON.stringify({ paperId: p.id, note: withNote ? note : existing?.note ?? "", stage: withNote ? stage : existing?.stage ?? "待读" }) });
            const d = await api("/api/collections");
            setCollections(d.collections);
            toast.success(withNote ? tr("笔记已保存") : tr("已加入选题收藏"));
        }
        catch (e) {
            toast.error(tr((e as Error).message));
        }
        finally {
            setSaving(false);
        }
    };
    const removePaper = async (p: Paper) => {
        try {
            await api("/api/collections", { method: "DELETE", body: JSON.stringify({ paperId: p.id }) });
            setCollections(c => c.filter(x => x.paperId !== p.id));
            toast.success(tr("已取消收藏"));
        }
        catch (e) {
            toast.error(tr((e as Error).message));
        }
    };
    const exportCsv = () => {
        const safe = (v: unknown) => {
            let s = String(v ?? "");
            if (/^[=+\-@\t\r]/.test(s))
                s = "'" + s;
            return '"' + s.replace(/"/g, '""') + '"';
        };
        const rows = [["标题", "作者", "来源日期", "来源", "状态", "DOI", "原文链接", "感兴趣方向", "任务标签", "模态", "笔记"].map(v => tr(v)), ...filtered.map(p => [p.title, p.authors.map(a => a.name).join("; "), p.publishedAt, p.sources.join("; "), p.status, p.doi, p.url, p.tracks.map(t => tr(TRACKS[t] ?? t)).join("; "), p.tasks.map(t => tr(TASKS[t])).join("; "), p.modalities.map(v => tr(v)).join("; "), collectionById.get(p.id)?.note ?? ""])];
        const blob = new Blob(["\uFEFF" + rows.map(r => r.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `medical-image-papers-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };
    const accountControl = <LocalDataControls onChange={refreshPersonal}/>;
    const personalGate = null;
    const signalsView = view === "github" || view === "news";
    const sourceRecords = signals?.records ?? EMPTY_SIGNALS;
    const paperDashboardView = view === "dashboard" || view === "feed" || view === "analysis";
    const current = [...nav, ...auxiliaryNav].find(n => n.id === view) ?? nav[0];
    const sourceRecordCount = useMemo(() => (signals?.records ?? []).filter(record => record.kind === view).length, [signals, view]);
    const filterPanel = needsFilteredPapers ? <div className="filter-panel library-filters">
      <div className="library-primary-filters"><div className="search-box"><Search size={18}/><Input aria-label={tr("搜索论文")} placeholder={tr("搜索论文、方法、作者、疾病或 DOI…")} value={search} onChange={e => setSearch(e.target.value)}/></div>
      <Picker label={tr("感兴趣方向筛选")} value={track} onChange={chooseTrack} options={[["all", "全部感兴趣方向"], ...Object.entries(TRACKS)]}/>
      <Picker label={tr("记录日期范围")} value={period} onChange={setPeriod} options={[["all", "全部记录日期"], ["30", "近 30 天"], ["90", "近 90 天"], ["365", "近一年"]]}/>
      <Button variant="outline" aria-expanded={advanced} aria-controls="advanced-paper-filters" onClick={() => setAdvanced(v => !v)}><SlidersHorizontal size={15}/>{ui("高级筛选", "More filters")}{[task,modality,organ,method,source,status,human].filter(v=>v!=="all").length > 0 && <span className="filter-active-count">{[task,modality,organ,method,source,status,human].filter(v=>v!=="all").length}</span>}</Button></div>
      {advanced && <div className="filter-row" id="advanced-paper-filters">
      <Picker label={tr("研究任务")} value={task} onChange={setTask} options={[["all", "全部研究任务"], ...Object.entries(TASKS)]}/>
      <Picker label={tr("影像模态")} value={modality} onChange={setModality} options={[["all", "全部模态"], ...modalities.map(x => [x,x] as [string,string])]}/>
      <Picker label={tr("器官或疾病")} value={organ} onChange={setOrgan} options={[["all", "全部器官 / 疾病"], ...organs.map(x => [x,x] as [string,string])]}/>
      <Picker label={tr("研究方法")} value={method} onChange={setMethod} options={[["all", "全部研究方法"], ...methods.map(x => [x,x] as [string,string])]}/>
      <Picker label={tr("数据来源")} value={source} onChange={setSource} options={[["all", "全部来源"], ...[...new Set(papers.flatMap(p=>p.sources))].sort().map(x => [x,x] as [string,string])]}/>
      <Picker label={tr("发表状态")} value={status} onChange={setStatus} options={[["all", "全部发表状态"], ["preprint", "预印本"], ["published", "正式发表"]]}/>
      <Picker label={tr("人参与线索")} value={human} onChange={setHuman} options={[["all", "全部线索"], ...Object.entries(HUMAN_LABELS)]}/>
      <Button variant="ghost" size="sm" onClick={reset}>{tr("重置")}</Button></div>}</div> : null;
    const viewFallback = <div className="loading-papers" role="status" aria-label={ui("正在加载内容", "Loading content")} aria-busy="true">{[1, 2, 3].map(n => <Skeleton key={n} className="h-28 w-full rounded-xl"/>)}</div>;
    return <SidebarProvider style={{ "--sidebar-width": locale === "en" ? "260px" : "248px" } as React.CSSProperties}><Toaster richColors position="bottom-right"/><Sidebar><SidebarHeader className="brand"><div className="brand-symbol"><Focus size={25}/></div><div><strong>{tr("医学影像科研观察")}</strong><span>{ui("从论文证据到研究判断", "From evidence to research decisions")}</span></div></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>{tr("研究工作台")}</SidebarGroupLabel><SidebarMenu className="workspace-main-nav">{nav.map(n => <SidebarMenuItem key={n.id}><NavButton isActive={view === n.id || n.id === "dashboard" && paperDashboardView} size="lg" onClick={() => setView(n.id)}><n.icon /><span>{ui(n.label,n.en)}</span></NavButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter><SidebarMenu>{auxiliaryNav.map(n=><SidebarMenuItem key={n.id}><NavButton isActive={view===n.id} onClick={()=>setView(n.id)}><n.icon/><span>{ui(n.label,n.en)}</span>{n.id==="saved" && collections.length>0 && <span className="nav-count">{collections.length}</span>}</NavButton></SidebarMenuItem>)}</SidebarMenu><div className="sidebar-note"><Database size={15}/><span>{signalsView ? signals ? ui(`${sourceRecordCount.toLocaleString()} ${view === "github" ? "个项目" : "条消息"}`, `${sourceRecordCount.toLocaleString()} ${view === "github" ? "repositories" : "announcements"}`) : ui("读取来源数据", "Loading source data") : data ? ui(`${papers.length.toLocaleString()} 条论文记录`, `${papers.length.toLocaleString()} paper records`) : tr("读取论文库")}<br/><small>{tr("最后更新 ")}{tr(fmtTime(signalsView ? signals?.generatedAt : data?.collectedAt))}</small></span></div><a className="homepage-link" href="https://yazhouzhu19.github.io/" target="_blank" rel="noreferrer">{tr("Yazhou Zhu · 个人主页 ")}<ArrowUpRight size={13}/></a></SidebarFooter></Sidebar><SidebarInset><header className="topbar"><div className="topbar-label"><SidebarTrigger /><strong>{ui(current.label,current.en)}</strong></div><div className="account-controls"><nav className="language-switch" aria-label={locale === "en" ? "Language" : "界面语言"}><a href="/research-monitor/" hrefLang="zh-CN" lang="zh-CN" aria-current={locale === "zh" ? "page" : undefined}>中文</a><a href="/research-monitor/en/" hrefLang="en" lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</a></nav>{accountControl}</div></header><div className="workspace foresight-workspace"><div className="page-heading compact-page-heading"><div><p className="eyebrow">MEDICAL IMAGE RESEARCH</p><h1>{paperDashboardView ? ui("论文仪表盘", "Paper dashboard") : view==="foresight" ? ui("下一步，值得研究什么？", "What is worth researching next?") : view==="teams" ? ui("理解积累，研判下一步", "Follow the work. Consider what comes next.") : view==="github" ? ui("GitHub 开源代码仪表盘", "GitHub code dashboard") : view==="news" ? ui("公开进展消息仪表盘", "Public updates dashboard") : view==="saved" ? tr("从阅读到下一个课题") : tr("让每一条记录有据可查")}</h1><p>{paperDashboardView ? ui("从论文规模、研究方向与时间分布，到完整论文、原始摘要和阅读笔记。", "Explore paper counts, research areas and dates, then inspect the full library, original abstracts and reading notes.") : view==="foresight" ? ui("从持续出现的研究线索中，形成可检验的技术、数据与应用判断。", "Turn recurring research signals into testable hypotheses about methods, data and applications.") : view==="teams" ? ui("围绕你确认的 PI 与成员名单，观察研究主线与可能走向。", "Explore trajectories and possible next steps for researchers and teams you identify.") : view==="github" ? ui("观察公开代码的方向分布、维护与复现条件，进入项目库核对具体实现。", "Explore research areas, maintenance and reproduction clues, then inspect the repository library.") : view==="news" ? ui("观察模型与研究消息的主题、发布节奏及来源，进入消息库追溯原始发布。", "Explore announcement topics, publication dates and sources, then trace individual updates in the news library.") : view==="saved" ? tr("记录阅读判断、相关问题和下一步验证。") : tr("查看数据覆盖、检索范围与同步结果。")}</p></div><Button variant="outline" size="sm" onClick={() => { if (signalsView) void loadSignals(); else { void load(true); void loadSignals(); } }} disabled={signalsView ? signalsLoading : loading || refreshing} aria-busy={signalsView ? signalsLoading : refreshing}><RefreshCw size={15} className={(signalsView ? signalsLoading : refreshing) ? "animate-spin" : undefined}/>{tr((signalsView ? signalsLoading : refreshing) ? "正在检查…" : "检查最新数据")}</Button></div>
 <div className="compact-freshness"><span>{ui("数据截至 ", "Data updated ")}{signalsView ? signals ? fmtTime(signals.generatedAt) : tr("尚未载入") : data ? fmtTime(data.collectedAt) : tr("尚未载入")}</span>{!signalsView && <button onClick={()=>setView("sources")}>{ui("覆盖与同步状态", "Coverage & sync")}<ArrowUpRight size={12}/></button>}<div role="status" aria-live="polite">{signalsView ? signalsLoading ? ui("正在读取已发布快照…", "Checking the published snapshot…") : signalsError ? ui("读取失败，已保留已有数据。", "The check failed; any existing data is retained.") : signalsCheckedAt ? ui("已检查发布快照；采集时间见下方来源状态。", "Published snapshot checked; source collection times are listed below.") : "" : refreshing ? tr("正在读取最新已发布数据…") : checkResult && tr(checkResult.kind === "same" ? "当前已是最新发布的数据。" : checkResult.kind === "updated" ? "已加载新版数据，新增 {0} 条记录。" : checkResult.kind === "loaded" ? "已加载最新发布的数据。" : "检查失败，已保留当前数据。",[checkResult.added??0])}</div></div>
 {error && !signalsView && <div className="notice error" role="alert">{tr(error)}<Button variant="ghost" onClick={() => void load(true)} disabled={refreshing}>{tr("重新读取")}</Button></div>}{data?.personalStorageError && <div className="notice error" role="alert">{tr(data.personalStorageError)}</div>}{!signalsView && (data?.error || failedSources.length > 0) && <div className="notice error" role="alert"><span>{failedSources.length ? tr("部分来源采集失败（{0}），已保留已有论文。", [failedSources.join(locale === "en" ? ", " : "、")]) : tr("存在来源采集失败，已保留已有论文。详情请查看同步日志。")}</span><Button variant="ghost" onClick={() => setView("sources")}>{tr("查看同步日志")}<ArrowUpRight size={14}/></Button></div>}{!signalsView && data?.totalStored && data.totalStored > papers.length ? <div className="notice">{tr("库内共 ")}{data.totalStored}{tr(" 条记录，当前展示最新 ")}{papers.length}{tr(" 条；筛选与图表基于当前展示范围。")}</div> : null}
 {paperDashboardView && <nav className="dashboard-section-tabs" aria-label={ui("论文仪表盘视图", "Paper dashboard views")}>
   <button type="button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}><LayoutDashboard size={16}/>{ui("统计总览", "Overview")}</button>
   <button type="button" aria-pressed={view === "feed"} onClick={() => { setDashboardDrill(null); setView("feed"); }}><Layers3 size={16}/>{ui("论文库", "Paper library")}<span>{data ? papers.length.toLocaleString() : "—"}</span></button>
   <button type="button" aria-pressed={view === "analysis"} onClick={() => setView("analysis")}><ChartNoAxesCombined size={16}/>{ui("阅读线索", "Reading leads")}</button>
 </nav>}
 {view === "feed" && dashboardDrill && <div className="dash-drill-banner"><div><strong>{dashboardDrill.label}</strong><span>{dashboardDrill.ids.length}{tr(" 条范围记录 · 下方筛选可继续缩小范围")}</span></div><Button variant="outline" onClick={() => { setDashboardDrill(null); setView(drillOrigin); }}>{drillOrigin === "dashboard" ? ui("返回统计总览", "Back to overview") : drillOrigin === "analysis" ? ui("返回初步分析", "Back to analysis") : drillOrigin === "feed" ? ui("返回论文库", "Back to library") : drillOrigin === "teams" ? ui("返回 PI / 团队", "Back to PI / Teams") : drillOrigin === "github" ? ui("返回代码仪表盘", "Back to code dashboard") : drillOrigin === "news" ? ui("返回消息仪表盘", "Back to updates dashboard") : ui("返回方向研判", "Back to outlook")}</Button><Button variant="ghost" onClick={reset}>{tr("清除钻取")}</Button></div>}
 {view === "analysis" && <Button variant="ghost" onClick={() => setView("dashboard")}>{ui("返回统计总览", "Back to overview")}</Button>}
 {(view === "feed" || view === "saved") && filterPanel}
 <Suspense fallback={viewFallback}>{signalsView ? <ResearchSignalsView key={view} kind={view as "github" | "news"} snapshot={signals} loading={signalsLoading} error={signalsError} onRefresh={() => void loadSignals()} papers={papers} onPaper={openPaper} onDrill={d=>openDrill(d,view)}/> : loading ? viewFallback : view === "dashboard" && data ? <ResearchDashboard authenticated={authenticated} data={data} teams={teams} collections={collections} filters={dashboardFilters} onFilters={setDashboardFilters} onDrill={d=>openDrill(d,"dashboard")} onNavigate={setView} onPaper={openPaper}/> : view === "analysis" && data ? <PreliminaryAnalysisView data={data} teams={teams} filters={analysisFilters} onFilters={setAnalysisFilters} onDrill={d=>openDrill(d,"analysis")} onPaper={openPaper}/> : view === "foresight" && data ? <ForesightView data={data} signals={sourceRecords} preferences={directionPreferences} onPreferencesChange={setDirectionPreferences} onPaper={openPaper} onDrill={d=>openDrill(d,"foresight")}/> : view === "teams" && data ? <TeamForesight data={data} signals={sourceRecords} preferences={teamPreferences} onPreferencesChange={setTeamPreferences} teams={teams} onChange={refreshPersonal} openPaper={openPaper} onDrill={d=>openDrill(d,"teams")} storageAvailable={!!data.personalStorageAvailable}/> : view === "sources" ? <SourcesView data={data}/> : <section className="paper-section"><div className="section-heading"><div><h2>{view === "saved" ? tr("我的选题库") : track === "all" ? ui("全部论文", "All papers") : tr(TRACKS[track])} <span>{filtered.length}{tr(" 条")}</span></h2><p className="section-caption">{tr("按 DOI / 来源标识去重 \u00B7 自动标签待复核")}</p></div><div className="list-tools"><Picker label={tr("排序")} value={sort} onChange={setSort} options={[["newest", "来源日期 ↓"], ["oldest", "来源日期 ↑"], ["discovered", "发现时间 ↓"]]}/><Button variant="ghost" size="icon" aria-label={tr("导出当前筛选记录")} onClick={exportCsv} disabled={!filtered.length}><Download size={16}/></Button></div></div>{filtered.length === 0 ? <div className="empty-state"><Search /><p>{view === "saved" ? tr("还没有符合条件的收藏") : tr("没有符合条件的记录")}</p><span>{view === "saved" ? tr("在论文详情里收藏论文、添加阅读笔记。") : tr("尝试移除部分筛选，或同步最新论文。")}</span><Button className="mt-4" variant="outline" onClick={reset}>{tr("清除筛选")}</Button></div> : filtered.slice(0, limit).map(p => <article key={p.id} className="paper-row"><div className="paper-main"><div className="paper-meta"><Badge className={p.status === "preprint" ? "status-preprint" : "status-published"} variant="secondary">{p.status === "preprint" ? tr("预印本") : p.status === "published" ? tr("正式发表") : tr("状态未确认")}</Badge><span>{p.sources.join(" · ")}</span><span>{tr(fmtDate(p.publishedAt))}{p.source === "medRxiv" ? tr(" \u00B7 版本日期") : ""}</span>{p.version && <span>v{p.version}</span>}{p.publishedAt > new Date().toISOString().slice(0, 10) && <span>{tr("来源标注未来日期")}</span>}</div><button className="paper-title" onClick={() => openPaper(p)}>{p.title}<ChevronRight size={17}/></button><div className="paper-authors">{p.authors.slice(0, 4).map(a => a.name).join(" · ")}{p.authors.length > 4 ? tr(" 等 {0} 位作者", [p.authors.length]) : ""}</div><p className="abstract-preview">{p.abstract || tr("来源未提供摘要")}</p><div className="tag-row">{p.tasks.slice(0, 2).map(t => <span className="tag task-tag" key={t}>{tr(TASKS[t])}</span>)}{p.modalities.slice(0, 2).map(t => <span className="tag" key={t}>{tr(t)}</span>)}{p.humanSignals.filter(t => t !== "annotation" && t !== "simulated").slice(0, 1).map(t => <span className="tag human-tag" key={t}>{tr(HUMAN_LABELS[t])}</span>)}{view === "saved" && <span className="tag saved-tag">{tr(collectionById.get(p.id)?.stage ?? "")}</span>}</div>{view === "saved" && collectionById.get(p.id)?.note && <p className="saved-note">{collectionById.get(p.id)?.note}</p>}</div><Button variant="ghost" size="icon" aria-label={savedIds.has(p.id) ? tr("取消收藏：{0}", [p.title]) : tr("收藏：{0}", [p.title])} onClick={() => savedIds.has(p.id) ? void removePaper(p) : void savePaper(p)} disabled={saving || !data?.personalStorageAvailable}>{savedIds.has(p.id) ? <BookmarkCheck className="saved-icon"/> : <Bookmark />}</Button></article>)}{filtered.length > limit && <div className="load-more"><Button variant="outline" onClick={() => setLimit(l => l + 30)}>{tr("再显示 30 条 \u00B7 剩余 ")}{filtered.length - limit}{tr(" 条")}</Button></div>}</section>}</Suspense>

 </div></SidebarInset>
 <Sheet open={!!selected} onOpenChange={open => {
            if (!open)
                setSelected(null);
        }}><SheetContent className="paper-detail"><SheetHeader><SheetTitle>{tr("论文详情")}</SheetTitle><SheetDescription>{tr("查看原始证据、版本与阅读笔记。")}</SheetDescription></SheetHeader>{selected && <div className="detail-body"><div className="paper-meta"><Badge variant="secondary" className={selected.status === "preprint" ? "status-preprint" : "status-published"}>{selected.status === "preprint" ? tr("预印本") : selected.status === "published" ? tr("正式发表") : tr("状态未确认")}</Badge><span>{selected.sources.join(" · ")}</span></div><h2>{selected.title}</h2><p className="detail-authors">{selected.authors.map(a => a.name).join(" · ")}</p><Button asChild variant="outline"><a href={selected.url} target="_blank" rel="noreferrer">{tr("查看原始论文")}<ArrowUpRight size={16}/></a></Button><dl className="detail-dates"><div><dt>{selected.source === "medRxiv" ? tr("该版本发布日期") : tr("来源发表 / 提交日期")}</dt><dd>{tr(fmtDate(selected.publishedAt))}</dd></div><div><dt>{tr("平台首次发现")}</dt><dd>{fmtTime(selected.firstSeenAt)}</dd></div>{selected.updatedAt && <div><dt>{tr("来源更新时间")}</dt><dd>{fmtDate(selected.updatedAt)}</dd></div>}{selected.venue && <div><dt>{tr("期刊 / 发表信息")}</dt><dd>{selected.venue}</dd></div>}{selected.doi && <div><dt>{selected.source === "arXiv" ? tr("关联 DOI") : "DOI"}</dt><dd>{selected.doi}</dd></div>}</dl>{selected.relatedDoi && <p className="related-publication">{tr("来源提供了正式发表关联：")}<a href={`https://doi.org/${selected.relatedDoi}`} target="_blank" rel="noreferrer">{selected.relatedDoi}<ArrowUpRight size={14}/></a></p>}<Suspense fallback={<Skeleton className="my-6 h-28 w-full rounded-xl"/>}><PaperPreliminaryAnalysis paper={selected}/></Suspense><h3>{tr("原始摘要")}</h3><p className="full-abstract">{selected.abstract || tr("来源未提供摘要。")}</p><h3>{tr("自动分类")}</h3><div className="tag-row">{[...new Set([...selected.tracks.map(t => TRACKS[t]), ...selected.tasks.map(t => TASKS[t]), ...selected.modalities, ...selected.organs, ...selected.methods])].filter(Boolean).map(t => <span className="tag" key={t}>{tr(t)}</span>)}</div><p className="detail-hint">{tr("基于标题与摘要规则匹配；标签不构成研究质量或临床效果判断。")}</p><h3>{tr("人参与线索")}</h3>{selected.evidence.length ? selected.evidence.map((e, i) => <div className="evidence" key={i}><strong>{tr(e.label)}</strong><blockquote>…{e.excerpt}…</blockquote></div>) : <p className="detail-hint">{tr("摘要中未检出明确线索，不能据此认定研究没有人参与。")}</p>}{selected.humanSignals.includes("simulated") && <div className="notice">{tr("检出模拟交互表述，不能将模拟点击视为真实医生使用证据。")}</div>}<h3>{tr("作者机构")}</h3>{selected.affiliations.length ? <ul className="affiliation-list">{selected.affiliations.map(a => <li key={a}>{a}</li>)}</ul> : <p className="detail-hint">{tr("来源未提供机构，未推断当前任职。")}</p>}<p className="detail-hint">{tr("机构为论文署名信息；medRxiv 通常仅提供通讯作者机构。")}</p>{authenticated ? <><h3>{tr("我的阅读笔记")}</h3><Picker label={tr("阅读状态")} value={stage} onChange={setStage} options={["待读", "已读", "选题候选", "暂不相关"].map(x => [x, x])}/><Textarea className="note-input" aria-label={tr("阅读笔记")} placeholder={tr("与我们课题的关系、可复现之处、值得验证的问题\u2026")} value={note} onChange={e => setNote(e.target.value)}/><Button onClick={() => void savePaper(selected, true)} disabled={saving || !data?.personalStorageAvailable}>{saving ? <RefreshCw className="animate-spin"/> : <Check />}{tr("保存笔记与收藏")}</Button></> : <div className="public-note-login"><p>{tr("登录后可保存个人收藏与阅读笔记。")}</p>{accountControl}</div>}<h3>{tr("记录来源")}</h3>{selected.provenance.slice(-3).map((p, i) => <p key={i} className="detail-hint">{tr("源记录 ")}{p.sourceRecordId ?? tr("未提供")}{tr(" \u00B7 采集于 ")}{fmtTime(p.collectedAt)}</p>)}</div>}</SheetContent></Sheet>
 </SidebarProvider>;
}
