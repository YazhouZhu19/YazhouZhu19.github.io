"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { TRACKS } from "@/lib/classify";
import { beijingDay, type DashboardDrill } from "@/lib/dashboard";
import { buildForesight } from "@/lib/foresight";
import type { ForesightCard, ForesightResult } from "@/lib/foresight-types";
import type { MonitorData, Paper } from "@/lib/types";
import { AssessmentHistory } from "./assessment-history";
import { useI18n } from "./locale-provider";

type EvidenceActions = {
  onPaper: (paper: Paper) => void;
  onDrill: (drill: DashboardDrill) => void;
};

const HORIZONS: ForesightCard["horizon"][] = ["3–6", "6–12", "12–24"];
export type ForesightPreferences = { track: string; modality: string; query: string; horizon: ForesightCard["horizon"] };

/** Shared by the direction and team views; every drill preserves the complete evidence set. */
export function ForesightCards({ result, onPaper, onDrill }: EvidenceActions & { result: ForesightResult }) {
  const { locale, tr } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const resultKey = `${result.key}:${result.fingerprint}`;
  const expanded = expandedKey === resultKey;
  const cards = expanded ? result.cards : result.cards.slice(0, 3);
  const papersById = useMemo(() => new Map(result.papers.map(paper => [paper.id, paper])), [result.papers]);

  return <div className="assessment-content">
    {!!result.cards.length && <p className="assessment-scope-note">{t("基于库内样本的条件判断，不代表全领域预测。", "Conditional assessments from this library sample, not field-wide forecasts.")}{!result.comparisonReady && ` ${t("两个窗口暂不足以稳定比较。", "The two windows do not yet support a stable comparison.")}`}</p>}
    {!result.cards.length ? <div className="foresight-empty" role="status">
      <h3>{result.papers.length
        ? t("证据还不足以形成判断", "The evidence is not yet sufficient for an assessment")
        : t("当前范围暂无可用论文", "No available papers in this scope")}</h3>
      <p>{result.papers.length
        ? t("保留这些论文作为观察起点。调整关键词或影像模态，或等待相关证据积累后再评估。", "Keep these papers as a starting point. Broaden the keywords or imaging modality, or revisit when more relevant evidence is available.")
        : t("试试其他方向、移除关键词或放宽影像模态。空结果不能说明这个问题没有研究。", "Try another direction, remove keywords, or broaden the imaging modality. An empty result does not establish that the topic is unstudied.")}</p>
      {!!result.papers.length && <button type="button" className="foresight-button" onClick={() => onDrill({ label: t("当前观察范围的论文", "Papers in the current scope"), ids: result.papers.map(paper => paper.id) })}>
        {t(`查看 ${result.papers.length} 篇论文`, `View ${result.papers.length} papers`)}
      </button>}
    </div> : <>
      <div className="assessment-cards">
        {cards.map((card, index) => {
          const ids = [...new Set(card.paperIds)];
          const supporting = ids.map(id => papersById.get(id)).filter((paper): paper is Paper => !!paper);
          const preview = supporting.slice(0, 3);
          const openEvidence = () => onDrill({ label: card.title[locale], ids });
          return <article className="assessment-card" key={`${resultKey}:${card.id}`}>
            <div className="assessment-card-meta">
              <span className="assessment-dimension"><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{card.label[locale]}</span>
              <div className="assessment-labels">
                <span className={`assessment-strength assessment-strength-${card.strength}`}>
                  {card.strength === "supported" ? t("观察证据较充分", "Broader observed evidence") : t("有限证据", "Limited evidence")}
                </span>
                <span>{t(`${card.horizon} 个月`, `${card.horizon} months`)}</span>
              </div>
            </div>
            <h3>{card.title[locale]}</h3>
            <p className="assessment-forecast">{card.forecast[locale]}</p>
            <div className="assessment-evidence-line">
              <button type="button" onClick={openEvidence} disabled={!ids.length}>{t(`两窗共 ${ids.length} 篇支撑论文`, `${ids.length} supporting papers across both windows`)} <span aria-hidden="true">↗</span></button>
            </div>
            <details className="assessment-details">
              <summary>{t("查看证据与验证计划", "Evidence and validation plan")}</summary>
              <div className="assessment-details-content">
                <div className="assessment-observation">
                  <span>{t("已观察到", "Observed")}</span>
                  <p>{card.observation[locale]}</p>
                </div>
                <section className="assessment-evidence" aria-label={t("支撑论文与原文依据", "Supporting papers and source evidence")}>
                  <h4>{t("支撑论文与原文依据", "Supporting papers and source evidence")}</h4>
                  <p className="assessment-window-comparison">{t(`本期检出 ${card.currentCount} / ${card.currentDenominator} 篇；前期 ${card.previousCount} / ${card.previousDenominator} 篇。`, `Signal found in ${card.currentCount} / ${card.currentDenominator} current papers and ${card.previousCount} / ${card.previousDenominator} previous papers.`)}</p>
                  <ol className="assessment-paper-list">
                    {preview.map(paper => {
                      const evidence = card.evidence.find(item => item.paperId === paper.id);
                      return <li key={paper.id}>
                        <button type="button" className="assessment-paper-title" onClick={() => onPaper(paper)}>{paper.title}</button>
                        <p className="assessment-paper-meta"><time dateTime={paper.publishedAt}>{paper.publishedAt.slice(0, 10)}</time><span>{paper.venue || paper.source}</span><span>{paper.status === "preprint" ? tr("预印本") : paper.status === "published" ? tr("正式发表") : t("状态未确认", "Status unconfirmed")}</span></p>
                        {evidence?.excerpt ? <div className="assessment-excerpt"><span>{evidence.kind === "abstract" ? t("摘要原文", "Abstract excerpt") : t("分类依据", "Classification evidence")}</span><blockquote>{evidence.excerpt}</blockquote></div>
                          : <p className="assessment-evidence-unavailable">{t("可打开论文核对；当前卡片没有可展示的原文片段。", "Open the paper to verify; no source excerpt is available for this card.")}</p>}
                      </li>;
                    })}
                  </ol>
                  {ids.length > preview.length && <button type="button" className="foresight-text-button" onClick={openEvidence}>{t(`查看全部 ${ids.length} 篇支撑论文`, `View all ${ids.length} supporting papers`)} <span aria-hidden="true">→</span></button>}
                </section>
                <dl className="assessment-reasoning">
                  <div><dt>{t("另一种解释", "Alternative explanation")}</dt><dd>{card.alternative[locale]}</dd></div>
                  <div><dt>{t("下一步实验", "Next experiment")}</dt><dd>{card.action[locale]}</dd></div>
                  <div><dt>{t("继续跟踪什么", "What to watch")}</dt><dd>{card.watch[locale]}</dd></div>
                </dl>
              </div>
            </details>
          </article>;
        })}
      </div>
      {result.cards.length > 3 && <div className="assessment-show-more"><button type="button" className="foresight-button" aria-expanded={expanded} onClick={() => setExpandedKey(expanded ? null : resultKey)}>{expanded ? t("收起其他判断", "Show fewer assessments") : t(`再看 ${result.cards.length - 3} 个判断`, `Show ${result.cards.length - 3} more assessments`)}</button></div>}
    </>}
    {!!result.caveats.length && <details className="assessment-boundaries"><summary>{t("证据范围与判断限制", "Evidence scope and limitations")}</summary><ul>{result.caveats.map((caveat, index) => <li key={index}>{caveat[locale]}</li>)}</ul></details>}
    <AssessmentHistory result={result} />
  </div>;
}

