"use client";
import { EmptyState } from "./state-views";

import "@/styles/foresight.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/local-api";
import { buildForesight } from "@/lib/foresight";
import { beijingDay, matchesTeam, type DashboardDrill } from "@/lib/dashboard";
import { TRACKS } from "@/lib/classify";
import {
  buildTeamDirectory,
  filterTeamDirectory,
  type TeamDirectoryEntry,
  type TeamDirectorySort,
} from "@/lib/team-directory";
import type { ForesightCard, ForesightResult } from "@/lib/foresight-types";
import type { MonitorData, Paper, Team } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "./locale-provider";
import { AiModelSettings, AiResearchPanel } from "./ai-research-panel";
import { findRelatedSignals } from "@/lib/signal-evidence";
import { safeSignalUrl, type ResearchSignal } from "@/lib/research-signals";
import { TeamsView } from "./monitor-views";
import "@/styles/team-foresight.css";

type ListSource = "directory" | "saved";
export type TeamForesightPreferences = {
  teamId: string;
  horizon: ForesightCard["horizon"];
  directoryTrack?: string;
  query?: string;
  listSource?: ListSource;
  savedKind?: string;
  directorySort?: TeamDirectorySort;
};
type Props = {
  data: MonitorData;
  signals?: ResearchSignal[];
  teams: Team[];
  onChange: () => Promise<unknown>;
  openPaper: (paper: Paper) => void;
  onDrill: (drill: DashboardDrill) => void;
  storageAvailable: boolean;
  preferences?: TeamForesightPreferences;
  onPreferencesChange?: (preferences: TeamForesightPreferences) => void;
};
type TrajectoryDimension = "tracks" | "methods" | "modalities";
const WATCHLIST_KINDS = ["持续关注", "竞争观察", "合作候选"];

