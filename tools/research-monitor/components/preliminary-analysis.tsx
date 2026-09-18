"use client";

import { useMemo } from "react";
import { ArrowUpRight, BookOpen, CircleHelp, Filter, Layers3, Search, Telescope } from "lucide-react";
import { useI18n } from "./locale-provider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRACKS } from "@/lib/classify";
import { buildPreliminaryAnalysis, type AnalysisCount } from "@/lib/analysis";
import { defaultDashboardFilters, type DashboardDrill, type DashboardFilters } from "@/lib/dashboard";
import type { MonitorData, Paper, Team } from "@/lib/types";
import "@/styles/analysis.css";

const percentage = (value: number) => value > 0 && value < 1 ? "<1" : String(Math.round(value));

export type PreliminaryAnalysisProps = {
  data: MonitorData;
  teams: Team[];
  filters: DashboardFilters;
  onFilters: (filters: DashboardFilters) => void;
  onDrill: (drill: DashboardDrill) => void;
  onPaper: (paper: Paper) => void;
};

function AnalysisChoice({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (value: string) => void;
}) {
  const { tr } = useI18n();
  return <div className="analysis-control"><label>{tr(label)}</label><Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={tr(label)}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([id, name]) => <SelectItem key={id} value={id}>{tr(name)}</SelectItem>)}</SelectContent>
  </Select></div>;
}

function TopicBars({ rows, title, onDrill }: { rows: AnalysisCount[]; title: string; onDrill: PreliminaryAnalysisProps["onDrill"] }) {
  const { locale, tr } = useI18n();
  const max = Math.max(1, ...rows.map(row => row.count));
  return <section className="analysis-panel analysis-topics">
    <div className="analysis-panel-heading"><h2>{tr(title)}</h2><span>{tr("当前范围内的标签计数")}</span></div>
    <div className="analysis-topic-bars">{rows.filter(row => row.count > 0).slice(0, 10).map(row => <button key={row.id}
      aria-label={tr("查看{0}：{1}条记录", [tr(row.label), row.count])}
      onClick={() => onDrill({ label: tr("研究主题：{0}", [tr(row.label)]), ids: row.paperIds })}>
      <span className="analysis-topic-name">{tr(row.label)}</span><span className="analysis-topic-track"><i style={{ width: `${row.count / max * 100}%` }} /></span>
      <b>{row.count.toLocaleString(locale)}</b><span className="analysis-topic-share">{percentage(row.share)}%</span>
    </button>)}{!rows.some(row => row.count) && <p className="analysis-empty-inline">{tr("当前范围未识别到此类主题标签。")}</p>}</div>
    <p className="analysis-panel-note">{tr("比例以当前范围记录为分母；多标签可重叠。")}</p>
  </section>;
}

