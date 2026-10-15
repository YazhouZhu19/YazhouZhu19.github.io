"use client";

import { useId, useState } from "react";
import { Activity, ArrowUpRight, ChartBar, Code2, Database, FileCheck2, GitBranch, Layers3, PackageCheck, Radio } from "lucide-react";
import { githubDashboardDate, type GitHubDashboardModel } from "@/lib/github-dashboard";
import type { SignalDashboardBucket } from "@/lib/signal-dashboard";
import type { SignalDashboardDrill } from "./signal-dashboard";
import { Button } from "./ui/button";
import { DashboardChoice } from "./dashboard-choice";
import { useI18n } from "./locale-provider";
import "@/styles/spatial-charts.css";
import "@/styles/github-dashboard.css";

type DashboardProps = { model: GitHubDashboardModel; onDrill: (drill: SignalDashboardDrill) => void; onBrowse: () => void };
type SummaryProps = Pick<DashboardProps, "model" | "onDrill">;
type SeriesRow = GitHubDashboardModel["series"][number];
const SERIES = [
  { key: "count", ids: "recordIds", zh: "全部", en: "All", color: "var(--chart-3)", dash: "5 5" },
  { key: "direct", ids: "directRecordIds", zh: "高相关", en: "Directly relevant", color: "var(--chart-1)", dash: undefined },
  { key: "candidate", ids: "candidateRecordIds", zh: "待复核", en: "Needs review", color: "var(--chart-2)", dash: "2 4" },
] as const;
const STATE_COLORS = ["var(--chart-4)", "var(--chart-1)", "var(--chart-2)", "var(--living-line)"];

export function GitHubDashboardSummary({ model, onDrill }: SummaryProps) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const open = (bucket: SignalDashboardBucket, label: string) => onDrill({ label, ids: bucket.recordIds });
  const clock = model.now ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(model.now)) : "—";
  return <div className="github-dashboard-summary">
    <div className="dash-global-strip">
      <button type="button" onClick={() => open(model.global.total, t("GitHub 全部库内记录", "All GitHub library records"))}><Database size={15}/>{t("库内", "In library")} <b>{count(model.global.total.count)}</b> {t("条记录", "records")}<ArrowUpRight size={13}/></button>
      <button type="button" disabled={!model.nowValid || !model.referenceDateValid} onClick={() => open(model.global.today, t("今日入库 · 不含最早采集批次", "Added today · excluding earliest batch"))}><Radio size={15}/>{t("今日入库", "Added today")} <b>{model.nowValid && model.referenceDateValid ? count(model.global.today.count) : "—"}</b><ArrowUpRight size={13}/></button>
      <button type="button" onClick={() => open(model.global.initial, t("最早采集批次 · 推定基线", "Earliest collection batch · inferred baseline"))} title={t("按现存记录最早的首次发现时间推定，不代表完整初始建库。", "Inferred from the earliest first-seen timestamp in retained records; not a complete initial-import history.")}><Layers3 size={14}/>{t("最早采集批次", "Earliest batch")} <b>{count(model.global.initial.count)}</b><ArrowUpRight size={13}/></button>
      <span className="dash-clock"><time dateTime={model.now ?? undefined}>{clock}</time> {t("北京时间", "Beijing time")}</span>
    </div>
    <p className="github-summary-note">{t("以上为全库统计；今日入库按首次发现时间计算，不等于项目今日创建或发布。最早采集批次单列为推定基线。", "Global library counts. Added today uses first-seen time, not repository creation or release. The earliest collection batch is shown separately as an inferred baseline.")}{model.snapshotStale && <span>{t(` 快照日期为 ${model.snapshotDay ?? "未知"}，今日数量仅代表已收录记录。`, ` The snapshot is dated ${model.snapshotDay ?? "unknown"}; today's count reflects only records already collected.`)}</span>}{model.snapshotInFuture && <span>{t(" 快照时间晚于当前时间，时间标注待核实；统计仅计入当前时间之前的记录。", " The snapshot timestamp is ahead of the current time and needs verification; counts include only earlier records.")}</span>}</p>
  </div>;
}

