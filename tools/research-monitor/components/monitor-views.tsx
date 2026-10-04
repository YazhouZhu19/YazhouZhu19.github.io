"use client";
import { api as request } from "@/lib/local-api";
import { useI18n } from "./locale-provider";
import { useMemo, useState } from "react";
import { ArrowUpRight, Database, Info, Plus, RefreshCw, Trash2, Users } from "lucide-react";
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
import { TRACKS, normalizedName } from "@/lib/classify";
import type { MonitorData, Paper, Team } from "@/lib/types";
const date = (d?: string | null) => d ? d.slice(0, 10) : "未提供";
const time = (d?: string | null) => d ? new Date(d).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "尚未同步";
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
    return <div className="sources-content"><div className="source-grid">{sources.map(s => { const sourceRuns = [...(data?.runs ?? [])].filter(r => r.source === s.name).sort((a, b) => b.completedAt.localeCompare(a.completedAt)); const run = sourceRuns[0]; const lastSuccess = sourceRuns.find(r => r.status !== "error" && !r.error); const count = data?.papers.filter(p => p.sources.includes(s.name)).length ?? 0; return <div className="source-card" key={s.name}><div className="source-card-title"><Database size={21}/><h2>{s.name}</h2><Badge variant="secondary" className={run?.status === "error" || run?.error ? "status-error" : "source-status"}>{run?.status === "error" ? tr("同步失败") : run?.error ? tr("部分失败") : run?.status === "partial" ? tr("有限覆盖") : run ? tr("同步成功") : tr("初始快照")}</Badge></div><strong className="source-count">{count}<small>{tr("条关联记录")}</small></strong><p>{tr(s.scope)}</p><span>{tr("最后成功：")}{lastSuccess ? time(lastSuccess.completedAt) : tr("尚无成功同步记录")}</span><a href={s.url} target="_blank" rel="noreferrer">{tr("数据源说明 ")}<ArrowUpRight size={14}/></a></div>; })}</div><section className="settings-panel"><div><h2>{tr("数据更新")}</h2><p>{tr("采集、关键词分类和统计不调用 AI 模型。定时任务或来源更新可能延迟，请以最后成功同步时间为准。")}</p><p>{tr("GitHub Actions 计划每小时运行；arXiv 成功检索在同一 UTC 日内复用缓存，其他来源每小时检查。GitHub Pages 页面每 5 分钟读取最新快照，也可手动刷新。")}</p><p><a href="https://github.com/YazhouZhu19/YazhouZhu19.github.io/actions/workflows/research-monitor-sync.yml" target="_blank" rel="noreferrer">{tr("查看采集任务状态")} ↗</a></p><p>{tr("同步失败保留旧记录。部分请求失败时标为“部分失败”；因数量上限或来源返回数量差异而未取全时标为“有限覆盖”。")}</p></div></section><div className="notice"><Info size={17}/><span>{tr("首次快照采用最近记录抽样，不是完整历史库；medRxiv 的日期是版本发布日期。来源有时标注未来卷期日期，此类记录保留标识，且不计入日期分布图。机构、关键词标签和关联 DOI 都保留来源含义。数据源记录可能交叉计数。")}</span></div><div className="notice"><Info size={17}/><span>{tr("新增方向从扩展采集后逐步积累；历史记录已重新分类，当前数量不代表完整历史或研究热度。")}</span></div><section className="paper-section"><div className="section-heading"><h2>{tr("同步记录")}</h2><span className="muted">{tr("最多 45 条来源同步记录")}</span></div>{data?.runs.length ? <Table><TableHeader><TableRow><TableHead>{tr("来源 / 时间")}</TableHead><TableHead>{tr("结果")}</TableHead><TableHead>{tr("新增 / 更新")}</TableHead><TableHead>{tr("检索范围与限制")}</TableHead></TableRow></TableHeader><TableBody>{data.runs.map(r => <TableRow key={r.id}><TableCell><strong>{r.source}</strong><small className="block muted">{time(r.completedAt)}</small></TableCell><TableCell>{r.status === "error" ? tr("失败") : r.error ? tr("部分失败") : r.status === "partial" ? tr("有限覆盖") : tr("完成")}<small className="block muted">{tr("读取 ")}{r.received}{tr(" \u00B7 保留 ")}{r.kept}</small></TableCell><TableCell>{r.added} / {r.updated}</TableCell><TableCell className="run-coverage">{tr(r.error ?? r.coverage)}<details><summary>{tr("查看检索式")}</summary><pre>{r.query}</pre><p>{r.dateFrom || tr("不限起始日")} — {r.dateTo}</p></details></TableCell></TableRow>)}</TableBody></Table> : <div className="history-empty"><Database size={24}/><div><strong>{tr("首次采集快照已加载")}</strong><p>{tr("初始采集于 ")}{time(data?.collectedAt)}{tr("。后续同步结果将在这里逐次记录。")}</p></div></div>}</section><section className="paper-section initial-queries"><div className="section-heading"><h2>{tr("初始快照的检索记录")}</h2></div>{data?.queryRuns.map((r: any, i: number) => <details key={i} className="query-detail"><summary><strong>{r.source}</strong><span>{tr(r.track)}</span><span>{tr("本请求 ")}{r.retrieved}{tr(" 条 / 检索命中 ")}{r.hitCount}</span></summary><p>{r.startDate} — {r.endDate} · {tr(r.dateField)}</p><pre>{r.query}</pre><p>{tr("查询时间：")}{time(r.collectedAt)}{tr("。分页请求的命中总数不可相加。")}</p>{r.url && <a href={r.url} target="_blank" rel="noreferrer">{tr("重现此来源查询 ")}<ArrowUpRight size={14}/></a>}</details>)}</section></div>;
}
