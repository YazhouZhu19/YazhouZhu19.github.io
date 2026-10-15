"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, GitFork, Search, Star, X } from "lucide-react";
import { type GitHubSignal, type ResearchSignal, type ResearchSignalsData, type SignalSourceState, safeSignalUrl } from "@/lib/research-signals";
import { GITHUB_DISCOVERY_GROUPS } from "@/lib/github-discovery";
import { NEWS_DISCOVERY_GROUPS, NEWS_QUERIES } from "@/lib/news-discovery";
import { getSignalBrowseCategories, getSignalBrowseCategoryIds } from "@/lib/signal-browse-categories";
import { signalDashboardDate } from "@/lib/signal-dashboard";
import { buildGitHubDashboard, githubDashboardDate } from "@/lib/github-dashboard";
import { buildNewsDashboard, newsDashboardAsOf, newsDashboardDate, type NewsDashboardClock } from "@/lib/news-dashboard";
import { beijingDay } from "@/lib/dashboard";
import { RELEVANCE_REASON_LABELS } from "@/lib/signal-relevance";
import { explicitEvidenceKeys, findRelatedSignals } from "@/lib/signal-evidence";
import type { Paper } from "@/lib/types";
import type { DashboardDrill } from "@/lib/dashboard";
import { AiModelSettings, AiResearchPanel } from "./ai-research-panel";
import type { SignalDashboardDrill } from "./signal-dashboard";
import { GitHubDashboard, GitHubDashboardSummary } from "./github-dashboard";
import { NewsDashboard, NewsDashboardSummary } from "./news-dashboard";
import { DashboardChoice } from "./dashboard-choice";
import { useI18n } from "./locale-provider";
import "@/styles/research-signals.css";
import "@/styles/signal-dashboard.css";
import "@/styles/ai-research.css";
import "@/styles/foresight.css";

type Props = {
  kind: "github" | "news";
  snapshot: ResearchSignalsData | null;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  papers: Paper[];
  onPaper: (paper: Paper) => void;
  onDrill: (drill: DashboardDrill) => void;
};
type RelevanceFilter = "direct" | "candidate" | "all";
type DashboardRange = 7 | 30 | 90 | "all" | "custom";
type BrowseDrill = SignalDashboardDrill & { global?: boolean; exactIds?: boolean };
type BrowseState = { query: string; category: string; relevance: RelevanceFilter; from: string; to: string; sort: string; limit: number; compareIds: string[]; analyze: boolean; view: "overview" | "library"; drill: BrowseDrill | null; dateRange?: DashboardRange; githubClock?: "activity" | "creation"; newsClock?: NewsDashboardClock };
const browseSessions = new Map<Props["kind"], BrowseState>();

function discoverySearchUrl(kind: Props["kind"], query: string): string {
  if (kind === "github") return `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
  const locale = NEWS_QUERIES.find(route => route.query === query);
  const params = new URLSearchParams({ q: query, hl: locale?.hl ?? "en-US", gl: locale?.gl ?? "US", ceid: locale?.ceid ?? "US:en" });
  return `https://news.google.com/search?${params}`;
}

const dateLabel = (value: string | null | undefined, empty: string) => value ? value.slice(0, 10) : empty;
const isNewsBackfill = (source: SignalSourceState) => source.kind === "news" && new URL(source.url).hostname === "news.google.com" && source.status === "partial" && !source.error;
function relatedRecords(signal: ResearchSignal, byKey: Map<string, ResearchSignal[]>) {
  const linked = new Map<string, ResearchSignal>();
  for (const key of explicitEvidenceKeys([signal.url, ...signal.relatedUrls, signal.kind === "news" ? signal.originalUrl : null])) {
    for (const other of byKey.get(key) ?? []) if (other.kind !== signal.kind) linked.set(other.id, other);
  }
  return [...linked.values()].slice(0, 4);
}
function SourceLink({ url, children }: { url: string | null | undefined; children: React.ReactNode }) {
  return safeSignalUrl(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13}/></a> : null;
}