function GitHubTimeline({ rows, title, onDrill, monthly }: { rows: SeriesRow[]; title: string; onDrill: DashboardProps["onDrill"]; monthly: boolean }) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [activeDate, setActiveDate] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const uid = useId();
  const count = (value: number | null) => value === null ? "—" : value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const currentIndex = rows.findIndex(row => row.date === activeDate);
  const lastObserved = rows.findLastIndex(row => row.observed);
  const selectedIndex = currentIndex >= 0 ? currentIndex : lastObserved >= 0 ? lastObserved : rows.length - 1;
  const current = rows[selectedIndex];
  const maximum = Math.max(1, ...rows.map(row => row.count ?? 0));
  const x = (index: number) => rows.length > 1 ? 45 + index / (rows.length - 1) * 520 : 305;
  const y = (value: number) => 184 - value / maximum * 148;
  const open = (row: SeriesRow, series: typeof SERIES[number]) => {
    const ids = row[series.ids];
    if (row.observed && ids.length) onDrill({ label: `${title} · ${row.date} · ${t(series.zh, series.en)}`, ids });
  };
  const indexAt = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return selectedIndex;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    return Math.max(0, Math.min(rows.length - 1, Math.round((point.x - 45) / 520 * (rows.length - 1))));
  };
  const pathFor = (key: typeof SERIES[number]["key"]) => {
    let openSegment = false;
    return rows.map((row, index) => {
      const value = row[key];
      if (!row.observed || value === null) { openSegment = false; return ""; }
      const command = openSegment ? "L" : "M";
      openSegment = true;
      return `${command}${x(index)},${y(value)}`;
    }).join(" ");
  };
  const ticks = [...new Set([0, Math.ceil(maximum / 2), maximum])];
  const unknown = rows.filter(row => !row.observed);
  return <>
    <div className="light-timeline github-daily-timeline">
      <svg viewBox="0 0 610 224" role="img" aria-labelledby={`${uid}-title ${uid}-description`} onPointerMove={event => setActiveDate(rows[indexAt(event)]?.date ?? "")} onClick={event => { const row = rows[indexAt(event)]; if (row) { setActiveDate(row.date); open(row, SERIES[0]); } }}>
        <title id={`${uid}-title`}>{title}</title><desc id={`${uid}-description`}>{t("三条线分别展示全部、高相关和待复核的记录数。未知日期不连线；下方可选择日期并查看记录。", "Three series show all, directly relevant, and review-candidate record counts. Unknown dates are not connected; choose a date below to inspect records.")}</desc>
        {unknown.map(row => { const index = rows.indexOf(row); const half = rows.length > 1 ? 260 / (rows.length - 1) : 20; const left = Math.max(45, x(index) - half); return <rect className="github-unobserved-zone" key={row.date} x={left} y="24" width={Math.min(565, x(index) + half) - left} height="160"/>; })}
        {ticks.map(tick => <g className="spatial-grid" key={tick}><path d={`M45,${y(tick)}H565`}/><text x="37" y={y(tick) + 3} textAnchor="end">{count(tick)}</text></g>)}
        {SERIES.map(series => <g key={series.key}><path d={pathFor(series.key)} fill="none" stroke={series.color} strokeWidth={series.key === "count" ? 1.6 : 2.3} strokeDasharray={series.dash}/>{rows.length <= 31 && rows.map((row, index) => row.observed && row[series.key] !== null ? <circle key={row.date} cx={x(index)} cy={y(row[series.key]!)} r={series.key === "count" ? 4.1 : 2.5} fill={series.key === "count" ? "white" : series.color} stroke={series.color} strokeWidth="1.3"/> : null)}</g>)}
        {current && <g><path className="spatial-floor" d={`M${x(selectedIndex)},24V184`}/>{current.observed && SERIES.map(series => current[series.key] !== null && <circle key={series.key} cx={x(selectedIndex)} cy={y(current[series.key]!)} r="3.4" fill={series.color}/>)}</g>}
        {[...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].filter(index => index >= 0).map(index => <text key={index} className="spatial-axis" x={x(index)} y="212" textAnchor={rows.length === 1 ? "middle" : index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}>{rows[index].date}</text>)}
      </svg>
      {current && <div className="github-timeline-readout"><div className="dash-control github-timeline-choice"><label htmlFor={`${uid}-date`}>{monthly ? t("选择月份", "Select month") : t("选择日期", "Select date")}</label><DashboardChoice id={`${uid}-date`} label={monthly ? t("选择月份", "Select month") : t("选择日期", "Select date")} value={current.date} onChange={setActiveDate} options={rows.map(row => [row.date, `${row.date}${row.isToday ? monthly ? t(" · 本月", " · this month") : t(" · 今日", " · today") : ""}${!row.observed ? t(" · 尚未观测", " · not observed") : ""}`])}/></div><div className="github-timeline-series">{SERIES.map(series => <button type="button" key={series.key} disabled={!current.observed || !current[series.ids].length} onClick={() => open(current, series)} aria-label={`${current.date} · ${t(series.zh, series.en)} ${count(current[series.key])} · ${t("查看项目", "View repositories")}`}><i style={{ background: series.color }}/>{t(series.zh, series.en)} <b>{count(current[series.key])}</b><ArrowUpRight size={12}/></button>)}</div></div>}
    </div>
    {!!unknown.length && <p className="dash-note github-unknown-note">{t("浅色区间尚无有效观测，显示“—”，不计作 0。", "Shaded dates have no valid observation and show “—”, not zero.")}</p>}
    <details className="dash-series-detail github-series-detail" onToggle={event => setShowDetails(event.currentTarget.open)}><summary>{monthly ? t("查看每月明细与项目入口", "Monthly counts and repository links") : t("查看每日明细与项目入口", "Daily counts and repository links")}</summary>{showDetails && <div><table><thead><tr><th>{t("日期 · 北京时间", "Date · Beijing time")}</th>{SERIES.map(series => <th key={series.key}>{t(series.zh, series.en)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}{row.isToday && <span> {monthly ? t("本月", "this month") : t("今日", "today")}</span>}</th>{SERIES.map(series => <td key={series.key}><button type="button" disabled={!row.observed || !row[series.ids].length} onClick={() => open(row, series)} aria-label={`${row.date} · ${t(series.zh, series.en)} ${count(row[series.key])}`}>{count(row[series.key])}</button></td>)}</tr>)}</tbody></table></div>}</details>
  </>;
}

