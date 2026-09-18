"use client";
import { useI18n } from "./locale-provider";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, BookOpen, CircleHelp, Database, Layers3, Radio, Users, Workflow } from "lucide-react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TRACKS } from "@/lib/classify";
import { beijingDay, buildDashboard, type DashboardDrill, type DashboardFilters } from "@/lib/dashboard";
import type { Collection, MonitorData, Paper, Team } from "@/lib/types";
type Props = {
    authenticated: boolean;
    data: MonitorData;
    teams: Team[];
    collections: Collection[];
    filters: DashboardFilters;
    onFilters: (filters: DashboardFilters) => void;
    onDrill: (drill: DashboardDrill) => void;
    onNavigate: (view: string) => void;
    onPaper: (paper: Paper) => void;
};
const count = (n: number) => n.toLocaleString("zh-CN");
const stamp = (s: string) => new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function Choice({ label, value, onChange, options }: {
    label: string;
    value: string;
    onChange: (s: string) => void;
    options: [
        string,
        string
    ][];
}) {
    const { locale, tr } = useI18n();
    return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={tr(label)}><SelectValue /></SelectTrigger><SelectContent>{options.map(([v, name]) => <SelectItem key={v} value={v}>{tr(name)}</SelectItem>)}</SelectContent></Select>;
}
function Metric({ label, value, hint, icon: Icon, accent, onClick }: {
    label: string;
    value: string;
    hint: string;
    icon: typeof Database;
    accent?: boolean;
    onClick: () => void;
}) {
    const { locale, tr } = useI18n();
    return <button className={`dash-metric${accent ? " dash-metric-primary" : ""}`} onClick={onClick}><span className="dash-metric-label"><Icon size={17}/>{label}<ArrowUpRight size={15}/></span><strong>{value}</strong><span className="dash-metric-hint">{hint}</span></button>;
}
export function ResearchDashboard({ authenticated, data, teams, collections, filters, onFilters, onDrill, onNavigate, onPaper }: Props) {
    const { locale, tr } = useI18n();
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
    const m = useMemo(() => buildDashboard(data, teams, filters, now), [data, teams, filters, now]);
    const change = (key: keyof DashboardFilters, value: string) => onFilters({ ...filters, [key]: value });
    const drill = (label: string, papers: Paper[]) => onDrill({ label:tr(label), ids: papers.map(p => p.id) });
    const dateLabel = tr(filters.clock === "discovery" ? "平台发现时间" : "来源发布日期");
    const maximum = Math.max(1, ...m.matrix.flatMap(r => r.cells.map(c => c.papers.length)));
    const latest = [...m.rows].sort((a, b) => (filters.clock === "discovery" ? b.firstSeenAt.localeCompare(a.firstSeenAt) : b.publishedAt.localeCompare(a.publishedAt))).slice(0, 4);
    const selectedIds = new Set(m.rows.map(p => p.id));
    const saved = collections.filter(c => selectedIds.has(c.paperId));
    const exportRows = () => {
        const safe = (v: string) => '"' + (/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"';
        const rows = [["记录ID", "标题", "来源日期", "首次发现", "状态", "来源", "链接"].map(v => tr(v)), ...m.rows.map(p => [p.id, p.title, p.publishedAt, p.firstSeenAt, p.status, p.sources.join("; "), p.url])];
        const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(r => r.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `research-dashboard-${m.end}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };
    return <div className="research-dashboard">
    <div className="dash-global-strip"><span><Database size={15}/>{tr("库内 ")}<b>{count(data.totalStored ?? data.papers.length)}</b>{tr(" 条记录")}</span><button onClick={() => drill("今日新入库 · 不含初始快照", m.newToday)}><Radio size={15}/>{tr("今日新入库 ")}<b>{count(m.newToday.length)}</b><ArrowUpRight size={13}/></button><span>{tr("初始快照单独计入库总量")}</span><span className="dash-clock">{stamp(now.toISOString())}{tr(" 北京时间")}</span></div>
    <div className="dash-controls"><div className="dash-control"><label>{tr("统计时间")}</label><Choice label={tr("仪表盘时间范围")} value={filters.days} onChange={v => change("days", v)} options={[["7", "近 7 天"], ["30", "近 30 天"], ["90", "近 90 天"], ["all", "全部日期"]]}/></div><div className="dash-control"><label>{tr("日期口径")}</label><Choice label={tr("仪表盘日期口径")} value={filters.clock} onChange={v => change("clock", v)} options={[["publication", "来源发布日期"], ["discovery", "平台发现时间"]]}/></div><div className="dash-control"><label>{tr("重点方向")}</label><Choice label={tr("仪表盘重点方向")} value={filters.track} onChange={v => change("track", v)} options={[["all", "两个重点方向"], ...Object.entries(TRACKS)]}/></div><div className="dash-control"><label>{tr("来源")}</label><Choice label={tr("仪表盘数据来源")} value={filters.source} onChange={v => change("source", v)} options={[["all", "全部来源"], ["Europe PMC", "Europe PMC"], ["arXiv", "arXiv"], ["medRxiv", "medRxiv"]]}/></div><Button variant="outline" onClick={exportRows} disabled={!m.rows.length}><ArrowDownToLine size={16}/>{tr("导出分析记录")}</Button></div>
    <div className="dash-scope"><span>{m.start} — {m.end}{tr(" \u00B7 按")}{dateLabel}{tr("筛选 \u00B7 下方指标与图表使用同一范围")}</span><span>{tr("可点击数字查看论文")}</span></div>
    {filters.clock === "discovery" && <div className="dash-explanation"><CircleHelp size={16}/>{tr("当前方向及来源的初始快照 ")}{m.initialCount}{tr(" 条已排除。发现曲线从 ")}{m.observedFrom}{tr(" 开始，展示当前载入样本中的后续发现，不代表论文新发表。")}</div>}
    <div className="dash-metrics">
      <Metric accent label={tr("当前范围记录")} value={count(m.rows.length)} hint={tr("DOI / 来源标识去重")} icon={BookOpen} onClick={() => drill("当前仪表盘范围", m.rows)}/>
      <Metric label={tr("器官与病灶分割")} value={count(m.segmented.length)} hint={tr("含自动、提示式与交互分割")} icon={Layers3} onClick={() => drill("器官与病灶分割", m.segmented)}/>
      <Metric label={tr("人参与研究线索")} value={count(m.human.length)} hint={tr("临床人在回路效果待核实")} icon={Workflow} onClick={() => drill("人参与研究线索", m.human)}/>
      <Metric label={tr("观察名单匹配")} value={teams.length ? count(m.matched.length) : "—"} hint={teams.length ? tr("{0} 份名单 \u00B7 跨名单去重", [teams.length]) : authenticated ? tr("添加 PI / 团队后开始追踪") : tr("登录后使用个人观察名单")} icon={Users} onClick={() => teams.length ? drill("观察名单匹配", m.matched) : onNavigate("teams")}/>
    </div>
    <div className="dash-main-grid">
      <section className="dash-panel dash-trajectory"><div className="dash-panel-heading"><div><h2>{filters.clock === "discovery" ? tr("平台发现记录") : tr("来源日期分布")}</h2><p>{m.monthly ? tr("按月") : tr("按日")}{tr("计数 \u00B7 两个方向可重叠，不相加为总量")}</p></div><span className="dash-unit">{tr("单位：条")}</span></div>
        {m.rows.length ? <ChartContainer className="dash-line-chart" config={{ all: { label: tr("当前范围"), color: "#91a2b3" }, segmentation: { label: tr("分割"), color: "#119780" }, human_loop: { label: tr("人参与线索"), color: "#4f84c5" } }}><LineChart accessibilityLayer data={m.trend} margin={{ left: 0, right: 15, top: 14, bottom: 4 }} onClick={(state: any) => {
                if (state?.activeTooltipIndex == null)
                    return;
                const r = m.trend[Number(state.activeTooltipIndex)];
                if (r?.ids.length)
                    onDrill({ label: `${r.date} · ${dateLabel}`, ids: r.ids });
            }}><CartesianGrid vertical={false} strokeDasharray="3 4"/><XAxis dataKey="date" tickFormatter={d => m.monthly ? d : d.slice(5)} minTickGap={28} tickLine={false} axisLine={false}/><YAxis allowDecimals={false} width={35} tickLine={false} axisLine={false}/><ChartTooltip content={<ChartTooltipContent />}/><Line type="linear" dataKey="all" stroke="var(--color-all)" strokeDasharray="4 3" strokeWidth={1.5} dot={m.trend.length === 1} isAnimationActive={false}/><Line type="linear" dataKey="segmentation" stroke="var(--color-segmentation)" strokeWidth={2.5} dot={m.trend.length <= 7} activeDot={{ r: 5 }} isAnimationActive={false}/><Line type="linear" dataKey="human_loop" stroke="var(--color-human_loop)" strokeWidth={2.5} dot={m.trend.length <= 7} activeDot={{ r: 5 }} isAnimationActive={false}/></LineChart></ChartContainer> : <div className="dash-chart-empty"><Radio size={28}/><strong>{filters.clock === "discovery" ? tr("尚无符合范围的后续发现") : tr("当前范围暂无记录")}</strong><span>{tr("调整时间或来源，或同步最新论文。")}</span></div>}
        <div className="dash-chart-legend"><span><i style={{ background: "#91a2b3" }}/>{tr("当前范围")}</span><span><i style={{ background: "#119780" }}/>{tr("分割")}</span><span><i style={{ background: "#4f84c5" }}/>{tr("人参与线索")}</span></div><details className="dash-series-detail"><summary>{tr("查看日期明细并定位论文")}</summary><div><Table><TableHeader><TableRow><TableHead>{tr("日期")}</TableHead><TableHead>{tr("全部")}</TableHead><TableHead>{tr("分割")}</TableHead><TableHead>{tr("人参与线索")}</TableHead></TableRow></TableHeader><TableBody>{m.trend.map(r => <TableRow key={r.date}><TableCell><button disabled={!r.ids.length} onClick={() => onDrill({ label: `${r.date} · ${dateLabel}`, ids: r.ids })}>{r.date}</button></TableCell><TableCell>{r.all}</TableCell><TableCell>{r.segmentation}</TableCell><TableCell>{r.human_loop}</TableCell></TableRow>)}</TableBody></Table></div></details>
        <p className="dash-note">{filters.clock === "discovery" ? tr("按平台首次发现时间统计；采集断档或上限会影响历史完整性。") : <>{tr("来源日期可能为卷期日期，medRxiv 为版本日期；覆盖受检索范围限制。")}{m.futureCount > 0 && tr(" 来源未来日期 {0} 条已排除。", [m.futureCount])}</>}</p>
      </section>
      <section className="dash-panel dash-publication"><div className="dash-panel-heading"><div><h2>{tr("发表状态")}</h2><p>{tr("预印本与期刊版本仍可能为不同记录")}</p></div></div><div className="dash-donut-wrap">{m.known ? <ChartContainer className="dash-donut" config={Object.fromEntries(m.status.map(s => [s.key, { label: tr(s.label), color: s.color }]))}><PieChart><ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel/>}/><Pie data={m.status.filter(s => s.key !== "unknown" && s.count)} dataKey="count" nameKey="key" innerRadius="68%" outerRadius="92%" paddingAngle={m.status.filter(s => s.key !== "unknown" && s.count).length > 1 ? 3 : 0} strokeWidth={0} isAnimationActive={false} onClick={(entry: any) => {
                const key = entry.key ?? entry.payload?.key;
                const s = m.status.find(x => x.key === key);
                if (s)
                    drill(s.label, m.rows.filter(p => p.status === key));
            }}>{m.status.filter(s => s.key !== "unknown" && s.count).map(s => <Cell key={s.key} fill={s.color}/>)}</Pie></PieChart></ChartContainer> : <div className="dash-donut-empty"/>}<div className="dash-donut-center"><strong>{m.preprintRate === null ? "—" : `${Math.round(m.preprintRate)}%`}</strong><span>{tr("预印本占比")}</span></div></div><div className="dash-status-legend">{m.status.map(s => <button key={s.key} onClick={() => drill(s.label, m.rows.filter(p => p.status === s.key))}><span><i style={{ background: s.color }}/>{tr(s.label)}</span><b>{count(s.count)}</b><ArrowUpRight size={13}/></button>)}</div><p className="dash-note">{tr("环形仅统计已知状态 ")}{m.known}{tr(" 条；占比 = 预印本 / 已知状态。未确认状态单列。")}</p></section>
    </div>
    <div className="dash-analysis-grid"><section className="dash-panel"><div className="dash-panel-heading"><div><h2>{tr("任务 \u00D7 影像模态")}</h2><p>{tr("点击单元格查看交叉方向 \u00B7 多标签计数，各格不能相加")}</p></div><span className="dash-heat-key">{tr("少 ")}<i />{tr(" 多")}</span></div><div className="dash-matrix-scroll"><table className="dash-matrix"><thead><tr><th>{tr("研究任务")}</th>{m.modalities.map(v => <th key={v}>{tr(v)}</th>)}</tr></thead><tbody>{m.matrix.map(row => <tr key={row.task}><th>{tr(row.label)}</th>{row.cells.map(c => <td key={c.modality}><button disabled={!c.papers.length} aria-label={tr("{0} \u00D7 {1}：{2} 条", [tr(row.label), tr(c.modality), c.papers.length])} title={tr("{0} \u00D7 {1}：{2} 条", [tr(row.label), tr(c.modality), c.papers.length])} onClick={() => drill(`${tr(row.label)} × ${tr(c.modality)}`, c.papers)} style={{ background: c.papers.length ? `rgba(10,139,116,${.12 + .76 * c.papers.length / maximum})` : "#f4f7fa", color: c.papers.length / maximum > .55 ? "#fff" : "#254959" }}>{c.papers.length || "—"}</button></td>)}</tr>)}</tbody></table></div></section><section className="dash-panel"><div className="dash-panel-heading"><div><h2>{tr("方法分布")}</h2><p>{tr("来自标题与摘要的关键词")}</p></div></div><div className="dash-methods">{m.methods.map(r => <button key={r.name} onClick={() => drill(tr("方法：{0}",[tr(r.name)]), r.papers)}><span>{tr(r.name)}<b>{r.papers.length}</b></span><i><i style={{ width: `${r.papers.length / Math.max(1, m.methods[0]?.papers.length ?? 0) * 100}%` }}/></i></button>)}{!m.methods.length && <p className="dash-note">{tr("当前范围未检出预设方法关键词。")}</p>}</div></section></div>
    <div className="dash-bottom-grid"><section className="dash-panel"><div className="dash-panel-heading"><div><h2>{tr("团队观察")}</h2><p>{tr("匹配当前分析范围内的论文记录")}</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate("teams")}>{tr("管理名单")}<ArrowUpRight size={14}/></Button></div>{teams.length ? <div className="dash-team-list">{m.teamRows.map(r => <button key={r.team.id} onClick={() => drill(tr("名单：{0}",[r.team.name]), r.papers)}><div><strong>{r.team.name}</strong><span>{tr(r.team.kind)} · {r.team.members.length}{tr(" 位成员 / 标识")}</span></div><b>{r.papers.length}</b><ArrowUpRight size={15}/></button>)}</div> : <div className="dash-team-empty"><Users size={28}/><strong>{authenticated ? tr("建立你的团队观察名单") : tr("你的个人团队观察空间")}</strong><p>{authenticated ? tr("输入 PI 或核心成员，集中查看竞争观察和合作候选的论文。") : tr("登录后建立自己的 PI / 团队名单，查看相关论文与共同署名线索。")}</p><Button variant="outline" onClick={() => onNavigate("teams")}>{authenticated ? tr("添加团队 / 作者") : tr("了解个人观察名单")}</Button></div>}<p className="dash-note">{tr("姓名可能重名；匹配数不代表真实团队产出，共同署名不代表合作意愿。")}</p></section><section className="dash-panel"><div className="dash-panel-heading"><div><h2>{tr("当前范围的近期记录")}</h2><p>{authenticated ? tr("{0} 条已收藏 \u00B7 {1} 条选题候选", [saved.length, saved.filter(c => c.stage === "选题候选").length]) : tr("公开论文与预印本 \u00B7 点击查看原始来源")}</p></div><Button variant="ghost" size="sm" onClick={() => drill("当前仪表盘范围", m.rows)}>{tr("查看全部")}<ArrowUpRight size={14}/></Button></div><div className="dash-recent-list">{latest.map(p => <button key={p.id} onClick={() => onPaper(p)}><span className="dash-recent-meta">{filters.clock === "discovery" ? beijingDay(p.firstSeenAt) : p.publishedAt.slice(0, 10)}<span>{p.status === "preprint" ? tr("预印本") : p.status === "published" ? tr("正式发表") : tr("状态未确认")}</span></span><strong>{p.title}</strong><span className="dash-recent-source">{p.source}<ArrowUpRight size={14}/></span></button>)}{!latest.length && <p className="dash-note">{tr("当前筛选没有记录。")}</p>}</div></section></div>
    <section className="dash-health"><div className="dash-health-heading"><h2>{tr("数据源状态")}</h2><span>{tr("全局状态，独立于上方筛选")}</span><Button variant="ghost" size="sm" onClick={() => onNavigate("sources")}>{tr("查看同步日志")}<ArrowUpRight size={14}/></Button></div><div className="dash-source-row">{m.sources.map(s => <button key={s.name} onClick={() => onNavigate("sources")}><span className="dash-source-name"><i className={s.warning ? "warn" : s.initial || s.limited ? "limited" : "ok"}/>{s.name}<b>{tr(s.state)}</b></span><span>{s.initial ? tr("初始采集") : tr("最后获取")} {stamp(s.updatedAt)} · {s.count}{tr(" 条关联记录")}</span></button>)}</div></section>
    <p className="dash-footnote">{tr("分析基于当前载入的 ")}{data.papers.length}{tr(" 条候选记录；日期分布与方法数量不代表全领域增长或研究质量。平台发现按北京时间统计。")}</p>
  </div>;
}