export function TeamForesight({
  data,
  signals,
  teams,
  onChange,
  openPaper,
  onDrill,
  storageAvailable,
  preferences,
  onPreferencesChange,
}: Props) {
  const { locale, tr } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [localPreferences, setLocalPreferences] = useState<TeamForesightPreferences>({
    teamId: "",
    horizon: "6–12",
  });
  const viewPreferences = preferences ?? localPreferences;
  const { teamId, horizon } = viewPreferences;
  const directoryTrack = viewPreferences.directoryTrack ?? "all";
  const query = viewPreferences.query ?? "";
  const listSource = viewPreferences.listSource ?? (teams.length ? "saved" : "directory");
  const savedKind = viewPreferences.savedKind ?? "all";
  const changePreferences = (next: TeamForesightPreferences) => {
    setLocalPreferences(next);
    onPreferencesChange?.(next);
  };
  const [visibleLimit, setVisibleLimit] = useState(6);
  const directorySort = viewPreferences.directorySort ?? "senior";
  const [trajectoryDimension, setTrajectoryDimension] = useState<TrajectoryDimension>("tracks");
  const [relationshipsOpen, setRelationshipsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftMembers, setDraftMembers] = useState("");
  const [draftInstitution, setDraftInstitution] = useState("");
  const [draftKind, setDraftKind] = useState("持续关注");
  const [saving, setSaving] = useState(false);
  const assessmentHeading = useRef<HTMLDivElement>(null);
  const shouldScrollToAssessment = useRef(false);
  const day = beijingDay(new Date());
  // The workspace already applies its core/all scope switch to data.
  const directory = useMemo(() => buildTeamDirectory(data.papers, day, { scope: "all" }), [data.papers, day]);
  const filteredAuthors = useMemo(
    () => filterTeamDirectory(directory, { track: directoryTrack, query, sort: directorySort }),
    [directory, directoryTrack, query, directorySort],
  );
  // Keep a chosen card visible when returning from its paper evidence after remount.
  const selectedAuthorIndex =
    listSource === "directory" ? filteredAuthors.findIndex((author) => author.id === teamId) : -1;
  const effectiveLimit = Math.max(visibleLimit, Math.ceil((selectedAuthorIndex + 1) / 6) * 6);
  const visibleAuthors = filteredAuthors.slice(0, effectiveLimit);
  const visibleTeams = teams.filter((team) => savedKind === "all" || team.kind === savedKind);
  const selectedCandidate =
    listSource === "directory" ? filteredAuthors.find((author) => author.id === teamId) : undefined;
  const selectedSavedTeam =
    listSource === "saved" ? visibleTeams.find((team) => team.id === teamId) : undefined;
  const selectedTeam = useMemo<Team | undefined>(
    () =>
      selectedCandidate
        ? {
            id: selectedCandidate.id,
            name: selectedCandidate.name,
            members: [selectedCandidate.member],
            institution: "",
            kind: "作者目录",
            createdAt: "",
          }
        : selectedSavedTeam,
    [selectedCandidate, selectedSavedTeam],
  );
  const scopedPapers = useMemo(
    () =>
      selectedCandidate?.papers ??
      (selectedTeam ? data.papers.filter((paper) => matchesTeam(paper, selectedTeam)) : []),
    [data.papers, selectedCandidate, selectedTeam],
  );
  const associated = useMemo(() => findRelatedSignals(scopedPapers, signals ?? []), [scopedPapers, signals]);
  const associatedSignals = useMemo(() => associated.map((item) => item.signal), [associated]);
  const result = useMemo<ForesightResult | null>(
    () =>
      selectedTeam
        ? buildForesight(selectedCandidate?.papers ?? data.papers, {
            team: selectedTeam,
            horizon,
            track: selectedCandidate && directoryTrack !== "all" ? directoryTrack : undefined,
            now: new Date(`${day}T12:00:00+08:00`),
          })
        : null,
    [data.papers, selectedTeam, selectedCandidate, directoryTrack, horizon, day],
  );
  const teamCounts = useMemo(
    () =>
      new Map(teams.map((team) => [team.id, data.papers.filter((paper) => matchesTeam(paper, team)).length])),
    [data.papers, teams],
  );
  const changeListScope = (next: Partial<TeamForesightPreferences>) => {
    setVisibleLimit(6);
    setRelationshipsOpen(false);
    changePreferences({ ...viewPreferences, listSource, teamId: "", ...next });
  };
  const selectObject = (id: string) => {
    setRelationshipsOpen(false);
    shouldScrollToAssessment.current = true;
    if (id === teamId) {
      assessmentHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      assessmentHeading.current?.focus({ preventScroll: true });
      shouldScrollToAssessment.current = false;
    }
    changePreferences({ ...viewPreferences, listSource, teamId: id });
  };
  useEffect(() => {
    if (!selectedTeam || !shouldScrollToAssessment.current) return;
    shouldScrollToAssessment.current = false;
    assessmentHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    assessmentHeading.current?.focus({ preventScroll: true });
  }, [selectedTeam?.id]);
  const relationships = useMemo(() => {
    if (!relationshipsOpen || !selectedSavedTeam || !selectedTeam || !result) return [];
    const currentIds = new Set(result.current.map((paper) => paper.id));
    return teams
      .filter((team) => team.id !== selectedTeam.id)
      .slice(0, 3)
      .map((team) => {
        const peer = buildForesight(data.papers, { team, horizon, now: new Date(`${day}T12:00:00+08:00`) });
        const shared = (dimension: TrajectoryDimension) => {
          const ownTags = new Set(result.current.flatMap((paper) => paper[dimension]));
          return [...new Set(peer.current.flatMap((paper) => paper[dimension]))]
            .filter((tag) => ownTags.has(tag))
            .sort();
        };
        return {
          team,
          papers: peer.current,
          common: peer.current.filter((paper) => currentIds.has(paper.id)),
          tracks: shared("tracks"),
          methods: shared("methods"),
          modalities: shared("modalities"),
        };
      });
  }, [relationshipsOpen, selectedSavedTeam, selectedTeam, result, teams, data.papers, horizon, day]);
  const dimensionLabel = (dimension: TrajectoryDimension) =>
    dimension === "tracks"
      ? t("研究方向", "Research direction")
      : dimension === "methods"
        ? t("方法路线", "Methods")
        : t("数据模态", "Data modalities");
  const tagLabel = (dimension: TrajectoryDimension, tag: string) =>
    tr(dimension === "tracks" ? (TRACKS[tag] ?? tag) : tag);

  const beginCreate = (author?: TeamDirectoryEntry) => {
    setDraftName(author ? `${author.name} · ${t("作者观察", "Author watchlist")}` : "");
    setDraftMembers(author?.member ?? "");
    setDraftInstitution("");
    setDraftKind("持续关注");
    setCreateOpen(true);
  };
  const createTeam = async () => {
    setSaving(true);
    try {
      const response = await api("/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: draftName,
          members: draftMembers
            .split(/\n|;/)
            .map((value) => value.trim())
            .filter(Boolean),
          institution: draftInstitution,
          kind: draftKind,
        }),
      });
      await onChange();
      if (response.team) {
        shouldScrollToAssessment.current = true;
        changePreferences({
          ...viewPreferences,
          teamId: response.team.id,
          listSource: "saved",
          savedKind: draftKind,
        });
      }
      setCreateOpen(false);
      toast.success(tr("已建立观察名单"));
    } catch (error) {
      toast.error(tr(error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };
  const openPeriod = (label: string, papers: Paper[]) =>
    onDrill({ label, ids: papers.map((paper) => paper.id) });

  return (
    <div className="foresight-view team-foresight">
      <section className="team-selector" aria-labelledby="team-selector-title">
        <div className="team-watchlist-toolbar">
          <div>
            <h3 id="team-selector-title">{t("选择观察对象", "Choose a research subject")}</h3>
            <p>
              {t(
                "从库内作者开始，或选择你保存的 PI／团队名单。",
                "Start with authors in the library or choose a saved PI / team watchlist.",
              )}
            </p>
          </div>
          <Button variant="outline" onClick={() => beginCreate()} disabled={!storageAvailable}>
            <Plus size={16} />
            {t("新建名单", "New watchlist")}
          </Button>
        </div>
        <div
          className="team-list-tabs"
          role="group"
          aria-label={t("观察对象来源", "Research subject source")}
        >
          <button
            id="team-directory-tab"
            aria-controls={listSource === "directory" ? "team-directory-panel" : undefined}
            aria-pressed={listSource === "directory"}
            onClick={() => {
              if (listSource !== "directory") changeListScope({ listSource: "directory" });
            }}
          >
            {t("按研究方向选作者", "Authors by research direction")}
          </button>
          <button
            id="team-saved-tab"
            aria-controls={listSource === "saved" ? "team-saved-panel" : undefined}
            aria-pressed={listSource === "saved"}
            onClick={() => {
              if (listSource !== "saved") changeListScope({ listSource: "saved" });
            }}
          >
            {t("我的团队名单", "My watchlists")}
            <span>{teams.length}</span>
          </button>
        </div>
        {listSource === "directory" ? (
          <div id="team-directory-panel" role="region" aria-labelledby="team-directory-tab">
            <div className="team-directory-controls">
              <label className="foresight-field">
                <span>{t("研究方向", "Research direction")}</span>
                <select
                  value={directoryTrack}
                  onChange={(event) => changeListScope({ directoryTrack: event.target.value })}
                >
                  <option value="all">{t("全部研究方向", "All research directions")}</option>
                  {Object.entries(TRACKS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {tr(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="foresight-field">
                <span>{t("排序方式", "Sort authors")}</span>
                <select
                  value={directorySort}
                  onChange={(event) => {
                    changePreferences({
                      ...viewPreferences,
                      listSource,
                      directorySort: event.target.value as TeamDirectorySort,
                    });
                    setVisibleLimit(6);
                  }}
                >
                  <option value="senior">{t("按资深作者排序", "Last-author works")}</option>
                  <option value="works">{t("按作品数排序", "Total works")}</option>
                </select>
              </label>
              <label className="foresight-field team-author-search">
                <span>{t("查找姓名、ORCID 或署名机构", "Find a name, ORCID or affiliation")}</span>
                <div>
                  <Search size={16} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => changeListScope({ query: event.target.value })}
                    placeholder={t("搜索作者或机构", "Search authors or affiliations")}
                  />
                </div>
              </label>
            </div>
            <p className="foresight-note team-directory-note">
              {t(
                "列表跟随当前研究范围，默认展示至少有 2 项作品的完整姓名或 ORCID。最后作者仅作为资深作者线索，作者排序惯例因领域而异，不能据此确认 PI 身份。相似身份提示不合并计数。",
                "The directory follows the selected research scope and defaults to at least two works with a full name or ORCID. Last-author position is a seniority clue; conventions vary and do not confirm PI status. Possible-identity hints never combine counts.",
              )}
            </p>
            <div className="team-directory-count">
              {t(`${filteredAuthors.length} 位作者候选`, `${filteredAuthors.length} author candidates`)}
              <span>
                {t(
                  directorySort === "senior"
                    ? "按最后作者作品数、总作品数排列；数量不代表研究质量"
                    : "按总作品数排列；数量不代表研究质量",
                  directorySort === "senior"
                    ? "Ordered by last-author works, then total works; counts do not measure quality"
                    : "Ordered by total works; counts do not measure quality",
                )}
              </span>
            </div>
            <ul className="team-author-candidates">
              {visibleAuthors.map((author) => (
                <li
                  key={author.id}
                  className={selectedCandidate?.id === author.id ? "is-selected" : undefined}
                >
                  <div className="team-author-identity">
                    <strong>{author.name}</strong>
                    <span>
                      {author.orcid
                        ? `ORCID ${author.orcid}`
                        : author.abbreviated
                          ? t(
                              "缩写姓名可能合并不同作者，请核验身份",
                              "Abbreviated names may combine different authors; verify identity",
                            )
                          : t("姓名匹配，身份待核对", "Name match; identity needs review")}
                    </span>
                    <p className="team-affiliation" title={author.affiliations.join(" · ")}>
                      {t("论文署名机构：", "Paper affiliation: ")}
                      {author.affiliations[0] || t("来源未提供", "Not supplied")}
                      {author.affiliations.length > 1
                        ? t(
                            ` 等 ${author.affiliations.length} 处署名`,
                            ` (${author.affiliations.length} affiliations)`,
                          )
                        : ""}
                    </p>
                    {author.possibleIdentities.map((peer) => (
                      <button
                        key={peer.id}
                        className="foresight-button team-identity-hint"
                        title={
                          peer.sharedAffiliations.length
                            ? t(
                                "相同全名与署名机构；尚未合并身份",
                                "Same full name and affiliation; identities remain separate",
                              )
                            : t(
                                "相同全名与至少两位共同作者；尚未合并身份",
                                "Same full name and at least two coauthors; identities remain separate",
                              )
                        }
                        onClick={() => {
                          setVisibleLimit(6);
                          shouldScrollToAssessment.current = true;
                          changePreferences({
                            ...viewPreferences,
                            listSource: "directory",
                            teamId: peer.id,
                            query: peer.orcid ?? peer.name,
                          });
                        }}
                      >
                        {t("可能是同一人：", "Possibly the same person: ")}
                        {peer.name} · {peer.orcid ? `ORCID ${peer.orcid}` : t("姓名条目", "name-only entry")}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  <div className="team-author-actions">
                    <Button
                      size="sm"
                      variant={selectedCandidate?.id === author.id ? "secondary" : "outline"}
                      aria-pressed={selectedCandidate?.id === author.id}
                      onClick={() => selectObject(author.id)}
                    >
                      {selectedCandidate?.id === author.id
                        ? t("正在查看", "Viewing")
                        : t("查看研判", "View assessment")}
                    </Button>
                    <button
                      className="foresight-button"
                      disabled={!storageAvailable}
                      onClick={() => beginCreate(author)}
                    >
                      <Plus size={14} />
                      {t("加入我的名单", "Save to my watchlists")}
                    </button>
                  </div>
                  <div className="team-author-scope">
                    <span className="team-author-work-count">
                      {t(
                        `最后作者 ${author.lastAuthorCount} 篇 · 共 ${author.works} 项作品`,
                        `${author.lastAuthorCount} last-author · ${author.works} total works`,
                      )}
                      <span>
                        {t(
                          `第一作者 ${author.firstAuthorCount} 篇`,
                          `${author.firstAuthorCount} first-author works`,
                        )}
                      </span>
                    </span>
                    <button
                      className="foresight-button"
                      onClick={() => openPeriod(author.name, author.papers)}
                    >
                      {author.papers.length} {t("条当前方向记录", "records in this direction")}
                      <ArrowUpRight size={14} />
                    </button>
                    <div className="team-direction-tags">
                      {author.tracks.slice(0, 3).map((track) => (
                        <span key={track}>{tr(TRACKS[track] ?? track)}</span>
                      ))}
                      {author.tracks.length > 3 && <span>+{author.tracks.length - 3}</span>}
                    </div>
                  </div>
                  <button className="team-author-paper" onClick={() => openPaper(author.papers[0])}>
                    <span>
                      {t("最近论文", "Latest paper")} · {author.papers[0].publishedAt.slice(0, 10)}
                    </span>
                    {author.papers[0].title}
                    <ArrowUpRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {!visibleAuthors.length && (
              <EmptyState
                compact
                description={
                  <>
                    {query
                      ? t(
                          "该方向下未找到匹配作者。可调整搜索，或手动新建名单。",
                          "No matching author was found in this direction. Adjust the search or create a watchlist manually.",
                        )
                      : t(
                          "该方向尚无符合默认条件的作者。可搜索姓名，查看单篇或缩写姓名线索。",
                          "No author meets the default criteria in this direction. Search to include single-record or abbreviated-name candidates.",
                        )}
                  </>
                }
              />
            )}
            {filteredAuthors.length > effectiveLimit && (
              <div className="team-directory-more">
                <Button
                  variant="outline"
                  onClick={() => setVisibleLimit((limit) => Math.max(limit, effectiveLimit) + 6)}
                >
                  {t("显示更多", "Show more")}
                </Button>
                <span>
                  {t(
                    `已显示 ${visibleAuthors.length} / ${filteredAuthors.length}`,
                    `Showing ${visibleAuthors.length} of ${filteredAuthors.length}`,
                  )}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div id="team-saved-panel" role="region" aria-labelledby="team-saved-tab">
            <div className="team-kind-filters" role="group" aria-label={t("名单用途", "Watchlist purpose")}>
              {["all", ...WATCHLIST_KINDS].map((kind) => (
                <button
                  key={kind}
                  aria-pressed={savedKind === kind}
                  onClick={() => {
                    if (savedKind !== kind) changeListScope({ savedKind: kind });
                  }}
                >
                  {kind === "all" ? t("全部", "All") : tr(kind)}
                  <span>{teams.filter((team) => kind === "all" || team.kind === kind).length}</span>
                </button>
              ))}
            </div>
            <ul className="team-saved-cards">
              {visibleTeams.map((team) => (
                <li key={team.id} className={selectedSavedTeam?.id === team.id ? "is-selected" : undefined}>
                  <div>
                    <strong>{team.name}</strong>
                    <span className="team-saved-kind">{tr(team.kind)}</span>
                    <p>{team.members.join(" · ")}</p>
                    {team.institution && (
                      <p>
                        {t("署名机构筛选：", "Affiliation filter: ")}
                        {team.institution}
                      </p>
                    )}
                  </div>
                  <div className="team-saved-actions">
                    <button
                      className="foresight-button"
                      onClick={() =>
                        openPeriod(
                          team.name,
                          data.papers.filter((paper) => matchesTeam(paper, team)),
                        )
                      }
                    >
                      {teamCounts.get(team.id) ?? 0} {t("条库内记录", "library records")}
                      <ArrowUpRight size={14} />
                    </button>
                    <Button
                      variant={selectedSavedTeam?.id === team.id ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={selectedSavedTeam?.id === team.id}
                      onClick={() => selectObject(team.id)}
                    >
                      {selectedSavedTeam?.id === team.id
                        ? t("正在查看", "Viewing")
                        : t("查看研判", "View assessment")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {!visibleTeams.length && (
              <EmptyState
                compact
                description={
                  <>
                    {teams.length
                      ? t(
                          "这一用途下还没有名单。可新建名单，或从作者目录加入。",
                          "There are no watchlists for this purpose. Create one or add an author from the directory.",
                        )
                      : t(
                          "尚未保存个人名单。先从“按研究方向选作者”选择对象，或新建一份名单。",
                          "No personal watchlists are saved yet. Choose a subject under Authors by research direction, or create a watchlist.",
                        )}
                  </>
                }
              />
            )}
          </div>
        )}
      </section>

      {!storageAvailable && (
        <p className="foresight-note">
          {t(
            "当前浏览器无法保存名单；仍可查看已有名单和论文证据。",
            "This browser cannot save watchlists. Existing watchlists and paper evidence remain available.",
          )}
        </p>
      )}

      {selectedTeam && result ? (
        <>
          <div className="team-assessment-heading" ref={assessmentHeading} tabIndex={-1}>
            <div>
              <span>
                {selectedCandidate
                  ? t("作者目录 · 临时观察", "Author directory · temporary observation")
                  : t("我的团队名单", "My watchlists")}
              </span>
              <h3>{selectedTeam.name}</h3>
            </div>
          </div>
          <div className="team-identity-note">
            <span>{selectedTeam.members.join(" · ")}</span>
            <p>
              {selectedCandidate
                ? t(
                    "本次研判仅使用当前方向下该作者候选的公开论文，未加入个人名单；姓名仍可能重名，作者目录不自动认定 PI 或真实团队身份。",
                    "This assessment uses only this author candidate’s public papers in the selected direction and is not saved as a personal watchlist. Names may be ambiguous; the directory does not establish PI or team identity.",
                  )
                : t(
                    "按成员全名或 ORCID 匹配；同名可能混淆，机构和末位作者不自动认定为真实团队或 PI。",
                    "Matches use member names or ORCIDs. Names may be ambiguous; affiliations and last authorship do not establish a team or PI role.",
                  )}
            </p>
            {selectedTeam.institution && (
              <p>
                {t("署名机构筛选：", "Affiliation filter: ")}
                {selectedTeam.institution}
                {t(
                  "；缺少该机构信息的记录不会匹配。",
                  "; records without matching affiliation metadata are excluded.",
                )}
              </p>
            )}
          </div>
          <AiModelSettings />
          <div className="foresight-note">
            <p>
              {associated.length
                ? t(
                    `已找到 ${associated.length} 条与这些论文存在显式 URL／DOI／arXiv 关联的仓库或新闻，可勾选加入联合研判。关联表示引用关系，不确认该 PI 拥有仓库或参与发布。`,
                    `${associated.length} repository/news records have explicit URL, DOI or arXiv links to these papers. Select them for joint analysis. A reference link does not establish PI ownership or involvement.`,
                  )
                : t(
                    "暂未找到与这些论文有显式 URL／DOI／arXiv 关联的仓库或新闻。不会根据姓名、仓库 owner 或关键词推断团队身份；仍可使用论文研判。",
                    "No repository/news records have explicit URL, DOI or arXiv links to these papers. Names, repository owners and topics do not establish team identity; paper analysis remains available.",
                  )}
            </p>
            {!!associated.length && (
              <details>
                <summary>{t("核对跨来源关联依据", "Inspect cross-source linkage")}</summary>
                <ul>
                  {associated.map(({ signal, basis }) => (
                    <li key={signal.id}>
                      {safeSignalUrl(signal.url) && (
                        <a href={signal.url} target="_blank" rel="noreferrer">
                          [{signal.kind === "github" ? "GitHub" : t("新闻", "News")}] {signal.title} ↗
                        </a>
                      )}
                      <p>{basis.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <AiResearchPanel
            key={`${selectedTeam.id}:${selectedCandidate ? directoryTrack : "saved"}`}
            papers={scopedPapers}
            signals={associatedSignals}
            mode="team"
            subjectId={`${selectedTeam.id}:${selectedCandidate ? directoryTrack : "saved"}`}
            onPaper={openPaper}
            onDrill={onDrill}
          />
          <details className="team-relationships">
            <summary>{t("查看原始论文轨迹与既有标签", "Inspect paper trajectory and existing tags")}</summary>
            <section className="team-trajectory" aria-labelledby="team-trajectory-title">
              <div className="foresight-toolbar">
                <h3 id="team-trajectory-title">{t("公开研究轨迹", "Public research trajectory")}</h3>
                <span>{t("两个相邻的 90 天窗口", "Two adjacent 90-day windows")}</span>
              </div>
              <label className="team-trajectory-dimension">
                <span>{t("观察维度", "View dimension")}</span>
                <select
                  value={trajectoryDimension}
                  onChange={(event) => setTrajectoryDimension(event.target.value as TrajectoryDimension)}
                >
                  {(["tracks", "methods", "modalities"] as const).map((dimension) => (
                    <option key={dimension} value={dimension}>
                      {dimensionLabel(dimension)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="team-trajectory-periods">
                {[
                  {
                    key: "previous",
                    label: t("此前 90 天", "Previous 90 days"),
                    from: result.previousFrom,
                    to: result.previousTo,
                    papers: result.previous,
                  },
                  {
                    key: "current",
                    label: t("最近 90 天", "Latest 90 days"),
                    from: result.from,
                    to: result.asOf,
                    papers: result.current,
                  },
                ].map((period) => {
                  const tags = [...new Set(period.papers.flatMap((paper) => paper[trajectoryDimension]))]
                    .map((tag) => ({
                      tag,
                      count: period.papers.filter((paper) => paper[trajectoryDimension].includes(tag)).length,
                    }))
                    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
                    .slice(0, 3);
                  return (
                    <div className="team-trajectory-period" key={period.key}>
                      <div>
                        <h4>{period.label}</h4>
                        <span>
                          {period.from} — {period.to}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="team-period-count"
                        disabled={!period.papers.length}
                        aria-label={`${period.label}: ${period.papers.length} ${t("篇去重论文", "distinct works")}`}
                        onClick={() => openPeriod(`${selectedTeam.name} · ${period.label}`, period.papers)}
                      >
                        <strong>{period.papers.length}</strong>
                        <span>{t("篇去重论文", "distinct works")}</span>
                        <ArrowUpRight size={16} />
                      </button>
                      {tags.length ? (
                        <ul className="team-period-methods">
                          {tags.map((row) => (
                            <li key={row.tag}>
                              <span>{tagLabel(trajectoryDimension, row.tag)}</span>
                              <span>
                                {row.count}/{period.papers.length}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          {t(
                            "该窗口尚无可识别的相关标签。",
                            "No labels for this dimension are identified in this window.",
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            {!!result.current.length && (
              <section className="team-recent-evidence">
                <div className="foresight-toolbar">
                  <h3>{t("近期论文证据", "Recent paper evidence")}</h3>
                  <button
                    className="foresight-button"
                    onClick={() =>
                      openPeriod(
                        `${selectedTeam.name} · ${t("最近180天轨迹", "Latest 180-day trajectory")}`,
                        result.papers,
                      )
                    }
                  >
                    {t("查看最近180天轨迹论文", "View trajectory papers from the latest 180 days")}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                <ul>
                  {result.current.slice(0, 3).map((paper) => (
                    <li key={paper.id}>
                      <button onClick={() => openPaper(paper)}>
                        <time dateTime={paper.publishedAt}>{paper.publishedAt.slice(0, 10)}</time>
                        <span>{paper.title}</span>
                        <ArrowUpRight size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </details>
          {selectedSavedTeam && teams.length >= 2 && (
            <details
              key={selectedSavedTeam.id}
              className="team-relationships"
              onToggle={(event) => setRelationshipsOpen(event.currentTarget.open)}
            >
              <summary>{t("关注名单之间的关系", "Relationships between watchlists")}</summary>
              <p className="foresight-note">
                {t(
                  "比较最近 90 天的去重论文，最多展示另外 3 份名单。公开研究交集与潜在互补线索需结合真实资源核验，不推断合作意愿或竞争强度。",
                  "Compare distinct works from the latest 90 days for up to three other watchlists. Public research overlap and possible complementary clues require real-world resource checks; they do not establish willingness to collaborate or competitive strength.",
                )}
              </p>
              <ul className="team-relationship-list">
                {relationships.map((relation) => (
                  <li key={relation.team.id}>
                    <h4>
                      {selectedTeam.name} × {relation.team.name}
                    </h4>
                    <dl>
                      {(["tracks", "methods", "modalities"] as const)
                        .filter((dimension) => relation[dimension].length)
                        .map((dimension) => (
                          <div key={dimension}>
                            <dt>{dimensionLabel(dimension)}</dt>
                            <dd>{relation[dimension].map((tag) => tagLabel(dimension, tag)).join(" · ")}</dd>
                          </div>
                        ))}
                    </dl>
                    {!relation.tracks.length && !relation.methods.length && !relation.modalities.length && (
                      <p className="foresight-note">
                        {t(
                          "当前样本未识别到共同标签；不能据此判断合作或竞争关系。",
                          "No shared labels were identified in the current sample. This does not establish a collaboration or competition relationship.",
                        )}
                      </p>
                    )}
                    <div className="team-relationship-actions">
                      <button
                        className="foresight-button"
                        disabled={!relation.common.length}
                        onClick={() =>
                          openPeriod(
                            `${selectedTeam.name} × ${relation.team.name} · ${t("共同论文", "Shared papers")}`,
                            relation.common,
                          )
                        }
                      >
                        {t("共同论文", "Shared papers")} · {relation.common.length}
                        <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="foresight-button"
                        disabled={!result.current.length}
                        onClick={() =>
                          openPeriod(
                            `${selectedTeam.name} · ${t("最近 90 天", "Latest 90 days")}`,
                            result.current,
                          )
                        }
                      >
                        {selectedTeam.name} · {result.current.length}
                        <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="foresight-button"
                        disabled={!relation.papers.length}
                        onClick={() =>
                          openPeriod(
                            `${relation.team.name} · ${t("最近 90 天", "Latest 90 days")}`,
                            relation.papers,
                          )
                        }
                      >
                        {relation.team.name} · {relation.papers.length}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <section className="team-selection-hint">
          <Users size={20} />
          <p>
            {t(
              "在上方选择一位作者或一份名单，即可查看研究轨迹、方向研判与论文证据。",
              "Choose an author or watchlist above to explore the research trajectory, assessments and paper evidence.",
            )}
          </p>
        </section>
      )}

      {!!teams.length && (
        <details className="team-management">
          <summary>
            {t("管理已保存名单", "Manage saved watchlists")} · {teams.length}
          </summary>
          <TeamsView
            papers={data.papers}
            teams={teams}
            onChange={onChange}
            openPaper={openPaper}
            storageAvailable={storageAvailable}
            managementOnly
          />
        </details>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(value) => {
          if (!saving) setCreateOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("建立 PI / 团队观察名单", "Create a PI / team watchlist")}</DialogTitle>
            <DialogDescription>
              {t(
                "只使用你确认的成员姓名或 ORCID。作者候选的身份仍需你核对。",
                "Use member names or ORCIDs you have confirmed. Suggested authors still require an identity check.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="team-form">
            <Label htmlFor="foresight-team-name">{t("名单名称", "Watchlist name")}</Label>
            <Input
              id="foresight-team-name"
              maxLength={160}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
            <Label htmlFor="foresight-team-members">
              {t("成员 / ORCID（每行一位）", "Members / ORCIDs (one per line)")}
            </Label>
            <Textarea
              id="foresight-team-members"
              value={draftMembers}
              onChange={(event) => setDraftMembers(event.target.value)}
            />
            <Label htmlFor="foresight-team-institution">
              {t("署名机构关键词（可选）", "Affiliation keyword (optional)")}
            </Label>
            <Input
              id="foresight-team-institution"
              maxLength={250}
              value={draftInstitution}
              onChange={(event) => setDraftInstitution(event.target.value)}
            />
            <p className="foresight-control-help">
              {t(
                "设置后，缺少匹配机构的论文不会进入该名单。",
                "When set, papers without a matching affiliation will be excluded.",
              )}
            </p>
            <label className="foresight-field">
              <span>{t("观察目的", "Watchlist purpose")}</span>
              <select value={draftKind} onChange={(event) => setDraftKind(event.target.value)}>
                {WATCHLIST_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {tr(kind)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setCreateOpen(false)}>
              {t("取消", "Cancel")}
            </Button>
            <Button
              disabled={!storageAvailable || !draftName.trim() || !draftMembers.trim() || saving}
              onClick={() => void createTeam()}
            >
              {saving ? t("正在保存…", "Saving…") : t("保存并分析", "Save and assess")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
