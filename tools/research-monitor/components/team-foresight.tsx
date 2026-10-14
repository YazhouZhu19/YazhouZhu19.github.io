"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/local-api";
import { buildForesight } from "@/lib/foresight";
import { beijingDay, matchesMember, matchesTeam, type DashboardDrill } from "@/lib/dashboard";
import { normalizedName, TRACKS } from "@/lib/classify";
import type { ForesightCard, ForesightResult } from "@/lib/foresight-types";
import type { MonitorData, Paper, Team } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "./locale-provider";
import { ForesightCards } from "./foresight-view";
import { TeamsView } from "./monitor-views";
import "@/styles/team-foresight.css";

export type TeamForesightPreferences = { teamId: string; horizon: ForesightCard["horizon"] };
type Props = {
  data: MonitorData;
  teams: Team[];
  onChange: () => Promise<unknown>;
  openPaper: (paper: Paper) => void;
  onDrill: (drill: DashboardDrill) => void;
  storageAvailable: boolean;
  preferences?: TeamForesightPreferences;
  onPreferencesChange?: (preferences: TeamForesightPreferences) => void;
};
type AuthorCandidate = { key: string; name: string; member: string; orcid: string | null; affiliations: string[]; papers: Paper[] };
type TrajectoryDimension = "tracks" | "methods" | "modalities";

function hasUnabbreviatedName(name: string): boolean {
  const tokens = name.match(/[\p{L}]+/gu) ?? [];
  if (tokens.some(token => /^[A-Za-z]$/.test(token) || /^[A-Z]{2,3}$/.test(token))) return false;
  return tokens.length >= 2 || /^[\p{Script=Han}]{2,}$/u.test(name.trim());
}

function authorCandidates(papers: Paper[], asOf: string): AuthorCandidate[] {
  const candidates = new Map<string, AuthorCandidate>();
  for (const paper of papers) {
    const date = paper.publishedAt.slice(0, 10);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!paper.tracks.length || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > asOf) continue;
    const seen = new Set<string>();
    for (const author of paper.authors) {
      const name = author.displayName?.trim() || author.name.trim();
      const candidateOrcid = (author.orcid || "").replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, "").trim().toUpperCase();
      const orcid = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(candidateOrcid) ? candidateOrcid : null;
      const normalized = normalizedName(name);
      const key = orcid ? `orcid:${orcid}` : `name:${normalized}`;
      if ((!normalized && !orcid) || seen.has(key)) continue;
      seen.add(key);
      const entry = candidates.get(key) ?? { key, name: name || orcid!, member: orcid || author.name.trim() || name, orcid, affiliations: [], papers: [] };
      if (orcid && hasUnabbreviatedName(name) && !hasUnabbreviatedName(entry.name)) entry.name = name;
      if (!entry.papers.some(row => row.id === paper.id)) entry.papers.push(paper);
      entry.affiliations = [...new Set([...entry.affiliations, ...author.affiliations])];
      candidates.set(key, entry);
    }
  }
  return [...candidates.values()].map(candidate => ({ ...candidate, papers: candidate.papers.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) }))
    .sort((a, b) => Number(!!b.orcid) - Number(!!a.orcid) || Number(hasUnabbreviatedName(b.name)) - Number(hasUnabbreviatedName(a.name)) || b.papers.length - a.papers.length || a.name.localeCompare(b.name));
}

