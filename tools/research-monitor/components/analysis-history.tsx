import { useId, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Circle } from "lucide-react";
import type { HistoryDirection, LongitudinalHistory } from "@/lib/longitudinal-analysis";
import { useI18n } from "./locale-provider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import "@/styles/analysis-history.css";

export type AnalysisHistoryProps = {
  history: LongitudinalHistory;
  evidenceFilter: "all" | "sufficient" | "pending";
  query: string;
};

const englishTitles: Record<string, string> = {
  "spinal-cord-mri": "Spinal cord MRI segmentation and quantitative analysis",
  "fetal-brain-mri": "Fetal brain MRI motion correction, reconstruction and segmentation",
  "qsm-reconstruction": "Quantitative susceptibility mapping and reconstruction",
};
const englishScopes: Record<string, string> = {
  "spinal-cord-mri":
    "Spinal cord segmentation, nerve-rootlet localization and quantitative MRI across centers; excludes vertebral imaging.",
  "fetal-brain-mri":
    "Motion correction, super-resolution reconstruction and tissue segmentation in fetal brain MRI.",
  "qsm-reconstruction":
    "Masking, background-field removal, dipole inversion and reproducible QSM reconstruction.",
};
const englishChecks: Record<string, string> = {
  niche: "Low share in the baseline library",
  papers: "Independent papers across years",
  logic: "Problem, method, validation and numerical-result cues",
  data: "Content accumulation within one dataset",
  code: "Paper-linked code maintained across years",
  chain: "A common paper links the dataset and code",
};
const sourceLang = (text: string) => (/\p{Script=Han}/u.test(text) ? "zh-CN" : undefined);
const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
};

function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="analysis-history-source-link">
      <span>{children}</span>
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>
  ) : (
    <span>{children}</span>
  );
}

