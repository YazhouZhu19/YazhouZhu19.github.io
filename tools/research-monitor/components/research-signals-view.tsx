"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, GitFork, GitBranch, Newspaper, Search, Star, X } from "lucide-react";
import { type GitHubSignal, type ResearchSignal, type ResearchSignalsData, safeSignalUrl, signalDate } from "@/lib/research-signals";
import { GITHUB_DISCOVERY_GROUPS } from "@/lib/github-discovery";
import { explicitEvidenceKeys, findRelatedSignals } from "@/lib/signal-evidence";
import type { Paper } from "@/lib/types";
import type { DashboardDrill } from "@/lib/dashboard";
import { AiModelSettings, AiResearchPanel } from "./ai-research-panel";
import { useI18n } from "./locale-provider";
import "@/styles/research-signals.css";
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
type BrowseState = { query: string; publisher: string; discoveryGroup: string; from: string; to: string; sort: string; limit: number; compareIds: string[]; analyze: boolean };
const browseSessions = new Map<Props["kind"], BrowseState>();

const dateLabel = (value: string | null | undefined, empty: string) => value ? value.slice(0, 10) : empty;
function relatedRecords(signal: ResearchSignal, records: ResearchSignal[]) {
  const own = new Set(explicitEvidenceKeys([signal.url, ...signal.relatedUrls, signal.kind === "news" ? signal.originalUrl : null]));
  return records.filter(other => other.id !== signal.id && other.kind !== signal.kind
    && explicitEvidenceKeys([other.url, ...other.relatedUrls, other.kind === "news" ? other.originalUrl : null]).some(key => own.has(key))).slice(0, 4);
}
function SourceLink({ url, children }: { url: string | null | undefined; children: React.ReactNode }) {
  return safeSignalUrl(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13}/></a> : null;
}

