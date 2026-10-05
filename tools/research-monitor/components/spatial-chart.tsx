import { memo, useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, ChartBar, CircleDot } from "lucide-react";
import { useI18n } from "./locale-provider";
import "@/styles/spatial-charts.css";

export type SpatialDatum = { id: string; label: string; count: number; detail?: string; group?: string };
type Props = { title: string; data: SpatialDatum[]; columns?: string[]; onOpen: (id: string) => void; compact?: boolean; variant?: "bubbles" | "bars" };

/** Bars and method dots use linear scales; circle area encodes count in bubble views. */
export const SpatialChart = memo(function SpatialChart({ title, data, columns, onOpen, compact, variant = "bubbles" }: Props) {
  const { locale } = useI18n();
  const en = locale === "en";
  const uid = useId().replace(/:/g, "");
  const [selectedId, setSelectedId] = useState("");
  const [group, setGroup] = useState("*");
  const groups = useMemo(() => [...new Set(data.flatMap(d => d.group ? [d.group] : []))], [data]);
  const activeGroup = groups.includes(group) ? group : "*";
  const visible = useMemo(() => activeGroup === "*" ? data : data.filter(d => d.group === activeGroup), [data, activeGroup]);
  const selected = visible.find(d => d.id === selectedId) ?? visible.find(d => d.count > 0) ?? visible[0];
  // Keep the full-scope scale when inspecting a single task.
  const maximum = Math.max(1, ...data.map(d => d.count));
  const barStep = 10 ** Math.floor(Math.log10(maximum));
  const barMaximum = Math.ceil(maximum / barStep) * barStep;
  const bars = variant === "bars" && !columns && !compact;
  const inspect = (id: string) => setSelectedId(id);
  const open = (item: SpatialDatum) => { inspect(item.id); if (item.count) onOpen(item.id); };
  const accessibleLabel = (item: SpatialDatum) => en ? `View ${item.label}: ${item.count.toLocaleString(locale)} records` : `查看${item.label}：${item.count.toLocaleString(locale)}条记录`;
  const mode = columns ? (en ? "DOT MATRIX" : "交叉点阵") : compact ? (en ? "METHOD PROFILE" : "方法比较") : bars ? (en ? "DIRECTION COUNTS" : "方向数量") : (en ? "RESEARCH BUBBLES" : "气泡分布");
  return <div className={`spatial-chart${compact ? " spatial-compact" : ""}`}>
    <div className="spatial-toolbar"><span className="spatial-mode">{bars ? <ChartBar size={14} /> : <CircleDot size={14} />}{mode}</span>
      {!!groups.length && <select aria-label={en ? `${title}: task filter` : `${title}：任务筛选`} value={activeGroup} onChange={e => setGroup(e.target.value)}><option value="*">{en ? "All tasks" : "全部任务"}</option>{groups.map(g => <option key={g}>{g}</option>)}</select>}
    </div>
    {columns ? <>
      <div className="dot-matrix-scroll" tabIndex={0} role="region" aria-label={en ? `${title}: scrollable chart` : `${title}：可横向滚动的图表`}>
        <div className="dot-matrix" style={{ "--matrix-cols": columns.length, "--label-width": en ? "176px" : "126px" } as CSSProperties}>
          <div className="dot-matrix-row dot-matrix-head"><span>{en ? "TASK / MODALITY" : "任务 / 模态"}</span>{columns.map(column => <span key={column} title={column}>{column}</span>)}</div>
          {(activeGroup === "*" ? groups : [activeGroup]).map(name => <div className="dot-matrix-row" key={name}>
            <span className="dot-row-name">{name}</span>{visible.filter(d => d.group === name).map(item => <button key={item.id} className={`dot-cell${selected?.id === item.id ? " is-selected" : ""}`} aria-label={accessibleLabel(item)} title={`${item.label} · ${item.count.toLocaleString(locale)}`} onFocus={() => inspect(item.id)} onPointerEnter={() => inspect(item.id)} onClick={() => open(item)} data-count={item.count}>
              <svg viewBox="0 0 42 42" aria-hidden="true">{item.count ? <circle className="dot-core" cx="21" cy="21" r={17 * Math.sqrt(item.count / maximum)} /> : <circle className="dot-zero" cx="21" cy="21" r="2.5" />}</svg>
              <span className="dot-value" aria-hidden="true">{item.count.toLocaleString(locale)}</span>
            </button>)}
          </div>)}
        </div>
      </div>
      <p className="spatial-swipe-hint">{en ? "Swipe horizontally to see every modality" : "横向滑动查看全部模态"}</p>
      <div className="spatial-axis-key">{columns.map((c, i) => <span key={c}><b>{String(i + 1).padStart(2, "0")}</b>{c}</span>)}</div>
    </> : compact ? <div className="method-dot-list">{visible.map(item => <button key={item.id} className={selected?.id === item.id ? "is-selected" : ""} aria-label={accessibleLabel(item)} onFocus={() => inspect(item.id)} onPointerEnter={() => inspect(item.id)} onClick={() => open(item)}>
      <span className="method-dot-label"><span>{item.label}</span><b>{item.count.toLocaleString(locale)}</b></span>
      <svg viewBox="0 0 320 26" preserveAspectRatio="none" aria-hidden="true"><path className="method-dot-track" d="M9,13 H311" /><path className="method-dot-stem" d={`M9,13 H${9 + item.count / maximum * 302}`} /><circle className="method-dot-end" cx={9 + item.count / maximum * 302} cy="13" r="4.5" /></svg>
    </button>)} {!!visible.length && <div className="method-dot-scale"><span>0</span><span>{maximum.toLocaleString(locale)} {en ? "records" : "条"}</span></div>}</div> : bars ? <div className="direction-bars">
      {!!visible.length && <div className="direction-bar-scale" aria-hidden="true"><span /><span><span>0</span><span>{barMaximum.toLocaleString(locale)}</span></span><span>{en ? "records" : "条"}</span></div>}
      {visible.map(item => <button key={item.id} className={`direction-bar-row${selected?.id === item.id ? " is-selected" : ""}`} aria-label={accessibleLabel(item)} onFocus={() => inspect(item.id)} onPointerEnter={() => inspect(item.id)} onClick={() => open(item)}>
        <span className="direction-bar-label">{item.label}</span><span className="direction-bar-track" aria-hidden="true"><span className="direction-bar-fill" style={{ width: `${item.count / barMaximum * 100}%` }} /></span><strong className="direction-bar-value">{item.count.toLocaleString(locale)}</strong>
      </button>)}
    </div> : <div className="bubble-grid" style={{ "--bubble-cols": Math.min(5, Math.max(1, Math.ceil(visible.length / 2))) } as CSSProperties}>{visible.map((item, i) => {
      const fillId = `${uid}bubble${i}`;
      return <button key={item.id} className={`bubble-item${selected?.id === item.id ? " is-selected" : ""}`} aria-label={accessibleLabel(item)} onFocus={() => inspect(item.id)} onPointerEnter={() => inspect(item.id)} onClick={() => open(item)} title={`${item.label} · ${item.count.toLocaleString(locale)}${item.detail ? ` · ${item.detail}` : ""}`}>
        <span className="bubble-index">{String(i + 1).padStart(2, "0")}</span>
        <svg viewBox="0 0 140 124" aria-hidden="true"><defs><radialGradient id={fillId} cx="32%" cy="25%" r="80%"><stop stopColor="#dcecf8" stopOpacity=".7" /><stop offset=".5" stopColor="#a4c7e3" stopOpacity=".24" /><stop offset="1" stopColor="#779cb9" stopOpacity=".06" /></radialGradient></defs>{item.count ? <circle className="bubble-core" cx="70" cy="60" r={49 * Math.sqrt(item.count / maximum)} fill={`url(#${fillId})`} /> : <circle className="dot-zero" cx="70" cy="60" r="3" />}</svg>
        <strong>{item.count.toLocaleString(locale)}</strong><span className="bubble-label">{item.label}</span>
      </button>;
    })}</div>}
    <div className="spatial-caption">{compact ? (en ? "Dot position corresponds to record count" : "圆点位置线性对应记录数") : columns ? (en ? "Circle area = records · hollow dot = zero" : "圆面积对应记录数 · 空心点表示 0") : bars ? (en ? "Bar length corresponds to record count" : "细条长度线性对应记录数") : (en ? "Circle area = records · position is for layout only" : "圆面积对应记录数 · 位置仅用于排布")}</div>
    {selected ? <div className="spatial-readout"><div><label htmlFor={`${uid}pick`}>{en ? "Inspect a data point" : "选择数据点"}</label><select id={`${uid}pick`} value={selected.id} onChange={e => inspect(e.target.value)}>{visible.map((item, i) => <option key={item.id} value={item.id}>{columns ? "" : `${String(i + 1).padStart(2, "0")} · `}{item.label} · {item.count.toLocaleString(locale)}</option>)}</select>{selected.detail && <small>{selected.detail}</small>}</div><strong>{selected.count.toLocaleString(locale)}<small>{en ? "records" : "条记录"}</small></strong><button disabled={!selected.count} onClick={() => onOpen(selected.id)} aria-label={en ? `Open papers for ${selected.label}: ${selected.count} records` : `打开${selected.label}的论文：${selected.count}条记录`}>{en ? "Papers" : "查看论文"}<ArrowUpRight size={15} /></button></div> : <p className="spatial-empty">{en ? "No matching data in this range." : "当前范围暂无匹配记录。"}</p>}
    {columns && <details className="spatial-details"><summary>{en ? "All exact values & paper links" : "展开全部数值与论文入口"}</summary><div>{data.map(item => <button key={item.id} disabled={!item.count} onClick={() => onOpen(item.id)}><span>{item.label}</span><b>{item.count.toLocaleString(locale)}</b><ArrowUpRight size={12} /></button>)}</div></details>}
  </div>;
});

