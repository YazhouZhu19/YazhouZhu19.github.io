"use client";
import { api, LOCAL_DATA_KEY, getLocalStorageStatus } from "@/lib/local-api";
import { LocalDataControls } from "./local-data-controls";
import { useI18n } from "./locale-provider";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Bookmark, BookmarkCheck, ChartNoAxesCombined, LayoutDashboard, Check, ChevronRight, Database, Download, Focus, Info, Layers3, RefreshCw, Search, SlidersHorizontal, Users, Workflow, X } from "lucide-react";
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
import { TrendsView, SourcesView, TeamsView } from "./monitor-views";
import { ResearchDashboard } from "./research-dashboard";
import { buildDashboard, defaultDashboardFilters, type DashboardFilters, type DashboardDrill } from "@/lib/dashboard";
const nav = [{ id: "dashboard", label: "科研仪表盘", icon: LayoutDashboard }, { id: "feed", label: "论文动态", icon: Activity }, { id: "trends", label: "方向趋势", icon: ChartNoAxesCombined }, { id: "teams", label: "团队观察", icon: Users }, { id: "saved", label: "选题收藏", icon: Bookmark }, { id: "sources", label: "数据与同步", icon: Database }];
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
    const [data, setData] = useState<MonitorData | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
    const [collections, setCollections] = useState<Collection[]>([]), [teams, setTeams] = useState<Team[]>([]), [selected, setSelected] = useState<Paper | null>(null), [note, setNote] = useState(""), [stage, setStage] = useState("待读"), [saving, setSaving] = useState(false);
    const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>(defaultDashboardFilters);
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
    const load = useCallback(async () => {
        try {
            const d = await api("/api/papers");
            flushSync(() => { setData(d); setError(""); });
            return d as MonitorData;
        } catch (e) { setError((e as Error).message); return null; }
        finally { await refreshPersonal(); setLoading(false); }
    }, [refreshPersonal]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const onStorage = (event: StorageEvent) => { if (event.key === LOCAL_DATA_KEY || event.key === null) void refreshPersonal(); };
        window.addEventListener("storage", onStorage);
        const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 300000);
        return () => { clearInterval(timer); window.removeEventListener("storage", onStorage); };
    }, [load, refreshPersonal]);
    useEffect(() => setLimit(30), [view, search, track, task, modality, organ, method, source, status, period, human]);
    const savedIds = useMemo(() => new Set(collections.map(c => c.paperId)), [collections]);
    const papers = data?.papers ?? [];
    const filtered = useMemo(() => { const q = search.trim().toLowerCase(); const boundary = period === "all" ? null : Date.now() - Number(period) * 86400000; return papers.filter(p => (view !== "feed" || !drillIds || drillIds.has(p.id)) && (view !== "saved" || savedIds.has(p.id)) && (track === "all" || p.tracks.includes(track)) && (task === "all" || p.tasks.includes(task)) && (modality === "all" || p.modalities.includes(modality)) && (organ === "all" || p.organs.includes(organ)) && (method === "all" || p.methods.includes(method)) && (source === "all" || p.sources.includes(source)) && (status === "all" || p.status === status) && (human === "all" || p.humanSignals.includes(human)) && (!boundary || (Date.parse(p.publishedAt) >= boundary && p.publishedAt <= new Date().toISOString().slice(0, 10))) && (!q || `${p.title} ${p.abstract} ${p.authors.map(a => a.name).join(" ")} ${p.affiliations.join(" ")} ${p.doi ?? ""}`.toLowerCase().includes(q))).sort((a, b) => sort === "oldest" ? a.publishedAt.localeCompare(b.publishedAt) : sort === "discovered" ? b.firstSeenAt.localeCompare(a.firstSeenAt) : b.publishedAt.localeCompare(a.publishedAt)); }, [papers, search, track, task, modality, organ, method, source, status, period, view, savedIds, sort, human, drillIds]);
    const modalities = [...new Set(papers.flatMap(p => p.modalities))].sort();
    const reset = () => { setDashboardDrill(null); setSearch(""); setTrack("all"); setTask("all"); setModality("all"); setOrgan("all"); setMethod("all"); setSource("all"); setStatus("all"); setPeriod("all"); setHuman("all"); };
    const openDrill = (drill: DashboardDrill) => { reset(); setDashboardDrill({...drill,label:tr(drill.label)}); setView("feed"); setSort("discovered"); };
    const openPaper = (p: Paper) => { setSelected(p); const c = collections.find(c => c.paperId === p.id); setNote(c?.note ?? ""); setStage(c?.stage ?? "待读"); };
    const savePaper = async (p: Paper, withNote = false) => {
                if (!data?.personalStorageAvailable) {
            toast.error(tr("存储暂时不可用，请稍后再试"));
            return;
        }
        setSaving(true);
        try {
            const existing = collections.find(c => c.paperId === p.id);
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
        const rows = [["标题", "作者", "来源日期", "来源", "状态", "DOI", "原文链接", "任务标签", "模态", "笔记"].map(v => tr(v)), ...filtered.map(p => [p.title, p.authors.map(a => a.name).join("; "), p.publishedAt, p.sources.join("; "), p.status, p.doi, p.url, p.tasks.map(t => tr(TASKS[t])).join("; "), p.modalities.map(v => tr(v)).join("; "), collections.find(c => c.paperId === p.id)?.note ?? ""])];
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
    const current = nav.find(n => n.id === view)!;
    const filterPanel = <div className="filter-panel"><div className="search-box"><Search size={18}/><Input aria-label={tr("搜索论文")} placeholder={tr("搜索论文、方法、作者、疾病或 DOI\u2026")} value={search} onChange={e => setSearch(e.target.value)}/></div><div className="filter-row"><SlidersHorizontal size={16}/><Picker label={tr("研究任务")} value={task} onChange={setTask} options={[["all", "全部研究任务"], ...Object.entries(TASKS)]}/><Picker label={tr("影像模态")} value={modality} onChange={setModality} options={[["all", "全部模态"], ...modalities.map(x => [x, x] as [
                string,
                string
            ])]}/><Picker label={tr("器官或疾病")} value={organ} onChange={setOrgan} options={[["all", "全部器官 / 疾病"], ...[...new Set(papers.flatMap(p => p.organs))].sort().map(x => [x, x] as [
                string,
                string
            ])]}/><Picker label={tr("研究方法")} value={method} onChange={setMethod} options={[["all", "全部研究方法"], ...[...new Set(papers.flatMap(p => p.methods))].sort().map(x => [x, x] as [
                string,
                string
            ])]}/><Picker label={tr("数据来源")} value={source} onChange={setSource} options={[["all", "全部来源"], ["Europe PMC", "Europe PMC"], ["arXiv", "arXiv"], ["medRxiv", "medRxiv"]]}/><Picker label={tr("发表状态")} value={status} onChange={setStatus} options={[["all", "全部发表状态"], ["preprint", "预印本"], ["published", "正式发表"]]}/><Picker label={tr("记录日期范围")} value={period} onChange={setPeriod} options={[["all", "全部记录日期"], ["30", "近 30 天"], ["90", "近 90 天"], ["365", "近一年"]]}/><Button variant="ghost" size="sm" onClick={reset}>{tr("重置")}</Button></div>{track === "human_loop" && <div className="filter-row subfilters"><span>{tr("人参与线索")}</span><Picker label={tr("人参与线索")} value={human} onChange={setHuman} options={[["all", "全部线索"], ...Object.entries(HUMAN_LABELS)]}/><span className="muted">{tr("关键词线索，临床协作效果待核实")}</span></div>}</div>;
    return <SidebarProvider style={{ "--sidebar-width": locale === "en" ? "260px" : "240px" } as React.CSSProperties}><Toaster richColors position="bottom-right"/><Sidebar><SidebarHeader className="brand"><div className="brand-symbol"><Focus size={25}/></div><div><strong>{tr("医学影像科研观察")}</strong><span>{tr("研究动态 \u00B7 团队协作")}</span></div></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>{tr("研究工作台")}</SidebarGroupLabel><SidebarMenu>{nav.map(n => <SidebarMenuItem key={n.id}><NavButton isActive={view === n.id} size="lg" onClick={() => setView(n.id)}><n.icon /><span>{tr(n.label)}</span>{n.id === "saved" && collections.length > 0 && <span className="nav-count">{collections.length}</span>}</NavButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup><SidebarGroup><SidebarGroupLabel>{tr("重点方向")}</SidebarGroupLabel><SidebarMenu>{Object.entries(TRACKS).map(([id, label]) => <SidebarMenuItem key={id}><NavButton size="lg" isActive={track === id && view === "feed"} onClick={() => { setView("feed"); setTrack(id); }}>{id === "segmentation" ? <Layers3 /> : <Workflow />}<span>{tr(label)}</span></NavButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter><a className="homepage-link" href="https://yazhouzhu19.github.io/" target="_blank" rel="noreferrer">{tr("Yazhou Zhu \u00B7 个人主页 ")}<ArrowUpRight size={13}/></a><div className="sidebar-note"><Database size={16}/><span>{data ? tr("{0} 条已采集记录", [papers.length]) : tr("读取论文库")}<br /><small>{tr("最后更新 ")}{tr(fmtTime(data?.lastSuccessfulSync ?? data?.collectedAt))}</small></span></div></SidebarFooter></Sidebar><SidebarInset><header className="topbar"><div className="topbar-label"><SidebarTrigger /><span>{tr("研究工作台")}</span><span className="divider">/</span><strong>{tr(current.label)}</strong></div><div className="account-controls"><nav className="language-switch" aria-label={locale === "en" ? "Language" : "界面语言"}><a href="/research-monitor/" hrefLang="zh-CN" lang="zh-CN" aria-current={locale === "zh" ? "page" : undefined}>中文</a><a href="/research-monitor/en/" hrefLang="en" lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</a></nav><span className="private-label">{tr("浏览器本地保存")}</span>{accountControl}</div></header><div className={`workspace${view === "dashboard" ? " dashboard-workspace" : ""}`}><div className="page-heading"><div>{view !== "dashboard" && <p className="eyebrow">MEDICAL IMAGE ANALYSIS</p>}<h1>{view === "dashboard" ? tr("科研监测仪表盘") : view === "feed" ? tr("与你研究相关的进展") : view === "trends" ? tr("观察研究方向的变化") : view === "teams" ? tr("理解团队，发现连接") : view === "saved" ? tr("从阅读到下一个课题") : tr("让每一条记录有据可查")}</h1><p>{view === "dashboard" ? tr("器官与病灶分割 \u00B7 人在回路临床诊断") : view === "feed" ? tr("器官与病灶分割 \u00B7 人在回路临床诊断") : view === "trends" ? tr("统计范围为当前已采集论文库，不代表全领域增长。") : view === "teams" ? tr("以确认的成员名单追踪研究，保留合作线索的证据。") : view === "saved" ? tr("记录阅读判断、相关问题和下一步验证。") : tr("查看数据覆盖、检索范围与同步结果。")}</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>{tr("刷新数据")}</Button></div>
 {error && <div className="notice error" role="alert">{tr(error)}<Button variant="ghost" onClick={() => void load()}>{tr("重新读取")}</Button></div>}{data?.personalStorageError && <div className="notice error" role="alert">{tr(data.personalStorageError)}</div>}{data?.error && <div className="notice error" role="alert">{tr("存在来源采集失败，已保留已有论文。详情请查看同步日志。")}</div>}{data?.totalStored && data.totalStored > papers.length ? <div className="notice">{tr("库内共 ")}{data.totalStored}{tr(" 条记录，当前展示最新 ")}{papers.length}{tr(" 条；筛选与图表基于当前展示范围。")}</div> : null}
 {(view === "saved" || view === "teams") && <div className="notice"><Info size={17}/><span>{tr("个人记录仅保存在当前浏览器；切换设备或清除浏览器数据前，请从右上角导出个人备份。")}</span></div>}
 {view === "feed" && <div className="focus-grid">{Object.entries(TRACKS).map(([id, label]) => <button key={id} className={track === id ? "focus-card selected" : "focus-card"} onClick={() => setTrack(track === id ? "all" : id)}>{id === "segmentation" ? <Layers3 /> : <Workflow />}<div><strong>{tr(label)}</strong><span>{id === "segmentation" ? tr("通用分割 \u00B7 提示式分割 \u00B7 交互修正") : tr("医生反馈 \u00B7 读片者研究 \u00B7 人机协同")}</span></div><b>{papers.filter(p => p.tracks.includes(id)).length}</b><ArrowUpRight /></button>)}</div>}
 {view === "feed" && dashboardDrill && <div className="dash-drill-banner"><div><strong>{tr("仪表盘分析：")}{dashboardDrill.label}</strong><span>{dashboardDrill.ids.length}{tr(" 条范围记录 \u00B7 下方筛选可继续缩小范围")}</span></div><Button variant="outline" onClick={() => { setDashboardDrill(null); setView("dashboard"); }}>{tr("返回仪表盘")}</Button><Button variant="ghost" onClick={reset}>{tr("清除钻取")}</Button></div>}
 {(view === "feed" || (view === "saved" && authenticated) || view === "trends") && filterPanel}
 {loading ? <div className="loading-papers">{[1, 2, 3].map(n => <Skeleton key={n} className="h-28 w-full rounded-xl"/>)}</div> : !authenticated && (view === "teams" || view === "saved") ? personalGate : view === "dashboard" && data ? <ResearchDashboard authenticated={authenticated} data={data} teams={teams} collections={collections} filters={dashboardFilters} onFilters={setDashboardFilters} onDrill={openDrill} onNavigate={setView} onPaper={openPaper}/> : view === "trends" ? <TrendsView papers={filtered} runs={data?.runs ?? []}/> : view === "teams" ? <TeamsView papers={papers} teams={teams} onChange={() => void refreshPersonal()} openPaper={openPaper} storageAvailable={!!data?.personalStorageAvailable}/> : view === "sources" ? <SourcesView data={data}/> : <section className="paper-section"><div className="section-heading"><div><h2>{view === "saved" ? tr("我的选题库") : track === "all" ? tr("论文动态") : tr(TRACKS[track])} <span>{filtered.length}{tr(" 条")}</span></h2><p className="section-caption">{tr("按 DOI / 来源标识去重 \u00B7 自动标签待复核")}</p></div><div className="list-tools"><Picker label={tr("排序")} value={sort} onChange={setSort} options={[["newest", "来源日期 ↓"], ["oldest", "来源日期 ↑"], ["discovered", "发现时间 ↓"]]}/><Button variant="ghost" size="icon" aria-label={tr("导出当前筛选记录")} onClick={exportCsv} disabled={!filtered.length}><Download size={16}/></Button></div></div>{filtered.length === 0 ? <div className="empty-state"><Search /><p>{view === "saved" ? tr("还没有符合条件的收藏") : tr("没有符合条件的记录")}</p><span>{view === "saved" ? tr("在论文详情里收藏论文、添加阅读笔记。") : tr("尝试移除部分筛选，或同步最新论文。")}</span><Button className="mt-4" variant="outline" onClick={reset}>{tr("清除筛选")}</Button></div> : filtered.slice(0, limit).map(p => <article key={p.id} className="paper-row"><div className="paper-main"><div className="paper-meta"><Badge className={p.status === "preprint" ? "status-preprint" : "status-published"} variant="secondary">{p.status === "preprint" ? tr("预印本") : p.status === "published" ? tr("正式发表") : tr("状态未确认")}</Badge><span>{p.sources.join(" · ")}</span><span>{tr(fmtDate(p.publishedAt))}{p.source === "medRxiv" ? tr(" \u00B7 版本日期") : ""}</span>{p.version && <span>v{p.version}</span>}{p.publishedAt > new Date().toISOString().slice(0, 10) && <span>{tr("来源标注未来日期")}</span>}</div><button className="paper-title" onClick={() => openPaper(p)}>{p.title}<ChevronRight size={17}/></button><div className="paper-authors">{p.authors.slice(0, 4).map(a => a.name).join(" · ")}{p.authors.length > 4 ? tr(" 等 {0} 位作者", [p.authors.length]) : ""}</div><p className="abstract-preview">{p.abstract || tr("来源未提供摘要")}</p><div className="tag-row">{p.tasks.slice(0, 2).map(t => <span className="tag task-tag" key={t}>{tr(TASKS[t])}</span>)}{p.modalities.slice(0, 2).map(t => <span className="tag" key={t}>{tr(t)}</span>)}{p.humanSignals.filter(t => t !== "annotation" && t !== "simulated").slice(0, 1).map(t => <span className="tag human-tag" key={t}>{tr(HUMAN_LABELS[t])}</span>)}{view === "saved" && <span className="tag saved-tag">{tr(collections.find(c => c.paperId === p.id)?.stage ?? "")}</span>}</div>{view === "saved" && collections.find(c => c.paperId === p.id)?.note && <p className="saved-note">{collections.find(c => c.paperId === p.id)?.note}</p>}</div><Button variant="ghost" size="icon" aria-label={savedIds.has(p.id) ? tr("取消收藏：{0}", [p.title]) : tr("收藏：{0}", [p.title])} onClick={() => savedIds.has(p.id) ? void removePaper(p) : void savePaper(p)} disabled={saving || !data?.personalStorageAvailable}>{savedIds.has(p.id) ? <BookmarkCheck className="saved-icon"/> : <Bookmark />}</Button></article>)}{filtered.length > limit && <div className="load-more"><Button variant="outline" onClick={() => setLimit(l => l + 30)}>{tr("再显示 30 条 \u00B7 剩余 ")}{filtered.length - limit}{tr(" 条")}</Button></div>}</section>}
 {view !== "dashboard" && <div className="workspace-footnote"><Info size={14}/><span>{tr("当前覆盖 Europe PMC、arXiv 与 medRxiv 的两个重点方向。预印本未必经过同行评审；相似标题不自动合并。")}</span></div>}</div></SidebarInset>
 <Sheet open={!!selected} onOpenChange={open => {
            if (!open)
                setSelected(null);
        }}><SheetContent className="paper-detail"><SheetHeader><SheetTitle>{tr("论文详情")}</SheetTitle><SheetDescription>{tr("查看原始证据、版本与阅读笔记。")}</SheetDescription></SheetHeader>{selected && <div className="detail-body"><div className="paper-meta"><Badge variant="secondary" className={selected.status === "preprint" ? "status-preprint" : "status-published"}>{selected.status === "preprint" ? tr("预印本") : selected.status === "published" ? tr("正式发表") : tr("状态未确认")}</Badge><span>{selected.sources.join(" · ")}</span></div><h2>{selected.title}</h2><p className="detail-authors">{selected.authors.map(a => a.name).join(" · ")}</p><Button asChild variant="outline"><a href={selected.url} target="_blank" rel="noreferrer">{tr("查看原始论文")}<ArrowUpRight size={16}/></a></Button><dl className="detail-dates"><div><dt>{selected.source === "medRxiv" ? tr("该版本发布日期") : tr("来源发表 / 提交日期")}</dt><dd>{tr(fmtDate(selected.publishedAt))}</dd></div><div><dt>{tr("平台首次发现")}</dt><dd>{fmtTime(selected.firstSeenAt)}</dd></div>{selected.updatedAt && <div><dt>{tr("来源更新时间")}</dt><dd>{fmtDate(selected.updatedAt)}</dd></div>}{selected.venue && <div><dt>{tr("期刊 / 发表信息")}</dt><dd>{selected.venue}</dd></div>}{selected.doi && <div><dt>{selected.source === "arXiv" ? tr("关联 DOI") : "DOI"}</dt><dd>{selected.doi}</dd></div>}</dl>{selected.relatedDoi && <p className="related-publication">{tr("来源提供了正式发表关联：")}<a href={`https://doi.org/${selected.relatedDoi}`} target="_blank" rel="noreferrer">{selected.relatedDoi}<ArrowUpRight size={14}/></a></p>}<h3>{tr("原始摘要")}</h3><p className="full-abstract">{selected.abstract || tr("来源未提供摘要。")}</p><h3>{tr("自动分类")}</h3><div className="tag-row">{[...selected.tasks.map(t => TASKS[t]), ...selected.modalities, ...selected.organs, ...selected.methods].map(t => <span className="tag" key={t}>{tr(t)}</span>)}</div><p className="detail-hint">{tr("基于标题与摘要规则匹配；标签不构成研究质量或临床效果判断。")}</p><h3>{tr("人参与线索")}</h3>{selected.evidence.length ? selected.evidence.map((e, i) => <div className="evidence" key={i}><strong>{tr(e.label)}</strong><blockquote>…{e.excerpt}…</blockquote></div>) : <p className="detail-hint">{tr("摘要中未检出明确线索，不能据此认定研究没有人参与。")}</p>}{selected.humanSignals.includes("simulated") && <div className="notice">{tr("检出模拟交互表述，不能将模拟点击视为真实医生使用证据。")}</div>}<h3>{tr("作者机构")}</h3>{selected.affiliations.length ? <ul className="affiliation-list">{selected.affiliations.map(a => <li key={a}>{a}</li>)}</ul> : <p className="detail-hint">{tr("来源未提供机构，未推断当前任职。")}</p>}<p className="detail-hint">{tr("机构为论文署名信息；medRxiv 通常仅提供通讯作者机构。")}</p>{authenticated ? <><h3>{tr("我的阅读笔记")}</h3><Picker label={tr("阅读状态")} value={stage} onChange={setStage} options={["待读", "已读", "选题候选", "暂不相关"].map(x => [x, x])}/><Textarea className="note-input" aria-label={tr("阅读笔记")} placeholder={tr("与我们课题的关系、可复现之处、值得验证的问题\u2026")} value={note} onChange={e => setNote(e.target.value)}/><Button onClick={() => void savePaper(selected, true)} disabled={saving || !data?.personalStorageAvailable}>{saving ? <RefreshCw className="animate-spin"/> : <Check />}{tr("保存笔记与收藏")}</Button></> : <div className="public-note-login"><p>{tr("登录后可保存个人收藏与阅读笔记。")}</p>{accountControl}</div>}<h3>{tr("记录来源")}</h3>{selected.provenance.slice(-3).map((p, i) => <p key={i} className="detail-hint">{tr("源记录 ")}{p.sourceRecordId ?? tr("未提供")}{tr(" \u00B7 采集于 ")}{fmtTime(p.collectedAt)}</p>)}</div>}</SheetContent></Sheet>
 </SidebarProvider>;
}
