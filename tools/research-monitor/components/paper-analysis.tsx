"use client";
import { useMemo } from "react";
import { ScanText } from "lucide-react";
import { buildPaperAnalysis } from "@/lib/analysis";
import type { Paper } from "@/lib/types";
import { useI18n } from "./locale-provider";
import "@/styles/paper-analysis.css";

export function PaperPreliminaryAnalysis({ paper }: { paper: Paper }) {
  const { tr } = useI18n();
  const analysis = useMemo(() => buildPaperAnalysis(paper), [paper]);
  const sections = [
    { label: "研究目标摘录", text: analysis.objective },
    { label: "研究方法摘录", text: analysis.methods },
    { label: "研究结果摘录", text: analysis.results },
  ];
  return <section className="paper-preliminary" aria-label={tr("单篇论文初步分析")}>
    <div className="paper-preliminary-heading"><ScanText size={19}/><h3>{tr("论文速读")}</h3><span>{tr("摘要原文 · 规则提取")}</span></div>
    <p className="paper-preliminary-note">{tr("以下摘录用于初步阅读，不是对全文的总结或质量评价；未识别的内容不代表研究没有报告。")}</p>
    {!analysis.hasAbstract ? <p className="paper-preliminary-missing">{tr("来源未提供摘要，暂时无法提取速读内容。")}</p> : <dl className="paper-extracts">{sections.map(section => <div key={section.label}><dt>{tr(section.label)}</dt><dd className={section.text ? undefined : "paper-preliminary-missing"}>{section.text || tr("未识别到明确表述，请查看完整摘要。")}</dd></div>)}</dl>}
    <h4>{tr("可复核的验证与开放资源线索")}</h4>
    {analysis.signals.length ? <div className="paper-signal-evidence">{analysis.signals.map(signal => <div key={signal.id}><strong>{tr(signal.label)}</strong><blockquote>{signal.excerpt}</blockquote></div>)}</div> : <p className="paper-preliminary-missing">{tr("未检出明确线索。请在全文中核对验证设计、代码和数据可用性。")}</p>}
  </section>;
}
