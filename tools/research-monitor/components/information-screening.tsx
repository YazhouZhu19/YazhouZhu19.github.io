import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "./locale-provider";
import { useSignalsAccess } from "./signals-context";
import type { Paper } from "@/lib/types";
import type { ResearchSignal } from "@/lib/research-signals";
import type { PaperScreening, ScreeningText } from "@/lib/information-screening";
import "@/styles/information-screening.css";

type Props = {
  papers: Paper[];
  candidates: Paper[];
  signals: ResearchSignal[];
  onPaper: (paper: Paper) => void;
};
type Dimension = "history" | "crossSource" | "priorWork" | "logic";
const dimensions: Dimension[] = ["history", "crossSource", "priorWork", "logic"];
const titles: Record<Dimension, ScreeningText> = {
  history: { zh: "历史记录", en: "Library history" },
  crossSource: { zh: "跨来源关联", en: "Cross-source links" },
  priorWork: { zh: "早期相关工作", en: "Earlier related work" },
  logic: { zh: "研究逻辑线索", en: "Research logic cues" },
};
const labels: Record<Dimension, Record<string, ScreeningText>> = {
  history: {
    new: { zh: "窗口内首次收录", en: "First collected in window" },
    known: { zh: "此前已收录", en: "Previously collected" },
    "related-version": { zh: "同作品其他记录", en: "Other records of this work" },
    unknown: { zh: "收录时间未知", en: "Collection date unknown" },
  },
  crossSource: {
    linked: { zh: "找到显式关联", en: "Explicit links found" },
    none: { zh: "已载入资料中未找到关联", en: "No links in loaded records" },
    incomplete: { zh: "跨源检查未完成", en: "Cross-source check incomplete" },
  },
  priorWork: {
    candidates: { zh: "有早期工作可对照", en: "Earlier works to compare" },
    none: { zh: "未检索到比较对象", en: "No comparison retrieved" },
  },
  logic: {
    review: { zh: "有论证线索需复核", en: "Claims need review" },
    insufficient: { zh: "摘要线索不足", en: "Insufficient abstract cues" },
    "cues-found": { zh: "已提取摘要线索", en: "Abstract cues extracted" },
  },
};
const emptyFilters: Record<Dimension, string> = {
  history: "all",
  crossSource: "all",
  priorWork: "all",
  logic: "all",
};