function RepositoryBars({ buckets, title, onDrill, language = false }: { buckets: SignalDashboardBucket[]; title: string; onDrill: DashboardProps["onDrill"]; language?: boolean }) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [selectedId, setSelectedId] = useState("");
  const uid = useId();
  const selected = buckets.find(bucket => bucket.id === selectedId) ?? buckets.find(bucket => bucket.count) ?? buckets[0];
  const label = (bucket: SignalDashboardBucket) => t(bucket.labelZh, bucket.labelEn);
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const maximum = Math.max(1, ...buckets.map(bucket => bucket.count));
  const step = 10 ** Math.floor(Math.log10(maximum));
  const ceiling = Math.ceil(maximum / step) * step;
  const open = (bucket: SignalDashboardBucket) => { setSelectedId(bucket.id); if (bucket.count) onDrill({ label: `${title} · ${label(bucket)}`, ids: bucket.recordIds }); };
  return <div className={`spatial-chart github-bucket-chart${language ? " github-language-chart" : ""}`}>
    <div className="spatial-toolbar"><span className="spatial-mode">{language ? <Code2 size={14}/> : <ChartBar size={14}/>} {language ? t("主要语言", "PRIMARY LANGUAGE") : t("方向数量", "DIRECTION COUNTS")}</span></div>
    <div className="direction-bars"><div className="direction-bar-scale" aria-hidden="true"><span/><span><span>0</span><span>{count(ceiling)}</span></span><span>{t("个项目", "repos")}</span></div>{buckets.map(bucket => <button type="button" key={bucket.id} className={`direction-bar-row${selected?.id === bucket.id ? " is-selected" : ""}`} onFocus={() => setSelectedId(bucket.id)} onPointerEnter={() => setSelectedId(bucket.id)} onClick={() => open(bucket)} aria-label={`${label(bucket)} · ${count(bucket.count)} ${t("个项目，点击查看", "repositories, click to view")}`}><span className="direction-bar-label">{label(bucket)}</span><span className="direction-bar-track" aria-hidden="true"><span className="direction-bar-fill" style={{ width: `${bucket.count / ceiling * 100}%` }}/></span><strong className="direction-bar-value">{count(bucket.count)}</strong></button>)}</div>
    <div className="spatial-caption">{t("细条长度线性对应当前范围的项目数", "Bar length corresponds to repositories in the current scope")}</div>
    {selected && <div className="spatial-readout"><div className="dash-control"><label htmlFor={`${uid}-bucket`}>{t("选择数据点", "Inspect a data point")}</label><DashboardChoice id={`${uid}-bucket`} label={`${title} · ${t("选择数据点", "Inspect a data point")}`} value={selected.id} onChange={setSelectedId} options={buckets.map(bucket => [bucket.id, `${label(bucket)} · ${count(bucket.count)}`])}/></div><strong>{count(selected.count)}<small>{t("个项目", "repositories")}</small></strong><button type="button" disabled={!selected.count} onClick={() => open(selected)}>{t("查看项目", "Repositories")}<ArrowUpRight size={15}/></button></div>}
  </div>;
}