export function ResearchSignalsView({ kind, snapshot, loading, error, onRefresh, papers, onPaper, onDrill }: Props) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [query, setQuery] = useState(() => browseSessions.get(kind)?.query ?? "");
  const deferredQuery = useDeferredValue(query);
  const [publisher, setPublisher] = useState(() => browseSessions.get(kind)?.publisher ?? "all");
  const [discoveryGroup, setDiscoveryGroup] = useState(() => browseSessions.get(kind)?.discoveryGroup ?? "all");
  const [from, setFrom] = useState(() => browseSessions.get(kind)?.from ?? "");
  const [to, setTo] = useState(() => browseSessions.get(kind)?.to ?? "");
  const [sort, setSort] = useState(() => browseSessions.get(kind)?.sort ?? "latest");
  const [limit, setLimit] = useState(() => browseSessions.get(kind)?.limit ?? 24);
  const [compareIds, setCompareIds] = useState<string[]>(() => browseSessions.get(kind)?.compareIds ?? []);
  const [analyze, setAnalyze] = useState(() => browseSessions.get(kind)?.analyze ?? false);
  const analysisRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const records = useMemo(() => (snapshot?.records ?? []).filter(record => record.kind === kind), [snapshot, kind]);
  const relatedPapers = useMemo(() => new Map(findRelatedSignals(papers, records).map(association => [association.signal.id, association.paperIds])), [papers, records]);
  const paperById = useMemo(() => new Map(papers.map(paper => [paper.id, paper])), [papers]);
  const publishers = useMemo(() => [...new Set(records.map(record => record.publisher))].sort((a, b) => a.localeCompare(b)), [records]);
  const discoveryCounts = useMemo(() => new Map(GITHUB_DISCOVERY_GROUPS.map(group => [group.id, records.filter(record => record.kind === "github" && record.discoveryGroups?.includes(group.id)).length])), [records]);
  const ungroupedCount = records.filter(record => record.kind === "github" && !record.discoveryGroups?.length).length;
  const sources = useMemo(() => (snapshot?.sources ?? []).filter(source => source.kind === kind), [snapshot, kind]);
  const invalidDates = !!from && !!to && from > to;
  const filtered = useMemo(() => {
    if (invalidDates) return [];
    const search = deferredQuery.trim().toLowerCase();
    return records.filter(record => {
      const date = signalDate(record)?.slice(0, 10);
      const matchesGroup = record.kind !== "github" || discoveryGroup === "all" || (discoveryGroup === "ungrouped" ? !record.discoveryGroups?.length : record.discoveryGroups?.includes(discoveryGroup));
      const text = `${record.title} ${record.summary} ${record.publisher} ${record.topics.join(" ")} ${record.kind === "github" ? `${record.fullName} ${record.language ?? ""} ${record.readmeExcerpt}` : ""}`.toLowerCase();
      return matchesGroup && (publisher === "all" || record.publisher === publisher) && (!search || text.includes(search))
        && (!from || !!date && date >= from) && (!to || !!date && date <= to);
    }).sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const left = signalDate(a) ?? "", right = signalDate(b) ?? "";
      if (!left || !right) return left ? -1 : right ? 1 : a.id.localeCompare(b.id);
      return (sort === "oldest" ? left.localeCompare(right) : right.localeCompare(left)) || a.id.localeCompare(b.id);
    });
  }, [records, deferredQuery, publisher, discoveryGroup, from, to, sort, invalidDates]);
  const compared = useMemo(() => records.filter((record): record is GitHubSignal => record.kind === "github" && compareIds.includes(record.id)), [records, compareIds]);
  const missingDates = records.filter(record => !signalDate(record)).length;
  const unhealthy = sources.filter(source => source.status !== "ok");
  useEffect(() => { setLimit(24); }, [deferredQuery, publisher, discoveryGroup, from, to, sort]);
  useEffect(() => { browseSessions.set(kind, { query, publisher, discoveryGroup, from, to, sort, limit, compareIds, analyze }); }, [kind, query, publisher, discoveryGroup, from, to, sort, limit, compareIds, analyze]);
  useEffect(() => {
    if (!snapshot) return;
    const available = new Set(records.map(record => record.id));
    setCompareIds(ids => ids.some(id => !available.has(id)) ? ids.filter(id => available.has(id)) : ids);
  }, [snapshot, records]);
  const reset = () => { setQuery(""); setPublisher("all"); setDiscoveryGroup("all"); setFrom(""); setTo(""); setSort("latest"); };
  const showAnalysis = () => {
    setAnalyze(true);
    requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const noDate = t("未提供日期", "Date not provided");

  return <div className="research-signals">
    <section className="signals-intro" aria-label={t("数据范围", "Data coverage")}>
      <div className="signals-intro-mark">{kind === "github" ? <GitBranch size={21}/> : <Newspaper size={21}/>}</div>
      <div><h2>{kind === "github" ? t("从研究到可复现的工具", "From research to reproducible tools") : t("模型发布与研究进展", "Model releases and research updates")}</h2>
        <p>{kind === "github" ? t("查看公开仓库的功能、许可、维护与发布记录。Stars 是采集时的社区关注快照，不代表科研质量。", "Explore public repositories, licenses, maintenance, and releases. Stars are a snapshot of community interest, not a measure of research quality.") : t("通过 Google 新闻检索发现医疗影像相关发布，保留原发布者和检索链接。检索摘要不等于原文，发布声明也不等于独立验证。", "Discover medical imaging announcements through Google News searches, with the original publisher and search links. Search snippets are not full articles; announcements are not independent validation.")}</p>
      </div>
    </section>

    <details className="signals-source-health">
      <summary>{t("采集范围与来源状态", "Collection scope and source status")}<span>{sources.length} {t("个检索 / 采集入口", "collection endpoints")}{unhealthy.length > 0 ? ` · ${unhealthy.length} ${t("项需留意", "need attention")}` : ""} · {t("快照", "Snapshot")} {dateLabel(snapshot?.generatedAt, noDate)}</span></summary>
      <p>{t("这是已采集的公开样本，并非全网收录。刷新读取网站已发布的快照，不会触发实时全网检索。", "This is a collected public sample, not exhaustive web coverage. Refresh loads the published snapshot; it does not run a live web search.")}</p>
      {sources.map(source => <div className="signals-source-row" key={source.id}><div><strong>{source.name}</strong><span className={`signals-status signals-status-${source.status}`}>{source.status === "ok" ? t("正常", "OK") : source.status === "partial" ? t("部分可用", "Partial") : t("采集失败", "Failed")}</span><SourceLink url={source.url}>{t("检索入口", "Source")}</SourceLink></div><p>{source.coverage}</p><small>{t("检查", "Checked")} {dateLabel(source.checkedAt, noDate)} · {t("本次返回", "Received")} {source.received} · {t("保留", "Retained")} {source.retained}{source.lastSuccessAt ? ` · ${t("最近成功", "Last success")} ${dateLabel(source.lastSuccessAt, noDate)}` : ""}</small>{source.error && <p className="signals-source-error">{source.error}</p>}</div>)}
      {kind === "github" && <details className="signals-discovery-catalog"><summary>{t(`查看 ${GITHUB_DISCOVERY_GROUPS.length} 组方向／任务检索`, `Inspect ${GITHUB_DISCOVERY_GROUPS.length} direction and task searches`)}</summary><p>{t("以下是项目发现入口，同一仓库可命中多组。数量为当前库内带有对应检索标签的项目数，不代表该方向的项目总量或经过验证的任务分类。", "These searches discover candidate projects, and a repository may match several groups. Counts show tagged projects in this library, not the total size of a field or a verified task classification.")}</p><div className="signals-discovery-grid">{GITHUB_DISCOVERY_GROUPS.map(group => <div key={group.id}><strong>{t(group.labelZh, group.labelEn)} <span>{discoveryCounts.get(group.id) ?? 0}</span></strong>{group.queries.map(searchQuery => <SourceLink key={searchQuery} url={`https://github.com/search?q=${encodeURIComponent(searchQuery)}&type=repositories`}>{searchQuery}</SourceLink>)}</div>)}</div><p>{t("链接会在 GitHub 打开检索，结果不会自动加入当前页面。", "Links open a GitHub search; its results are not automatically added to this page.")}</p></details>}
      {snapshot?.limitations.length ? <ul>{snapshot.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}
    </details>
    {error && <div className="signals-notice" role="alert"><p>{snapshot ? t("最新快照暂时无法读取，以下保留上次载入的结果。", "The latest snapshot could not be loaded. Previously loaded results are retained below.") : t("此数据源暂时无法读取；论文库仍可独立使用。", "This source could not be loaded. The paper library remains available independently.")}</p><button type="button" className="foresight-button" onClick={onRefresh} disabled={loading}>{t("重新读取", "Retry")}</button></div>}

    <section className="signals-filters" aria-label={t("数据源筛选", "Source filters")}>
      <div className="signals-search"><Search size={17}/><label className="sr-only" htmlFor={`${fieldId}-search`}>{kind === "github" ? t("搜索项目", "Search repositories") : t("搜索已采集的发布", "Search collected announcements")}</label><input id={`${fieldId}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={kind === "github" ? t("搜索项目、模型、任务或开发者…", "Repository, model, task, or developer…") : t("在已采集发布中搜索模型、技术或发布方…", "Search collected models, methods, or publishers…")}/></div>
      {kind === "github" && <div className="signals-discovery-filter"><div><label htmlFor={`${fieldId}-discovery`}>{t("检索方向／任务", "Discovery direction / task")}</label><select id={`${fieldId}-discovery`} value={discoveryGroup} onChange={event => setDiscoveryGroup(event.target.value)} aria-describedby={`${fieldId}-discovery-hint`}><option value="all">{t("全部项目", "All repositories")} ({records.length})</option>{GITHUB_DISCOVERY_GROUPS.map(group => <option key={group.id} value={group.id}>{t(group.labelZh, group.labelEn)} ({discoveryCounts.get(group.id) ?? 0})</option>)}{ungroupedCount > 0 && <option value="ungrouped">{t("未标注检索组", "Without a discovery group")} ({ungroupedCount})</option>}</select></div><p id={`${fieldId}-discovery-hint`}>{t("按检索匹配入口浏览；同一项目可属于多组，尚非验证后的任务分类。括号为全库命中数，可继续叠加其他筛选。", "Browse discovery matches. Projects may appear in multiple groups; these are not verified task labels. Counts cover the full library; other filters can narrow them.")}</p></div>}
      <div className="signals-filter-row"><div><label htmlFor={`${fieldId}-publisher`}>{kind === "github" ? t("仓库所有者", "Repository owner") : t("原发布者", "Original publisher")}</label><select id={`${fieldId}-publisher`} value={publisher} onChange={event => setPublisher(event.target.value)}><option value="all">{t("全部", "All")}</option>{publishers.map(value => <option key={value} value={value}>{value}</option>)}</select></div><div><label htmlFor={`${fieldId}-from`}>{t("起始日期", "From")}</label><input id={`${fieldId}-from`} type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)}/></div><div><label htmlFor={`${fieldId}-to`}>{t("截止日期", "To")}</label><input id={`${fieldId}-to`} type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)}/></div><div><label htmlFor={`${fieldId}-sort`}>{t("排序", "Sort")}</label><select id={`${fieldId}-sort`} value={sort} onChange={event => setSort(event.target.value)}><option value="latest">{t("最近日期优先", "Newest first")}</option><option value="oldest">{t("最早日期优先", "Oldest first")}</option><option value="title">{t("名称", "Name")}</option></select></div><button type="button" className="foresight-button" onClick={reset}>{t("清除筛选", "Clear filters")}</button></div>
      <p className="signals-filter-hint">{kind === "github" ? t("筛选采用仓库最新活动日期（推送、Release 或创建日期中的最新值），不是研究发表日期。", "Filters use the latest repository activity (push, release, or creation), not the paper publication date.") : t("日期采用检索源标注的文章发布日期。", "Dates are the article publication dates supplied by the discovery source.")}{missingDates > 0 ? t(` ${missingDates} 条没有日期，设置日期范围后将排除。`, ` ${missingDates} undated items are excluded when a date range is set.`) : ""}</p>
      {kind === "news" && <p className="signals-filter-hint"><SourceLink url={`https://news.google.com/search?q=${encodeURIComponent(query.trim() || "medical imaging AI")}&hl=en-US&gl=US&ceid=US:en`}>{t("在 Google 新闻继续检索", "Continue searching on Google News")}</SourceLink>{t(" · 在新窗口检索，结果不会自动入库。", " · Opens a new search; results are not added automatically.")}</p>}
      {invalidDates && <p className="signals-source-error" role="alert">{t("起始日期不能晚于截止日期。", "The start date must not follow the end date.")}</p>}
    </section>

    <div className="signals-results-heading"><h2>{filtered.length}<span> / {records.length} {kind === "github" ? t("个项目", "repositories") : t("条发布", "announcements")}</span></h2><button type="button" className="foresight-button foresight-button-primary" disabled={!filtered.length || loading} onClick={showAnalysis}>{t("分析当前结果", "Analyze these results")}<ArrowUpRight size={14}/></button></div>
    {kind === "github" && compared.length > 0 && <section className="signals-compare" aria-label={t("项目对照", "Repository comparison")}><div className="signals-compare-heading"><div><h3>{t("项目对照", "Repository comparison")} <span>{compared.length} / 3</span></h3><p>{t("帮助选择复现候选；可用性与模型效果仍需在原仓库核实。", "Compare candidates for reproduction; verify usability and model performance in the original repository.")}</p></div><button type="button" className="foresight-button" onClick={() => setCompareIds([])}>{t("清空对照", "Clear")}</button></div><div className="signals-table-scroll"><table><thead><tr><th>{t("检查项", "Check")}</th>{compared.map(record => <th key={record.id}><SourceLink url={record.url}>{record.fullName}</SourceLink><button type="button" aria-label={t(`移除 ${record.fullName}`, `Remove ${record.fullName}`)} onClick={() => setCompareIds(ids => ids.filter(id => id !== record.id))}><X size={13}/></button></th>)}</tr></thead><tbody><tr><th>{t("代码许可", "Code license")}</th>{compared.map(record => <td key={record.id}>{record.license || t("未识别 · 查看仓库", "Not identified · check repository")}</td>)}</tr><tr><th>{t("最近推送", "Latest push")}</th>{compared.map(record => <td key={record.id}>{dateLabel(record.pushedAt, noDate)}</td>)}</tr><tr><th>{t("最近 Release", "Latest release")}</th>{compared.map(record => <td key={record.id}>{record.releaseUrl ? <SourceLink url={record.releaseUrl}>{dateLabel(record.releasedAt, noDate)}</SourceLink> : t("未采集到", "Not collected")}</td>)}</tr><tr><th>{t("维护状态", "Repository state")}</th>{compared.map(record => <td key={record.id}>{record.archived ? t("已归档", "Archived") : t("未归档", "Not archived")}</td>)}</tr><tr><th>{t("Stars 快照", "Stars snapshot")}</th>{compared.map(record => <td key={record.id}>{record.stars.toLocaleString(locale === "en" ? "en-US" : "zh-CN")}</td>)}</tr></tbody></table></div><p className="signals-filter-hint">{t("代码许可证不自动涵盖模型权重、训练数据或临床使用授权；请查阅项目具体条款。", "A code license does not automatically cover model weights, training data, or clinical-use permissions; check the project terms.")}</p></section>}

    {loading && !snapshot ? <div className="signals-empty" role="status" aria-busy="true">{t("正在读取公开数据…", "Loading public data…")}</div> : filtered.length === 0 ? <div className="signals-empty"><Search size={23}/><h3>{t("没有符合条件的记录", "No matching records")}</h3><p>{records.length ? t("尝试缩小关键词或移除日期、来源筛选。", "Try fewer keywords or remove the date and publisher filters.") : t("尚未载入此来源的数据，请查看采集状态或稍后重试。", "No records from this source are loaded. Check its collection status or retry later.")}</p></div> : <div className="signals-list">{filtered.slice(0, limit).map(record => {
      const related = relatedRecords(record, snapshot?.records ?? []);
      const paperLinks = (relatedPapers.get(record.id) ?? []).map(id => paperById.get(id)).filter((paper): paper is Paper => !!paper);
      const comparing = compareIds.includes(record.id);
      const matchedGroups = record.kind === "github" ? GITHUB_DISCOVERY_GROUPS.filter(group => record.discoveryGroups?.includes(group.id)) : [];
      return <article className="signal-card" key={record.id}>
        <div className="signal-card-meta"><span className={`signal-kind signal-kind-${record.kind}`}>{record.kind === "github" ? "GitHub" : record.discoveryUrl ? t("Google 新闻检索", "Google News discovery") : t("公开发布", "Public announcement")}</span><span>{record.publisher}</span><span>{record.kind === "github" ? t("最近活动 ", "Latest activity ") : ""}{dateLabel(signalDate(record), noDate)}</span>{record.kind === "github" && record.archived && <span className="signal-archived">{t("已归档", "Archived")}</span>}</div>
        <h3><SourceLink url={record.kind === "news" ? record.originalUrl || record.url : record.url}>{record.title}</SourceLink></h3>
        <p className="signal-summary">{record.summary || t("来源未提供摘要。", "No summary was supplied by the source.")}</p>
        {record.kind === "news" && <p className="signal-provenance">{record.summaryKind === "search-snippet" ? t("检索摘要 · 原始正文未核验", "Search snippet · original article not verified") : t("发布方内容摘录 · 不构成独立效果验证", "Publisher excerpt · not independent performance validation")}{!record.originalUrl ? t(" · 原文链接尚未解析，标题打开检索结果。", " · Original URL unresolved; the title opens the discovery result.") : ""}</p>}
        {record.kind === "github" && <div className="signal-repo-facts"><span><Star size={13}/>{record.stars.toLocaleString()}<small>{t("关注快照", "snapshot")}</small></span><span><GitFork size={13}/>{record.forks.toLocaleString()}</span>{record.language && <span>{record.language}</span>}<span>{record.license || t("许可未识别", "License not identified")}</span><span>{t("推送", "Pushed")} {dateLabel(record.pushedAt, noDate)}</span></div>}
        {matchedGroups.length > 0 && <div className="signal-discovery-tags"><span className="signal-discovery-label">{t("检索匹配", "Discovery matches")}</span>{matchedGroups.slice(0, 3).map(group => <span key={group.id}>{t(group.labelZh, group.labelEn)}</span>)}{matchedGroups.length > 3 && <span title={matchedGroups.slice(3).map(group => t(group.labelZh, group.labelEn)).join(" · ")}>+{matchedGroups.length - 3}</span>}</div>}
        {record.topics.length > 0 && <div className="signal-topics">{record.topics.slice(0, 6).map(topic => <span key={topic}>{topic}</span>)}</div>}
        {record.kind === "github" && record.readmeExcerpt && <details className="signal-readme"><summary>{t("README 片段", "README excerpt")}</summary><p>{record.readmeExcerpt}</p></details>}
        {related.length > 0 && <div className="signal-related"><span>{t("显式链接关联", "Explicitly linked sources")}</span>{related.map(other => <SourceLink key={other.id} url={other.url}>{other.title}</SourceLink>)}</div>}
        {paperLinks.length > 0 && <details className="signal-paper-links"><summary>{t(`查看 ${paperLinks.length} 篇显式关联论文`, `Inspect ${paperLinks.length} explicitly linked papers`)}</summary><p>{t("按公开 URL、DOI 或 arXiv 标识关联，不表示论文作者拥有或发布此项目／新闻。", "Matched by public URL, DOI, or arXiv ID; a link does not establish that the paper's authors own or published the project or news.")}</p>{paperLinks.slice(0, 4).map(paper => <button key={paper.id} type="button" onClick={() => onPaper(paper)}>{paper.title}<ArrowUpRight size={12}/></button>)}{paperLinks.length > 4 && <button type="button" onClick={() => onDrill({ label: record.title, ids: paperLinks.map(paper => paper.id) })}>{t("查看全部关联论文", "View all linked papers")} ↗</button>}</details>}
        <div className="signal-card-footer"><div><SourceLink url={record.kind === "news" ? record.originalUrl || record.url : record.url}>{record.kind === "github" ? t("查看仓库", "View repository") : record.originalUrl ? t("查看原文", "Read original") : t("查看检索结果", "View discovery result")}</SourceLink>{record.kind === "github" && record.releaseUrl && <SourceLink url={record.releaseUrl}>{t("Release 记录", "Release")}</SourceLink>}{record.kind === "news" && record.originalUrl && record.discoveryUrl && <SourceLink url={record.discoveryUrl}>{t("检索来源", "Discovery source")}</SourceLink>}<span>{t("采集", "Observed")} {dateLabel(record.observedAt, noDate)}</span></div>{record.kind === "github" && <button type="button" className={`foresight-button ${comparing ? "signals-selected" : ""}`} aria-pressed={comparing} disabled={!comparing && compareIds.length >= 3} onClick={() => setCompareIds(ids => comparing ? ids.filter(id => id !== record.id) : [...ids, record.id])}>{comparing && <Check size={13}/>} {comparing ? t("已加入对照", "In comparison") : t("加入对照", "Compare")}</button>}</div>
      </article>;
    })}</div>}
    {filtered.length > limit && <div className="signals-load-more"><button type="button" className="foresight-button" onClick={() => setLimit(value => value + 24)}>{t(`再显示 ${Math.min(24, filtered.length - limit)} 条`, `Show ${Math.min(24, filtered.length - limit)} more`)}</button></div>}

    <div ref={analysisRef} className="signals-analysis">{analyze && <><div className="signals-analysis-heading"><h2>{t("从当前结果形成研究判断", "Build an assessment from these results")}</h2><button type="button" className="foresight-button" onClick={() => setAnalyze(false)}>{t("收起分析", "Close analysis")}</button></div><p className="signals-analysis-description">{t("筛选结果作为分析候选，再在下方选择时间范围。勾选论文可联合论文库；方向研判页可同时选择论文、GitHub 与新闻三个来源。", "Filtered results are the candidate evidence; choose a date range below. Include papers to connect this source with the paper library. The Research outlook page supports papers, GitHub, and news together.")}</p><AiModelSettings/><AiResearchPanel papers={papers} signals={filtered} initialSources={[kind]} mode="interest" subjectId={`${kind}-library`} title={kind === "github" ? t("GitHub 项目分析", "GitHub repository assessment") : t("模型与进展分析", "Model and progress assessment")} description={t("输入需要判断的问题，比较技术路线、复现条件、证据缺口与下一步值得验证的机会。", "Ask a question about methods, reproducibility, evidence gaps, and opportunities worth testing.")} onPaper={onPaper} onDrill={onDrill}/></>}</div>
  </div>;
}