export function TeamForesight({ data, teams, onChange, openPaper, onDrill, storageAvailable, preferences, onPreferencesChange }: Props) {
  const { locale, tr } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [localPreferences, setLocalPreferences] = useState<TeamForesightPreferences>({ teamId: "", horizon: "6–12" });
  const viewPreferences = preferences ?? localPreferences;
  const { teamId, horizon } = viewPreferences;
  const changePreferences = (next: TeamForesightPreferences) => {
    setLocalPreferences(next);
    onPreferencesChange?.(next);
  };
  const [search, setSearch] = useState("");
  const [trajectoryDimension, setTrajectoryDimension] = useState<TrajectoryDimension>("tracks");
  const [relationshipsOpen, setRelationshipsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftMembers, setDraftMembers] = useState("");
  const [draftInstitution, setDraftInstitution] = useState("");
  const [draftKind, setDraftKind] = useState("持续关注");
  const [saving, setSaving] = useState(false);
  const selectedTeam = teams.find(team => team.id === teamId) ?? teams[0];
  const day = beijingDay(new Date());
  const result = useMemo<ForesightResult | null>(() => selectedTeam ? buildForesight(data.papers, { team: selectedTeam, horizon, now: new Date(`${day}T12:00:00+08:00`) }) : null,
    [data.papers, selectedTeam, horizon, day]);
  const teamCounts = useMemo(() => new Map(teams.map(team => [team.id, data.papers.filter(paper => matchesTeam(paper, team)).length])), [data.papers, teams]);
  const authors = useMemo(() => authorCandidates(data.papers, day), [data.papers, day]);
  const visibleAuthors = useMemo(() => {
    const query = normalizedName(search);
    return authors.filter(author => query
      ? normalizedName(`${author.name} ${author.orcid ?? ""} ${author.affiliations.join(" ")}`).includes(query)
      : !!author.orcid || hasUnabbreviatedName(author.name)).slice(0, 4);
  }, [authors, search]);
  const relationships = useMemo(() => {
    if (!relationshipsOpen || !selectedTeam || !result) return [];
    const currentIds = new Set(result.current.map(paper => paper.id));
    return teams.filter(team => team.id !== selectedTeam.id).slice(0, 3).map(team => {
      const peer = buildForesight(data.papers, { team, horizon, now: new Date(`${day}T12:00:00+08:00`) });
      const shared = (dimension: TrajectoryDimension) => {
        const ownTags = new Set(result.current.flatMap(paper => paper[dimension]));
        return [...new Set(peer.current.flatMap(paper => paper[dimension]))].filter(tag => ownTags.has(tag)).sort();
      };
      return { team, papers: peer.current, common: peer.current.filter(paper => currentIds.has(paper.id)), tracks: shared("tracks"), methods: shared("methods"), modalities: shared("modalities") };
    });
  }, [relationshipsOpen, selectedTeam, result, teams, data.papers, horizon, day]);
  const dimensionLabel = (dimension: TrajectoryDimension) => dimension === "tracks" ? t("研究方向", "Research direction") : dimension === "methods" ? t("方法路线", "Methods") : t("数据模态", "Data modalities");
  const tagLabel = (dimension: TrajectoryDimension, tag: string) => tr(dimension === "tracks" ? TRACKS[tag] ?? tag : tag);

  const beginCreate = (author?: AuthorCandidate) => {
    setDraftName(author ? `${author.name} · ${t("作者观察", "Author watchlist")}` : "");
    setDraftMembers(author?.member ?? "");
    setDraftInstitution("");
    setDraftKind("持续关注");
    setCreateOpen(true);
  };
  const createTeam = async () => {
    setSaving(true);
    try {
      const response = await api("/api/teams", { method: "POST", body: JSON.stringify({
        name: draftName, members: draftMembers.split(/\n|;/).map(value => value.trim()).filter(Boolean), institution: draftInstitution, kind: draftKind,
      }) });
      await onChange();
      if (response.team) changePreferences({ ...viewPreferences, teamId: response.team.id });
      setCreateOpen(false);
      toast.success(tr("已建立观察名单"));
    } catch (error) {
      toast.error(tr(error instanceof Error ? error.message : String(error)));
    } finally { setSaving(false); }
  };
  const openPeriod = (label: string, papers: Paper[]) => onDrill({ label, ids: papers.map(paper => paper.id) });

  return <div className="foresight-view team-foresight">
    {!!teams.length && <div className="team-watchlist-toolbar">
      <span>{t(`${teams.length} 份已保存名单`, `${teams.length} saved watchlists`)}</span>
      <Button onClick={() => beginCreate()} disabled={!storageAvailable}><Plus size={16}/>{t("添加观察名单", "Add watchlist")}</Button>
    </div>}

    {!storageAvailable && <p className="foresight-note">{t("当前浏览器无法保存名单；仍可查看已有名单和论文证据。", "This browser cannot save watchlists. Existing watchlists and paper evidence remain available.")}</p>}

    {selectedTeam && result ? <>
      <div className="foresight-controls team-foresight-controls">
        <label className="foresight-field"><span>{t("观察对象", "Watchlist")}</span><select value={selectedTeam.id} onChange={event => changePreferences({ ...viewPreferences, teamId: event.target.value })}>{teams.map(team => <option key={team.id} value={team.id}>{team.name} · {teamCounts.get(team.id) ?? 0} {t("条库内记录", "library records")}</option>)}</select></label>
        <label className="foresight-field"><span>{t("判断时间范围", "Outlook horizon")}</span><select value={horizon} onChange={event => changePreferences({ ...viewPreferences, horizon: event.target.value as ForesightCard["horizon"] })}>{(["3–6", "6–12", "12–24"] as const).map(value => <option key={value} value={value}>{value} {t("个月", "months")}</option>)}</select></label>
      </div>
      <div className="team-identity-note">
        <strong>{selectedTeam.name}</strong><span>{selectedTeam.members.join(" · ")}</span>
        <p>{t("按成员全名或 ORCID 匹配；同名可能混淆，机构和末位作者不自动认定为真实团队或 PI。", "Matches use member names or ORCIDs. Names may be ambiguous; affiliations and last authorship do not establish a team or PI role.")}</p>
        {selectedTeam.institution && <p>{t("署名机构筛选：", "Affiliation filter: ")}{selectedTeam.institution}{t("；缺少该机构信息的记录不会匹配。", "; records without matching affiliation metadata are excluded.")}</p>}
      </div>
      <section className="team-trajectory" aria-labelledby="team-trajectory-title">
        <div className="foresight-toolbar"><h3 id="team-trajectory-title">{t("公开研究轨迹", "Public research trajectory")}</h3><span>{t("两个相邻的 90 天窗口", "Two adjacent 90-day windows")}</span></div>
        <label className="team-trajectory-dimension"><span>{t("观察维度", "View dimension")}</span><select value={trajectoryDimension} onChange={event => setTrajectoryDimension(event.target.value as TrajectoryDimension)}>{(["tracks", "methods", "modalities"] as const).map(dimension => <option key={dimension} value={dimension}>{dimensionLabel(dimension)}</option>)}</select></label>
        <div className="team-trajectory-periods">{[
          { key: "previous", label: t("此前 90 天", "Previous 90 days"), from: result.previousFrom, to: result.previousTo, papers: result.previous },
          { key: "current", label: t("最近 90 天", "Latest 90 days"), from: result.from, to: result.asOf, papers: result.current },
        ].map(period => {
          const tags = [...new Set(period.papers.flatMap(paper => paper[trajectoryDimension]))].map(tag => ({ tag, count: period.papers.filter(paper => paper[trajectoryDimension].includes(tag)).length })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 3);
          return <div className="team-trajectory-period" key={period.key}>
            <div><h4>{period.label}</h4><span>{period.from} — {period.to}</span></div>
            <button type="button" className="team-period-count" disabled={!period.papers.length} aria-label={`${period.label}: ${period.papers.length} ${t("篇去重论文", "distinct works")}`} onClick={() => openPeriod(`${selectedTeam.name} · ${period.label}`, period.papers)}><strong>{period.papers.length}</strong><span>{t("篇去重论文", "distinct works")}</span><ArrowUpRight size={16}/></button>
            {tags.length ? <ul className="team-period-methods">{tags.map(row => <li key={row.tag}><span>{tagLabel(trajectoryDimension, row.tag)}</span><span>{row.count}/{period.papers.length}</span></li>)}</ul> : <p>{t("该窗口尚无可识别的相关标签。", "No labels for this dimension are identified in this window.")}</p>}
          </div>;
        })}</div>
      </section>
      <ForesightCards result={result} onPaper={openPaper} onDrill={onDrill}/>
      {!!result.current.length && <section className="team-recent-evidence"><div className="foresight-toolbar"><h3>{t("近期论文证据", "Recent paper evidence")}</h3><button className="foresight-button" onClick={() => openPeriod(selectedTeam.name, result.papers)}>{t("查看本次范围论文", "All papers in this scope")}<ArrowUpRight size={14}/></button></div><ul>{result.current.slice(0, 3).map(paper => <li key={paper.id}><button onClick={() => openPaper(paper)}><time dateTime={paper.publishedAt}>{paper.publishedAt.slice(0, 10)}</time><span>{paper.title}</span><ArrowUpRight size={15}/></button></li>)}</ul></section>}
      {teams.length >= 2 && <details className="team-relationships" onToggle={event => setRelationshipsOpen(event.currentTarget.open)}>
        <summary>{t("关注名单之间的关系", "Relationships between watchlists")}</summary>
        <p className="foresight-note">{t("比较最近 90 天的去重论文，最多展示另外 3 份名单。公开研究交集与潜在互补线索需结合真实资源核验，不推断合作意愿或竞争强度。", "Compare distinct works from the latest 90 days for up to three other watchlists. Public research overlap and possible complementary clues require real-world resource checks; they do not establish willingness to collaborate or competitive strength.")}</p>
        <ul className="team-relationship-list">{relationships.map(relation => <li key={relation.team.id}>
          <h4>{selectedTeam.name} × {relation.team.name}</h4>
          <dl>{(["tracks", "methods", "modalities"] as const).filter(dimension => relation[dimension].length).map(dimension => <div key={dimension}><dt>{dimensionLabel(dimension)}</dt><dd>{relation[dimension].map(tag => tagLabel(dimension, tag)).join(" · ")}</dd></div>)}</dl>
          {!relation.tracks.length && !relation.methods.length && !relation.modalities.length && <p className="foresight-note">{t("当前样本未识别到共同标签；不能据此判断合作或竞争关系。", "No shared labels were identified in the current sample. This does not establish a collaboration or competition relationship.")}</p>}
          <div className="team-relationship-actions"><button className="foresight-button" disabled={!relation.common.length} onClick={() => openPeriod(`${selectedTeam.name} × ${relation.team.name} · ${t("共同论文", "Shared papers")}`, relation.common)}>{t("共同论文", "Shared papers")} · {relation.common.length}<ArrowUpRight size={14}/></button><button className="foresight-button" disabled={!result.current.length} onClick={() => openPeriod(`${selectedTeam.name} · ${t("最近 90 天", "Latest 90 days")}`, result.current)}>{selectedTeam.name} · {result.current.length}<ArrowUpRight size={14}/></button><button className="foresight-button" disabled={!relation.papers.length} onClick={() => openPeriod(`${relation.team.name} · ${t("最近 90 天", "Latest 90 days")}`, relation.papers)}>{relation.team.name} · {relation.papers.length}<ArrowUpRight size={14}/></button></div>
        </li>)}</ul>
      </details>}
    </> : <section className="foresight-empty team-foresight-empty"><Users size={28}/><div><h3>{t("先选择真实的研究对象", "Start with a real research watchlist")}</h3><p>{t("添加 PI、作者或核心成员的全名 / ORCID，或从下方论文作者中建立名单。选定后将生成有原文证据的方向判断。", "Add a PI, author or core member by full name or ORCID, or start from an author below. Selecting a watchlist creates assessments linked to paper evidence.")}</p></div><Button variant="outline" onClick={() => beginCreate()} disabled={!storageAvailable}>{t("建立第一份名单", "Create your first watchlist")}</Button></section>}

    <details className="team-discovery" open={!teams.length ? true : undefined}>
      <summary>{t("从真实论文发现作者", "Discover authors from real papers")}</summary>
      <div className="team-discovery-content"><p className="foresight-note">{t("从已分类且日期有效的非未来论文中发现作者，默认优先 ORCID 与完整姓名。数量不代表研究质量或 PI 身份；姓名仍可能重名，请先核对论文与机构。", "Authors come from classified papers with valid, nonfuture dates; defaults prioritize ORCIDs and unabbreviated names. Counts do not establish research quality or PI status. Names can still be ambiguous; inspect papers and affiliations first.")}</p>
        <label className="foresight-field team-author-search"><span>{t("查找姓名、ORCID 或署名机构", "Find a name, ORCID or affiliation")}</span><div><Search size={16} aria-hidden="true"/><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("输入你关心的作者", "Search for an author")}/></div></label>
        <ul className="team-author-candidates">{visibleAuthors.map(author => {
          const alreadyWatched = teams.some(team => author.papers.some(paper => paper.authors.some(a => matchesMember(a, [author.member]) && matchesMember(a, team.members))));
          return <li key={author.key}>
            <div className="team-author-identity"><strong>{author.name}</strong><span>{author.orcid ? `ORCID ${author.orcid}` : !hasUnabbreviatedName(author.name) ? t("缩写姓名可能合并不同作者，请核验身份", "Abbreviated names may combine different authors; verify identity") : t("姓名匹配，身份待核对", "Name match; identity needs review")}</span><p>{author.affiliations[0] || t("来源未提供机构", "No affiliation supplied")}</p></div>
            <div className="team-author-actions"><button className="foresight-button" onClick={() => openPeriod(author.name, author.papers)}>{author.papers.length} {t("条匹配记录", "matching records")}<ArrowUpRight size={14}/></button><Button variant="outline" size="sm" disabled={!storageAvailable} onClick={() => beginCreate(author)}><Plus size={14}/>{alreadyWatched ? t("加入新名单", "Add to a new list") : t("建立观察", "Watch author")}</Button></div>
            <button className="team-author-paper" onClick={() => openPaper(author.papers[0])}><span>{t("论文证据", "Paper evidence")}</span>{author.papers[0].title}<ArrowUpRight size={14}/></button>
          </li>;
        })}</ul>
        {!visibleAuthors.length && <p className="foresight-note">{search ? t("当前相关论文中没有匹配的作者线索，可手动添加姓名或 ORCID。", "No matching author appears in the relevant papers. You can still add a name or ORCID manually.") : t("当前尚无适合默认展示的作者线索，可搜索姓名或手动建立名单。", "No suitable default author is available. Search for a name or create a watchlist manually.")}</p>}
      </div>
    </details>
    {!!teams.length && <details className="team-management"><summary>{t("管理已保存名单", "Manage saved watchlists")} · {teams.length}</summary><TeamsView papers={data.papers} teams={teams} onChange={onChange} openPaper={openPaper} storageAvailable={storageAvailable} managementOnly/></details>}

    <Dialog open={createOpen} onOpenChange={value => { if (!saving) setCreateOpen(value); }}><DialogContent><DialogHeader><DialogTitle>{t("建立 PI / 团队观察名单", "Create a PI / team watchlist")}</DialogTitle><DialogDescription>{t("只使用你确认的成员姓名或 ORCID。作者候选的身份仍需你核对。", "Use member names or ORCIDs you have confirmed. Suggested authors still require an identity check.")}</DialogDescription></DialogHeader><div className="team-form">
      <Label htmlFor="foresight-team-name">{t("名单名称", "Watchlist name")}</Label><Input id="foresight-team-name" maxLength={160} value={draftName} onChange={event => setDraftName(event.target.value)}/>
      <Label htmlFor="foresight-team-members">{t("成员 / ORCID（每行一位）", "Members / ORCIDs (one per line)")}</Label><Textarea id="foresight-team-members" value={draftMembers} onChange={event => setDraftMembers(event.target.value)}/>
      <Label htmlFor="foresight-team-institution">{t("署名机构关键词（可选）", "Affiliation keyword (optional)")}</Label><Input id="foresight-team-institution" maxLength={250} value={draftInstitution} onChange={event => setDraftInstitution(event.target.value)}/><p className="foresight-control-help">{t("设置后，缺少匹配机构的论文不会进入该名单。", "When set, papers without a matching affiliation will be excluded.")}</p>
      <label className="foresight-field"><span>{t("观察目的", "Watchlist purpose")}</span><select value={draftKind} onChange={event => setDraftKind(event.target.value)}>{["持续关注", "竞争观察", "合作候选"].map(kind => <option key={kind} value={kind}>{tr(kind)}</option>)}</select></label>
    </div><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setCreateOpen(false)}>{t("取消", "Cancel")}</Button><Button disabled={!storageAvailable || !draftName.trim() || !draftMembers.trim() || saving} onClick={() => void createTeam()}>{saving ? t("正在保存…", "Saving…") : t("保存并分析", "Save and assess")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