export function ForesightView({ data, onPaper, onDrill, preferences, onPreferencesChange }: EvidenceActions & {
  data: MonitorData;
  preferences?: ForesightPreferences;
  onPreferencesChange?: (preferences: ForesightPreferences) => void;
}) {
  const { locale, tr } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const fieldId = useId();
  const [localPreferences, setLocalPreferences] = useState<ForesightPreferences>({ track: "segmentation", modality: "", query: "", horizon: "6–12" });
  const currentPreferences = preferences ?? localPreferences;
  const { track, modality, query, horizon } = currentPreferences;
  const [draftQuery, setDraftQuery] = useState(currentPreferences.query);
  useEffect(() => setDraftQuery(query), [query]);
  const updatePreferences = (changes: Partial<ForesightPreferences>) => {
    const next = { ...currentPreferences, ...changes };
    setLocalPreferences(next);
    onPreferencesChange?.(next);
  };
  const day = beijingDay(new Date());
  const modalities = useMemo(() => [...new Set(data.papers.filter(paper => paper.tracks.includes(track)).flatMap(paper => paper.modalities))].sort(), [data.papers, track]);
  const result = useMemo<ForesightResult>(() => buildForesight(data.papers, { track, modality, query, horizon, now: new Date(`${day}T12:00:00+08:00`) }), [data.papers, track, modality, query, horizon, day]);
  const scopeLabel = `${tr(TRACKS[track])}${modality ? ` · ${tr(modality)}` : ""}${query ? ` · ${query}` : ""}`;

  return <section className="foresight-view" aria-label={t("方向前瞻", "Research direction outlook")}>
    <form className="foresight-controls" onSubmit={event => { event.preventDefault(); updatePreferences({ query: draftQuery.trim() }); }}>
      <div className="foresight-field"><label htmlFor={`${fieldId}-track`}>{t("研究方向", "Research direction")}</label><select id={`${fieldId}-track`} value={track} onChange={event => updatePreferences({ track: event.target.value, modality: "" })}>{Object.entries(TRACKS).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}</select></div>
      <div className="foresight-field"><label htmlFor={`${fieldId}-modality`}>{t("影像模态", "Imaging modality")}</label><select id={`${fieldId}-modality`} value={modality} onChange={event => updatePreferences({ modality: event.target.value })}><option value="">{t("不限模态", "Any modality")}</option>{modalities.map(value => <option key={value} value={value}>{tr(value)}</option>)}</select></div>
      <div className="foresight-field"><label htmlFor={`${fieldId}-horizon`}>{t("判断时间跨度", "Outlook horizon")}</label><select id={`${fieldId}-horizon`} value={horizon} onChange={event => updatePreferences({ horizon: event.target.value as ForesightCard["horizon"] })}>{HORIZONS.map(value => <option key={value} value={value}>{t(`${value} 个月`, `${value} months`)}</option>)}</select></div>
      <div className="foresight-field foresight-field-wide"><label htmlFor={`${fieldId}-query`}>{t("聚焦问题 / 关键词（可选）", "Question keywords (optional)")}</label><div className="foresight-query-row"><input id={`${fieldId}-query`} value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder={t("例如：domain shift", "e.g. domain shift")} aria-describedby={`${fieldId}-query-help`} /><button type="submit" className="foresight-button foresight-button-primary">{t("更新观察", "Update outlook")}</button></div><p id={`${fieldId}-query-help`} className="foresight-control-help">{t("按标题与摘要匹配所有输入词，建议使用英文术语。此处用于缩小论文范围。", "All entered words must match the title or abstract. Use English terms to narrow the paper set.")}</p></div>
    </form>

    <dl className="foresight-scope" aria-label={t("本次判断的数据范围", "Evidence scope for this assessment")}>
      <div className="foresight-window"><dt>{t("发表窗口", "Publication windows")}</dt><dd><span>{result.from} — {result.asOf}</span><small>{t("对照", "vs.")} {result.previousFrom} — {result.previousTo}</small></dd></div>
      <div><dt>{t("本期论文", "Current papers")}</dt><dd><button type="button" disabled={!result.current.length} onClick={() => onDrill({ label: `${scopeLabel} · ${t("本期", "Current")}`, ids: result.current.map(paper => paper.id) })}>{result.current.length}</button></dd></div>
      <div><dt>{t("前期论文", "Previous papers")}</dt><dd><button type="button" disabled={!result.previous.length} onClick={() => onDrill({ label: `${scopeLabel} · ${t("前期", "Previous")}`, ids: result.previous.map(paper => paper.id) })}>{result.previous.length}</button></dd></div>
      <div><dt>{t("缺少摘要", "Missing abstracts")}</dt><dd>{result.missingAbstracts}</dd></div>
    </dl>
    <div className="foresight-toolbar"><div><h2>{t("当前值得验证的判断", "Assessments to test next")}</h2><p>{scopeLabel}</p></div><button type="button" className="foresight-text-button" disabled={!result.papers.length} onClick={() => onDrill({ label: scopeLabel, ids: result.papers.map(paper => paper.id) })}>{t(`查看范围内 ${result.papers.length} 篇论文`, `Browse ${result.papers.length} papers in scope`)} <span aria-hidden="true">↗</span></button></div>
    <ForesightCards result={result} onPaper={onPaper} onDrill={onDrill} />
  </section>;
}
