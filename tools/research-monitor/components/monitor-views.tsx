"use client";
import { api as request } from "@/lib/local-api";
import { useI18n } from "./locale-provider";
import { useMemo, useState } from "react";
import { ArrowUpRight, Database, GitBranch, Info, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { matchesTeam, matchesMember } from "@/lib/dashboard";
import { TASKS, TRACKS, normalizedName } from "@/lib/classify";
import type { MonitorData, Paper, SyncRun, Team } from "@/lib/types";
const date = (d?: string | null) => d ? d.slice(0, 10) : "未提供";
const time = (d?: string | null) => d ? new Date(d).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "尚未同步";
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
        for (const p of papers) {
            if (!p.publishedAt || p.publishedAt > new Date().toISOString().slice(0, 10))
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
    const tasks = Object.entries(TASKS).map(([key, label]) => ({ name: tr(label), count: papers.filter(p => p.tasks.includes(key)).length })).filter(r => r.count).sort((a, b) => b.count - a.count);
    const methods = [...new Set(papers.flatMap(p => p.methods))].map(name => ({ name, count: papers.filter(p => p.methods.includes(name)).length })).sort((a, b) => b.count - a.count);
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
    return <div className="trends-content"><div className="metric-row"><div><span>{tr("筛选后的候选记录")}</span><strong>{papers.length}</strong><small>{tr("按 DOI / 来源标识去重")}</small></div><div><span>{tr("其中预印本")}</span><strong>{papers.filter(p => p.status === "preprint").length}</strong><small>{tr("以当前来源记录状态为准")}</small></div><div><span>{tr("匹配的感兴趣方向")}</span><strong>{Object.keys(TRACKS).filter(id => papers.some(p => p.tracks.includes(id))).length}</strong><small>{tr("方向可重叠，不相加为记录总量")}</small></div></div><div className="chart-panel"><div className="section-heading"><div><h2>{tr("已采集论文的日期分布")}</h2><p className="section-caption">{tr("未知状态和来源未来日期不计入柱图；medRxiv 为版本日期，其他来源为其标注的发表 / 提交日期。")}</p></div></div><ChartContainer className="date-chart" config={{ published: { label: tr("正式发表"), color: "#087d6a" }, preprint: { label: tr("预印本"), color: "#7297ce" } }}><BarChart accessibilityLayer data={months} margin={{ left: 4, right: 18, top: 12, bottom: 12 }}><CartesianGrid vertical={false}/><XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={25}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40}/><ChartTooltip content={<ChartTooltipContent />}/><Bar dataKey="published" stackId="a" fill="var(--color-published)" maxBarSize={42}/><Bar dataKey="preprint" stackId="a" fill="var(--color-preprint)" maxBarSize={42} radius={[4, 4, 0, 0]}/></BarChart></ChartContainer><div className="chart-legend"><span><i style={{ background: "#087d6a" }}/>{tr("正式发表")}</span><span><i style={{ background: "#7297ce" }}/>{tr("预印本")}</span></div><p className="chart-note"><Info size={14}/>{tr("日期分布受检索范围和采集上限影响，不用于判断全领域发文增长。")}</p></div><div className="charts-grid"><div className="chart-panel"><div className="section-heading"><div><h2>{tr("研究任务分布")}</h2><p className="section-caption">{tr("同一记录可属于多个任务，类别数不能相加为总量。")}</p></div></div><ChartContainer className="task-chart" config={{ count: { label: tr("候选记录"), color: "#168672" } }}><BarChart accessibilityLayer data={tasks} layout="vertical" margin={{ left: 4, right: 30, top: 4, bottom: 12 }}><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="name" width={locale === "en" ? 185 : 143} tickLine={false} axisLine={false}/><ChartTooltip content={<ChartTooltipContent />}/><Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={18}/></BarChart></ChartContainer></div><div className="chart-panel"><div className="section-heading"><div><h2>{tr("方法关键词")}</h2><p className="section-caption">{tr("标题 / 摘要中的规则匹配，可交叉出现。")}</p></div></div><div className="method-bars">{methods.map(m => <div key={tr(m.name)}><div><span>{tr(m.name)}</span><strong>{m.count}</strong></div><div className="method-track"><span style={{ width: `${m.count / Math.max(...methods.map(x => x.count), 1) * 100}%` }}/></div></div>)}{!methods.length && <p className="detail-hint">{tr("未检出预设方法关键词。")}</p>}</div></div></div><div className="chart-panel"><div className="section-heading"><div><h2>{tr("平台每日发现记录")}</h2><p className="section-caption">{tr("全库同步日志，独立于上方论文筛选；记录平台采集活动，不代表论文当日发表。")}</p></div></div>{history.length >= 2 ? <ChartContainer className="history-chart" config={{ added: { label: tr("新增入库"), color: "#087d6a" } }}><LineChart accessibilityLayer data={history} margin={{ left: 4, right: 25, top: 12, bottom: 12 }}><CartesianGrid vertical={false}/><XAxis dataKey="day" minTickGap={24} tickLine={false}/><YAxis allowDecimals={false} width={40}/><ChartTooltip content={<ChartTooltipContent />}/><Line dataKey="added" stroke="var(--color-added)" strokeWidth={2} dot={{ r: 4 }} connectNulls={false}/></LineChart></ChartContainer> : <div className="history-empty"><GitBranch size={24}/><div><strong>{tr("正在积累持续监测记录")}</strong><p>{history.length ? tr("{0} 已通过同步新增 {1} 条。累积多个同步日后展示轨迹。", [history[0].day, history[0].added]) : tr("首次快照已入库。执行增量同步后，这里会记录每天的新发现。")}</p></div></div>}</div></div>;
}
export function TeamsView({ papers, teams, onChange, openPaper, storageAvailable }: {
    papers: Paper[];
    teams: Team[];
    onChange: () => void;
    openPaper: (p: Paper) => void;
    storageAvailable: boolean;
}) {
    const { locale, tr } = useI18n();
    const [open, setOpen] = useState(false), [name, setName] = useState(""), [members, setMembers] = useState(""), [institution, setInstitution] = useState(""), [kind, setKind] = useState("持续关注"), [saving, setSaving] = useState(false), [expanded, setExpanded] = useState<string | null>(null);
    const candidates = useMemo(() => {
        const m = new Map<string, {
            name: string;
            count: number;
            affiliation: string;
        }>();
        for (const p of papers) {
            const seen = new Set<string>();
            for (const a of p.authors) {
                const key = a.orcid ?? normalizedName(a.name);
                if (!key || seen.has(key))
                    continue;
                seen.add(key);
                const r = m.get(key) ?? { name: a.name, count: 0, affiliation: a.affiliations[0] ?? "" };
                r.count++;
                if (!r.affiliation && a.affiliations[0])
                    r.affiliation = a.affiliations[0];
                m.set(key, r);
            }
        }
        return [...m.values()].filter(r => r.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
    }, [papers]);
    const create = async () => {
        setSaving(true);
        try {
            await request("/api/teams", { method: "POST", body: JSON.stringify({ name, members: members.split(/\n|;/).map(s => s.trim()).filter(Boolean), institution, kind }) });
            setOpen(false);
            onChange();
            toast.success(tr("已建立观察名单"));
        }
        catch (e) {
            toast.error(tr((e as Error).message));
        }
        finally {
            setSaving(false);
        }
    };
    const remove = async (id: string) => {
        try {
            await request("/api/teams", { method: "DELETE", body: JSON.stringify({ id }) });
            onChange();
            toast.success(tr("已移出观察名单"));
        }
        catch (e) {
            toast.error(tr((e as Error).message));
        }
    };
    const begin = (author = "") => { setName(author ? tr("{0} · 作者观察",[author]) : ""); setMembers(author); setInstitution(""); setKind("持续关注"); setOpen(true); };
    return <><div className="teams-heading"><h2>{tr("我的观察名单 ")}<span>{teams.length}</span></h2><Button onClick={() => begin()} disabled={!storageAvailable}><Plus size={16}/>{tr("添加团队 / 作者")}</Button></div><div className="notice"><Info size={17}/><span>{tr("按成员姓名或 ORCID 匹配。姓名可能重名，机构可能缺失；名单由你确认，不把机构或末位作者自动当作课题组。")}</span></div>{!teams.length ? <div className="team-intro"><Users size={30}/><div><h3>{tr("先建立你真正关心的名单")}</h3><p>{tr("添加 PI 和核心成员，将相关论文集中到一个观察窗口。")}</p></div><Button variant="outline" onClick={() => begin()} disabled={!storageAvailable}>{tr("建立第一份名单")}</Button></div> : <div className="team-grid">{teams.map(t => { const works = papers.filter(p => matchesTeam(p, t)); const known = new Set(t.members.map(normalizedName)); const coauthors = new Map<string, number>(); works.forEach(p => { new Set(p.authors.filter(a => !matchesMember(a, t.members)).map(a => a.name)).forEach(n => coauthors.set(n, (coauthors.get(n) ?? 0) + 1)); }); return <section className="team-card" key={t.id}><div className="team-card-heading"><div className="team-avatar">{t.name.slice(0, 1)}</div><div><h3>{t.name}</h3><span>{tr(t.kind)}</span></div><Button variant="ghost" size="icon" aria-label={tr("移除观察名单：{0}", [t.name])} onClick={() => void remove(t.id)}><Trash2 size={15}/></Button></div><p className="team-members">{tr("成员：")}{t.members.join(" · ")}</p>{t.institution && <p className="team-members">{tr("成员署名机构筛选：")}{t.institution}</p>}<div className="team-metrics"><div><strong>{works.length}</strong><span>{tr("匹配记录")}</span></div><div><strong>{Object.keys(TRACKS).filter(id => works.some(p => p.tracks.includes(id))).length}</strong><span>{tr("感兴趣方向")}</span></div><div><strong>{works.filter(p => p.status === "preprint").length}</strong><span>{tr("预印本")}</span></div></div><h4>{tr("近期研究")}</h4>{works.length ? works.slice(0, expanded === t.id ? 12 : 3).map(p => <button className="team-paper" key={p.id} onClick={() => openPaper(p)}><span>{p.title}</span><small>{tr(date(p.publishedAt))}</small></button>) : <p className="detail-hint">{tr("当前采集库中暂无匹配；这不表示该团队没有相关研究。")}</p>}{works.length > 3 && <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>{expanded === t.id ? tr("收起") : tr("查看更多匹配论文")}</Button>}<h4>{tr("共同署名线索")}</h4><div className="tag-row">{[...coauthors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => <span className="tag" key={n}>{n} · {c}</span>)}</div><p className="detail-hint">{tr("共著次数来自当前采集库，不代表当前合作关系或意愿。")}</p></section>; })}</div>}<section className="paper-section author-discovery"><div className="section-heading"><div><h2>{tr("从已采集论文发现作者")}</h2><p className="section-caption">{tr("至少出现于两条记录的作者线索；数量不代表学术水平或竞争强度。")}</p></div></div><div className="author-grid">{candidates.map(a => <div className="author-row" key={a.name}><div><strong>{a.name}</strong><span>{a.count}{tr(" 条记录 \u00B7 ")}{a.affiliation || tr("来源未提供机构")}</span></div><Button variant="ghost" size="sm" onClick={() => begin(a.name)} disabled={!storageAvailable}><Plus size={15}/>{tr("观察")}</Button></div>)}</div>{!candidates.length && <div className="empty-state">{tr("当前没有足够的重复作者记录。")}</div>}</section><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{tr("建立团队 / 作者观察名单")}</DialogTitle><DialogDescription>{tr("成员请使用论文署名全名或完整 ORCID。每行一位，可随时移除名单。")}</DialogDescription></DialogHeader><div className="team-form"><Label htmlFor="team-name">{tr("名单名称")}</Label><Input id="team-name" value={name} onChange={e => setName(e.target.value)} placeholder={tr("课题组名称或作者名")}/><Label htmlFor="team-members">{tr("成员 / ORCID（每行一位）")}</Label><Textarea id="team-members" value={members} onChange={e => setMembers(e.target.value)} placeholder={tr("与来源记录一致的作者全名")}/><Label htmlFor="team-inst">{tr("成员署名机构关键词（可选）")}</Label><Input id="team-inst" value={institution} onChange={e => setInstitution(e.target.value)} placeholder={tr("用于减少重名；缺少机构的记录将不匹配")}/><Label>{tr("观察目的")}</Label><Select value={kind} onValueChange={setKind}><SelectTrigger aria-label={tr("观察目的")}><SelectValue /></SelectTrigger><SelectContent>{["持续关注", "竞争观察", "合作候选"].map(x => <SelectItem key={x} value={x}>{tr(x)}</SelectItem>)}</SelectContent></Select></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{tr("取消")}</Button><Button disabled={!name.trim() || !members.trim() || saving} onClick={() => void create()}>{saving ? tr("正在保存") : tr("保存名单")}</Button></DialogFooter></DialogContent></Dialog></>;
}
export function SourcesView({ data }: { data: MonitorData | null }) {
    const { locale, tr } = useI18n();
    const sources = [{ name: "Europe PMC", url: "https://europepmc.org/RestfulWebService", scope: "PubMed / PMC / 预印本索引；10 个感兴趣方向分别检索。" }, { name: "arXiv", url: "https://info.arxiv.org/help/api/user-manual.html", scope: "每方向按版本更新时间获取最近 100 条，10 个方向合计最多读取 1,000 条；结果去重。" }, { name: "medRxiv", url: "https://api.biorxiv.org/", scope: "Radiology and Imaging 分类，版本日期重叠窗口。" }];
    return <div className="sources-content"><div className="source-grid">{sources.map(s => { const run = data?.runs.find(r => r.source === s.name); const count = data?.papers.filter(p => p.sources.includes(s.name)).length ?? 0; return <div className="source-card" key={s.name}><div className="source-card-title"><Database size={21}/><h2>{s.name}</h2><Badge variant="secondary" className={run?.status === "error" ? "status-error" : "source-status"}>{run?.status === "error" ? tr("同步失败") : run?.status === "partial" ? tr("有限覆盖") : run ? tr("同步成功") : tr("初始快照")}</Badge></div><strong className="source-count">{count}<small>{tr("条关联记录")}</small></strong><p>{tr(s.scope)}</p><span>{tr("最后成功：")}{time(data?.runs.find(r => r.source === s.name && r.status !== "error")?.completedAt ?? data?.collectedAt)}</span><a href={s.url} target="_blank" rel="noreferrer">{tr("数据源说明 ")}<ArrowUpRight size={14}/></a></div>; })}</div><section className="settings-panel"><div><h2>{tr("数据更新")}</h2><p>{tr("采集、关键词分类和统计不调用 AI 模型。定时任务或来源更新可能延迟，请以最后成功同步时间为准。")}</p><p>{tr("GitHub Actions 计划每小时运行；arXiv 成功检索在同一 UTC 日内复用缓存，其他来源每小时检查。GitHub Pages 页面每 5 分钟读取最新快照，也可手动刷新。")}</p><p><a href="https://github.com/YazhouZhu19/YazhouZhu19.github.io/actions/workflows/research-monitor-sync.yml" target="_blank" rel="noreferrer">{tr("查看采集任务状态")} ↗</a></p><p>{tr("同步失败保留旧记录。每次检索有数量上限，来源总量超过上限时标为\u201C有限覆盖\u201D。")}</p></div></section><div className="notice"><Info size={17}/><span>{tr("首次快照采用最近记录抽样，不是完整历史库；medRxiv 的日期是版本发布日期。来源有时标注未来卷期日期，此类记录保留标识，且不计入日期分布图。机构、关键词标签和关联 DOI 都保留来源含义。数据源记录可能交叉计数。")}</span></div><div className="notice"><Info size={17}/><span>{tr("新增方向从扩展采集后逐步积累；历史记录已重新分类，当前数量不代表完整历史或研究热度。")}</span></div><section className="paper-section"><div className="section-heading"><h2>{tr("同步记录")}</h2><span className="muted">{tr("最多 45 条来源同步记录")}</span></div>{data?.runs.length ? <Table><TableHeader><TableRow><TableHead>{tr("来源 / 时间")}</TableHead><TableHead>{tr("结果")}</TableHead><TableHead>{tr("新增 / 更新")}</TableHead><TableHead>{tr("检索范围与限制")}</TableHead></TableRow></TableHeader><TableBody>{data.runs.map(r => <TableRow key={r.id}><TableCell><strong>{r.source}</strong><small className="block muted">{time(r.completedAt)}</small></TableCell><TableCell>{r.status === "error" ? tr("失败") : r.status === "partial" ? tr("有限覆盖") : tr("完成")}<small className="block muted">{tr("读取 ")}{r.received}{tr(" \u00B7 保留 ")}{r.kept}</small></TableCell><TableCell>{r.added} / {r.updated}</TableCell><TableCell className="run-coverage">{tr(r.error ?? r.coverage)}<details><summary>{tr("查看检索式")}</summary><pre>{r.query}</pre><p>{r.dateFrom || tr("不限起始日")} — {r.dateTo}</p></details></TableCell></TableRow>)}</TableBody></Table> : <div className="history-empty"><Database size={24}/><div><strong>{tr("首次采集快照已加载")}</strong><p>{tr("初始采集于 ")}{time(data?.collectedAt)}{tr("。后续同步结果将在这里逐次记录。")}</p></div></div>}</section><section className="paper-section initial-queries"><div className="section-heading"><h2>{tr("初始快照的检索记录")}</h2></div>{data?.queryRuns.map((r: any, i: number) => <details key={i} className="query-detail"><summary><strong>{r.source}</strong><span>{tr(r.track)}</span><span>{tr("本请求 ")}{r.retrieved}{tr(" 条 / 检索命中 ")}{r.hitCount}</span></summary><p>{r.startDate} — {r.endDate} · {tr(r.dateField)}</p><pre>{r.query}</pre><p>{tr("查询时间：")}{time(r.collectedAt)}{tr("。分页请求的命中总数不可相加。")}</p>{r.url && <a href={r.url} target="_blank" rel="noreferrer">{tr("重现此来源查询 ")}<ArrowUpRight size={14}/></a>}</details>)}</section></div>;
}