export function GitHubDashboard({ model, onDrill, onBrowse }: DashboardProps) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const label = (bucket: SignalDashboardBucket) => t(bucket.labelZh, bucket.labelEn);
  const open = (bucket: SignalDashboardBucket, override?: string) => onDrill({ label: override ?? label(bucket), ids: bucket.recordIds });
  const creation = model.filters.clock === "creation";
  const monthly = model.seriesGranularity === "month";
  const timelineTitle = creation ? t("最初发布时间分布", "Initial repository publication dates") : t("最近活动日期分布", "Latest activity by date");
  const metricHints: Record<string, string> = {
    total: t("按仓库去重 · 与当前筛选一致", "Unique repositories · current filters"),
    recent90: t("快照前 90 天内有推送 · 北京时间", "Push within 90 days of snapshot · Beijing time"),
    licensed: t("仓库元数据已注明代码许可", "Code license identified in repository metadata"),
    released: t("已采集有效 Release 链接与日期", "Collected release link and date"),
  };
  const icons = [GitBranch, Activity, FileCheck2, PackageCheck];
  const stateTotal = model.scoped.maintenance.reduce((sum, bucket) => sum + bucket.count, 0);
  let previousFraction = 0;
  const stateSegments = model.scoped.maintenance.map((bucket, index) => { const start = previousFraction; const fraction = stateTotal ? bucket.count / stateTotal : 0; previousFraction += fraction; return { bucket, color: STATE_COLORS[index], start, fraction }; });
  const datedRows = model.rows.map(record => ({ record, date: githubDashboardDate(record, model.filters.clock) }));
  const latest = datedRows.sort((left, right) => (Date.parse(right.date ?? "") || 0) - (Date.parse(left.date ?? "") || 0) || left.record.id.localeCompare(right.record.id)).slice(0, 4);
  const beijingStamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : t("日期未知", "Date unknown");
  const exclusions = [model.excluded.missing, model.excluded.future, model.excluded.unavailable].filter(bucket => bucket.count > 0);

  return <div className="research-dashboard github-research-dashboard">
    <div className="dash-scope"><span>{model.start ?? "—"} — {model.end ?? "—"} · {creation ? t("仓库最初发布时间", "Initial repository publication") : t("仓库最近活动", "Latest repository activity")} · {t("北京时间", "Beijing time")}</span><span>{t("数字与图表均可点击查看项目", "Click counts and charts to inspect repositories")}</span></div>
    <div className="dash-metrics">{model.scoped.metrics.map((metric, index) => {
      const Icon = icons[index];
      const unavailable = !model.referenceDateValid && ["recent90", "released"].includes(metric.id);
      return <button type="button" key={metric.id} className={`dash-metric${index === 0 ? " dash-metric-primary" : ""}`} disabled={unavailable || !metric.count} onClick={() => open(metric)}><span className="dash-metric-label"><Icon size={17}/>{label(metric)}<ArrowUpRight size={15}/></span><strong>{unavailable ? "—" : count(metric.count)}</strong><span className="dash-metric-hint">{unavailable ? t("快照日期不可用", "Snapshot date unavailable") : metricHints[metric.id]}</span></button>;
    })}</div>

    <div className="dash-main-grid github-main-grid">
      <section className="dash-panel github-trajectory"><div className="dash-panel-heading"><div><h2>{timelineTitle}</h2><p>{creation ? t("每个仓库按创建时间计数一次", "Each repository counted once by its creation date") : t("每个仓库按最新活动日期计数一次", "Each repository counted once by its latest activity date")}{monthly ? t(" · 长时间范围按月汇总", " · long windows aggregate by month") : t(" · 按日汇总", " · daily counts")}</p></div><span className="dash-unit">{t("单位：个", "Unit: repos")}</span></div>
        {model.rangeValid && model.series.length ? <GitHubTimeline rows={model.series} title={timelineTitle} onDrill={onDrill} monthly={monthly}/> : <div className="dash-chart-empty"><Radio size={28}/><strong>{t("当前范围暂无可展示的日期记录", "No date records to display in this range")}</strong><span>{t("调整统计时间，或检查快照日期。", "Adjust the time window or check the snapshot date.")}</span></div>}
        <p className="dash-note">{creation ? t("最初发布时间采用 GitHub 仓库创建时间，不代表首次 Release 或从私有转公开的时间；缺失日期不作推断。", "Initial publication uses GitHub repository creation time, not the first release or the date a private repository became public. Missing dates are not inferred.") : t("活动取推送、Release 或创建日期的最新值。这是当前快照分布，不能还原历史提交频次。", "Activity is the latest push, release, or creation date. This snapshot cannot reconstruct historical commit frequency.")}{monthly && t(" 首末月份可能只包含所选窗口及已收录时段的部分日期。", " The first and last months may cover only part of the selected and observed period.")}</p>
      </section>
      <section className="dash-panel github-maintenance"><div className="dash-panel-heading"><div><h2>{t("维护状态", "Maintenance status")}</h2><p>{t("优先区分归档，再按最近推送分组", "Archived status first, then latest push date")}</p></div></div><div className="dash-donut-wrap"><svg className="light-status-ring" viewBox="0 0 200 200" role="img" aria-label={t("仓库维护状态分布，详见下方数值", "Repository maintenance distribution; exact counts below")}><circle cx="100" cy="100" r="75" fill="none" stroke="var(--living-line)" strokeWidth="16"/>{stateSegments.filter(segment => segment.fraction > 0).map(segment => <circle key={segment.bucket.id} cx="100" cy="100" r="75" fill="none" stroke={segment.color} strokeWidth="16" strokeDasharray={`${segment.fraction * 471.239} 471.239`} strokeDashoffset={-segment.start * 471.239} transform="rotate(-90 100 100)" onClick={() => open(segment.bucket, `${t("维护状态", "Maintenance")} · ${label(segment.bucket)}`)}><title>{label(segment.bucket)}: {count(segment.bucket.count)}</title></circle>)}</svg><div className="dash-donut-center"><strong>{count(stateTotal)}</strong><span>{t("当前范围项目", "Repositories in scope")}</span></div></div><div className="dash-status-legend">{stateSegments.map(segment => <button type="button" key={segment.bucket.id} disabled={!segment.bucket.count} onClick={() => open(segment.bucket, `${t("维护状态", "Maintenance")} · ${label(segment.bucket)}`)}><span><i style={{ background: segment.color }}/>{label(segment.bucket)}</span><b>{count(segment.bucket.count)}</b><ArrowUpRight size={13}/></button>)}</div><p className="dash-note">{t("较早推送不等于停止维护；该状态不代表代码质量或临床可用性。", "An older push does not imply abandonment; status does not establish code quality or clinical usability.")}</p></section>
    </div>

    <section className="dash-panel dash-interests github-directions"><div className="dash-panel-heading"><div><h2>{t("当前范围的研究方向", "Research areas in scope")}</h2><p>{t("同一项目可命中多个方向，不能将各方向数量相加为总量。", "Projects can match several areas; category counts cannot be added to obtain a total.")}</p></div><span className="dash-unit">{t("点击查看项目", "Click for repositories")}</span></div><RepositoryBars buckets={model.scoped.categories} title={t("研究方向", "Research area")} onDrill={onDrill}/><p className="dash-note">{t("分类沿用公开检索线索，展示库内样本结构，不代表领域热度或经过人工验证的任务分类。", "Categories follow discovery clues and describe this sample, not field popularity or manually validated tasks.")}</p></section>

    <div className="dash-bottom-grid github-bottom-grid"><section className="dash-panel"><div className="dash-panel-heading"><div><h2>{t("主要编程语言", "Primary languages")}</h2><p>{t("每仓库一个主要语言 · 前 6 种与其他、未注明", "One primary language per repository · top 6, other, and unknown")}</p></div></div><RepositoryBars language buckets={model.scoped.languages} title={t("主要语言", "Primary language")} onDrill={onDrill}/><p className="dash-note">{t("依据 GitHub 主要语言元数据，不等于模型框架或方法分类。", "GitHub language metadata is not a model-framework or method classification.")}</p></section><section className="dash-panel"><div className="dash-panel-heading"><div><h2>{creation ? t("当前范围的近期创建项目", "Recently created in this scope") : t("当前范围的近期活动项目", "Recently active in this scope")}</h2><p>{creation ? t("按仓库创建时间排序 · 点击定位项目卡片", "Sorted by repository creation time · click for its card") : t("按仓库最近活动排序 · 点击定位项目卡片", "Sorted by latest repository activity · click for its card")}</p></div><Button variant="ghost" size="sm" onClick={onBrowse}>{t("查看全部", "View all")}<ArrowUpRight size={14}/></Button></div><div className="dash-recent-list">{latest.map(({ record, date }) => <button type="button" key={record.id} onClick={() => onDrill({ label: record.fullName, ids: [record.id] })}><span className="dash-recent-meta">{beijingStamp(date)}<span>{record.relevance?.level === "direct" ? t("高相关", "Directly relevant") : t("待复核", "Needs review")}</span></span><strong>{record.fullName}</strong><span className="github-recent-description">{record.summary || t("来源未提供项目简介。", "No description was supplied by the source.")}</span><span className="dash-recent-source">{t("所有者：", "Owner: ")}{record.publisher}<ArrowUpRight size={14}/></span></button>)}{!latest.length && <p className="dash-note">{t("当前范围暂无项目。", "No repositories in this scope.")}</p>}</div></section></div>

    {exclusions.length > 0 && <details className="github-excluded"><summary>{t("查看本次统计单列的记录", "Inspect records outside the statistics")}</summary><p>{t("以下记录仍保留在库中；缺失或异常日期与时间范围分开处理。", "These records remain in the library; missing and unverified dates are handled separately from the time window.")}</p><div>{exclusions.map(bucket => <button type="button" key={bucket.id} onClick={() => open(bucket)}>{label(bucket)} <b>{count(bucket.count)}</b><ArrowUpRight size={12}/></button>)}</div></details>}
    <p className="dash-footnote">{t("统计基于已采集的公开仓库，不代表全网覆盖。Stars、推送、Release 与许可字段均不能直接证明科研质量、可复现性或临床有效性。", "Statistics cover collected public repositories, not the whole web. Stars, pushes, releases, and license fields do not establish research quality, reproducibility, or clinical validity.")}</p>
  </div>;
}
