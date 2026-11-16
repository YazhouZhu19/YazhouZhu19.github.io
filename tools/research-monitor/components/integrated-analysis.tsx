import { lazy, Suspense, useState } from "react";
import { useI18n } from "./locale-provider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
const PaperCodeLinks = lazy(() => import("./paper-code-links").then((m) => ({ default: m.PaperCodeLinks })));
const AnalysisHistoryPanel = lazy(() =>
  import("./analysis-history-panel").then((m) => ({ default: m.AnalysisHistoryPanel })),
);
import type { Paper } from "@/lib/types";
import type { ResearchSignal } from "@/lib/research-signals";
import type { AnalysisState } from "@/lib/analysis-store";
import type { Evidence, Text } from "@/lib/integrated-analysis";
import "@/styles/integrated-analysis.css";
import "@/styles/paper-code-links.css";

export function IntegratedAnalysis({
  analysis,
  reload,
  onPaper,
  loadCodeInputs,
}: {
  analysis: AnalysisState & { reloadRequired?: boolean };
  reload: () => Promise<unknown>;
  onPaper: (id: string) => void;
  loadCodeInputs: () => Promise<{ papers: Paper[]; signals: ResearchSignal[] }>;
}) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const label = (x: Text) => x[locale === "en" ? "en" : "zh"];
  const [showResult, setShowResult] = useState(false);
  const [codeToolOpened, setCodeToolOpened] = useState(false);
  const result = showResult ? (analysis.data?.result ?? null) : null;
  const ready = !!analysis.data;
  const sourceStates = analysis.data?.sources.signals.states ?? [];
  const [tab, setTab] = useState<"mainstream" | "niche">("niche"),
    [evidenceFilter, setEvidenceFilter] = useState<"all" | "sufficient" | "pending">("all"),
    [limit, setLimit] = useState(12),
    [query, setQuery] = useState("");
  const evidence = (items: Evidence[]) => (
    <ul className="integrated-evidence">
      {items.map((e) => (
        <li key={`${e.kind}:${e.id}`}>
          <span>
            {e.kind === "paper"
              ? t("论文", "Paper")
              : e.kind === "github"
                ? t("开源", "Code")
                : t("动态", "News")}
          </span>
          {e.kind === "paper" ? (
            <button onClick={() => onPaper(e.id)}>{e.title}</button>
          ) : /^https?:\/\//i.test(e.url) ? (
            <a href={e.url} target="_blank" rel="noopener noreferrer">
              {e.title}
            </a>
          ) : (
            <strong>{e.title}</strong>
          )}
          <blockquote>{e.excerpt}</blockquote>
        </li>
      ))}
    </ul>
  );
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const visibleNiches =
    result?.niches.filter(
      (n) =>
        (evidenceFilter === "all" || n.evidenceStatus === evidenceFilter) &&
        `${n.label.zh} ${n.label.en} ${n.evidence.map((e) => e.title).join(" ")}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ) ?? [];
  return (
    <section className="integrated-analysis" aria-label={t("综合分析", "Integrated analysis")}>
      <nav
        className="dashboard-section-tabs integrated-tabs integrated-category-tabs"
        aria-label={t("分析类别", "Analysis category")}
      >
        <button type="button" aria-pressed={tab === "mainstream"} onClick={() => setTab("mainstream")}>
          {t("主流研究方向", "Mainstream directions")}
        </button>
        <button type="button" aria-pressed={tab === "niche"} onClick={() => setTab("niche")}>
          {t("小众积累方向", "Niche trajectories")}
        </button>
      </nav>
      <div className="integrated-toolbar">
        <div>
          <span>
            {t("当前库", "Current library")} ·{" "}
            {analysis.data?.sources.papers.totalStored.toLocaleString() ?? "—"} {t("篇论文", "papers")} ·
            GitHub {ready ? t("已载入", "loaded") : t("载入中", "loading")} · {t("动态", "News")}{" "}
            {ready ? t("已载入", "loaded") : t("载入中", "loading")}
          </span>
          <p className="integrated-coverage">
            {t(
              "主流统计与全库初筛采用同一批已发布资料；下方定向补证保留已核查版本，单独统计。",
              "Mainstream statistics and library screening use one published source generation. Targeted history retains its reviewed snapshot and is counted separately.",
            )}
          </p>
        </div>
        <Button onClick={() => setShowResult(true)} disabled={!ready}>
          {t("查看规则分析", "View rule analysis")}
        </Button>
        {(!ready || analysis.error) && (
          <Button variant="outline" disabled={analysis.loading} onClick={() => void reload()}>
            {analysis.reloadRequired ? t("刷新页面", "Reload page") : t("重新载入来源", "Retry sources")}
          </Button>
        )}
      </div>
      {analysis.error && (
        <p role="alert">
          {ready
            ? t(
                "最新发布检查未完成，已保留下方标注日期的分析结果。",
                "The latest publication could not be checked. The dated analysis below is retained.",
              )
            : t(
                "分析或来源加载未完成，请重试。",
                "Analysis or source loading did not complete. Please retry.",
              )}
        </p>
      )}
      <p role="status" className="integrated-coverage">
        {analysis.data
          ? t(
              `规则计算截至 ${analysis.data.result.asOf} UTC；可直接查看三类来源的分析结果。`,
              `Rules evaluated as of ${analysis.data.result.asOf} UTC. Analysis across all three sources is ready to view.`,
            )
          : t(
              "定向补证可直接查看；正在载入已发布的规则分析。",
              "Reviewed history is ready to browse. Loading the published rule analysis.",
            )}
      </p>
      {tab === "mainstream" ? (
        <div id="integrated-mainstream-panel">
          {!result ? (
            <p className="integrated-empty">
              {t(
                "点击“查看规则分析”，查看当前论文、开源和动态中的主流方向。",
                "Select View rule analysis to explore mainstream directions across the current papers, code and news.",
              )}
            </p>
          ) : (
            <>
              <p className="integrated-coverage">
                {t("当前窗口", "Current window")}: {result.windowStart} – {result.asOf} ·{" "}
                {t("历史独立论文", "Historical unique papers")}: {result.historyTotal}
              </p>
              <div className="integrated-counts">
                {(["paper", "github", "news"] as const).map((k) => (
                  <div key={k}>
                    <strong>{result.totals[k].toLocaleString()}</strong>
                    <span>
                      {k === "paper"
                        ? t("独立论文", "Unique papers")
                        : k === "github"
                          ? t("开源仓库", "Repositories")
                          : t("动态原文组", "News groups")}
                    </span>
                    <small>
                      {t("排除 / 合并 / 未分类", "Excluded / merged / unclassified")}: {result.excluded[k]} /{" "}
                      {result.duplicates[k]} / {result.unmatched[k]}
                    </small>
                  </div>
                ))}
              </div>
              <div className="integrated-directions">
                {!result.directions.some((d) => d.mainstream) && (
                  <p>
                    {t(
                      "当前资料尚不足以标记主流方向；下列为观察结果。",
                      "Current evidence does not meet the mainstream thresholds; observations are shown below.",
                    )}
                  </p>
                )}
                {result.directions.map((d) => (
                  <article key={d.id}>
                    <header>
                      <h3>{label(d.label)}</h3>
                      <span>
                        {d.mainstream
                          ? t("主流候选", "Mainstream candidate")
                          : t("观察方向", "Observed direction")}
                      </span>
                    </header>
                    <p className="integrated-score">
                      {t("三源集中度", "Three-source concentration")} <strong>{pct(d.score)}</strong>
                    </p>
                    <p>
                      {t("论文 / 开源 / 动态占比", "Paper / code / news share")}: {pct(d.shares.paper)} /{" "}
                      {pct(d.shares.github)} / {pct(d.shares.news)} · {t("记录数", "Records")}:{" "}
                      {d.counts.paper} / {d.counts.github} / {d.counts.news}
                    </p>
                    <div className="integrated-facets">
                      {(["problems", "methods", "scenarios"] as const).map((key) => (
                        <section key={key}>
                          <h4>
                            {key === "problems"
                              ? t("主要问题", "Problems")
                              : key === "methods"
                                ? t("技术手段", "Methods")
                                : t("应用场景", "Scenarios")}
                          </h4>
                          {!d.facets[key].length && <p>{t("尚无足够文本线索", "No matching text cues")}</p>}
                          {d.facets[key].slice(0, 3).map((f) => (
                            <details key={f.label.en}>
                              <summary>
                                {label(f.label)}{" "}
                                <small>
                                  {f.counts.paper} / {f.counts.github} / {f.counts.news}
                                </small>
                              </summary>
                              {evidence(f.evidence)}
                            </details>
                          ))}
                        </section>
                      ))}
                    </div>
                    <details>
                      <summary>
                        {t("查看方向依据（每类来源最多 3 条）", "Direction evidence (up to 3 per source)")}
                      </summary>
                      {evidence(d.evidence)}
                    </details>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="integrated-niches" id="integrated-niche-panel">
          <div className="integrated-niche-toolbar">
            <label htmlFor="integrated-niche-search">
              {t("搜索研究方向", "Search research directions")}
              <Input
                id="integrated-niche-search"
                type="search"
                value={query}
                placeholder={t("方向、论文或资源名称", "Direction, paper or resource")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(12);
                }}
              />
            </label>
            <div
              className="integrated-status"
              role="group"
              aria-label={t("积累证据状态", "Accumulation evidence status")}
            >
              {(["all", "sufficient", "pending"] as const).map((status) => (
                <Button
                  key={status}
                  variant={evidenceFilter === status ? "default" : "outline"}
                  aria-pressed={evidenceFilter === status}
                  onClick={() => {
                    setEvidenceFilter(status);
                    setLimit(12);
                  }}
                >
                  {status === "all"
                    ? t("全部方向", "All directions")
                    : status === "sufficient"
                      ? t("证据充分", "Evidence sufficient")
                      : t("待补证据", "Evidence pending")}
                </Button>
              ))}
            </div>
          </div>
          <Suspense
            fallback={
              <p role="status">{t("正在载入已核查的研究积累…", "Loading reviewed research history…")}</p>
            }
          >
            <AnalysisHistoryPanel evidenceFilter={evidenceFilter} query={query} />
          </Suspense>
          <details className="integrated-lexical">
            <summary>
              {t("全库词法初筛", "Library lexical screening")}
              {result ? ` · ${result.niches.length}` : ""}
            </summary>
            <p className="integrated-coverage">
              {t(
                "按“方向 × 问题 × 场景”生成的组合，与上方定向核查专题分别统计。",
                "Direction × problem × scenario combinations are counted separately from the reviewed topics above.",
              )}
            </p>
            {!result ? (
              <p>
                {t(
                  "查看规则分析后，可浏览当前库中的其他候选组合。",
                  "View rule analysis to inspect other combinations in the current library.",
                )}
              </p>
            ) : (
              <>
                <p>
                  {t(
                    `检出 ${result.niches.length} 个低占比组合：证据充分 ${result.niches.filter((n) => n.evidenceStatus === "sufficient").length} 个，待补证据 ${result.niches.filter((n) => n.evidenceStatus === "pending").length} 个。`,
                    `Found ${result.niches.length} low-share combinations: ${result.niches.filter((n) => n.evidenceStatus === "sufficient").length} evidence sufficient, ${result.niches.filter((n) => n.evidenceStatus === "pending").length} evidence pending.`,
                  )}
                </p>
                <p>
                  {t(
                    "证据充分仅表示达到当前规则门槛；待补证据表示已采集材料存在缺口，不代表方向不成立。相似代码候选不计入充分证据。",
                    "Evidence sufficient means the current rule thresholds are met. Evidence pending indicates gaps in collected material, not an invalid direction. Similar-code candidates do not count as sufficient evidence.",
                  )}
                </p>
                {!visibleNiches.length && (
                  <p>
                    {t(
                      "当前状态下暂无方向。可切换到全部方向查看已有组合和证据缺口；空结果不代表没有值得研究的方向。",
                      "No direction has this status. Select All directions to inspect existing combinations and evidence gaps; an empty result does not establish absence of research opportunities.",
                    )}
                  </p>
                )}
                {visibleNiches.slice(0, limit).map((n) => (
                  <article
                    className="integrated-lexical-card"
                    key={n.id}
                    data-evidence-status={n.evidenceStatus}
                  >
                    <header>
                      <h3>{label(n.label)}</h3>
                      <span className="integrated-niche-status">
                        {n.evidenceStatus === "sufficient"
                          ? t("证据充分", "Evidence sufficient")
                          : t("待补证据", "Evidence pending")}
                      </span>
                    </header>
                    <p>
                      {n.count} {t("篇独立论文", "works")} · {pct(n.share)} · {n.years.join(" / ")} ·{" "}
                      {n.spanDays} {t("天跨度", "days")}
                    </p>
                    <p>
                      {t("完整逻辑词语线索论文", "Papers with all reasoning cues")}: {n.logicPapers}
                    </p>
                    {n.gaps.length ? (
                      <section>
                        <h4>{t("待补证据", "Missing evidence")}</h4>
                        <ul>
                          {n.gaps.map((g) => (
                            <li key={g.en}>{label(g)}</li>
                          ))}
                        </ul>
                      </section>
                    ) : (
                      <p>
                        {t(
                          "满足规则筛选条件，建议核对全文与资源。",
                          "Meets screening criteria; inspect full texts and resources.",
                        )}
                      </p>
                    )}
                    <details>
                      <summary>
                        {t("展开论文、数据与代码依据", "Inspect paper, data and code evidence")}
                      </summary>
                      <h4>{t("论文积累", "Paper trajectory")}</h4>
                      {evidence(n.evidence)}
                      <h4>{t("数据开放表述", "Data availability statements")}</h4>
                      {evidence(n.data)}
                      <h4>{t("明确关联代码", "Explicit code associations")}</h4>
                      {evidence(n.code)}
                      <h4>
                        {t("关联动态（不作为独立验证）", "Associated news (not independent validation)")}
                      </h4>
                      {evidence(n.news)}
                    </details>
                  </article>
                ))}
                {visibleNiches.length > limit && (
                  <Button variant="outline" onClick={() => setLimit(limit + 12)}>
                    {t("显示更多", "Show more")}
                  </Button>
                )}
              </>
            )}
          </details>
        </div>
      )}
      <div className="integrated-tools">
        {ready && (
          <details
            className="paper-code-links"
            onToggle={(event) => {
              if (event.currentTarget.open) setCodeToolOpened(true);
            }}
          >
            <summary>
              {t("论文与代码关联 · TF-IDF / BM25", "Paper–code associations · TF-IDF / BM25")}
            </summary>
            {codeToolOpened && (
              <Suspense fallback={<p role="status">{t("正在载入检索工具…", "Loading retrieval tools…")}</p>}>
                <PaperCodeLinks
                  key={`${analysis.data?.sources.papers.manifestSha256}:${analysis.data?.sources.signals.manifestSha256}:${analysis.data?.result.asOf}`}
                  loadInputs={loadCodeInputs}
                />
              </Suspense>
            )}
          </details>
        )}
        <details className="integrated-rules">
          <summary>{t("查看算法与筛选口径", "Rules and inclusion criteria")}</summary>
          <p>
            {t(
              "主流分析按标注的计算日期回看 365 个 UTC 日：论文与动态按发表日，仓库按最近提交日；无有效日期的不进入该窗口。小众分析使用完整历史论文库。先按作品标识、仓库地址及资讯原文链接去重。方向允许多标签，因此占比不相加。集中度 =（论文内占比 + 开源内占比 + 动态内占比）÷ 3；空来源贡献为零，另行显示来源数量。主流候选须至少 3 篇独立论文、至少两类来源各有 2 条记录、集中度不低于 5%。问题、技术和场景均为同一方向记录中出现的词语线索，不作因果关系或性能优劣判断。",
              "Mainstream analysis uses the 365 UTC days ending on the displayed calculation date: publication dates for papers/news and push dates for repositories. Missing dates are not included. Niche analysis uses the full paper history. Deduplicate works, repositories and declared news originals. Directions may overlap, so shares do not sum to 100%. Concentration is the mean of paper, code and news shares; empty sources contribute zero. A mainstream candidate needs 3 works, at least 2 records in each of 2 source types, and a concentration of at least 5%. Problems, methods and scenarios are wording cues within that direction, not causal or performance conclusions.",
            )}
          </p>
          <p>
            {t(
              "全库词法初筛按“方向 × 问题 × 场景”组合，论文占比须低于 10%。证据充分须达到全部规则门槛：至少 3 篇作品、730 天跨度、3 个发表年份，至少 2 篇含问题—方法—验证—结果线索；同时有跨至少一年重复出现的同一数据资源开放链接和明确关联、创建满两年且近一年提交过的非归档仓库。其余保留为待补证据，不判定方向不成立。数据与代码可用性未实际下载核验，时间跨度也不证明持续维护。",
              "Library lexical screening combines direction × problem × scenario and occupy less than 10% of eligible papers. Evidence sufficient means all rule thresholds are met: 3 works across 730 days and 3 publication years, 2 papers with problem–method–evaluation–result cues, a shared data-availability link documented across at least one year, and an explicitly associated non-archived repository created at least two years ago and pushed within a year. Other candidates remain evidence pending, not invalid research directions. Resource availability and continuous maintenance have not been verified.",
            )}
          </p>
          <p>
            {t(
              "定向补证采用已核查的独立快照：在多年论文与摘要线索之外，要求同一数据集的明确日期版本跨至少 365 天，并有新增影像或标注证据；明确关联的非归档代码须有至少 3 个年份、730 天跨度的实际发布或提交，最近事件不超过 365 天。同一选中作品须同时关联合格数据与代码。建库日期、相似度候选和元数据更新不能替代这些证据。",
              "Targeted history is a separately reviewed snapshot. In addition to papers and abstract cues, it requires dated versions of the same dataset across at least 365 days with verified added images or annotations; explicitly linked, non-archived code needs releases or commits in at least 3 years across 730 days and an event within 365 days. One selected work must link both qualifying resources. Repository creation, similarity candidates and metadata edits do not replace this evidence.",
            )}
          </p>
        </details>
        <p className="integrated-coverage">
          {t("当前库采集状态：", "Current library collection: ")}
          {sourceStates.length
            ? t(
                `${sourceStates.filter((s) => s.status !== "ok").length} / ${sourceStates.length} 个来源未完整采集；已载入不等于覆盖完整。`,
                `${sourceStates.filter((s) => s.status !== "ok").length} / ${sourceStates.length} sources have incomplete collection; loading does not establish complete coverage.`,
              )
            : t("尚无来源采集状态", "Source collection status unavailable")}
        </p>
        {result && (
          <small>
            {t("当前库规则版本", "Library rule version")}: {result.version} · {result.asOf} UTC
          </small>
        )}
      </div>
    </section>
  );
}