type TrendRow = { date: string; all: number; published: number; preprint: number; ids: string[] };
export function TimelineChart({ rows, onOpen }: { rows: TrendRow[]; onOpen: (row: TrendRow) => void }) {
  const { locale, tr } = useI18n();
  const [active, setActive] = useState(-1);
  const max = Math.max(1, ...rows.map(r => r.all));
  const x = (i: number) => rows.length > 1 ? 38 + i / (rows.length - 1) * 540 : 308;
  const y = (value: number) => 178 - value / max * 150;
  const indexAt = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return Math.max(0, rows.length - 1);
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    return Math.max(0, Math.min(rows.length - 1, Math.round((point.x - 38) / 540 * (rows.length - 1))));
  };
  const current = rows[active] ?? rows[rows.length - 1];
  const series = [{ key: "all", color: "#7f94aa", label: "当前范围" }, { key: "published", color: "#edf5fc", label: "正式发表" }, { key: "preprint", color: "#9ac4e9", label: "预印本" }] as const;
  return <div className="light-timeline"><svg viewBox="0 0 600 215" role="img" aria-label={locale === "en" ? "Record counts by date" : "按日期统计的记录数"} onPointerMove={event => setActive(indexAt(event))} onClick={event => { const index = indexAt(event); setActive(index); if (rows[index]?.ids.length) onOpen(rows[index]); }}>
    {[...new Set([0, Math.ceil(max / 2), max])].map(t => <g className="spatial-grid" key={t}><path d={`M38,${y(t)}H578`} /><text x="30" y={y(t) + 3} textAnchor="end">{t}</text></g>)}
    {series.map(s => <g key={s.key}><polyline points={rows.map((r, i) => `${x(i)},${y(r[s.key])}`).join(" ")} fill="none" stroke={s.color} strokeWidth={s.key === "all" ? 1.5 : 2.5} strokeDasharray={s.key === "all" ? "4 5" : undefined} />{rows.length === 1 && <circle cx={x(0)} cy={y(rows[0][s.key])} r="4" fill={s.color} />}</g>)}
    {current && <g><path className="spatial-floor" d={`M${x(active < 0 || active >= rows.length ? rows.length - 1 : active)},20V178`} />{series.map(s => <circle key={s.key} cx={x(active < 0 || active >= rows.length ? rows.length - 1 : active)} cy={y(current[s.key])} r="3.5" fill={s.color} />)}</g>}
    {[...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].filter(i => i >= 0).map(i => <text key={i} className="spatial-axis" x={x(i)} y="202" textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}>{rows[i].date}</text>)}
  </svg>{current && <div className="timeline-readout"><label><span>{locale === "en" ? "Date" : "日期"}</span><select aria-label={locale === "en" ? "Inspect date counts" : "选择日期查看统计"} value={current.date} onChange={e => setActive(rows.findIndex(r => r.date === e.target.value))}>{rows.map(row => <option key={row.date}>{row.date}</option>)}</select></label><div>{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{tr(s.label)} <b>{current[s.key]}</b></span>)}</div><button disabled={!current.ids.length} onClick={() => onOpen(current)} aria-label={locale === "en" ? `View papers for ${current.date}` : `查看${current.date}的论文`}><ArrowUpRight size={16} /></button></div>}</div>;
}

export function StatusRing({ preprints, known, onOpen }: { preprints: number; known: number; onOpen: (key: string) => void }) {
  const { tr } = useI18n();
  const proportion = known ? preprints / known : 0;
  return <svg className="light-status-ring" viewBox="0 0 200 200" role="img" aria-label={tr("发表状态")}><circle cx="100" cy="100" r="75" fill="none" stroke="rgba(223,239,252,.1)" strokeWidth="16" />{!!known && <><circle cx="100" cy="100" r="75" fill="none" stroke="#eef5fb" strokeWidth="16" onClick={() => onOpen("published")}><title>{tr("正式发表")}: {known - preprints}</title></circle><circle cx="100" cy="100" r="75" fill="none" stroke="#8eb8de" strokeWidth="16" strokeDasharray={`${proportion * 471.239} 471.239`} transform="rotate(-90 100 100)" onClick={() => onOpen("preprint")}><title>{tr("预印本")}: {preprints}</title></circle></>}</svg>;
}
