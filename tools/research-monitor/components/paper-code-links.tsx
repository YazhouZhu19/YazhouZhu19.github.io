import { useEffect, useRef, useState } from "react";
import { useI18n } from "./locale-provider";
import { Button } from "./ui/button";
import type { Paper } from "../lib/types";
import type { ResearchSignal } from "../lib/research-signals";
import type { PaperCodeResult } from "../lib/paper-code-links";
import "../styles/paper-code-links.css";

const EMPTY_PAPERS: Paper[] = [];
const EMPTY_SIGNALS: ResearchSignal[] = [];
export function PaperCodeLinks({
  papers = EMPTY_PAPERS,
  signals = EMPTY_SIGNALS,
  loadInputs,
}: {
  papers?: Paper[];
  signals?: ResearchSignal[];
  loadInputs?: () => Promise<{ papers: Paper[]; signals: ResearchSignal[] }>;
}) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [result, setResult] = useState<PaperCodeResult | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [limit, setLimit] = useState(10);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    worker.current?.terminate();
    worker.current = null;
    setResult(null);
    setRunning(false);
    setError(false);
    return () => {
      requestId.current++;
      worker.current?.terminate();
    };
  }, [papers, signals]);
  async function run() {
    const id = ++requestId.current;
    worker.current?.terminate();
    setRunning(true);
    setError(false);
    setResult(null);
    setLimit(10);
    try {
      const inputs = loadInputs ? await loadInputs() : { papers, signals };
      if (id !== requestId.current) return;
      const w = new Worker(new URL("../lib/paper-code-links-worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onmessage = (event: MessageEvent<{ result?: PaperCodeResult; error?: string }>) => {
        if (worker.current !== w) return;
        setResult(event.data.result ?? null);
        setError(!event.data.result);
        setRunning(false);
        w.terminate();
        worker.current = null;
      };
      w.onerror = (event) => {
        event.preventDefault();
        if (worker.current !== w) return;
        setError(true);
        setRunning(false);
        w.terminate();
        worker.current = null;
      };
      w.postMessage({ ...inputs, asOf: new Date().toISOString().slice(0, 10) });
    } catch {
      if (id !== requestId.current) return;
      setError(true);
      setRunning(false);
    }
  }
  const link = (url: string, title: string) =>
    /^https?:\/\//i.test(url) ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {title}
      </a>
    ) : (
      <span>{title}</span>
    );
  const rows =
    result?.links.filter((r) => {
      const status = r.explicit.length ? "explicit" : r.candidates.length ? "candidate" : "none";
      return (
        (filter === "all" || filter === status) &&
        `${r.paperTitle} ${[...r.explicit, ...r.candidates].map((c) => c.title).join(" ")}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      );
    }) ?? [];
  return (
    <details className="paper-code-links">
      <summary>{t("论文与代码关联 · TF-IDF / BM25", "Paper–code associations · TF-IDF / BM25")}</summary>
      <p>
        {t(
          "明确链接与文本候选分别展示。候选需核对，不能据此认定为官方代码，也不会提升小众方向的证据状态。",
          "Explicit links and text candidates are separate. Candidates need review: they do not establish official code or upgrade niche evidence status.",
        )}
      </p>
      <Button onClick={run} disabled={running}>
        {running ? t("正在检索…", "Retrieving…") : t("查找代码关联", "Find code associations")}
      </Button>
      {running && (
        <Button
          variant="outline"
          onClick={() => {
            requestId.current++;
            worker.current?.terminate();
            worker.current = null;
            setRunning(false);
          }}
        >
          {t("取消检索", "Cancel retrieval")}
        </Button>
      )}
      <p role="status">
        {running
          ? t(
              "正在载入检索所需资料并在本地构建词汇索引，首次运行可能需要较长时间。",
              "Loading retrieval inputs and building a local lexical index. The first run may take longer.",
            )
          : result
            ? t(
                `已分析 ${result.stats.papers} 篇论文、${result.stats.repositories} 个仓库。`,
                `Analyzed ${result.stats.papers} papers and ${result.stats.repositories} repositories.`,
              )
            : t(
                "点击后按需载入已发布资料并在本地计算，不调用模型或外部检索。",
                "Load published inputs on request and compute locally, without models or external search.",
              )}
      </p>
      {error && (
        <p role="alert">{t("关联检索失败，请重试。", "Association retrieval failed. Please retry.")}</p>
      )}
      <details>
        <summary>{t("检索口径与限制", "Retrieval method and limits")}</summary>
        <p>
          {t(
            "英文词汇检索，统一词表最多 6,000 词，每篇取权重最高的 64 个查询词。TF-IDF 余弦与 BM25（k1=1.2，b=0.75）各取前 20，经 RRF（k=60）融合后保留至多 3 个候选；至少共享两个非停用词。过滤未来日期和低相关来源。归档仓库不进入文本候选，仍可作为明确链接展示。分数是相似度，未经人工校准，不是准确率；中文内容可能漏检。",
            "English lexical retrieval uses up to 6,000 terms and 64 weighted query terms. TF-IDF cosine and BM25 (k1=1.2, b=0.75) each supply 20 results, fused by RRF (k=60) into at most 3 candidates with two shared non-stopwords. Future-dated and low-relevance sources are excluded. Archived repositories may appear as explicit links but not text candidates. Scores are uncalibrated similarity measures, not accuracy. Chinese content may be missed.",
          )}
        </p>
      </details>
      {result && (
        <>
          <div className="paper-code-stats">
            {t(
              `明确链接 ${result.stats.explicitPapers} · 仅候选 ${result.stats.candidatePapers} · 暂无关联 ${result.stats.unmatchedPapers}`,
              `Explicit links ${result.stats.explicitPapers} · Candidates only ${result.stats.candidatePapers} · No association ${result.stats.unmatchedPapers}`,
            )}
          </div>
          <div className="paper-code-controls">
            <label>
              {t("搜索论文或仓库", "Search papers or repositories")}
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(10);
                }}
              />
            </label>
            <label>
              {t("关联状态", "Association status")}
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setLimit(10);
                }}
              >
                <option value="all">{t("全部论文", "All papers")}</option>
                <option value="explicit">{t("有明确链接", "Explicit links")}</option>
                <option value="candidate">{t("仅有待核对候选", "Candidates only")}</option>
                <option value="none">{t("暂无关联证据", "No association evidence")}</option>
              </select>
            </label>
          </div>
          <p>
            {t(
              `符合条件 ${rows.length} 篇，当前显示 ${Math.min(rows.length, limit)} 篇。`,
              `${rows.length} papers match; showing ${Math.min(rows.length, limit)}.`,
            )}
          </p>
          {rows.slice(0, limit).map((row) => (
            <article key={row.paperId} className="paper-code-row">
              <h3>{link(row.paperUrl, row.paperTitle)}</h3>
              {!!row.explicit.length && (
                <div>
                  <strong>
                    {t("明确链接 · 来自标识符或原文链接", "Explicit links · identifiers or source links")}
                  </strong>
                  <ul>
                    {row.explicit.map((c) => (
                      <li key={c.id}>{link(c.url, c.title)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!row.candidates.length && (
                <details>
                  <summary>
                    {t(
                      `待核对候选（${row.candidates.length}）`,
                      `Candidates to review (${row.candidates.length})`,
                    )}
                  </summary>
                  <ul>
                    {row.candidates.map((c) => (
                      <li key={c.id}>
                        {link(c.url, c.title)}
                        <p>
                          TF-IDF {c.tfidf.toFixed(3)} · BM25 {c.bm25.toFixed(2)} · {t("排名", "Ranks")}{" "}
                          {c.rankTfidf} / {c.rankBm25}
                        </p>
                        <p>
                          {t("匹配词：", "Shared terms: ")}
                          {c.sharedTerms.join(" · ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!row.explicit.length && !row.candidates.length && (
                <p>
                  {t(
                    "当前已采集数据中未找到关联，不能据此判断没有代码。",
                    "No association found in the collected data; this does not mean no code exists.",
                  )}
                </p>
              )}
            </article>
          ))}
          {!rows.length && <p>{t("没有符合当前筛选的论文。", "No papers match these filters.")}</p>}
          {limit < rows.length && (
            <Button variant="outline" onClick={() => setLimit((n) => n + 10)}>
              {t("显示更多关联", "Show more associations")}
            </Button>
          )}
        </>
      )}
    </details>
  );
}
