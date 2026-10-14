"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { aiModelLabel, getAiSettings, runAiAnalysis, subscribeAiSettings, updateAiSettings } from "@/lib/ai-client";
import { prepareAiEvidence, type AiMode, type AiReport } from "@/lib/ai-evidence";
import { beijingDay, type DashboardDrill } from "@/lib/dashboard";
import type { Paper } from "@/lib/types";
import { useI18n } from "./locale-provider";

type AiResult = { report: AiReport; model: string; generatedAt: string };
type PanelState = {
  from: string;
  to: string;
  horizonMonths: number;
  question: string;
  result?: AiResult;
  resultKey?: string;
};
type PanelProps = {
  papers: Paper[];
  mode: AiMode;
  subjectId?: string;
  onPaper: (paper: Paper) => void;
  onDrill: (drill: DashboardDrill) => void;
};

// Retain each window while opening paper evidence. Nothing is written to browser storage.
const panelSessions = new Map<string, PanelState>();
function saveSession(key: string, state: PanelState) {
  panelSessions.delete(key);
  panelSessions.set(key, state);
  if (panelSessions.size > 64) panelSessions.delete(panelSessions.keys().next().value!);
}
function initialState(): PanelState {
  const to = beijingDay(new Date());
  const from = new Date(`${to}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 89);
  return { from: from.toISOString().slice(0, 10), to, horizonMonths: 12, question: "" };
}

export function AiModelSettings() {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const settings = useSyncExternalStore(subscribeAiSettings, getAiSettings, getAiSettings);
  const fieldId = useId();
  return <section className="ai-model-settings" aria-label={t("AI 模型设置", "AI model settings")}>
    <div className="ai-model-heading">
      <div><span className="ai-eyebrow">{t("分析模型", "ANALYSIS MODEL")}</span><strong>{aiModelLabel(settings)}</strong></div>
      <span className="ai-model-badge">{settings.provider === "local" ? t("访客可直接使用", "Available to visitors") : settings.paid ? t("个人 API · 可能收费", "Personal API · may incur charges") : t("个人 API · 免费路由", "Personal API · free route")}</span>
    </div>
    <div className="ai-model-controls">
      <div className="ai-field"><label htmlFor={`${fieldId}-provider`}>{t("使用方式", "Run with")}</label><select id={`${fieldId}-provider`} value={settings.provider} onChange={event => updateAiSettings({ provider: event.target.value as "local" | "openrouter" })}>
        <option value="local">{t("免费本地模型 · 无需密钥", "Free local model · no key")}</option>
        <option value="openrouter">{t("个人 OpenRouter API", "Personal OpenRouter API")}</option>
      </select></div>
      <p className="ai-model-description">{settings.provider === "local"
        ? t("Qwen3-1.7B 在浏览器内运行，论文和问题留在本机。点击分析后才会下载模型；首次约 1 GB，后续使用浏览器缓存。需要支持 WebGPU 的浏览器；建议使用桌面设备，预留数 GB GPU 内存。免费轻量模型适合初步梳理，可能误读论文，请核对引用原文。", "Qwen3-1.7B runs in your browser; papers and questions remain on your device. The first analysis downloads about 1 GB, then uses the browser cache. Requires a WebGPU browser; a desktop device with several GB of available GPU memory is recommended. This free, small model is suitable for initial exploration and may misread papers; check the cited source text.")
        : t("使用你自己的密钥。分析时会将本次抽取的公开论文标题、摘要和问题发送给 OpenRouter 及其模型服务商；不会发送个人名单。密钥只在当前页面内存中保留，刷新后清除。", "Use your own key. Analysis sends the sampled public paper titles, abstracts, and your question to OpenRouter and its model provider; personal watchlists are not sent. The key stays in page memory and is cleared on refresh.")}</p>
    </div>
    <p className="ai-model-links"><span>{t("资料核对：2026-10-14", "Sources checked: 2026-10-14")}</span><a href="https://huggingface.co/Qwen/Qwen3-1.7B" target="_blank" rel="noreferrer">{t("模型说明", "Model card")} ↗</a><a href="https://openrouter.ai/docs/api-reference/limits" target="_blank" rel="noreferrer">{t("API 额度", "API limits")} ↗</a>{settings.provider === "openrouter" && <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">{t("获取个人 API Key", "Get a personal API key")} ↗</a>}</p>
    {settings.provider === "openrouter" && <div className="ai-api-settings">
      <div className="ai-field"><label htmlFor={`${fieldId}-key`}>{t("OpenRouter API key", "OpenRouter API key")}</label><div className="ai-secret-row"><input id={`${fieldId}-key`} type="password" autoComplete="off" spellCheck={false} value={settings.apiKey} placeholder="sk-or-…" onChange={event => updateAiSettings({ apiKey: event.target.value })} /><button type="button" className="foresight-button" disabled={!settings.apiKey} onClick={() => updateAiSettings({ apiKey: "" })}>{t("清除密钥", "Clear key")}</button></div></div>
      <div className="ai-field"><label htmlFor={`${fieldId}-route`}>{t("模型费用", "Model pricing")}</label><select id={`${fieldId}-route`} value={settings.paid ? "paid" : "free"} onChange={event => updateAiSettings({ paid: event.target.value === "paid", model: event.target.value === "paid" ? "" : "openrouter/free" })}><option value="free">{t("免费路由 · openrouter/free", "Free route · openrouter/free")}</option><option value="paid">{t("指定模型 · 允许 API 计费", "Choose model · allow API charges")}</option></select></div>
      {settings.paid && <div className="ai-field ai-field-full"><label htmlFor={`${fieldId}-model`}>{t("模型 ID", "Model ID")}</label><input id={`${fieldId}-model`} value={settings.model} onChange={event => updateAiSettings({ model: event.target.value })} placeholder={t("输入 OpenRouter 模型 ID", "Enter an OpenRouter model ID")} spellCheck={false} /><p className="ai-help">{t("费用由你选择的模型和账户决定，仅在点击分析时调用。", "Charges depend on your model and account; requests run only when you click Analyze.")}</p></div>}
      {!settings.paid && <p className="ai-help ai-field-full">{t("免费路由有配额和可用性限制，实际模型会显示在结果中；请求失败时不会自动切换付费模型。", "The free route has quota and availability limits. Results name the actual model; failures never switch automatically to a paid model.")}</p>}
    </div>}
  </section>;
}

export function AiResearchPanel(props: PanelProps) {
  return <AiResearchScope key={`${props.mode}:${props.subjectId ?? "all"}`} {...props} />;
}

function AiResearchScope({ papers, mode, subjectId, onPaper, onDrill }: PanelProps) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const settings = useSyncExternalStore(subscribeAiSettings, getAiSettings, getAiSettings);
  const sessionKey = `${mode}:${subjectId ?? "all"}`;
  const [state, setState] = useState<PanelState>(() => panelSessions.get(sessionKey) ?? initialState());
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const request = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const fieldId = useId();
  const today = beijingDay(new Date());
  const title = mode === "landscape" ? t("库内主流探索", "Explore the research landscape") : mode === "interest" ? t("自定义研究兴趣", "Explore your own research question") : t("PI / 团队 AI 研判", "PI / team AI assessment");
  const description = mode === "landscape"
    ? t("由 AI 从所选时间内的论文样本归纳研究方向、任务、技术路线和数据应用，再提出可验证的趋势判断。", "Let AI identify directions, tasks, methods, and data applications in a sample from your date range, then propose trends to test.")
    : mode === "interest"
      ? t("输入自己的问题，独立设置时间范围。AI 会评估与问题相关的证据、潜在路线与待核实的研究机会，兴趣无需属于热门方向。", "Ask your own question and set an independent date range. AI will assess relevant evidence, possible approaches, and research opportunities to verify, including interests outside popular topics.")
      : t("基于所选作者或团队的公开论文，分析研究重心、技术路线、数据应用及后续可能走向。", "Use the selected author or team's public papers to assess research focus, methods, data applications, and possible next directions.");
  const prepared = useMemo(() => {
    if (!state.from || !state.to) return { evidence: null, validation: t("请填写完整的论文日期范围。", "Enter both publication dates.") };
    if (state.from > state.to) return { evidence: null, validation: t("起始日期不能晚于截止日期。", "The start date must not follow the end date.") };
    if (state.to > today) return { evidence: null, validation: t("截止日期不能晚于今天。", "The end date cannot be in the future.") };
    try {
      return { evidence: prepareAiEvidence(papers, { mode, from: state.from, to: state.to, horizonMonths: state.horizonMonths, question: mode === "landscape" ? "" : state.question, locale, subjectId }, settings.provider === "local" ? 24 : 80), validation: "" };
    } catch {
      return { evidence: null, validation: t("请检查日期范围与研究问题，然后重试。", "Check the date range and research question, then retry.") };
    }
  }, [papers, mode, state.from, state.to, state.horizonMonths, state.question, locale, subjectId, settings.provider, today]);
  const evidence = prepared.evidence;
  const resultKey = JSON.stringify([evidence?.key, settings.provider, settings.model, settings.paid, locale]);
  const result = state.resultKey === resultKey ? state.result : undefined;
  const paperMap = useMemo(() => new Map((evidence?.papers ?? []).map(paper => [paper.id, paper])), [evidence]);
  const needsQuestion = mode === "interest" && !state.question.trim();
  const needsKey = settings.provider === "openrouter" && !settings.apiKey.trim();
  const needsModel = settings.provider === "openrouter" && settings.paid && !settings.model.trim();

  useEffect(() => { saveSession(sessionKey, state); }, [sessionKey, state]);
  useEffect(() => {
    request.current.controller?.abort();
    request.current.id += 1;
    setPending(false);
    setProgress("");
    setError("");
    return () => {
      request.current.controller?.abort();
      request.current.id += 1;
    };
  }, [evidence?.key, settings]);

  const update = (changes: Partial<PanelState>) => {
    request.current.controller?.abort();
    request.current.id += 1;
    setPending(false);
    setProgress("");
    setError("");
    setState(current => ({ ...current, ...changes, result: undefined, resultKey: undefined }));
  };
  const cancel = () => {
    request.current.controller?.abort();
    request.current.id += 1;
    setPending(false);
    setProgress(t("本次分析已取消。", "Analysis canceled."));
  };
  const analyze = async () => {
    if (!evidence || !evidence.papers.length || pending || needsKey || needsModel) return;
    request.current.controller?.abort();
    const controller = new AbortController();
    const id = request.current.id + 1;
    request.current = { id, controller };
    setPending(true);
    setError("");
    setProgress(t("正在准备论文证据…", "Preparing paper evidence…"));
    setState(current => ({ ...current, result: undefined, resultKey: undefined }));
    try {
      const next = await runAiAnalysis(evidence, settings, {
        signal: controller.signal,
        onProgress: message => { if (request.current.id === id) setProgress(message); },
      });
      if (controller.signal.aborted || request.current.id !== id) return;
      setState(current => ({ ...current, result: next, resultKey }));
      setProgress("");
    } catch (cause) {
      if (controller.signal.aborted || request.current.id !== id) return;
      setError(cause instanceof Error ? cause.message : t("AI 分析失败，请重试。", "AI analysis failed. Try again."));
      setProgress("");
    } finally {
      if (request.current.id === id) setPending(false);
    }
  };

  return <section className={`ai-research-panel ai-research-panel-${mode}`} aria-labelledby={`${fieldId}-title`}>
    <header className="ai-panel-header"><div><span className="ai-eyebrow">{mode === "landscape" ? "01 / LANDSCAPE" : mode === "interest" ? "02 / YOUR QUESTION" : "AI / PUBLIC EVIDENCE"}</span><h2 id={`${fieldId}-title`}>{title}</h2><p>{description}</p></div></header>
    <form className="ai-analysis-form" onSubmit={event => { event.preventDefault(); void analyze(); }}>
      {mode !== "landscape" && <div className="ai-field ai-field-full"><label htmlFor={`${fieldId}-question`}>{mode === "interest" ? t("你的研究问题", "Your research question") : t("希望重点了解的问题（可选）", "A question to focus on (optional)")}</label><textarea id={`${fieldId}-question`} value={state.question} onChange={event => update({ question: event.target.value })} maxLength={2000} rows={mode === "interest" ? 3 : 2} placeholder={mode === "interest" ? t("例如：在低标注、跨医院的数据条件下，心脏影像分析还有哪些值得验证的技术路线？", "For example: Which approaches are worth testing for cardiac imaging with limited labels across hospitals?") : t("例如：这个团队未来可能使用哪些数据和验证策略？", "For example: What data and validation strategies might this team pursue?")} /><p className="ai-help">{t("可用中文或英文自然提问；不按输入词做硬性筛选。", "Ask naturally in Chinese or English; your words are not used as strict keyword filters.")}</p></div>}
      <div className="ai-field"><label htmlFor={`${fieldId}-from`}>{t("论文起始日期", "Papers published from")}</label><input id={`${fieldId}-from`} type="date" value={state.from} max={state.to || today} required onChange={event => update({ from: event.target.value })} /></div>
      <div className="ai-field"><label htmlFor={`${fieldId}-to`}>{t("论文截止日期", "Papers published through")}</label><input id={`${fieldId}-to`} type="date" value={state.to} min={state.from} max={today} required onChange={event => update({ to: event.target.value })} /></div>
      <div className="ai-field ai-horizon"><label htmlFor={`${fieldId}-horizon`}>{t("预测未来", "Look ahead")}</label><select id={`${fieldId}-horizon`} value={state.horizonMonths} onChange={event => update({ horizonMonths: Number(event.target.value) })}>{[6, 12, 24].map(months => <option key={months} value={months}>{t(`${months} 个月`, `${months} months`)}</option>)}</select><p className="ai-help">{t("从所选论文截止日期起计算。", "Measured from the selected publication end date.")}</p></div>
      <div className="ai-analysis-scope ai-field-full">
        {evidence ? <><p><strong>{evidence.totalWorks.toLocaleString(locale)}</strong> {t("项去重研究", "distinct works")}<span>·</span>{t(`本次抽取 ${evidence.papers.length} 项`, `${evidence.papers.length} sampled for analysis`)}<span>·</span>{t(`${evidence.totalRecords} 条库内记录`, `${evidence.totalRecords} library records`)}</p><p className="ai-help">{t("按发表时间与来源分层抽样；结论仅适用于展示的证据，不能据此估计全领域占比。", "Sampling is balanced across publication time and source. Conclusions apply to this evidence and do not establish field-wide shares.")}{evidence.missingAbstracts > 0 && ` ${t(`范围内 ${evidence.missingAbstracts} 项缺少摘要。`, `${evidence.missingAbstracts} works in scope lack abstracts.`)}`}</p>{!!evidence.papers.length && <button type="button" className="foresight-text-button" onClick={() => onDrill({ label: `${title} · ${state.from} — ${state.to}`, ids: evidence.papers.map(paper => paper.id) })}>{t("查看将用于分析的论文", "Inspect the papers used for analysis")} ↗</button>}</>
          : <p className="ai-help">{needsQuestion ? t("填写研究问题后，将显示该时间范围的论文样本。", "Enter a research question to see the paper sample for this date range.") : prepared.validation}</p>}
      </div>
      <div className="ai-analysis-actions ai-field-full"><button type="submit" className="foresight-button foresight-button-primary" disabled={pending || !evidence?.papers.length || needsKey || needsModel}>{pending ? t("AI 分析中…", "Analyzing…") : result ? t("重新分析", "Analyze again") : settings.provider === "local" ? t("免费 AI 分析", "Analyze with free AI") : settings.paid ? t("使用付费 API 分析", "Analyze with paid API") : t("使用免费 API 分析", "Analyze with free API")}</button>{pending && <button type="button" className="foresight-button" onClick={cancel}>{t("取消", "Cancel")}</button>}<p className="ai-help">{needsKey ? t("请先填写上方的个人 API key。", "Enter your personal API key above.") : needsModel ? t("请先填写需要调用的模型 ID。", "Enter the model ID to call above.") : settings.provider === "local" ? t("首次点击将下载约 1 GB 模型；运行时间取决于设备。", "The first click downloads about 1 GB; runtime depends on your device.") : t("仅将本次样本与问题发送给模型。", "Only this sample and question are sent to the model.")}</p></div>
    </form>
    {(pending || progress) && <div className="ai-progress" role="status" aria-live="polite">{pending && <span className="ai-progress-dot" aria-hidden="true" />}{progress}</div>}
    {error && <div className="ai-error" role="alert"><strong>{t("本次分析未完成", "Analysis did not complete")}</strong><p>{error}</p><p>{t("可以调整模型或范围后重试。当前没有生成可用的 AI 结论。", "Adjust the model or scope and retry. No usable AI assessment was generated.")}</p></div>}
    {!pending && !error && evidence && !evidence.papers.length && <div className="ai-empty" role="status">{t("该时间范围没有可用论文。扩大日期范围后再分析；空结果不代表这个问题没有研究。", "No usable papers were found in this date range. Expand the dates; an empty result does not mean the question is unstudied.")}</div>}
    {result && evidence && <div className="ai-result">
      <div className="ai-result-meta"><span>{t("实际模型", "Actual model")}: <strong>{result.model}</strong></span><time dateTime={result.generatedAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(result.generatedAt))} (UTC+8)</time></div>
      <p className="ai-result-summary">{result.report.summary}</p>
      <p className="ai-help ai-result-boundary">{t(`基于 ${evidence.totalWorks} 项库内研究中抽取的 ${evidence.papers.length} 项证据。以下预测是待验证的条件推断。引用可追溯不代表结论已被验证。`, `Based on ${evidence.papers.length} sampled works out of ${evidence.totalWorks} in this library scope. Forecasts below are conditional inferences to test. Traceable citations do not mean the conclusions have been validated.`)}</p>
      <div className="ai-finding-list">{result.report.findings.map((finding, index) => {
        const supporting = [...new Set(finding.paperIds)].map(id => paperMap.get(id)).filter((paper): paper is Paper => !!paper);
        const kind = { direction: t("研究方向", "Direction"), task: t("任务", "Task"), method: t("技术路线", "Method"), data: t("数据", "Data"), application: t("应用", "Application"), opportunity: t("研究机会", "Opportunity") }[finding.kind];
        return <article className="ai-finding" key={`${index}:${finding.title}`}><div className="ai-finding-heading"><span>{String(index + 1).padStart(2, "0")} / {kind}</span><h3>{finding.title}</h3></div><dl className="ai-reasoning"><div><dt>{t("证据观察", "Observed evidence")}</dt><dd>{finding.observation}</dd></div><div><dt>{t("条件预测", "Conditional forecast")}</dt><dd>{finding.forecast}</dd></div><div><dt>{t("其他解释", "Alternative explanation")}</dt><dd>{finding.alternative}</dd></div><div><dt>{t("下一步验证", "Next step to test")}</dt><dd>{finding.nextStep}</dd></div></dl><details className="ai-finding-evidence"><summary>{t(`查看 ${supporting.length} 项引用证据`, `Inspect ${supporting.length} cited works`)}</summary><ol>{supporting.slice(0, 3).map(paper => <li key={paper.id}><button type="button" onClick={() => onPaper(paper)}>{paper.title}</button><p>{paper.publishedAt.slice(0, 10)} · {paper.venue || paper.source}</p></li>)}</ol>{supporting.length > 0 && <button type="button" className="foresight-text-button" onClick={() => onDrill({ label: finding.title, ids: supporting.map(paper => paper.id) })}>{t("打开全部引用论文", "Open all cited papers")} ↗</button>}</details></article>;
      })}</div>
      {!!result.report.limitations.length && <div className="ai-limitations"><h3>{t("本次分析的边界", "Limits of this analysis")}</h3><ul>{result.report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    </div>}
  </section>;
}