function HistoryCard({ item }: { item: HistoryDirection }) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const title = locale === "en" ? (englishTitles[item.id] ?? item.title) : item.title;
  const scope = locale === "en" ? (englishScopes[item.id] ?? item.scope) : item.scope;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const sufficient = item.evidenceStatus === "sufficient";
  const passed = item.checks.filter((check) => check.passed).length;
  const years = [...new Set(item.papers.map((paper) => paper.date.slice(0, 4)))].sort();
  const paperPeriod = years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0];
  const dataSpan = Math.max(0, ...item.datasets.map((dataset) => dataset.spanDays));
  const latestCode = item.repositories
    .flatMap((repository) => repository.events.map((event) => event.date))
    .sort()
    .at(-1);
  const empty = (
    <p className="analysis-history-empty-resource">
      {t("尚无可核查记录。", "No verifiable records collected.")}
    </p>
  );
  return (
    <article
      className="analysis-history-card"
      data-history-id={item.id}
      data-evidence-status={item.evidenceStatus}
      aria-labelledby={titleId}
    >
      <header className="analysis-history-card-head">
        <h3 id={titleId}>{title}</h3>
        <Badge
          variant="outline"
          className={`analysis-history-badge ${sufficient ? "is-sufficient" : "is-pending"}`}
        >
          {sufficient ? t("证据充分", "Sufficient evidence") : t("待补证据", "Evidence pending")}
        </Badge>
      </header>
      <p className="analysis-history-scope">{scope}</p>
      <div className="analysis-history-facts">
        <span>
          {item.papers.length} {t("篇独立论文", "independent papers")}
          {paperPeriod ? ` · ${paperPeriod}` : ""}
        </span>
        <span>
          {item.datasets.length} {t("个数据资源", "datasets")} · {t("最长版本跨度", "longest version span")}{" "}
          {dataSpan} {t("天", "days")}
        </span>
        <span>
          {item.repositories.length} {t("个代码仓库", "repositories")}
          {latestCode ? ` · ${t("最近记录", "latest event")} ${latestCode}` : ""}
        </span>
      </div>
      <div className="analysis-history-card-bottom">
        <p className="analysis-history-baseline">
          {t("基线库内", "Baseline library")}: {item.archiveCount} {t("篇", "papers")} ·{" "}
          {(item.archiveShare * 100).toFixed(2)}%
          <span>
            {t("检查已满足", "Checks met")} {passed}/{item.checks.length}
            {item.gaps.length ? ` · ${item.gaps.length} ${t("项待补", "gaps")}` : ""}
          </span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          data-history-toggle
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? t("收起证据", "Hide evidence") : t("证据与时间线", "Evidence and timeline")} · ${title}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("收起证据", "Hide evidence") : t("证据与时间线", "Evidence and timeline")}
          <ChevronDown size={14} aria-hidden="true" className={expanded ? "is-open" : undefined} />
        </Button>
      </div>
      <div id={panelId} hidden={!expanded} className="analysis-history-panel">
        {expanded && (
          <>
            <p className="analysis-history-source-note">
              {t(
                "以下保留来源记录与核查原文；规则线索未命中不表示论文没有实验或结果。",
                "Source records and audit details retain their original language, including Chinese. Missing lexical cues do not mean a paper lacks experiments or results.",
              )}
            </p>
            <details className="analysis-history-section" data-history-section="checks" open>
              <summary>
                {t("规则检查与证据缺口", "Rule checks and evidence gaps")}{" "}
                <span>
                  {passed}/{item.checks.length}
                </span>
              </summary>
              <ul className="analysis-history-checks">
                {item.checks.map((check) => (
                  <li key={check.id} data-passed={check.passed}>
                    <div>
                      {check.passed ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        <Circle size={12} aria-hidden="true" />
                      )}
                      <strong>
                        {check.passed ? t("已满足", "Met") : t("待补", "Pending")} ·{" "}
                        {locale === "en" ? (englishChecks[check.id] ?? check.label) : check.label}
                      </strong>
                    </div>
                    <p lang={sourceLang(check.detail)}>{check.detail}</p>
                  </li>
                ))}
              </ul>
              {item.gaps.length > 0 && (
                <div className="analysis-history-gaps">
                  <h4>{t("待补材料 · 核查原文", "Evidence gaps · audit wording")}</h4>
                  <ul>
                    {item.gaps.map((gap, index) => (
                      <li key={index} lang={sourceLang(gap)}>
                        {gap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
            <details className="analysis-history-section" data-history-section="papers">
              <summary>
                {t("论文时间线", "Paper timeline")} <span>{item.papers.length}</span>
              </summary>
              {item.papers.length ? (
                <ol className="analysis-history-timeline">
                  {item.papers.map((paper) => (
                    <li key={paper.id}>
                      <time dateTime={paper.date}>{paper.date}</time>
                      <div>
                        <SourceLink url={paper.url}>{paper.title}</SourceLink>
                        {paper.doi && <p className="analysis-history-id">DOI {paper.doi}</p>}
                        <p>
                          {paper.logicComplete
                            ? t("四类摘要规则均命中", "All four abstract cue groups matched")
                            : t("摘要规则未覆盖四类线索", "Not all four abstract cue groups matched")}
                        </p>
                        <dl className="analysis-history-cues">
                          {(
                            [
                              ["problem", t("问题", "Problem")],
                              ["method", t("方法", "Method")],
                              ["validation", t("验证", "Validation")],
                              ["result", t("结果", "Result")],
                            ] as const
                          ).map(([key, label]) => (
                            <div key={key}>
                              <dt>{label}</dt>
                              <dd lang={sourceLang(paper.cues[key].join(" "))}>
                                {paper.cues[key].join(" / ") || t("未命中", "No match")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                empty
              )}
            </details>
            <details className="analysis-history-section" data-history-section="datasets">
              <summary>
                {t("数据版本时间线", "Dataset version timeline")} <span>{item.datasets.length}</span>
              </summary>
              {item.datasets.length
                ? item.datasets.map((dataset) => (
                    <section key={dataset.id} className="analysis-history-resource">
                      <h4>
                        <SourceLink url={dataset.url}>{dataset.title}</SourceLink>
                      </h4>
                      <p className="analysis-history-resource-meta">
                        {t("版本跨度", "Version span")} {dataset.spanDays} {t("天", "days")} ·{" "}
                        {dataset.contentGrowth
                          ? t("已有内容变化记录", "Content changes documented")
                          : t("内容增长尚待核实", "Content growth not established")}{" "}
                        ·{" "}
                        {dataset.linked
                          ? t("已匹配论文链接", "Paper link matched")
                          : t("论文关联待补", "Paper link pending")}
                      </p>
                      {dataset.versions.length ? (
                        <ol className="analysis-history-timeline">
                          {dataset.versions.map((version, index) => (
                            <li key={`${version.version}:${index}`}>
                              {version.date ? (
                                <time dateTime={version.date}>{version.date}</time>
                              ) : (
                                <span className="analysis-history-unknown-date">
                                  {t("日期未核实", "Date unverified")}
                                </span>
                              )}
                              <div>
                                <SourceLink url={version.url}>
                                  {t("版本", "Version")} {version.version}
                                </SourceLink>
                                {version.participants != null && (
                                  <p className="analysis-history-participants">
                                    {version.participants} {t("个样本 / 参与者", "samples / participants")}
                                  </p>
                                )}
                                <p lang={sourceLang(version.changeDescription)}>
                                  {version.changeDescription}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        empty
                      )}
                    </section>
                  ))
                : empty}
            </details>
            <details className="analysis-history-section" data-history-section="repositories">
              <summary>
                {t("代码发布与提交", "Code releases and commits")} <span>{item.repositories.length}</span>
              </summary>
              {item.repositories.length
                ? item.repositories.map((repository) => (
                    <section key={repository.repository} className="analysis-history-resource">
                      <h4>
                        <SourceLink url={repository.url}>{repository.repository}</SourceLink>
                      </h4>
                      <p className="analysis-history-resource-meta">
                        {repository.years.join(" / ")} · {repository.spanDays} {t("天跨度", "days spanned")} ·{" "}
                        {repository.recent
                          ? t("有近期事件", "Recent event recorded")
                          : t("近期维护待补证", "Recent maintenance unverified")}{" "}
                        ·{" "}
                        {repository.linked
                          ? t("已匹配论文链接", "Paper link matched")
                          : t("论文关联待补", "Paper link pending")}
                        {repository.archived === true
                          ? ` · ${t("已归档", "Archived")}`
                          : repository.archived === null
                            ? ` · ${t("归档状态未核实", "Archive status unverified")}`
                            : ""}
                      </p>
                      {repository.events.length ? (
                        <ol className="analysis-history-timeline">
                          {repository.events.map((event, index) => (
                            <li key={`${event.url}:${index}`}>
                              <time dateTime={event.date}>{event.date}</time>
                              <div>
                                <SourceLink url={event.url}>
                                  {event.kind === "release" ? t("发布", "Release") : t("提交", "Commit")}{" "}
                                  {event.label}
                                </SourceLink>
                                <p lang={sourceLang(event.description)}>{event.description}</p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        empty
                      )}
                    </section>
                  ))
                : empty}
            </details>
            <details className="analysis-history-section" data-history-section="sources">
              <summary>
                {t("来源与核查边界", "Sources and limitations")} <span>{item.sources.length}</span>
              </summary>
              <ul className="analysis-history-source-list">
                {item.sources.map((source) => (
                  <li key={source.id}>
                    <SourceLink url={source.url}>{source.id}</SourceLink>
                    <span>
                      {t("访问", "Retrieved")} {source.retrievedAt}
                      {source.sourceType ? ` · ${source.sourceType}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {item.limitations.length > 0 && (
                <ul className="analysis-history-limitations">
                  {item.limitations.map((limitation, index) => (
                    <li key={index} lang={sourceLang(limitation)}>
                      {limitation}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </>
        )}
      </div>
    </article>
  );
}

export function AnalysisHistory({ history, evidenceFilter, query }: AnalysisHistoryProps) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const headingId = useId();
  const sufficient = history.directions.filter(
    (direction) => direction.evidenceStatus === "sufficient",
  ).length;
  const needle = query.trim().toLowerCase();
  const visible = history.directions
    .filter(
      (direction) =>
        (evidenceFilter === "all" || direction.evidenceStatus === evidenceFilter) &&
        (!needle ||
          [
            direction.title,
            englishTitles[direction.id] ?? "",
            direction.scope,
            englishScopes[direction.id] ?? "",
            ...direction.papers.map((paper) => `${paper.title} ${paper.doi ?? ""}`),
            ...direction.datasets.map((dataset) => dataset.title),
            ...direction.repositories.map((repository) => repository.repository),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(b.evidenceStatus === "sufficient") - Number(a.evidenceStatus === "sufficient") ||
        b.checks.filter((check) => check.passed).length - a.checks.filter((check) => check.passed).length ||
        a.id.localeCompare(b.id),
    );
  return (
    <section className="analysis-history" aria-labelledby={headingId} data-history-version={history.version}>
      <header className="analysis-history-heading">
        <div>
          <h2 id={headingId}>{t("多年积累 · 专题补证", "Long-term research · focused evidence")}</h2>
          <p>
            {t("固定核查快照", "Fixed audit snapshot")} · <time dateTime={history.asOf}>{history.asOf}</time>{" "}
            UTC
          </p>
        </div>
        <Badge variant="outline">{t("固定规则 · 无大语言模型", "Fixed rules · No LLM")}</Badge>
      </header>
      <dl className="analysis-history-metrics">
        <div>
          <dt>{t("核查专题", "Topics reviewed")}</dt>
          <dd data-history-count="topics">{history.directions.length}</dd>
        </div>
        <div>
          <dt>{t("独立作品 · 单独统计", "Independent works · separate count")}</dt>
          <dd data-history-count="works">{history.enrichedPaperCount}</dd>
        </div>
        <div>
          <dt>{t("证据充分", "Sufficient evidence")}</dt>
          <dd data-history-count="sufficient">{sufficient}</dd>
        </div>
        <div>
          <dt>{t("待补证据", "Evidence pending")}</dt>
          <dd data-history-count="pending">{history.directions.length - sufficient}</dd>
        </div>
      </dl>
      <p className="analysis-history-context">
        {t(
          `库内占比使用核查时的 ${history.basePaperCount.toLocaleString("zh-CN")} 篇基线论文，不能与当前来源统计相加。此快照不随重新运行分析更新。`,
          `Library shares use the audit baseline of ${history.basePaperCount.toLocaleString("en-US")} papers and are separate from current source counts. Running analysis does not refresh this snapshot.`,
        )}
      </p>
      <p className="analysis-history-boundary">
        {t(
          "证据充分仅表示通过本轮规则，不等于科学结论已被验证；待补证据不表示方向不成立。跨年事件只证明所列时间点有变更，不等于每年持续维护。",
          "Sufficient evidence means the current rules were met, not that scientific conclusions were validated. Pending evidence does not invalidate a topic. Events across years do not establish uninterrupted yearly maintenance.",
        )}
      </p>
      <p role="status" className="analysis-history-match">
        {t(
          `专题补证：匹配 ${visible.length} / ${history.directions.length} 个专题`,
          `Focused evidence: ${visible.length} of ${history.directions.length} topics match`,
        )}
      </p>
      <div className="analysis-history-cards">
        {visible.length ? (
          visible.map((direction) => <HistoryCard key={direction.id} item={direction} />)
        ) : (
          <p className="analysis-history-empty">
            {t(
              "没有符合当前筛选的补证专题。请调整证据状态或搜索词。",
              "No reviewed topics match these filters. Adjust the evidence status or search query.",
            )}
          </p>
        )}
      </div>
    </section>
  );
}