export function ResearchSignalsView({ kind, snapshot, loading, error, onRefresh, papers, onPaper, onDrill }: Props) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [query, setQuery] = useState(() => browseSessions.get(kind)?.query ?? "");
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState(() => browseSessions.get(kind)?.category ?? "all");
  const [relevance, setRelevance] = useState<RelevanceFilter>(() => browseSessions.get(kind)?.relevance ?? "all");
  const [from, setFrom] = useState(() => browseSessions.get(kind)?.from ?? "");
  const [to, setTo] = useState(() => browseSessions.get(kind)?.to ?? "");
  const [sort, setSort] = useState(() => browseSessions.get(kind)?.sort ?? "latest");
  const [limit, setLimit] = useState(() => browseSessions.get(kind)?.limit ?? 24);
  const [compareIds, setCompareIds] = useState<string[]>(() => browseSessions.get(kind)?.compareIds ?? []);
  const [analyze, setAnalyze] = useState(() => browseSessions.get(kind)?.analyze ?? false);
  const [view, setView] = useState<BrowseState["view"]>(() => browseSessions.get(kind)?.view ?? "overview");
  const [drill, setDrill] = useState<BrowseDrill | null>(() => browseSessions.get(kind)?.drill ?? null);
  const [dateRange, setDateRange] = useState<DashboardRange>(() => browseSessions.get(kind)?.dateRange ?? 30);
  const [githubClock, setGithubClock] = useState<"activity" | "creation">(() => browseSessions.get(kind)?.githubClock ?? "activity");
  const [newsClock, setNewsClock] = useState<NewsDashboardClock>(() => browseSessions.get(kind)?.newsClock ?? "publication");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  const analysisRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const records = useMemo(() => (snapshot?.records ?? []).filter(record => record.kind === kind), [snapshot, kind]);
  const recordLinkIndex = useMemo(() => {
    const index = new Map<string, ResearchSignal[]>();
    for (const record of snapshot?.records ?? []) {
      for (const key of explicitEvidenceKeys([record.url, ...record.relatedUrls, record.kind === "news" ? record.originalUrl : null])) {
        const linked = index.get(key) ?? [];
        linked.push(record); index.set(key, linked);
      }
    }
    return index;
  }, [snapshot]);
  const relatedPapers = useMemo(() => new Map(findRelatedSignals(papers, records).map(association => [association.signal.id, association.paperIds])), [papers, records]);
  const paperById = useMemo(() => new Map(papers.map(paper => [paper.id, paper])), [papers]);
  const categories = getSignalBrowseCategories(kind);
  const datesById = useMemo(() => new Map(records.map(record => [record.id, signalDashboardDate(record)])), [records]);
  const selectedDatesById = useMemo(() => new Map(records.map(record => [record.id, record.kind === "github" ? githubDashboardDate(record, githubClock) : newsDashboardDate(record, newsClock)])), [records, githubClock, newsClock]);
  const categoryIndex = useMemo(() => {
    const byRecord = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const record of records) {
      const ids = getSignalBrowseCategoryIds(record);
      byRecord.set(record.id, ids);
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return { byRecord, counts };
  }, [records]);
  const discoveryCatalog = kind === "github" ? GITHUB_DISCOVERY_GROUPS : NEWS_DISCOVERY_GROUPS;
  const discoveryCounts = useMemo(() => new Map(discoveryCatalog.map(group => [group.id, records.filter(record => record.discoveryGroups?.includes(group.id)).length])), [records, discoveryCatalog]);
  const directCount = records.filter(record => record.relevance?.level === "direct").length;
  const candidateCount = records.length - directCount;
  const sources = useMemo(() => (snapshot?.sources ?? []).filter(source => source.kind === kind)
    .sort((a, b) => Number(b.id.startsWith("rss-news-")) - Number(a.id.startsWith("rss-news-"))), [snapshot, kind]);
  const sourceCheckedAt = useMemo(() => sources.map(source => source.checkedAt).filter((value): value is string => value !== null && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1), [sources]);
  const googleSourceCount = sources.filter(source => new URL(source.url).hostname === "news.google.com").length;
  const publisherCount = useMemo(() => new Set(records.map(record => record.publisher.trim().toLocaleLowerCase("en")).filter(name => name && !/^(unknown|unspecified|n\/?a|none|null|未知|未注明|未提供)$/.test(name))).size, [records]);
  const invalidDates = dateRange === "custom" && !!from && !!to && from > to;
  const baseRecords = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    return records.filter(record => {
      const matchesCategory = category === "all" || categoryIndex.byRecord.get(record.id)?.includes(category);
      const matchesRelevance = relevance === "all" || (relevance === "direct" ? record.relevance?.level === "direct" : record.relevance?.level !== "direct");
      const text = `${record.title} ${record.summary} ${record.publisher} ${record.topics.join(" ")} ${record.kind === "github" ? `${record.fullName} ${record.language ?? ""} ${record.readmeExcerpt}` : ""}`.toLowerCase();
      return matchesCategory && matchesRelevance && (!search || text.includes(search));
    });
  }, [records, categoryIndex, deferredQuery, category, relevance]);
  const githubModel = useMemo(() => kind === "github" ? buildGitHubDashboard(records, { baseRecords, range: dateRange, clock: githubClock, from, to }, now, snapshot?.generatedAt ?? "") : null, [kind, records, baseRecords, dateRange, githubClock, from, to, now, snapshot?.generatedAt]);
  const newsAsOf = useMemo(() => newsDashboardAsOf(snapshot), [snapshot]);
  const newsModel = useMemo(() => kind === "news" ? buildNewsDashboard(records, { baseRecords, range: dateRange, clock: newsClock, from, to }, now, newsAsOf ?? "") : null, [kind, records, baseRecords, dateRange, newsClock, from, to, now, newsAsOf]);
  const dashboardModel = githubModel ?? newsModel;
  const scopedRecords = useMemo(() => {
    if (invalidDates) return [];
    const rows: ResearchSignal[] = dashboardModel?.rows ?? [];
    return [...rows].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const left = selectedDatesById.get(a.id) ?? "", right = selectedDatesById.get(b.id) ?? "";
      if (!left || !right) return left ? -1 : right ? 1 : a.id.localeCompare(b.id);
      return (sort === "oldest" ? left.localeCompare(right) : right.localeCompare(left)) || a.id.localeCompare(b.id);
    });
  }, [dashboardModel, selectedDatesById, sort, invalidDates]);
  const filtered = useMemo(() => {
    if (!drill) return scopedRecords;
    const ids = new Set(drill.ids);
    const rows = (drill.global || drill.exactIds ? records : scopedRecords).filter(record => ids.has(record.id));
    if (!drill.global && !drill.exactIds) return rows;
    return rows.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const left = selectedDatesById.get(a.id) ?? "", right = selectedDatesById.get(b.id) ?? "";
      if (!left || !right) return left ? -1 : right ? 1 : a.id.localeCompare(b.id);
      return (sort === "oldest" ? left.localeCompare(right) : right.localeCompare(left)) || a.id.localeCompare(b.id);
    });
  }, [scopedRecords, records, drill, selectedDatesById, sort]);
  const analysisRecords = useMemo(() => filtered.filter(record => record.relevance?.level === "direct"), [filtered]);
  const compared = useMemo(() => records.filter((record): record is GitHubSignal => record.kind === "github" && compareIds.includes(record.id)), [records, compareIds]);
  const unhealthy = sources.filter(source => source.status === "error" || (source.status === "partial" && !!source.error));
  const backfilling = sources.filter(isNewsBackfill);
  const pending = sources.filter(source => source.status === "pending");
  useEffect(() => { setLimit(24); }, [deferredQuery, category, relevance, from, to, sort, drill, dateRange, githubClock, newsClock]);
  useEffect(() => { browseSessions.set(kind, { query, category, relevance, from, to, sort, limit, compareIds, analyze, view, drill, dateRange, githubClock, newsClock }); }, [kind, query, category, relevance, from, to, sort, limit, compareIds, analyze, view, drill, dateRange, githubClock, newsClock]);
  useEffect(() => {
    if (!snapshot) return;
    const available = new Set(records.map(record => record.id));
    setCompareIds(ids => ids.some(id => !available.has(id)) ? ids.filter(id => available.has(id)) : ids);
  }, [snapshot, records]);
  const changeScope = (change: () => void) => { setDrill(null); change(); };
  const reset = () => { setDrill(null); setQuery(""); setCategory("all"); setRelevance("all"); setFrom(""); setTo(""); setSort("latest"); setDateRange(30); setGithubClock("activity"); setNewsClock("publication"); };
  const switchView = (next: BrowseState["view"]) => { setView(next); setDrill(null); };
  const openDashboardRecords = (selection: SignalDashboardDrill) => {
    setDrill({ ...selection, exactIds: true }); setView("library"); setLimit(24);
    requestAnimationFrame(() => { contentRef.current?.focus({ preventScroll: true }); contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  };
  const openGlobalRecords = (selection: SignalDashboardDrill) => {
    setQuery(""); setCategory("all"); setRelevance("all"); setFrom(""); setTo(""); setDateRange("all"); setGithubClock("activity"); setNewsClock("publication"); setSort("latest");
    setDrill({ ...selection, global: true }); setView("library"); setLimit(24);
    requestAnimationFrame(() => { contentRef.current?.focus({ preventScroll: true }); contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  };
  const showAnalysis = () => {
    setAnalyze(true);
    requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const noDate = t("未提供日期", "Date not provided");
  const searchControl = <div><label htmlFor={`${fieldId}-search`}>{kind === "github" ? t("搜索项目", "Search repositories") : t("搜索公开消息", "Search announcements")}</label><div className="signals-search"><Search size={16}/><input id={`${fieldId}-search`} type="search" value={query} onChange={event => changeScope(() => setQuery(event.target.value))} placeholder={kind === "github" ? t("项目、模型、任务或开发者…", "Repository, model, task, or developer…") : t("模型、技术或发布者…", "Model, method, or publisher…")}/></div></div>;
  const choiceControl = (id: string, label: string, value: string, onChange: (value: string) => void, options: [string, string][], describedBy?: string) => <DashboardChoice id={id} label={label} value={value} onChange={onChange} options={options} describedBy={describedBy}/>;
  const sortControl = <div className="dash-control"><label htmlFor={`${fieldId}-sort`}>{t("列表排序", "Library sort")}</label>{choiceControl(`${fieldId}-sort`, t("列表排序", "Library sort"), sort, setSort, [["latest", t("最近日期优先", "Newest first")], ["oldest", t("最早日期优先", "Oldest first")], ["title", t("名称", "Name")]])}</div>;

  const sourceHealth = <details className="signals-source-health">
      <summary>{t("采集范围与来源状态", "Collection scope and source status")}<span>{sources.length} {t("个检索 / 采集入口", "collection endpoints")}{pending.length > 0 ? ` · ${pending.length} ${t("项待首次检查", "awaiting first check")}` : ""}{backfilling.length > 0 ? ` · ${backfilling.length} ${t("项历史补采中", "backfill in progress")}` : ""}{unhealthy.length > 0 ? ` · ${unhealthy.length} ${t("项需留意", "need attention")}` : ""} · {t("快照", "Snapshot")} {dateLabel(snapshot?.generatedAt, noDate)}</span></summary>
      <p>{t("这是已采集的公开样本，并非全网收录。刷新读取网站已发布的快照，不会触发实时全网检索。", "This is a collected public sample, not exhaustive web coverage. Refresh loads the published snapshot; it does not run a live web search.")}</p>
      {kind === "news" && <p>{t(`${googleSourceCount} 个 Google 检索入口 · ${sources.length - googleSourceCount} 个独立订阅源 · 库内 ${publisherCount} 个发布者名称。检索入口与原始发布者是不同口径；同一发布者可被多个入口发现。`, `${googleSourceCount} Google discovery routes · ${sources.length - googleSourceCount} independent feeds · ${publisherCount} publisher names in the library. Discovery routes and original publishers are different counts; several routes can find the same publisher.`)}</p>}
      {kind === "github" && snapshot?.discoveryState?.github && <p>{t("分批检索进度", "Batched discovery progress")} · {t("累计完成查询", "Queries completed")} {snapshot.discoveryState.github.completedQueries} · {t("待继续的分页／时间窗口", "Queued pages / date windows")} {snapshot.discoveryState.github.queue.length}{snapshot.discoveryState.github.lastRun ? ` · ${t("本轮搜索请求", "Search requests this run")} ${snapshot.discoveryState.github.lastRun.searchRequests}` : ""}{t("。", ". ")}{t("进度仅覆盖已配置检索，不代表全网覆盖率。", "Progress covers configured searches, not a percentage of the entire web.")}</p>}
      {kind === "news" && snapshot?.discoveryState?.news && <p>{t("分批检索进度", "Batched discovery progress")} · {t("累计完成时间窗口", "Date windows completed")} {snapshot.discoveryState.news.completedWindows} · {t("待继续的时间窗口", "Queued date windows")} {snapshot.discoveryState.news.queue.length}{t("。", ". ")}{t("时间分窗降低结果截断，但仍受 Google 新闻索引范围影响。", "Date windows reduce result truncation, while coverage remains limited by the Google News index.")}</p>}
      <details className="signals-source-list"><summary>{t(`查看 ${sources.length} 个入口的检查状态`, `Inspect check status for ${sources.length} endpoints`)}</summary><div className="signals-source-scroll">{sources.map(source => <div className="signals-source-row" key={source.id}><div><strong>{source.name}</strong><span className={`signals-status signals-status-${isNewsBackfill(source) ? "backfill" : source.status}`}>{source.status === "ok" ? t("正常", "OK") : isNewsBackfill(source) ? t("历史补采中", "Backfill in progress") : source.status === "partial" ? t("部分可用", "Partial") : source.status === "pending" ? t("待首次检查", "Awaiting first check") : t("采集失败", "Failed")}</span><SourceLink url={source.url}>{t("检索 / 订阅入口", "Search / feed")}</SourceLink></div><p>{source.coverage}</p><small>{source.checkedAt ? `${t("检查", "Checked")} ${dateLabel(source.checkedAt, noDate)} · ${t("最近检查返回", "Received at last check")} ${source.received}` : t("尚未检查", "Not yet checked")} · {t("保留", "Retained")} {source.retained}{source.lastSuccessAt ? ` · ${t("最近成功", "Last success")} ${dateLabel(source.lastSuccessAt, noDate)}` : ""}</small>{source.error && <p className="signals-source-error">{source.error}</p>}</div>)}</div></details>
      <details className="signals-discovery-catalog"><summary>{t(`查看 ${discoveryCatalog.length} 组详细检索入口`, `Inspect ${discoveryCatalog.length} detailed discovery routes`)}</summary><p>{t("以下是发现入口，同一记录可命中多组。数量为当前库内带有对应检索标签的记录数，不代表该方向的总量或经过验证的任务分类。", "These are discovery routes, and a record may match several groups. Counts show tagged records in this library, not the total size of a field or a verified task classification.")}</p><div className="signals-discovery-grid">{discoveryCatalog.map(group => <div key={group.id}><strong>{t(group.labelZh, group.labelEn)} <span>{discoveryCounts.get(group.id) ?? 0}</span></strong>{group.queries.map(searchQuery => <SourceLink key={searchQuery} url={discoverySearchUrl(kind, searchQuery)}>{searchQuery}</SourceLink>)}</div>)}</div><p>{t("链接会打开来源检索，结果不会自动加入当前页面。", "Links open a search at the source; its results are not automatically added to this page.")}</p></details>
      {snapshot?.limitations.length ? <ul>{snapshot.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}
    </details>;

  return <div className={`research-signals source-signals ${kind}-signals`}>
    <nav className="dashboard-section-tabs signals-dashboard-tabs" aria-label={kind === "github" ? t("GitHub 仪表盘视图", "GitHub dashboard views") : t("公开进展仪表盘视图", "Public progress dashboard views")}><button type="button" className={view === "overview" ? "active" : ""} aria-pressed={view === "overview"} onClick={() => switchView("overview")}>{t("统计总览", "Overview")}</button><button type="button" className={view === "library" ? "active" : ""} aria-pressed={view === "library"} onClick={() => switchView("library")}>{kind === "github" ? t("项目库", "Repository library") : t("新闻库", "News library")}<span>{records.length.toLocaleString()}</span></button></nav>

    {kind === "github" && githubModel && snapshot && <GitHubDashboardSummary model={githubModel} onDrill={openGlobalRecords}/>}
    {kind === "news" && newsModel && snapshot && <NewsDashboardSummary model={newsModel} onDrill={openGlobalRecords} sourceCheckedAt={sourceCheckedAt}/>}
    {error && <div className="signals-notice" role="alert"><p>{snapshot ? t("最新快照暂时无法读取，以下保留上次载入的结果。", "The latest snapshot could not be loaded. Previously loaded results are retained below.") : t("此数据源暂时无法读取；论文库仍可独立使用。", "This source could not be loaded. The paper library remains available independently.")}</p><button type="button" className="foresight-button" onClick={onRefresh} disabled={loading}>{t("重新读取", "Retry")}</button></div>}

    <section className="signals-filters" aria-label={t("统计与列表共同筛选", "Shared dashboard and library filters")}>
      <div className="signals-filter-toolbar source-filter-toolbar">
          <div className="dash-control"><label htmlFor={`${fieldId}-range`}>{t("统计时间", "Time range")}</label><DashboardChoice id={`${fieldId}-range`} label={t("统计时间", "Time range")} value={String(dateRange)} onChange={value => changeScope(() => { setDateRange(["7", "30", "90"].includes(value) ? Number(value) as 7 | 30 | 90 : value as "all" | "custom"); setFrom(""); setTo(""); })} options={[["7", t("近 7 天", "Last 7 days")], ["30", t("近 30 天", "Last 30 days")], ["90", t("近 90 天", "Last 90 days")], ["all", t("全部日期", "All dates")], ["custom", t("自定义日期", "Custom dates")]]}/></div>
          <div className="dash-control"><label htmlFor={`${fieldId}-clock`}>{t("日期口径", "Date basis")}</label>{kind === "github" ? <DashboardChoice id={`${fieldId}-clock`} label={t("日期口径", "Date basis")} value={githubClock} onChange={value => changeScope(() => setGithubClock(value as "activity" | "creation"))} options={[["activity", t("仓库最近活动", "Latest repository activity")], ["creation", t("仓库最初发布时间", "Initial repository publication")]]}/> : <DashboardChoice id={`${fieldId}-clock`} label={t("日期口径", "Date basis")} value={newsClock} onChange={value => changeScope(() => setNewsClock(value as NewsDashboardClock))} options={[["publication", t("消息发布时间", "Announcement publication")], ["discovery", t("平台入库时间", "Library discovery date")]]}/>}</div>
        <div className="dash-control"><label htmlFor={`${fieldId}-category`}>{t("研究方向", "Research area")}</label>{choiceControl(`${fieldId}-category`, t("研究方向", "Research area"), category, value => changeScope(() => setCategory(value)), [["all", `${t("全部方向", "All directions")} (${records.length})`], ...categories.map((group): [string, string] => [group.id, `${t(group.labelZh, group.labelEn)} (${categoryIndex.counts.get(group.id) ?? 0})`])], `${fieldId}-category-hint`)}</div>
        <div className="dash-control"><label htmlFor={`${fieldId}-relevance`}>{t("相关性", "Relevance")}</label>{choiceControl(`${fieldId}-relevance`, t("相关性", "Relevance"), relevance, value => changeScope(() => setRelevance(value as RelevanceFilter)), [["direct", `${t("高相关", "Directly relevant")} (${directCount})`], ["candidate", `${t("待复核", "Needs review")} (${candidateCount})`], ["all", `${t("全部线索", "All leads")} (${records.length})`]], `${fieldId}-relevance-hint`)}</div>
        <button type="button" className="foresight-button" onClick={reset}>{t("重置", "Reset")}</button>
      </div>
      {dateRange === "custom" && <div className="signals-filter-row"><div><label htmlFor={`${fieldId}-from`}>{t("起始日期", "From")}</label><input id={`${fieldId}-from`} type="date" value={from} max={to || undefined} onChange={event => changeScope(() => setFrom(event.target.value))}/></div><div><label htmlFor={`${fieldId}-to`}>{t("截止日期", "To")}</label><input id={`${fieldId}-to`} type="date" value={to} min={from || undefined} onChange={event => changeScope(() => setTo(event.target.value))}/></div></div>}
      <details className="source-search-controls" open={query ? true : undefined}><summary>{t("搜索与列表排序", "Search and library sorting")}{query && ` · ${query}`}</summary><div className="signals-filter-toolbar">{searchControl}{sortControl}</div></details>
      <details className="signals-scope-explanation"><summary>{t("筛选口径与数据说明", "Filter definitions and data notes")}</summary>
        <p className="signals-filter-hint" id={`${fieldId}-category-hint`}>{t(`将检索方向归并为 ${categories.length} 个大类，跨方向记录可属于多类；尚无明确方向的记录归入综合类。括号为全库数量，可叠加其他筛选。`, `Discovery directions are grouped into ${categories.length} broad areas and can overlap. Records without a specific area are included in the general category. Counts cover the full library; combine them with other filters.`)}</p>
        <p className="signals-filter-hint" id={`${fieldId}-relevance-hint`}>{t("总览默认包括全部线索；高相关与待复核可分别筛选。待复核记录不进入 AI 研判。", "The overview includes all leads by default; filter direct and review candidates separately. Candidates do not enter AI assessments.")}{t("相关性不代表科研质量或效果验证。", " Relevance does not establish research quality or validated performance.")}</p>
        <p className="signals-filter-hint">{kind === "github" ? t("仓库最近活动取推送、Release 或创建时间中的最新值；仓库最初发布时间采用 GitHub 仓库创建时间，不等于首次 Release 或转为公开的时间。两者均按北京时间归日；顶部今日入库仍按平台首次发现时间统计。", "Latest activity uses the latest push, release or creation date. Initial publication uses GitHub repository creation time, not the first release or the date a repository became public. Both use Beijing calendar days; Added today still uses the platform first-seen time.") : t("消息发布时间采用检索来源提供的文章日期；平台入库时间采用首次发现时间，并单列最早采集批次。两者均按北京时间归日；入库不等于消息新发布，缺失日期不作推断。", "Publication uses the article date supplied by the discovery source; discovery uses first-seen time with the earliest collection batch separated. Both use Beijing calendar days. Collection is not a new announcement, and missing dates are not inferred.")}</p>
        {kind === "news" && <p className="signals-filter-hint"><SourceLink url={`https://news.google.com/search?q=${encodeURIComponent(query.trim() || "medical imaging AI")}&hl=en-US&gl=US&ceid=US:en`}>{t("在 Google 新闻继续检索", "Continue searching on Google News")}</SourceLink>{t(" · 在新窗口检索，结果不会自动入库。", " · Opens a new search; results are not added automatically.")}</p>}
      </details>
      {invalidDates && <p className="signals-source-error" role="alert">{t("起始日期不能晚于截止日期。", "The start date must not follow the end date.")}</p>}
    </section>

    <div ref={contentRef} className="signals-view-content" tabIndex={-1}>
    {view === "overview" ? loading && !snapshot ? <div className="signals-empty" role="status" aria-busy="true">{t("正在读取公开数据…", "Loading public data…")}</div> : kind === "github" && githubModel ? <GitHubDashboard model={githubModel} onDrill={openDashboardRecords} onBrowse={() => switchView("library")}/> : newsModel ? <NewsDashboard model={newsModel} onDrill={openDashboardRecords} onBrowse={() => switchView("library")}/> : null : <>
    {drill && <div className="signals-dashboard-drill"><span>{t("来自统计图表：", "From dashboard: ")}<strong>{drill.label}</strong> · {filtered.length.toLocaleString()} {t("条记录", "records")}</span><div><button type="button" className="foresight-button" onClick={() => setDrill(null)}>{t("显示筛选范围全部记录", "Show all filtered records")}</button><button type="button" className="foresight-button" onClick={() => switchView("overview")}>{t("返回统计总览", "Back to overview")}</button></div></div>}

    <p className="signals-filter-hint">{drill?.global ? t("全局记录入口，独立于日期及相关性筛选。调整筛选后恢复当前范围。", "Global records, independent of date and relevance filters. Changing a filter returns to the selected scope.") : t("当前列表与仪表盘采用相同范围；点击上方“库内记录”可查看完整库。", "This list shares the dashboard scope. Click Records in library above to inspect the complete collection.")}</p>
    <div className="signals-results-heading"><h2>{filtered.length}<span> / {records.length} {kind === "github" ? t("个项目", "repositories") : t("条发布", "announcements")}</span></h2><button type="button" className="foresight-button foresight-button-primary" disabled={!analysisRecords.length || loading} onClick={showAnalysis}>{t("分析当前结果", "Analyze these results")}<ArrowUpRight size={14}/></button></div>
    {filtered.length > analysisRecords.length && <p className="signals-analysis-exclusion">{t(`当前结果含 ${filtered.length - analysisRecords.length} 条待复核线索。分析仅使用其中 ${analysisRecords.length} 条高相关记录。`, `These results include ${filtered.length - analysisRecords.length} leads needing review. Analysis uses only the ${analysisRecords.length} directly relevant records.`)}</p>}
    {kind === "github" && compared.length > 0 && <section className="signals-compare" aria-label={t("项目对照", "Repository comparison")}><div className="signals-compare-heading"><div><h3>{t("项目对照", "Repository comparison")} <span>{compared.length} / 3</span></h3><p>{t("帮助选择复现候选；可用性与模型效果仍需在原仓库核实。", "Compare candidates for reproduction; verify usability and model performance in the original repository.")}</p></div><button type="button" className="foresight-button" onClick={() => setCompareIds([])}>{t("清空对照", "Clear")}</button></div><div className="signals-table-scroll"><table><thead><tr><th>{t("检查项", "Check")}</th>{compared.map(record => <th key={record.id}><SourceLink url={record.url}>{record.fullName}</SourceLink><button type="button" aria-label={t(`移除 ${record.fullName}`, `Remove ${record.fullName}`)} onClick={() => setCompareIds(ids => ids.filter(id => id !== record.id))}><X size={13}/></button></th>)}</tr></thead><tbody><tr><th>{t("代码许可", "Code license")}</th>{compared.map(record => <td key={record.id}>{record.license || t("未识别 · 查看仓库", "Not identified · check repository")}</td>)}</tr><tr><th>{t("最近推送", "Latest push")}</th>{compared.map(record => <td key={record.id}>{dateLabel(record.pushedAt, noDate)}</td>)}</tr><tr><th>{t("最近 Release", "Latest release")}</th>{compared.map(record => <td key={record.id}>{record.releaseUrl ? <SourceLink url={record.releaseUrl}>{dateLabel(record.releasedAt, noDate)}</SourceLink> : t("未采集到", "Not collected")}</td>)}</tr><tr><th>{t("维护状态", "Repository state")}</th>{compared.map(record => <td key={record.id}>{record.archived ? t("已归档", "Archived") : t("未归档", "Not archived")}</td>)}</tr><tr><th>{t("Stars 快照", "Stars snapshot")}</th>{compared.map(record => <td key={record.id}>{record.stars.toLocaleString(locale === "en" ? "en-US" : "zh-CN")}</td>)}</tr></tbody></table></div><p className="signals-filter-hint">{t("代码许可证不自动涵盖模型权重、训练数据或临床使用授权；请查阅项目具体条款。", "A code license does not automatically cover model weights, training data, or clinical-use permissions; check the project terms.")}</p></section>}

    {loading && !snapshot ? <div className="signals-empty" role="status" aria-busy="true">{t("正在读取公开数据…", "Loading public data…")}</div> : filtered.length === 0 ? <div className="signals-empty"><Search size={23}/><h3>{t("没有符合条件的记录", "No matching records")}</h3><p>{records.length ? t("尝试缩小关键词、移除日期筛选，或切换到全部线索。", "Try fewer keywords, remove date filters, or switch to all leads.") : t("尚未载入此来源的数据，请查看采集状态或稍后重试。", "No records from this source are loaded. Check its collection status or retry later.")}</p></div> : <div className="signals-list">{filtered.slice(0, limit).map(record => {
      const related = relatedRecords(record, recordLinkIndex);
      const paperLinks = (relatedPapers.get(record.id) ?? []).map(id => paperById.get(id)).filter((paper): paper is Paper => !!paper);
      const comparing = compareIds.includes(record.id);
      const matchedCategories = categories.filter(group => categoryIndex.byRecord.get(record.id)?.includes(group.id));
      return <article className="signal-card" key={record.id}>
        <div className="signal-card-meta"><span className={`signal-kind signal-kind-${record.kind}`}>{record.kind === "github" ? "GitHub" : record.sourceId.startsWith("rss-news-") ? t("发布者订阅源", "Publisher feed") : record.discoveryUrl && new URL(record.discoveryUrl).hostname === "news.google.com" ? t("Google 新闻检索", "Google News discovery") : t("公开发布", "Public announcement")}</span><span>{record.kind === "github" ? t("所有者：", "Owner: ") : t("发布者：", "Publisher: ")}{record.publisher}</span><span>{record.kind === "github" ? `${t("最近活动 ", "Latest activity ")}${beijingDay(datesById.get(record.id) ?? "") || noDate}` : `${t("发布时间 ", "Published ")}${beijingDay(newsDashboardDate(record, "publication") ?? "") || noDate}`}</span>{record.kind === "github" && <span>{t("最初发布 ", "Initially published ")}{beijingDay(githubDashboardDate(record, "creation") ?? "") || noDate}</span>}<span>{t("首次入库 ", "First collected ")}{beijingDay(record.firstSeenAt) || noDate}</span>{record.kind === "github" && record.archived && <span className="signal-archived">{t("已归档", "Archived")}</span>}</div>
        <h3><SourceLink url={record.kind === "news" ? record.originalUrl || record.url : record.url}>{record.title}</SourceLink></h3>
        <p className="signal-summary">{record.summary || t("来源未提供摘要。", "No summary was supplied by the source.")}</p>
        <details className={`signal-relevance-details signal-relevance-${record.relevance?.level ?? "candidate"}`}><summary><span>{record.relevance?.level === "direct" ? t("高相关", "Directly relevant") : t("待复核", "Needs review")}</span>{t("查看匹配依据", "Inspect relevance clues")}</summary>{record.relevance ? <ul>{record.relevance.reasons.map(reason => <li key={reason}>{RELEVANCE_REASON_LABELS[reason] ? t(RELEVANCE_REASON_LABELS[reason].zh, RELEVANCE_REASON_LABELS[reason].en) : reason}</li>)}</ul> : <p>{t("此旧记录尚未重新评估相关性。", "This older record has not been reassessed for relevance.")}</p>}<p>{t("依据公开元数据进行规则匹配；请核对原始内容。", "Rule-based matches in public metadata; check the original content.")}</p></details>
        {record.kind === "news" && <p className="signal-provenance">{record.summaryKind === "search-snippet" ? t("检索摘要 · 原始正文未核验", "Search snippet · original article not verified") : t("发布方内容摘录 · 不构成独立效果验证", "Publisher excerpt · not independent performance validation")}{!record.originalUrl ? t(" · 原文链接尚未解析，标题打开检索结果。", " · Original URL unresolved; the title opens the discovery result.") : ""}</p>}
        {record.kind === "github" && <div className="signal-repo-facts"><span><Star size={13}/>{record.stars.toLocaleString()}<small>{t("关注快照", "snapshot")}</small></span><span><GitFork size={13}/>{record.forks.toLocaleString()}</span>{record.language && <span>{record.language}</span>}<span>{record.license || t("许可未识别", "License not identified")}</span><span>{t("推送", "Pushed")} {dateLabel(record.pushedAt, noDate)}</span></div>}
        {matchedCategories.length > 0 && <div className="signal-discovery-tags"><span className="signal-discovery-label">{t("方向", "Areas")}</span>{matchedCategories.slice(0, 3).map(group => <span key={group.id}>{t(group.labelZh, group.labelEn)}</span>)}{matchedCategories.length > 3 && <span title={matchedCategories.slice(3).map(group => t(group.labelZh, group.labelEn)).join(" · ")}>+{matchedCategories.length - 3}</span>}</div>}
        {record.topics.length > 0 && <div className="signal-topics">{record.topics.slice(0, 6).map(topic => <span key={topic}>{topic}</span>)}</div>}
        {record.kind === "github" && record.readmeExcerpt && <details className="signal-readme"><summary>{t("README 片段", "README excerpt")}</summary><p>{record.readmeExcerpt}</p></details>}
        {related.length > 0 && <div className="signal-related"><span>{t("显式链接关联", "Explicitly linked sources")}</span>{related.map(other => <SourceLink key={other.id} url={other.url}>{other.title}</SourceLink>)}</div>}
        {paperLinks.length > 0 && <details className="signal-paper-links"><summary>{t(`查看 ${paperLinks.length} 篇显式关联论文`, `Inspect ${paperLinks.length} explicitly linked papers`)}</summary><p>{t("按公开 URL、DOI 或 arXiv 标识关联，不表示论文作者拥有或发布此项目／新闻。", "Matched by public URL, DOI, or arXiv ID; a link does not establish that the paper's authors own or published the project or news.")}</p>{paperLinks.slice(0, 4).map(paper => <button key={paper.id} type="button" onClick={() => onPaper(paper)}>{paper.title}<ArrowUpRight size={12}/></button>)}{paperLinks.length > 4 && <button type="button" onClick={() => onDrill({ label: record.title, ids: paperLinks.map(paper => paper.id) })}>{t("查看全部关联论文", "View all linked papers")} ↗</button>}</details>}
        <div className="signal-card-footer"><div><SourceLink url={record.kind === "news" ? record.originalUrl || record.url : record.url}>{record.kind === "github" ? t("查看仓库", "View repository") : record.originalUrl ? t("查看原文", "Read original") : t("查看检索结果", "View discovery result")}</SourceLink>{record.kind === "github" && record.releaseUrl && <SourceLink url={record.releaseUrl}>{t("Release 记录", "Release")}</SourceLink>}{record.kind === "news" && record.originalUrl && record.discoveryUrl && <SourceLink url={record.discoveryUrl}>{new URL(record.discoveryUrl).hostname === "news.google.com" ? t("Google 检索来源", "Google discovery source") : t("订阅来源", "Feed source")}</SourceLink>}<span>{t("采集", "Observed")} {dateLabel(record.observedAt, noDate)}</span></div>{record.kind === "github" && <button type="button" className={`foresight-button ${comparing ? "signals-selected" : ""}`} aria-pressed={comparing} disabled={!comparing && compareIds.length >= 3} onClick={() => setCompareIds(ids => comparing ? ids.filter(id => id !== record.id) : [...ids, record.id])}>{comparing && <Check size={13}/>} {comparing ? t("已加入对照", "In comparison") : t("加入对照", "Compare")}</button>}</div>
      </article>;
    })}</div>}
    {filtered.length > limit && <div className="signals-load-more"><button type="button" className="foresight-button" onClick={() => setLimit(value => value + 24)}>{t(`再显示 ${Math.min(24, filtered.length - limit)} 条`, `Show ${Math.min(24, filtered.length - limit)} more`)}</button></div>}

    </>}
    </div>

    {sourceHealth}
    <div ref={analysisRef} className="signals-analysis">{view === "library" && analyze && <><div className="signals-analysis-heading"><h2>{t("从当前结果形成研究判断", "Build an assessment from these results")}</h2><button type="button" className="foresight-button" onClick={() => setAnalyze(false)}>{t("收起分析", "Close analysis")}</button></div><p className="signals-analysis-description">{t("筛选结果中的高相关记录用于分析，再在下方选择时间范围；待复核线索不进入研判。勾选论文可联合论文库，方向研判页可选择三个来源。", "Only directly relevant filtered records enter this assessment; review candidates are excluded. Choose a date range below. Include papers to connect with the paper library, or use all three sources on the Research outlook page.")}</p><AiModelSettings/><AiResearchPanel papers={papers} signals={analysisRecords} initialSources={[kind]} mode="interest" subjectId={`${kind}-library`} title={kind === "github" ? t("GitHub 项目分析", "GitHub repository assessment") : t("模型与进展分析", "Model and progress assessment")} description={t("输入需要判断的问题，比较技术路线、复现条件、证据缺口与下一步值得验证的机会。", "Ask a question about methods, reproducibility, evidence gaps, and opportunities worth testing.")} onPaper={onPaper} onDrill={onDrill}/></>}</div>
  </div>;
}