export function InformationScreening(props: Props) {
  const { locale } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const t = (value: ScreeningText) => (locale === "en" ? value.en : value.zh);
  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [since, setSince] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [results, setResults] = useState<PaperScreening[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [limit, setLimit] = useState(20);
  const worker = useRef<Worker | null>(null);
  const { papers, candidates, signals } = props;
  const sourceAccess = useSignalsAccess();
  const loaded = sourceAccess?.loaded ?? { github: false, news: false };
  const sourcesLoading = sourceAccess?.loading ?? false;
  const sourcesError = sourceAccess?.error ?? false;
  async function loadSources() {
    if (!sourceAccess) return;
    try {
      await sourceAccess.ensureKind("github");
      await sourceAccess.ensureKind("news");
    } catch {
      setError(true);
    }
  }
  const byId = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  // A result is valid only for the exact inputs used to compute it.
  useEffect(() => {
    worker.current?.terminate();
    worker.current = null;
    setResults(null);
    setRunning(false);
    setError(false);
    setLimit(20);
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, [papers, candidates, signals, loaded.github, loaded.news, since, asOf]);
  const visible = useMemo(
    () =>
      (results ?? []).filter((result) =>
        dimensions.every(
          (dimension) => filters[dimension] === "all" || result[dimension].state === filters[dimension],
        ),
      ),
    [results, filters],
  );
  const validDates =
    [since, asOf].every((value) => {
      const stamp = Date.parse(`${value}T00:00:00Z`);
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(stamp) &&
        new Date(stamp).toISOString().slice(0, 10) === value
      );
    }) &&
    since <= asOf &&
    asOf <= new Date().toISOString().slice(0, 10);
  function run() {
    worker.current?.terminate();
    setResults(null);
    setError(false);
    setRunning(true);
    setLimit(20);
    try {
      const current = new Worker(new URL("../lib/information-screening-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = current;
      current.onmessage = (event: MessageEvent<{ results?: PaperScreening[]; error?: string }>) => {
        if (worker.current !== current) return;
        if (event.data.results) setResults(event.data.results);
        else setError(true);
        setRunning(false);
        current.terminate();
        worker.current = null;
      };
      current.onerror = (event) => {
        event.preventDefault();
        if (worker.current !== current) return;
        setError(true);
        setRunning(false);
        current.terminate();
        worker.current = null;
      };
      current.postMessage({
        papers,
        candidateIds: candidates.map((p) => p.id),
        signals,
        loaded,
        since,
        asOf,
      });
    } catch {
      worker.current?.terminate();
      worker.current = null;
      setError(true);
      setRunning(false);
    }
  }
  return (
    <section className="information-screening" aria-label={ui("信息筛选", "Information screening")}>
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls="information-screening-content"
        onClick={() => setOpen(!open)}
      >
        {ui("信息筛选", "Information screening")}
      </Button>
      {open && (
        <div id="information-screening-content">
          <h2>{ui("先比对，再判断信息价值", "Compare the evidence before prioritizing")}</h2>
          <p>
            {ui(
              "对当前筛选结果逐篇检查，以完整论文库作为参照。比较依据来自现有记录与摘要；跨源提及不等于独立验证，未找到早期工作也不代表创新。",
              "Screen the current selection against the complete paper library. Comparisons use stored records and abstracts: cross-source mentions are not independent validation, and no retrieved prior work does not establish novelty.",
            )}
          </p>
          <div className="screening-controls">
            <label>
              {ui("收录观察起点（UTC）", "Collection window start (UTC)")}
              <input type="date" value={since} max={asOf} onChange={(e) => setSince(e.target.value)} />
            </label>
            <label>
              {ui("记录截止日（UTC）", "Record cutoff (UTC)")}
              <input
                type="date"
                value={asOf}
                min={since}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <Button onClick={run} disabled={running || !validDates || !candidates.length}>
              {running ? ui("正在比对…", "Comparing…") : ui("开始比对", "Run comparison")}
            </Button>
            {running && (
              <Button
                variant="outline"
                onClick={() => {
                  worker.current?.terminate();
                  worker.current = null;
                  setRunning(false);
                }}
              >
                {ui("取消比对", "Cancel comparison")}
              </Button>
            )}
          </div>
          {!validDates && (
            <p role="alert">
              {ui("请选择有效且不晚于今天的起止日期。", "Choose valid dates in order, no later than today.")}
            </p>
          )}
          <p className="screening-note">
            {ui(
              `当前候选 ${candidates.length} 篇，参照库 ${papers.length} 条。早期工作按发表时间比较；历史截止日不会恢复旧版本内容。`,
              `${candidates.length} candidate papers; ${papers.length} reference records. Earlier work is compared by publication date; a past cutoff does not reconstruct historical versions.`,
            )}
          </p>
          <div className="screening-sources">
            <span>
              {ui("跨源资料：", "Source records: ")}GitHub{" "}
              {loaded.github ? ui("已载入", "loaded") : ui("未载入", "not loaded")} / {ui("资讯", "News")}{" "}
              {loaded.news ? ui("已载入", "loaded") : ui("未载入", "not loaded")}
            </span>
            {(!loaded.github || !loaded.news || sourcesError) && (
              <Button
                variant="outline"
                disabled={sourcesLoading}
                onClick={() => {
                  void loadSources();
                }}
              >
                {sourcesLoading ? ui("正在载入…", "Loading…") : ui("载入跨源资料", "Load source records")}
              </Button>
            )}
          </div>
          {sourcesError && (
            <p role="alert">
              {ui(
                "部分来源载入失败。可重试载入；未完成的检查不会记为无关联。",
                "Some sources could not load. Retry loading; incomplete checks are not reported as no association.",
              )}
            </p>
          )}
          {error && (
            <p role="alert">
              {ui(
                "本次比对未完成，请重试；可缩小论文筛选范围后再次运行。",
                "Comparison did not complete. Retry, or narrow the paper selection and run again.",
              )}
            </p>
          )}
          <p role="status" aria-live="polite">
            {running
              ? ui(
                  "正在检查历史、来源、早期工作与摘要论证线索。",
                  "Checking history, source links, earlier work and abstract reasoning cues.",
                )
              : results
                ? ui(
                    `已检查 ${results.length} 篇，当前显示 ${visible.length} 篇。`,
                    `${results.length} papers checked; ${visible.length} match the screening filters.`,
                  )
                : ui(
                    "调整论文条件、日期或载入新资料后，需要重新比对。",
                    "Run again after changing paper filters, dates or loaded records.",
                  )}
          </p>
          {results && (
            <>
              <div className="screening-controls screening-result-filters">
                {dimensions.map((dimension) => (
                  <label key={dimension}>
                    {t(titles[dimension])}
                    <select
                      value={filters[dimension]}
                      onChange={(e) => {
                        setFilters({ ...filters, [dimension]: e.target.value });
                        setLimit(20);
                      }}
                    >
                      <option value="all">{ui("全部", "All")}</option>
                      {Object.entries(labels[dimension]).map(([key, label]) => (
                        <option key={key} value={key}>
                          {t(label)} ({results.filter((result) => result[dimension].state === key).length})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters(emptyFilters);
                    setLimit(20);
                  }}
                >
                  {ui("重置比对筛选", "Reset screening filters")}
                </Button>
              </div>
              <p className="screening-note">
                {ui(
                  "结果按记录标识排列，不代表质量排名。以下筛选只影响比对结果，原始论文记录全部保留。",
                  "Results are ordered by record identifier, not quality. These filters affect comparison results only; original records are retained.",
                )}
              </p>
              {!visible.length && (
                <p>
                  {ui(
                    "没有匹配的比对结果。可重置比对筛选，或检查候选记录是否晚于截止日。",
                    "No matching results. Reset screening filters, or check whether candidate records fall after the cutoff.",
                  )}
                </p>
              )}
              {visible.slice(0, limit).map((result) => {
                const paper = byId.get(result.paperId);
                if (!paper) return null;
                return (
                  <article className="screening-result" key={result.paperId}>
                    <button className="screening-paper-title" onClick={() => props.onPaper(paper)}>
                      {paper.title}
                    </button>
                    <div className="screening-statuses">
                      {dimensions.map((dimension) => (
                        <span key={dimension}>
                          {t(titles[dimension])}: {t(labels[dimension][result[dimension].state])}
                        </span>
                      ))}
                    </div>
                    <details>
                      <summary>
                        {ui("查看比对依据与关联文献", "Show comparison evidence and references")}
                      </summary>
                      {dimensions.map((dimension) => (
                        <section className="screening-evidence" key={dimension}>
                          <h3>{t(titles[dimension])}</h3>
                          {result[dimension].findings.map((item) => (
                            <div key={item.id}>
                              <p>
                                <span className="screening-finding-kind">
                                  {item.status === "observed"
                                    ? ui("记录线索", "Observed cue")
                                    : item.status === "review"
                                      ? ui("待复核", "Review")
                                      : ui("证据边界", "Evidence limit")}
                                </span>
                                {t(item.message)}
                              </p>
                              {item.excerpt && <blockquote>{item.excerpt}</blockquote>}
                              {item.comparison && (
                                <div className="screening-chain">
                                  {item.comparison.map((side, index) => (
                                    <section key={index} aria-label={t(side.label)}>
                                      <h4>
                                        {t(side.label)} ({side.count})
                                      </h4>
                                      {side.excerpts.length ? (
                                        side.excerpts.map((excerpt, i) => (
                                          <blockquote key={i}>{excerpt}</blockquote>
                                        ))
                                      ) : (
                                        <p>{ui("未提取到摘要线索", "No abstract cue extracted")}</p>
                                      )}
                                    </section>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          {dimension !== "logic" &&
                            result[dimension].references.map((ref) => (
                              <p key={ref.id} className="screening-reference">
                                {byId.has(ref.id) ? (
                                  <button onClick={() => props.onPaper(byId.get(ref.id)!)}>
                                    {ref.title}
                                  </button>
                                ) : /^https?:\/\//i.test(ref.url) ? (
                                  <a href={ref.url} target="_blank" rel="noopener noreferrer">
                                    {ref.title}
                                  </a>
                                ) : (
                                  <span>{ref.title}</span>
                                )}
                                <span>{t(ref.basis)}</span>
                              </p>
                            ))}
                        </section>
                      ))}
                    </details>
                  </article>
                );
              })}
              {visible.length > limit && (
                <Button variant="outline" onClick={() => setLimit(limit + 20)}>
                  {ui("再显示 20 篇", "Show 20 more")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