export function PreliminaryAnalysis({ data, teams, filters, onFilters, onDrill, onPaper }: PreliminaryAnalysisProps) {
  const { locale, tr } = useI18n();
  const m = useMemo(() => buildPreliminaryAnalysis(data, { ...filters, clock: "publication" }, teams), [data, teams, filters.days, filters.track, filters.source]);
  const count = (value: number) => value.toLocaleString(locale);
  const change = (key: "days" | "track" | "source", value: string) => onFilters({ ...filters, clock: "publication", [key]: value });
  const clear = () => onFilters({ days: "all", clock: "publication", track: "all", source: "all" });
  const topDirection = [...m.directions].sort((a, b) => b.count - a.count).find(row => row.count > 0);
  const preprints = m.scope.rows.filter(paper => paper.status === "preprint").length;
  const knownStatus = m.scope.rows.filter(paper => paper.status !== "unknown").length;
  const unknownStatus = m.scope.total - knownStatus;
  const missingAbstract = m.scope.rows.filter(paper => !m.paperAnalyses[paper.id]?.hasAbstract).length;
  const withMethodTags = m.scope.rows.filter(paper => paper.methods.length > 0).length;
  const combinations = m.combinations.filter(row => row.count > 0).slice(0, 8);
  const availableSources = ["Europe PMC", "arXiv", "medRxiv"].filter(source => filters.source === "all" || source === filters.source);
  const sourceWarnings = availableSources.filter(source => {
    const run = data.runs.find(item => item.source === source);
    return !run || run.status !== "ok";
  });
  const drill = (label: string, ids: string[]) => onDrill({ label, ids });

  return <div className="preliminary-analysis">
    <div className="analysis-controls">
      <AnalysisChoice label="分析时间范围" value={filters.days} onChange={value => change("days", value)} options={[["7", "近 7 天"], ["30", "近 30 天"], ["90", "近 90 天"], ["all", "全部日期"]]} />
      <AnalysisChoice label="感兴趣方向" value={filters.track} onChange={value => change("track", value)} options={[["all", "全部感兴趣方向"], ...Object.entries(TRACKS)]} />
      <AnalysisChoice label="分析数据来源" value={filters.source} onChange={value => change("source", value)} options={[["all", "全部来源"], ["Europe PMC", "Europe PMC"], ["arXiv", "arXiv"], ["medRxiv", "medRxiv"]]} />
      <Button variant="outline" onClick={() => onFilters({ ...defaultDashboardFilters, clock: "publication" })}><Filter size={15} />{tr("重置")}</Button>
    </div>
    <div className="analysis-scope"><span>{m.scope.from} — {m.scope.to} · {tr("按来源发布日期筛选；medRxiv 使用版本日期。")}</span><span>{tr("所有观察、计数与阅读候选使用同一范围")}</span></div>

    {m.scope.total ? <>
      <section className="analysis-observation" aria-labelledby="analysis-observation-title">
        <div className="analysis-section-kicker"><Telescope size={18} /><h2 id="analysis-observation-title">{tr("从当前样本开始判断")}</h2></div>
        <p>{topDirection
          ? tr("这次筛选得到 {0} 条记录，其中 {1} 是出现较多的方向（{2} 条）。", [count(m.scope.total), tr(topDirection.label), count(topDirection.count)])
          : tr("这次筛选得到 {0} 条记录，尚未识别到方向标签。", [count(m.scope.total)])}
          {" "}{knownStatus > 0 ? tr("预印本占已知发表状态记录的 {0}%（{1}/{2}）；阅读时可优先核对验证设计及正式发表版本。", [percentage(preprints / knownStatus * 100), count(preprints), count(knownStatus)]) : tr("当前记录的发表状态尚未确认，阅读前请核对原始来源。")}</p>
        <p className="analysis-observation-next">{tr("下方把主题与方法组合拆开，帮助决定先读什么；这些样本分布不证明全领域趋势或研究空白。")}</p>
        <button onClick={() => drill(tr("初步分析：当前范围"), m.scope.rows.map(paper => paper.id))}>{tr("查看本次分析的全部论文")}<ArrowUpRight size={15} /></button>
      </section>

      <div className="analysis-coverage"><CircleHelp size={16} /><div><p>{tr("摘要缺失 {0}/{1} 条；未检出线索不等于研究没有相应设计。", [count(missingAbstract), count(m.scope.total)])}
        {" "}{unknownStatus > 0 && tr("另有 {0} 条记录的发表状态未确认。", [count(unknownStatus)])}</p>
        <p>{tr("方法标签识别 {0}/{1} 条；未识别到标签不代表论文未使用相关方法。", [count(withMethodTags), count(m.scope.total)])}</p>
        <details><summary>{tr("查看覆盖与统计口径")}</summary><p>{tr("统计仅覆盖当前已采集的公开记录。器官、模态、方向和方法均由标题与摘要规则匹配，可能漏检或误检；请点击记录核对原文。")}</p>
          <p>{tr("来源：{0}。来源索引可能重叠；跨来源重复记录先按已知标识去重。", [availableSources.join(" · ")])}</p>
          {!!sourceWarnings.length && <p>{tr("以下来源可能处于有限覆盖、失败或尚无完整同步状态：{0}。", [sourceWarnings.join(" · ")])}</p>}
          <p>{tr("已排除来源未来日期 {0} 条、缺失或无效日期 {1} 条，并移除重复记录 {2} 条。", [m.scope.excludedFuture, m.scope.excludedInvalidDate, m.scope.duplicatesRemoved])}</p>
        </details></div></div>

      <div className="analysis-topic-grid">
        <TopicBars title="研究主题 · 器官与疾病" rows={m.topics.filter(row => row.kind === "organ")} onDrill={onDrill} />
        <TopicBars title="研究主题 · 影像模态" rows={m.topics.filter(row => row.kind === "modality")} onDrill={onDrill} />
      </div>

      <section className="analysis-panel analysis-combinations">
        <div className="analysis-panel-heading"><div><h2>{tr("方向与方法如何组合")}</h2><p>{tr("按当前样本中的共同出现次数排列；不是新颖性证据，也不是方法效果排名。")}</p></div><Layers3 size={20} /></div>
        {combinations.length ? <div className="analysis-combination-table"><div className="analysis-combination-head"><span>{tr("方向 × 方法")}</span><span>{tr("记录数")}</span><span>{tr("方向内比例")}</span></div>
          {combinations.map((row, index) => <button key={row.id} onClick={() => drill(tr("方法组合：{0} × {1}", [tr(row.trackLabel), tr(row.method)]), row.paperIds)}>
            <span className="analysis-combination-name"><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{tr(row.trackLabel)}</strong><small>{tr(row.method)}</small></span></span>
            <b>{count(row.count)}</b><span className="analysis-combination-share"><span>{percentage(row.share)}%</span><small>{count(row.count)} / {count(row.denominator)}</small><i><i style={{ width: `${row.share}%` }} /></i></span>
          </button>)}</div> : <p className="analysis-empty-inline">{tr("当前范围没有识别到方向与方法的组合。可放宽筛选，或直接阅读论文摘要。")}</p>}
        <p className="analysis-panel-note">{tr("方向内比例 = 该组合记录数 / 同一筛选范围内该方向的记录数。每篇论文可进入多个组合。")}</p>
      </section>

      <section className="analysis-panel analysis-evidence">
        <div className="analysis-panel-heading"><div><h2>{tr("临床验证与开放资源线索")}</h2><p>{tr("只标记摘要中的明确表述；点击可核对论文，不合成为质量分数。")}</p></div></div>
        <div className="analysis-signal-grid">{m.signals.map(signal => <button key={signal.id} disabled={!signal.count} onClick={() => drill(tr("摘要线索：{0}", [tr(signal.label)]), signal.paperIds)}>
          <span>{tr(signal.label)}</span><strong>{count(signal.count)}</strong><small>{signal.denominator ? tr("占有摘要记录 {0}%（{1}/{2}）", [percentage(signal.share), count(signal.count), count(signal.denominator)]) : tr("当前范围无可用摘要")}</small><ArrowUpRight size={14} />
        </button>)}</div>
        <p className="analysis-panel-note">{tr("代码或数据开放表述不等于链接当前可用；验证设计是否充分仍需阅读全文。")}</p>
      </section>

      <section className="analysis-reading" aria-labelledby="analysis-reading-title">
        <div className="analysis-reading-heading"><div><div className="analysis-section-kicker"><BookOpen size={18} /><h2 id="analysis-reading-title">{tr("值得进一步阅读")}</h2></div><p>{tr("最多 6 篇：优先有摘要的组合代表，再选有研究线索的记录，最后按近期来源日期补充。选入不代表质量或创新性更高。")}</p></div></div>
        <div className="analysis-reading-list">{m.readingCandidates.map(({ paper, analysis, reasons }, index) => {
          const excerpt = analysis.objective ?? analysis.methods ?? analysis.results;
          const excerptLabel = analysis.objective ? "研究目标原文" : analysis.methods ? "研究方法原文" : "研究结果原文";
          return <article className="analysis-reading-card" key={paper.id}>
            <div className="analysis-reading-meta"><span className="analysis-reading-number">{String(index + 1).padStart(2, "0")}</span><span>{paper.publishedAt.slice(0, 10)}</span><span>{paper.source}</span><span>{tr(paper.status === "preprint" ? "预印本" : paper.status === "published" ? "正式发表" : "状态未确认")}</span></div>
            <button className="analysis-reading-title" aria-label={tr("查看论文分析：{0}", [paper.title])} onClick={() => onPaper(paper)}>{paper.title}<ArrowUpRight size={16} /></button>
            <div className="analysis-reading-reasons"><span>{tr("选入原因")}</span>{reasons.map((reason, i) => <span key={`${reason.kind}-${i}`} className="analysis-reason">{reason.kind === "combination" && reason.trackLabel && reason.method ? tr("组合代表：{0} × {1}", [tr(reason.trackLabel), tr(reason.method)]) : tr(reason.label)}</span>)}</div>
            {excerpt ? <div className="analysis-reading-excerpt"><span>{tr(excerptLabel)}</span><blockquote>{excerpt}</blockquote></div> : <p className="analysis-empty-inline">{tr(analysis.hasAbstract ? "摘要中未识别到明确的目标、方法或结果句，请查看原始摘要。" : "来源未提供摘要，请打开原文核对研究内容。")}</p>}
            <div className="analysis-reading-actions"><button onClick={() => onPaper(paper)}>{tr("查看目标、方法与结果")}<ArrowUpRight size={14} /></button><a href={paper.url} target="_blank" rel="noreferrer">{tr("打开原始论文")}<ArrowUpRight size={14} /></a></div>
          </article>;
        })}</div>
        {!m.readingCandidates.length && <div className="analysis-empty-inline">{tr("当前范围暂时没有可展示的阅读候选。")}</div>}
        <p className="analysis-reading-note">{tr("摘录保留摘要原文，不自动翻译或改写；句子识别可能不完整，详细判断请回到原始论文。")}</p>
      </section>

      <section className="analysis-reading-questions"><h2>{tr("带着这些问题继续阅读")}</h2><p>{tr("以下是核对问题，不是对当前论文的结论。")}</p><ul>
        <li>{tr("研究目标、目标人群和真实临床流程是否一致？")}</li>
        <li>{tr("数据划分、比较基线和外部验证是否足以支持报告的结论？")}</li>
        <li>{tr("相同的方法组合，换到其他器官、模态或医生反馈流程后是否仍然适用？")}</li>
      </ul></section>
    </> : <section className="analysis-empty"><Search size={30} /><h2>{tr("当前范围暂无可分析记录")}</h2><p>{tr("试着扩大日期范围或清除方向与来源筛选；空结果不表示该领域没有研究。")}</p><Button variant="outline" onClick={clear}>{tr("清除筛选，查看全部日期")}</Button></section>}
  </div>;
}
