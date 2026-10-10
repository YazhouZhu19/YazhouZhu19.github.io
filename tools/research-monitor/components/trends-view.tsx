"use client";
import { useMemo } from "react";
import { GitBranch, Info, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { TASKS, TRACKS } from "@/lib/classify";
import type { Paper, SyncRun } from "@/lib/types";
import { useI18n } from "./locale-provider";
export function TrendsView({ papers, runs }: {
    papers: Paper[];
    runs: SyncRun[];
}) {
    const { locale, tr } = useI18n();
    const months = useMemo(() => {
        const m = new Map<string, {
            month: string;
            published: number;
            preprint: number;
        }>();
        const today = new Date().toISOString().slice(0, 10);
        for (const p of papers) {
            if (!p.publishedAt || p.publishedAt > today)
                continue;
            const key = p.publishedAt.slice(0, 7);
            const row = m.get(key) ?? { month: key, published: 0, preprint: 0 };
            if (p.status === "preprint")
                row.preprint++;
            else if (p.status === "published")
                row.published++;
            m.set(key, row);
        }
        return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
    }, [papers]);
    const tasks = useMemo(() => Object.entries(TASKS).map(([key, label]) => ({ name: tr(label), count: papers.filter(p => p.tasks.includes(key)).length })).filter(r => r.count).sort((a, b) => b.count - a.count), [papers, tr]);
    const methods = useMemo(() => [...new Set(papers.flatMap(p => p.methods))].map(name => ({ name, count: papers.filter(p => p.methods.includes(name)).length })).sort((a, b) => b.count - a.count), [papers]);
    const maxMethodCount = Math.max(...methods.map(method => method.count), 1);
    const history = useMemo(() => {
        const m = new Map<string, {
            day: string;
            added: number;
        }>();
        for (const r of runs) {
            if (r.status === "error")
                continue;
            const key = r.completedAt.slice(0, 10);
            const row = m.get(key) ?? { day: key, added: 0 };
            row.added += r.added;
            m.set(key, row);
        }
        return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
    }, [runs]);
    if (!papers.length)
        return <div className="empty-state"><Search /><p>{tr("当前筛选下暂无可统计记录")}</p></div>;
    return <div className="trends-content"><div className="metric-row"><div><span>{tr("筛选后的候选记录")}</span><strong>{papers.length}</strong><small>{tr("按 DOI / 来源标识去重")}</small></div><div><span>{tr("其中预印本")}</span><strong>{papers.filter(p => p.status === "preprint").length}</strong><small>{tr("以当前来源记录状态为准")}</small></div><div><span>{tr("匹配的感兴趣方向")}</span><strong>{Object.keys(TRACKS).filter(id => papers.some(p => p.tracks.includes(id))).length}</strong><small>{tr("方向可重叠，不相加为记录总量")}</small></div></div><div className="chart-panel"><div className="section-heading"><div><h2>{tr("已采集论文的日期分布")}</h2><p className="section-caption">{tr("未知状态和来源未来日期不计入柱图；medRxiv 为版本日期，其他来源为其标注的发表 / 提交日期。")}</p></div></div><ChartContainer className="date-chart" config={{ published: { label: tr("正式发表"), color: "var(--chart-1)" }, preprint: { label: tr("预印本"), color: "var(--chart-2)" } }}><BarChart accessibilityLayer data={months} margin={{ left: 4, right: 18, top: 12, bottom: 12 }}><CartesianGrid vertical={false}/><XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={25}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40}/><ChartTooltip content={<ChartTooltipContent />}/><Bar dataKey="published" stackId="a" fill="var(--color-published)" maxBarSize={42}/><Bar dataKey="preprint" stackId="a" fill="var(--color-preprint)" maxBarSize={42} radius={[4, 4, 0, 0]}/></BarChart></ChartContainer><div className="chart-legend"><span><i style={{ background: "var(--chart-1)" }}/>{tr("正式发表")}</span><span><i style={{ background: "var(--chart-2)" }}/>{tr("预印本")}</span></div><p className="chart-note"><Info size={14}/>{tr("日期分布受检索范围和采集上限影响，不用于判断全领域发文增长。")}</p></div><div className="charts-grid"><div className="chart-panel"><div className="section-heading"><div><h2>{tr("研究任务分布")}</h2><p className="section-caption">{tr("同一记录可属于多个任务，类别数不能相加为总量。")}</p></div></div><ChartContainer className="task-chart" config={{ count: { label: tr("候选记录"), color: "var(--chart-3)" } }}><BarChart accessibilityLayer data={tasks} layout="vertical" margin={{ left: 4, right: 30, top: 4, bottom: 12 }}><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="name" width={locale === "en" ? 185 : 143} tickLine={false} axisLine={false}/><ChartTooltip content={<ChartTooltipContent />}/><Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={18}/></BarChart></ChartContainer></div><div className="chart-panel"><div className="section-heading"><div><h2>{tr("方法关键词")}</h2><p className="section-caption">{tr("标题 / 摘要中的规则匹配，可交叉出现。")}</p></div></div><div className="method-bars">{methods.map(m => <div key={tr(m.name)}><div><span>{tr(m.name)}</span><strong>{m.count}</strong></div><div className="method-track"><span style={{ width: `${m.count / maxMethodCount * 100}%` }}/></div></div>)}{!methods.length && <p className="detail-hint">{tr("未检出预设方法关键词。")}</p>}</div></div></div><div className="chart-panel"><div className="section-heading"><div><h2>{tr("平台每日发现记录")}</h2><p className="section-caption">{tr("全库同步日志，独立于上方论文筛选；记录平台采集活动，不代表论文当日发表。")}</p></div></div>{history.length >= 2 ? <ChartContainer className="history-chart" config={{ added: { label: tr("新增入库"), color: "var(--chart-1)" } }}><LineChart accessibilityLayer data={history} margin={{ left: 4, right: 25, top: 12, bottom: 12 }}><CartesianGrid vertical={false}/><XAxis dataKey="day" minTickGap={24} tickLine={false}/><YAxis allowDecimals={false} width={40}/><ChartTooltip content={<ChartTooltipContent />}/><Line dataKey="added" stroke="var(--color-added)" strokeWidth={2} dot={{ r: 4 }} connectNulls={false}/></LineChart></ChartContainer> : <div className="history-empty"><GitBranch size={24}/><div><strong>{tr("正在积累持续监测记录")}</strong><p>{history.length ? tr("{0} 已通过同步新增 {1} 条。累积多个同步日后展示轨迹。", [history[0].day, history[0].added]) : tr("首次快照已入库。执行增量同步后，这里会记录每天的新发现。")}</p></div></div>}</div></div>;
}
