import { memo, useId, useMemo, useState } from "react";
import { ArrowUpRight, Box, RotateCcw } from "lucide-react";
import { useI18n } from "./locale-provider";
import "@/styles/spatial-charts.css";

export type SpatialDatum = { id: string; label: string; count: number; detail?: string; group?: string };
type Props = { title: string; data: SpatialDatum[]; columns?: string[]; onOpen: (id: string) => void; compact?: boolean };

/** Orthographic cuboids: only height encodes count, with a common zero and linear scale. */
export const SpatialChart = memo(function SpatialChart({ title, data, columns, onOpen, compact }: Props) {
  const { locale } = useI18n();
  const en = locale === "en";
  const uid = useId().replace(/:/g, "");
  const [selectedId, setSelectedId] = useState("");
  const [angle, setAngle] = useState(24);
  const [flat, setFlat] = useState(false);
  const [group, setGroup] = useState("*");
  const groups = useMemo(() => [...new Set(data.flatMap(d => d.group ? [d.group] : []))], [data]);
  const activeGroup = groups.includes(group) ? group : "*";
  const visible = useMemo(() => activeGroup === "*" ? data : data.filter(d => d.group === activeGroup), [data, activeGroup]);
  const selected = visible.find(d => d.id === selectedId) ?? visible.find(d => d.count > 0) ?? visible[0];
  const maximum = Math.max(1, ...data.map(d => d.count));
  const ticks = [...new Set([0, Math.ceil(maximum / 2), maximum])];
  const rowCount = columns && activeGroup === "*" ? groups.length : 1;
  const colCount = columns?.length ?? Math.max(1, visible.length);
  const step = Math.min(62, 500 / colCount);
  const depthX = flat ? 0 : angle * .68;
  const depthY = flat ? 0 : 14;
  const barDepth = flat ? 0 : 9;
  const height = rowCount > 1 ? 120 : 148;
  const base = height + rowCount * depthY + 28;
  const width = colCount * step + rowCount * depthX + 66;
  const totalHeight = base + 43;
  const project = (col: number, row: number, h = 0) => [42 + col * step + row * depthX, base - row * depthY - h];
  const point = (x: number, y: number) => `${x},${y}`;
  const geometries = visible.map((item, i) => ({ item, i, row: Math.floor(i / colCount), col: i % colCount })).sort((a, b) => b.row - a.row || a.col - b.col);
  const inspect = (id: string) => setSelectedId(id);
  const open = (item: SpatialDatum) => { inspect(item.id); if (item.count) onOpen(item.id); };
  return <div className={`spatial-chart${compact ? " spatial-compact" : ""}`}>
    <div className="spatial-toolbar">
      <span className="spatial-mode"><Box size={13} />{flat ? "2D" : "3D"}<span>{en ? "RESEARCH ATLAS" : "研究分布"}</span></span>
      <div className="spatial-controls">
        {!!groups.length && <select aria-label={en ? `${title}: task layer` : `${title}：任务层`} value={activeGroup} onChange={e => { setGroup(e.target.value); if (e.target.value === "*") setFlat(false); }}><option value="*">{en ? "All tasks" : "全部任务"}</option>{groups.map(g => <option key={g}>{g}</option>)}</select>}
        <button className="spatial-toggle" onClick={() => { if (!flat && groups.length && activeGroup === "*") setGroup(groups[0]); setFlat(v => !v); }} aria-pressed={flat} title={en ? "Switch between spatial and flat views" : "切换立体与平面视图"}>{flat ? "3D" : "2D"}</button>
        <button className="spatial-reset" aria-label={en ? `Reset ${title} view` : `重置${title}视角`} onClick={() => { setAngle(24); setFlat(false); setGroup("*"); }}><RotateCcw size={13} /></button>
      </div>
    </div>
    <div className="spatial-stage">
      <svg viewBox={`0 0 ${width} ${totalHeight}`} role="img" aria-label={en ? `${title}. Bar height shows record count. Use the controls below for exact values and papers.` : `${title}。柱高表示记录数，可在下方选择项目，查看精确数量与论文。`}>
        <defs><linearGradient id={`${uid}face`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d3e5f4" stopOpacity=".64" /><stop offset="1" stopColor="#7797b4" stopOpacity=".16" /></linearGradient><linearGradient id={`${uid}active`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#eff9ff" stopOpacity=".95" /><stop offset="1" stopColor="#a7ceee" stopOpacity=".38" /></linearGradient></defs>
        {ticks.map(tick => { const [x, y] = project(0, 0, tick / maximum * height); const [farX, farY] = project(colCount, Math.max(0, rowCount - 1), tick / maximum * height); return <g key={tick} className="spatial-grid"><path d={`M${x - 8},${y} H${42 + colCount * step} L${farX},${farY}`} /><text x={x - 15} y={y + 3} textAnchor="end">{tick.toLocaleString(locale)}</text></g>; })}
        {Array.from({ length: rowCount }, (_, row) => { const [x, y] = project(0, row); return <path key={row} className="spatial-floor" d={`M${x},${y} h${colCount * step}`} />; })}
        {geometries.map(({ item, row, col }) => {
          const [x, y] = project(col, row); const h = item.count / maximum * height; const w = step * .55;
          const dx = barDepth * angle / 24; const dy = barDepth * .66; const active = selected?.id === item.id;
          return <g key={item.id} className={`spatial-bar${active ? " is-selected" : ""}`} onPointerEnter={() => inspect(item.id)} onClick={() => open(item)} data-count={item.count}>
            <title>{item.label}: {item.count.toLocaleString(locale)}{item.detail ? ` · ${item.detail}` : ""}</title>
            <path className="spatial-bar-hit" d={`M${x - 3},${y + 3} h${w + dx + 6} v${-Math.max(h + dy + 6, 15)} h${-w - dx - 6} Z`} />
            <polygon className="spatial-face" fill={`url(#${uid}${active ? "active" : "face"})`} points={[point(x, y), point(x + w, y), point(x + w, y - h), point(x, y - h)].join(" ")} />
            {!flat && <><polygon className="spatial-side" points={[point(x + w, y), point(x + w + dx, y - dy), point(x + w + dx, y - h - dy), point(x + w, y - h)].join(" ")} /><polygon className="spatial-top" points={[point(x, y - h), point(x + w, y - h), point(x + w + dx, y - h - dy), point(x + dx, y - h - dy)].join(" ")} /></>}
            {rowCount === 1 && <text className="spatial-value" x={x + w / 2} y={y - h - dy - 9} textAnchor="middle">{item.count.toLocaleString(locale)}</text>}
          </g>;
        })}
        {Array.from({ length: colCount }, (_, i) => { const [x, y] = project(i, 0); return <text key={i} className="spatial-axis" x={x + step * .3} y={y + 23} textAnchor="middle">{columns ? String(i + 1).padStart(2, "0") : String(i + 1).padStart(2, "0")}</text>; })}
      </svg>
    </div>
    <p className="spatial-swipe-hint">{en ? "Swipe horizontally to explore the chart" : "横向滑动查看全部柱体"}</p>
    <div className="spatial-caption"><span>{en ? "Linear height · records" : "柱高线性对应记录数"}{rowCount > 1 && (en ? " · task layers" : " · 纵深为任务层")}</span><label>{en ? "View" : "视角"}<input type="range" min="8" max="40" value={angle} disabled={flat} aria-label={en ? `${title}: viewing angle` : `${title}：视角`} onChange={e => setAngle(Number(e.target.value))} /></label></div>
    {columns && <div className="spatial-axis-key">{columns.map((c, i) => <span key={c}><b>{String(i + 1).padStart(2, "0")}</b>{c}</span>)}</div>}
    {selected ? <div className="spatial-readout"><div><label htmlFor={`${uid}pick`}>{en ? "Inspect a data point" : "选择数据点"}</label><select id={`${uid}pick`} value={selected.id} onChange={e => inspect(e.target.value)}>{visible.map((item, i) => <option key={item.id} value={item.id}>{columns ? "" : `${String(i + 1).padStart(2, "0")} · `}{item.label} · {item.count.toLocaleString(locale)}</option>)}</select>{selected.detail && <small>{selected.detail}</small>}</div><strong>{selected.count.toLocaleString(locale)}<small>{en ? "records" : "条记录"}</small></strong><button disabled={!selected.count} onClick={() => onOpen(selected.id)} aria-label={en ? `View ${selected.label}: ${selected.count} records` : `查看${selected.label}：${selected.count}条记录`}>{en ? "Papers" : "查看论文"}<ArrowUpRight size={15} /></button></div> : <p className="spatial-empty">{en ? "No matching data in this range." : "当前范围暂无匹配记录。"}</p>}
    {!columns && <div className="spatial-legend">{visible.map((item, i) => <button key={item.id} aria-pressed={selected?.id === item.id} onFocus={() => inspect(item.id)} onPointerEnter={() => inspect(item.id)} onClick={() => open(item)}><span>{String(i + 1).padStart(2, "0")}</span>{item.label}<b>{item.count.toLocaleString(locale)}</b></button>)}</div>}
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
