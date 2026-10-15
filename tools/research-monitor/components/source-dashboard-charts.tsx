"use client";

import { useId, useState } from "react";
import { ArrowUpRight, ChartBar, Code2, Users } from "lucide-react";
import type { SignalDashboardBucket } from "@/lib/signal-dashboard";
import type { SignalDashboardDrill } from "./signal-dashboard";
import { DashboardChoice } from "./dashboard-choice";
import { useI18n } from "./locale-provider";
import "@/styles/spatial-charts.css";
import "@/styles/source-dashboard-charts.css";

export type SourceDashboardSeriesRow = {
  date: string; count: number | null; direct: number | null; candidate: number | null;
  recordIds: string[]; directRecordIds: string[]; candidateRecordIds: string[];
  isToday: boolean; observed: boolean;
};
type DrillHandler = (drill: SignalDashboardDrill) => void;
const SERIES = [
  { key: "count", ids: "recordIds", zh: "全部", en: "All", color: "var(--chart-3)", dash: "5 5" },
  { key: "direct", ids: "directRecordIds", zh: "高相关", en: "Directly relevant", color: "var(--chart-1)", dash: undefined },
  { key: "candidate", ids: "candidateRecordIds", zh: "待复核", en: "Needs review", color: "var(--chart-2)", dash: "2 4" },
] as const;

export function SourceDashboardRing({ buckets, title, totalLabel, onDrill, colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"] }: {
  buckets: SignalDashboardBucket[]; title: string; totalLabel: string; onDrill: DrillHandler; colors?: string[];
}) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const label = (bucket: SignalDashboardBucket) => t(bucket.labelZh, bucket.labelEn);
  const open = (bucket: SignalDashboardBucket) => onDrill({ label: `${title} · ${label(bucket)}`, ids: bucket.recordIds });
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  let previousFraction = 0;
  const segments = buckets.map((bucket, index) => { const start = previousFraction; const fraction = total ? bucket.count / total : 0; previousFraction += fraction; return { bucket, start, fraction, color: colors[index % colors.length] }; });
  return <><div className="dash-donut-wrap"><svg className="light-status-ring" viewBox="0 0 200 200" role="img" aria-label={`${title} · ${t("详见下方数值", "exact counts below")}`}><circle cx="100" cy="100" r="75" fill="none" stroke="var(--living-line)" strokeWidth="16"/>{segments.filter(segment => segment.fraction > 0).map(segment => <circle key={segment.bucket.id} cx="100" cy="100" r="75" fill="none" stroke={segment.color} strokeWidth="16" strokeDasharray={`${segment.fraction * 471.239} 471.239`} strokeDashoffset={-segment.start * 471.239} transform="rotate(-90 100 100)" onClick={() => open(segment.bucket)}><title>{label(segment.bucket)}: {count(segment.bucket.count)}</title></circle>)}</svg><div className="dash-donut-center"><strong>{count(total)}</strong><span>{totalLabel}</span></div></div><div className="dash-status-legend source-ring-legend">{segments.map(segment => <button type="button" key={segment.bucket.id} disabled={!segment.bucket.count} onClick={() => open(segment.bucket)}><span><i style={{ background: segment.color }}/>{label(segment.bucket)}</span><b>{count(segment.bucket.count)}</b><ArrowUpRight size={13}/></button>)}</div></>;
}

export function SourceDashboardTimeline({ rows, title, onDrill, monthly, kind }: { rows: SourceDashboardSeriesRow[]; title: string; onDrill: DrillHandler; monthly: boolean; kind: "github" | "news" }) {
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
  const open = (row: SourceDashboardSeriesRow, series: typeof SERIES[number]) => {
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
    <div className="light-timeline source-daily-timeline">
      <svg viewBox="0 0 610 224" role="img" aria-labelledby={`${uid}-title ${uid}-description`} onPointerMove={event => setActiveDate(rows[indexAt(event)]?.date ?? "")} onClick={event => { const row = rows[indexAt(event)]; if (row) { setActiveDate(row.date); open(row, SERIES[0]); } }}>
        <title id={`${uid}-title`}>{title}</title><desc id={`${uid}-description`}>{t("三条线分别展示全部、高相关和待复核的记录数。未知日期不连线；下方可选择日期并查看记录。", "Three series show all, directly relevant, and review-candidate record counts. Unknown dates are not connected; choose a date below to inspect records.")}</desc>
        {unknown.map(row => { const index = rows.indexOf(row); const half = rows.length > 1 ? 260 / (rows.length - 1) : 20; const left = Math.max(45, x(index) - half); return <rect className="source-unobserved-zone" key={row.date} x={left} y="24" width={Math.min(565, x(index) + half) - left} height="160"/>; })}
        {ticks.map(tick => <g className="spatial-grid" key={tick}><path d={`M45,${y(tick)}H565`}/><text x="37" y={y(tick) + 3} textAnchor="end">{count(tick)}</text></g>)}
        {SERIES.map(series => <g key={series.key}><path d={pathFor(series.key)} fill="none" stroke={series.color} strokeWidth={series.key === "count" ? 1.6 : 2.3} strokeDasharray={series.dash}/>{rows.length <= 31 && rows.map((row, index) => row.observed && row[series.key] !== null ? <circle key={row.date} cx={x(index)} cy={y(row[series.key]!)} r={series.key === "count" ? 4.1 : 2.5} fill={series.key === "count" ? "white" : series.color} stroke={series.color} strokeWidth="1.3"/> : null)}</g>)}
        {current && <g><path className="spatial-floor" d={`M${x(selectedIndex)},24V184`}/>{current.observed && SERIES.map(series => current[series.key] !== null && <circle key={series.key} cx={x(selectedIndex)} cy={y(current[series.key]!)} r="3.4" fill={series.color}/>)}</g>}
        {[...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].filter(index => index >= 0).map(index => <text key={index} className="spatial-axis" x={x(index)} y="212" textAnchor={rows.length === 1 ? "middle" : index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}>{rows[index].date}</text>)}
      </svg>
      {current && <div className="source-timeline-readout"><div className="dash-control source-timeline-choice"><label htmlFor={`${uid}-date`}>{monthly ? t("选择月份", "Select month") : t("选择日期", "Select date")}</label><DashboardChoice id={`${uid}-date`} label={monthly ? t("选择月份", "Select month") : t("选择日期", "Select date")} value={current.date} onChange={setActiveDate} options={rows.map(row => [row.date, `${row.date}${row.isToday ? monthly ? t(" · 本月", " · this month") : t(" · 今日", " · today") : ""}${!row.observed ? t(" · 尚未观测", " · not observed") : ""}`])}/></div><div className="source-timeline-series">{SERIES.map(series => <button type="button" key={series.key} disabled={!current.observed || !current[series.ids].length} onClick={() => open(current, series)} aria-label={`${current.date} · ${t(series.zh, series.en)} ${count(current[series.key])} · ${(kind === "github" ? t("查看项目", "View repositories") : t("查看消息", "View news"))}`}><i style={{ background: series.color }}/>{t(series.zh, series.en)} <b>{count(current[series.key])}</b><ArrowUpRight size={12}/></button>)}</div></div>}
    </div>
    {!!unknown.length && <p className="dash-note source-unknown-note">{t("浅色区间尚无有效观测，显示“—”，不计作 0。", "Shaded dates have no valid observation and show “—”, not zero.")}</p>}
    <details className="dash-series-detail source-series-detail" onToggle={event => setShowDetails(event.currentTarget.open)}><summary>{monthly ? t("查看每月明细与记录入口", "Monthly counts and record links") : t("查看每日明细与记录入口", "Daily counts and record links")}</summary>{showDetails && <div><table><thead><tr><th>{t("日期 · 北京时间", "Date · Beijing time")}</th>{SERIES.map(series => <th key={series.key}>{t(series.zh, series.en)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}{row.isToday && <span> {monthly ? t("本月", "this month") : t("今日", "today")}</span>}</th>{SERIES.map(series => <td key={series.key}><button type="button" disabled={!row.observed || !row[series.ids].length} onClick={() => open(row, series)} aria-label={`${row.date} · ${t(series.zh, series.en)} ${count(row[series.key])}`}>{count(row[series.key])}</button></td>)}</tr>)}</tbody></table></div>}</details>
  </>;
}

export function SourceDashboardBars({ buckets, title, onDrill, kind, profile = "directions" }: { buckets: SignalDashboardBucket[]; title: string; onDrill: DrillHandler; kind: "github" | "news"; profile?: "directions" | "language" | "publisher" }) {
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
  return <div className={`spatial-chart source-bucket-chart${profile !== "directions" ? " source-compact-bars" : ""}`}>
    <div className="spatial-toolbar"><span className="spatial-mode">{profile === "language" ? <Code2 size={14}/> : profile === "publisher" ? <Users size={14}/> : <ChartBar size={14}/>} {profile === "language" ? t("主要语言", "PRIMARY LANGUAGE") : profile === "publisher" ? t("发布者", "PUBLISHERS") : t("方向数量", "DIRECTION COUNTS")}</span></div>
    <div className="direction-bars"><div className="direction-bar-scale" aria-hidden="true"><span/><span><span>0</span><span>{count(ceiling)}</span></span><span>{(kind === "github" ? t("个项目", "repos") : t("条消息", "news"))}</span></div>{buckets.map(bucket => <button type="button" key={bucket.id} className={`direction-bar-row${selected?.id === bucket.id ? " is-selected" : ""}`} onFocus={() => setSelectedId(bucket.id)} onPointerEnter={() => setSelectedId(bucket.id)} onClick={() => open(bucket)} aria-label={`${label(bucket)} · ${count(bucket.count)} ${(kind === "github" ? t("个项目，点击查看", "repositories, click to view") : t("条消息，点击查看", "news records, click to view"))}`}><span className="direction-bar-label">{label(bucket)}</span><span className="direction-bar-track" aria-hidden="true"><span className="direction-bar-fill" style={{ width: `${bucket.count / ceiling * 100}%` }}/></span><strong className="direction-bar-value">{count(bucket.count)}</strong></button>)}</div>
    <div className="spatial-caption">{(kind === "github" ? t("细条长度线性对应当前范围的项目数", "Bar length corresponds to repositories in the current scope") : t("细条长度线性对应当前范围的消息数", "Bar length corresponds to news records in the current scope"))}</div>
    {selected && <div className="spatial-readout"><div className="dash-control"><label htmlFor={`${uid}-bucket`}>{t("选择数据点", "Inspect a data point")}</label><DashboardChoice id={`${uid}-bucket`} label={`${title} · ${t("选择数据点", "Inspect a data point")}`} value={selected.id} onChange={setSelectedId} options={buckets.map(bucket => [bucket.id, `${label(bucket)} · ${count(bucket.count)}`])}/></div><strong>{count(selected.count)}<small>{(kind === "github" ? t("个项目", "repositories") : t("条消息", "news records"))}</small></strong><button type="button" disabled={!selected.count} onClick={() => open(selected)}>{(kind === "github" ? t("查看项目", "Repositories") : t("查看消息", "News records"))}<ArrowUpRight size={15}/></button></div>}
  </div>;
}
