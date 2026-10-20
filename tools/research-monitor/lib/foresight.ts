import { buildPaperAnalysis, type EvidenceSignalId, type PaperAnalysis } from "./analysis";
import { normalizeDoi, normalizedName, textOnly } from "./classify";
import { beijingDay, matchesTeam } from "./dashboard";
import type { Paper } from "./types";
import { publicationDateStatus, strictPublicationDay } from "./publication-date";
import type {
  Bilingual,
  ForesightCard,
  ForesightDimension,
  ForesightEvidence,
  ForesightOptions,
  ForesightResult,
} from "./foresight-types";

const DAY = 86400000;
const MIN_WORKS = 3;
const MIN_COMPARISON = 10;
const MAX_WINDOW_SIZE_RATIO = 3;
const MAX_SOURCE_VARIATION = 0.25;
const bi = (zh: string, en: string): Bilingual => ({ zh, en });
const dimensions: Record<ForesightDimension, Bilingual> = {
  method: bi("方法路线", "Methods"),
  data: bi("数据与标注", "Data and annotation"),
  validation: bi("验证设计", "Validation"),
  application: bi("应用目标", "Applications"),
  opportunity: bi("可检验机会", "Testable opportunities"),
  output: bi("可复现产出", "Reproducible outputs"),
};
type Work = { paper: Paper; day: string; text: string; abstract: string; analysis: PaperAnalysis };
type Candidate = {
  id: string;
  dimension: ForesightDimension;
  label: Bilingual;
  title: Bilingual;
  match: (work: Work) => ForesightEvidence | null;
  observation: Bilingual;
  scenario: Bilingual;
  action: Bilingual;
  watch: Bilingual;
  alternative: Bilingual;
  abstractOnly?: boolean;
};

export const publicationDay = strictPublicationDay;
function offset(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function doi(value: unknown): string | null {
  const normalized = normalizeDoi(value);
  return normalized && /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : null;
}
function arxiv(value: unknown): string | null {
  const id = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .toLowerCase();
  return /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/.test(id) ? id : null;
}
function identityKeys(paper: Paper): string[] {
  const keys = paper.id ? [`id:${paper.id}`] : [];
  for (const value of [paper.doi, paper.relatedDoi]) {
    const id = doi(value);
    if (id) keys.push(`doi:${id}`);
  }
  if (/^\d+$/.test(paper.pmid ?? "")) keys.push(`pmid:${paper.pmid}`);
  const arxivId = arxiv(paper.arxivId);
  if (arxivId) keys.push(`arxiv:${arxivId}`);
  const nativeId = paper.id.match(/^(?:pubmed:|pmid:|(?:europepmc|epmc):(?:med:)?)\s*(\d+)$/i);
  if (nativeId) keys.push(`pmid:${nativeId[1]}`);
  if (/^arxiv:/i.test(paper.id)) {
    const id = arxiv(paper.id);
    if (id) keys.push(`arxiv:${id}`);
  }
  for (const entry of paper.provenance ?? []) {
    const id = entry.sourceRecordId?.trim();
    if (!id) continue;
    if (/^(?:Europe PMC|PubMed)$/i.test(paper.source) && /^(?:MED:)?\d+$/i.test(id))
      keys.push(`pmid:${id.replace(/^MED:/i, "")}`);
    else if (/^arxiv$/i.test(paper.source)) {
      const native = arxiv(id);
      if (native) keys.push(`arxiv:${native}`);
    } else keys.push(`native:${paper.source.toLowerCase()}:${id.toLowerCase()}`);
  }
  return keys;
}

// Union-find handles preprint -> article -> correction/version chains without quadratic pair matching.
export function groupWorks(papers: Paper[]): Paper[][] {
  const parent = papers.map((_, index) => index),
    sizes = papers.map(() => 1),
    keys = new Map<string, number>();
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  papers.forEach((paper, index) => {
    for (const key of identityKeys(paper)) {
      const previous = keys.get(key);
      if (previous === undefined) {
        keys.set(key, index);
        continue;
      }
      let a = root(index),
        b = root(previous);
      if (a === b) continue;
      if (sizes[a] < sizes[b]) [a, b] = [b, a];
      parent[b] = a;
      sizes[a] += sizes[b];
    }
  });
  const groups = new Map<number, Paper[]>();
  papers.forEach((paper, index) => {
    const key = root(index),
      group = groups.get(key) ?? [];
    group.push(paper);
    groups.set(key, group);
  });
  return [...groups.values()];
}

/** Stable content digest, not a security identifier. It deliberately ignores collection timestamps. */
function digest(value: string): string {
  let a = 2166136261,
    b = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b, 33) ^ code;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
function snippet(text: string, pattern: RegExp): string {
  const index = text.search(pattern);
  if (index < 0) return "";
  const start = Math.max(0, index - 65),
    end = Math.min(text.length, index + 220);
  // Keep an exact substring, so readers can locate it in the source; do not synthesize a summary.
  return text.slice(start, end).trim();
}
function tag(pattern: RegExp): Candidate["match"] {
  return (work) => {
    const excerpt = snippet(work.text, pattern);
    return excerpt ? { paperId: work.paper.id, excerpt, kind: "tag" } : null;
  };
}
const keywordAlternative = bi(
  "词语共现可能来自相关工作、综述或共同的方法谱系；也可能受检索范围与索引时延影响，不能据此认定有效性或独立复现。",
  "Co-occurrence may reflect related work, reviews or a shared method lineage. Retrieval coverage and indexing delays can also change it; it does not establish effectiveness or independent replication.",
);
function keywordCandidate(
  id: string,
  dimension: ForesightDimension,
  label: Bilingual,
  pattern: RegExp,
  scenario: Bilingual,
  action: Bilingual,
  watch: Bilingual,
): Candidate {
  return {
    id,
    dimension,
    label,
    title: bi(`${label.zh}：下一步值得检验什么`, `${label.en}: a question to test next`),
    match: tag(pattern),
    observation: bi(
      `标题或摘要出现“${label.zh}”相关关键词；这只是主题线索，不确认论文采用了该方法或取得了改进。`,
      `Titles or abstracts contain keywords associated with ${label.en.toLowerCase()}; these are topic clues, not confirmation of use or improvement.`,
    ),
    scenario,
    action,
    watch,
    alternative: keywordAlternative,
  };
}

const methodCandidates: Candidate[] = [
  keywordCandidate(
    "foundation",
    "method",
    bi("基础模型适配", "Foundation model adaptation"),
    /foundation model|segment anything|\bmedsam\b|\bsam[- ]?med|universal (?:medical )?segmentation model/i,
    bi(
      "若后续工作在相同数据划分下持续报告可迁移性，基础模型适配可成为与专用模型比较的候选路线",
      "if later studies continue to document transfer under comparable data splits, foundation model adaptation could be a candidate to compare with task-specific models",
    ),
    bi(
      "固定数据与标注预算，比较冻结特征、轻量适配和专用模型；保留未参与适配的设备或解剖部位测试集。",
      "Hold data and annotation budgets fixed; compare frozen features, lightweight adaptation and a task-specific model on held-out devices or anatomy.",
    ),
    bi(
      "观察是否报告预训练重叠、适配成本、域外失效与可重复基线。",
      "Watch for pretraining overlap, adaptation cost, out-of-domain failures and reproducible baselines.",
    ),
  ),
  keywordCandidate(
    "generative",
    "method",
    bi("生成式影像方法", "Generative imaging methods"),
    /diffusion (?:model|probabilistic|transformer)|denoising diffusion|\bgenerative\b|\bGAN\b/i,
    bi(
      "若后续证据同时支持图像保真和下游任务稳定性，生成式方法可进入任务约束下的比较",
      "if later evidence supports both image fidelity and downstream stability, generative methods could enter task-constrained comparisons",
    ),
    bi(
      "在固定基线下增加病灶保留、伪影和定量测量检查，并测试下游任务；不要仅凭视觉效果或单一图像指标判断。",
      "Alongside a fixed baseline, test lesion preservation, artifacts, quantitative measurements and downstream tasks instead of relying on visual appearance or one image metric.",
    ),
    bi(
      "观察病灶幻觉、测量偏移、失败病例与跨设备验证是否有直接证据。",
      "Watch for direct evidence on hallucinated lesions, measurement bias, failures and cross-device tests.",
    ),
  ),
  keywordCandidate(
    "domain",
    "method",
    bi("域适应与泛化", "Domain adaptation and generalization"),
    /domain adapt|domain general|out.of.distribution|cross.domain/i,
    bi(
      "若独立保留的目标域上仍有稳定表现，域泛化策略可成为部署前比较的一条路线",
      "if performance remains stable on independently held-out target domains, generalization strategies could become a route to compare before deployment",
    ),
    bi(
      "锁定训练策略与调参集，按中心或设备保留测试集，并与无适配基线比较校准和最差子组表现。",
      "Lock training and tuning sets, hold out centers or devices, and compare calibration and worst-subgroup performance with a no-adaptation baseline.",
    ),
    bi(
      "观察目标域是否用于调参、样本是否重叠以及退化情况是否被报告。",
      "Watch for target-domain tuning, overlapping samples and reported degradation.",
    ),
  ),
  keywordCandidate(
    "multimodal",
    "method",
    bi("多模态表征", "Multimodal representations"),
    /multi.modal|vision.language|image.text/i,
    bi(
      "若跨模态对照能排除单模态捷径，多模态表征可进入缺失输入条件下的比较",
      "if cross-modal controls rule out unimodal shortcuts, multimodal representations could be compared under missing-input conditions",
    ),
    bi(
      "设置单模态、融合和缺失模态对照，检查患者级配对、信息泄漏与校准。",
      "Compare unimodal, fused and missing-modality conditions; check patient-level pairing, leakage and calibration.",
    ),
    bi(
      "观察新增信息是否来自临床可获得的输入，以及配对规则与缺失率是否公开。",
      "Watch whether added information comes from clinically available inputs and whether pairing and missingness are documented.",
    ),
  ),
  keywordCandidate(
    "federated",
    "method",
    bi("联邦学习", "Federated learning"),
    /federated learn|federated training/i,
    bi(
      "若真实跨中心设置下通信与性能权衡可复现，联邦训练可成为数据协作方案的候选",
      "if communication and performance trade-offs reproduce across real centers, federated training could be a candidate for data collaboration",
    ),
    bi(
      "区分模拟分区和真实中心，固定总样本量，比较本地训练与联邦训练的中心间差异及通信成本。",
      "Separate simulated partitions from real centers; fix total sample size and compare local and federated training across centers and communication costs.",
    ),
    bi(
      "观察隐私假设、客户端异质性、真实中心验证与通信成本。",
      "Watch privacy assumptions, client heterogeneity, real-center validation and communication costs.",
    ),
  ),
];
const dataCandidates: Candidate[] = [
  keywordCandidate(
    "label-efficient",
    "data",
    bi("有限标注学习", "Learning with limited labels"),
    /weakly.supervis|semi.supervis|few.shot|limited (?:label|annotat)|annotation budget/i,
    bi(
      "若按相同标注成本比较仍有收益，有限标注方案可成为降低数据准备负担的候选",
      "if gains remain under matched annotation cost, limited-label approaches could be candidates to reduce data preparation burden",
    ),
    bi(
      "用统一数据划分绘制标注预算—性能曲线，计入专家时间，并核查伪标签和预训练数据是否引入额外信息。",
      "Use a shared split to plot annotation budget against performance, include expert time, and audit extra information from pseudo-labels and pretraining.",
    ),
    bi(
      "观察标注成本定义、稀有病例、伪标签错误和预算匹配基线。",
      "Watch annotation-cost definitions, rare cases, pseudo-label errors and budget-matched baselines.",
    ),
  ),
  keywordCandidate(
    "self-supervised",
    "data",
    bi("自监督数据利用", "Self-supervised data use"),
    /self.supervis|contrastive learn/i,
    bi(
      "若未标注数据的增益能与数据规模效应区分，自监督预训练可成为标注预算实验的候选",
      "if gains from unlabeled data can be separated from scale effects, self-supervised pretraining could be a candidate for annotation-budget experiments",
    ),
    bi(
      "固定标注预算，比较随机初始化、通用预训练和领域自监督；检查预训练与测试患者是否重叠。",
      "Fix the label budget; compare random initialization, general pretraining and domain self-supervision, checking for patient overlap with test data.",
    ),
    bi(
      "观察预训练数据来源、患者级去重、增广假设和不同标注预算结果。",
      "Watch pretraining sources, patient-level deduplication, augmentation assumptions and results across label budgets.",
    ),
  ),
  keywordCandidate(
    "cross-modal-data",
    "data",
    bi("跨模态与不完整配对", "Cross-modal and incomplete pairing"),
    /unpaired|incompletely paired|missing modalit|cross.modal|multi.contrast/i,
    bi(
      "若对配对质量和缺失机制的压力测试仍稳定，跨模态设计可成为处理不完整输入的候选",
      "if stress tests of pairing quality and missingness remain stable, cross-modal designs could be candidates for incomplete inputs",
    ),
    bi(
      "区分配对、非配对和缺失模态设置，记录患者级配对规则；分别测试随机缺失与临床选择造成的缺失。",
      "Separate paired, unpaired and missing-modality settings, document patient-level pairing, and test random versus clinically selected missingness.",
    ),
    bi(
      "观察模态组合、配对数量、缺失机制和可获得输入是否明确。",
      "Watch whether modality combinations, pairing counts, missingness and available inputs are specified.",
    ),
  ),
];
const signalDefinitions: {
  id: EvidenceSignalId;
  label: Bilingual;
  scenario: Bilingual;
  action: Bilingual;
  watch: Bilingual;
}[] = [
  {
    id: "external_validation",
    label: bi("外部验证", "External validation"),
    scenario: bi(
      "若外部数据隔离和失败分析可核验，跨域稳健性可成为下一轮方法比较的重要条件",
      "if external data separation and failure analyses can be verified, cross-domain robustness could become a useful condition for the next comparison",
    ),
    action: bi(
      "核对外部队列是否参与训练或调参，固定测试集后比较性能、校准和最差子组。",
      "Verify that external cohorts were excluded from training and tuning, then compare performance, calibration and worst-subgroup behavior on a locked test set.",
    ),
    watch: bi(
      "观察外部队列来源、样本重叠、预设终点与性能退化。",
      "Watch external cohort provenance, sample overlap, prespecified endpoints and degradation.",
    ),
  },
  {
    id: "clinician_evaluation",
    label: bi("临床人员评估", "Clinician evaluation"),
    scenario: bi(
      "若读片流程与参与者差异得到控制，人机协作评价可进入方法比较设计",
      "if reading workflows and participant differences are controlled, human-AI evaluation could enter method comparisons",
    ),
    action: bi(
      "设计同一任务下有／无辅助对照，预先定义正确率、耗时和错误类型，并考虑顺序效应。",
      "Design assisted versus unassisted comparisons on the same task, prespecify accuracy, time and error types, and account for order effects.",
    ),
    watch: bi(
      "观察读片者数量、经验、随机化、洗脱期和临床任务是否报告。",
      "Watch reader counts, experience, randomization, washout periods and clinical tasks.",
    ),
  },
  {
    id: "prospective",
    label: bi("前瞻性研究", "Prospective studies"),
    scenario: bi(
      "若真实流程中的前瞻性终点得到重复验证，可进一步检验方法的实际工作流价值",
      "if prospective endpoints reproduce in real workflows, practical workflow value could be tested further",
    ),
    action: bi(
      "先核查注册和终点，再在可行范围内预设数据收集、失败记录与流程指标，避免追溯性挑选结果。",
      "Check registration and endpoints, then prespecify feasible data collection, failure logging and workflow measures rather than selecting outcomes retrospectively.",
    ),
    watch: bi(
      "观察注册时间、入组流程、失访、终点和真实干预。",
      "Watch registration timing, enrollment, loss to follow-up, endpoints and actual interventions.",
    ),
  },
  {
    id: "multicentre",
    label: bi("多中心研究", "Multicenter studies"),
    scenario: bi(
      "若中心间差异被明确评估，多中心设计可帮助检验方法对实际数据异质性的敏感程度",
      "if between-center differences are explicitly evaluated, multicenter designs could test sensitivity to real data heterogeneity",
    ),
    action: bi(
      "核查中心是否仅混合后随机划分，优先设计留一中心测试并报告各中心性能与不确定性。",
      "Check whether centers were pooled before random splitting; prefer leave-one-center-out tests and report center-level performance and uncertainty.",
    ),
    watch: bi(
      "观察中心级划分、设备差异、中心样本量与独立外部队列。",
      "Watch center-level splits, device differences, center sample sizes and independent external cohorts.",
    ),
  },
  {
    id: "code_availability",
    label: bi("代码开放声明", "Code availability statements"),
    scenario: bi(
      "若代码链接、依赖和权重可核验，开放实现可作为建立可复现比较基线的入口",
      "if code links, dependencies and weights can be verified, open implementations could be starting points for reproducible comparisons",
    ),
    action: bi(
      "先核查链接、许可证、权重和运行说明，再固定版本复现一个基线；摘要声明不等于已成功运行。",
      "Check links, licenses, weights and instructions, then pin a version and reproduce one baseline; an abstract statement does not establish a working implementation.",
    ),
    watch: bi(
      "观察版本固定、环境、模型权重、数据许可和复现结果。",
      "Watch pinned versions, environments, weights, data permissions and reproduction results.",
    ),
  },
  {
    id: "data_availability",
    label: bi("数据开放声明", "Data availability statements"),
    scenario: bi(
      "若许可、划分和采集条件可核验，开放数据可作为建立共同评测协议的入口",
      "if permissions, splits and acquisition conditions can be verified, open data could be starting points for shared evaluation protocols",
    ),
    action: bi(
      "核查数据是否实际可获取、使用许可与患者级划分；先做重复与泄漏检查，再设计共同评测。",
      "Check actual access, permissions and patient-level splits; audit duplicates and leakage before designing shared evaluation.",
    ),
    watch: bi(
      "观察数据版本、许可、标注规范、患者重叠和采集来源。",
      "Watch dataset versions, permissions, annotation protocols, patient overlap and acquisition provenance.",
    ),
  },
];
const signalCandidates: Candidate[] = signalDefinitions.map((definition) => ({
  ...definition,
  dimension: definition.id.endsWith("availability") ? "output" : "validation",
  abstractOnly: true,
  title: bi(
    `${definition.label.zh}：先核验，再纳入设计`,
    `${definition.label.en}: verify before designing around it`,
  ),
  observation: bi(
    `摘要中识别到已实施或已提供的“${definition.label.zh}”表述；未核查全文、质量、访问权限或样本独立性。`,
    `Abstracts contain affirmative statements of ${definition.label.en.toLowerCase()}; full texts, quality, access and sample independence have not been verified.`,
  ),
  match: (work) => {
    const signal = work.analysis.signals.find((signal) => signal.id === definition.id);
    return signal ? { paperId: work.paper.id, excerpt: signal.excerpt, kind: "abstract" } : null;
  },
  alternative: bi(
    "摘要表述差异和索引覆盖会影响计数；多个作品可能复用队列，肯定表述不等于高质量证据或独立复现。",
    "Abstract wording and indexing coverage affect counts; distinct works may reuse cohorts, and affirmative statements do not establish high-quality evidence or independent replication.",
  ),
}));

const taskRules: Record<string, { label: Bilingual; pattern: RegExp; action: Bilingual }> = {
  segmentation: {
    label: bi("分割", "segmentation"),
    pattern: /segment|delineat|contour/i,
    action: bi(
      "固定数据划分，补充边界误差、小病灶与标注者差异评估，再比较总体分数。",
      "Use fixed splits and evaluate boundary errors, small lesions and annotator variation alongside aggregate scores.",
    ),
  },
  diagnosis: {
    label: bi("辅助诊断", "diagnostic support"),
    pattern: /diagnos|detect|classif|screen/i,
    action: bi(
      "明确临床决策阈值，比较校准、漏诊与子组表现，并核查病例谱差异。",
      "Define decision thresholds and compare calibration, missed cases and subgroups while checking case-mix differences.",
    ),
  },
  reconstruction: {
    label: bi("重建与增强", "reconstruction and enhancement"),
    pattern: /reconstruct|denois|super.resolution|synthe|artifact/i,
    action: bi(
      "除图像相似度外，评估病灶保留、定量测量偏移及下游任务稳定性。",
      "Alongside image similarity, assess lesion preservation, quantitative measurement bias and downstream stability.",
    ),
  },
  registration: {
    label: bi("配准与运动", "registration and motion"),
    pattern: /registration|motion|align/i,
    action: bi(
      "在统一数据上比较解剖标志误差、形变合理性及运动幅度变化下的失败病例。",
      "On shared data compare landmark error, deformation plausibility and failures across motion amplitudes.",
    ),
  },
  quantification: {
    label: bi("定量影像", "quantitative imaging"),
    pattern: /quantitat|radiomic|biomarker|morphometr|volumetr/i,
    action: bi(
      "优先测试重测稳定性、设备差异和测量误差，并预设最小有意义变化。",
      "Test repeatability, device effects and measurement error, with a prespecified minimally meaningful change.",
    ),
  },
  prognosis: {
    label: bi("预后与疗效预测", "prognosis and response prediction"),
    pattern: /prognos|survival|treatment response|clinical outcome|disease progression/i,
    action: bi(
      "采用患者级时间划分，检验校准与临床基线的增量价值，核查结局泄漏。",
      "Use patient-level temporal splits, assess calibration and added value over clinical baselines, and audit outcome leakage.",
    ),
  },
  language: {
    label: bi("影像语言", "image-language tasks"),
    pattern: /report|vision.language|image.text|visual question/i,
    action: bi(
      "建立事实错误、遗漏病灶与定位错误评估，并检查语言流畅性是否掩盖临床错误。",
      "Evaluate factual errors, missed findings and localization errors, checking whether fluent language hides clinical mistakes.",
    ),
  },
  intervention: {
    label: bi("治疗规划与导航", "planning and navigation"),
    pattern: /radiotherapy|dose|surg|navigation|intraoperative|interventional/i,
    action: bi(
      "预设任务误差、延迟与失败恢复指标，验证影像指标能否对应实际规划或导航需求。",
      "Prespecify task error, latency and recovery measures, and test whether imaging metrics correspond to planning or navigation needs.",
    ),
  },
};
const modalityRules: Record<string, { label: Bilingual; pattern: RegExp }> = {
  MRI: { label: bi("MRI", "MRI"), pattern: /\bmri\b|magnetic resonance/i },
  CT: { label: bi("CT", "CT"), pattern: /\bct\b|computed tomograph/i },
  "X-ray": { label: bi("X-ray", "X-ray"), pattern: /x.ray|radiograph|mammograph/i },
  超声: { label: bi("超声", "ultrasound"), pattern: /ultrasound|ultrasonograph|echocardiograph/i },
  "PET / SPECT": { label: bi("PET / SPECT", "PET / SPECT"), pattern: /\bpet\b|\bspect\b|positron emission/i },
  病理切片: {
    label: bi("病理切片", "histopathology"),
    pattern: /histopatholog|whole.slide|digital patholog|histolog/i,
  },
  "眼底 / OCT": {
    label: bi("眼底 / OCT", "retinal imaging / OCT"),
    pattern: /fundus|retinal imag|optical coherence|\boct\b/i,
  },
  内镜: { label: bi("内镜", "endoscopy"), pattern: /endoscop|colonoscop|gastroscop/i },
};
function applicationCandidates(current: Work[]): Candidate[] {
  const pairs = new Set<string>();
  for (const work of current)
    for (const task of work.paper.tracks)
      for (const modality of work.paper.modalities) {
        if (taskRules[task] && modalityRules[modality]) pairs.add(JSON.stringify([task, modality]));
      }
  return [...pairs].sort(compare).map((pair) => {
    const [task, modality] = JSON.parse(pair) as [string, string],
      t = taskRules[task],
      m = modalityRules[modality];
    const candidate = keywordCandidate(
      `application:${task}:${modality}`,
      "application",
      bi(`${m.label.zh} ${t.label.zh}`, `${m.label.en} ${t.label.en}`),
      t.pattern,
      bi(
        "若后续评价能连接影像指标与明确的任务目标，该应用可作为设计更贴近实际使用条件的实验入口",
        "if later evaluations connect imaging metrics to explicit task goals, this application could be a starting point for experiments closer to use conditions",
      ),
      t.action,
      bi(
        "观察任务定义、患者来源、临床对照与失败情形是否清楚；任务标签不是临床有效性的证据。",
        "Watch task definitions, patient sources, clinical comparators and failures; task tags do not establish clinical effectiveness.",
      ),
    );
    candidate.match = (work) =>
      work.paper.tracks.includes(task) &&
      work.paper.modalities.includes(modality) &&
      t.pattern.test(work.text) &&
      m.pattern.test(work.text)
        ? tag(t.pattern)(work)
        : null;
    candidate.observation = bi(
      `标题／摘要与现有标签中，“${m.label.zh}”和“${t.label.zh}”线索共现；未确认实际临床部署或患者获益。`,
      `Titles/abstracts and existing tags co-occur for ${m.label.en} and ${t.label.en}; actual deployment or patient benefit is not established.`,
    );
    return candidate;
  });
}
const opportunityCandidates: Candidate[] = [
  keywordCandidate(
    "shift-stress-test",
    "opportunity",
    bi("域移位压力测试", "Domain-shift stress testing"),
    /domain shift|distribution shift|domain general|cross.domain|out.of.distribution/i,
    bi(
      "若这些关键词对应实际部署差异，预先锁定域移位压力测试可帮助区分有效改进和数据选择效应",
      "if these clues correspond to real deployment differences, a locked domain-shift stress test could separate useful improvements from data-selection effects",
    ),
    bi(
      "先阅读证据论文确认任务，再选择一个可获得的中心或设备差异，预注册同一基线的失败分析；这是实验建议，不是已证实的研究空白。",
      "Read the cited work to confirm the task, choose one accessible center or device difference, and preregister a fixed-baseline failure analysis; this is an experiment suggestion, not a demonstrated literature gap.",
    ),
    bi(
      "观察目标域定义、真实分布差异、调参泄漏以及既有同类压力测试。",
      "Watch target-domain definitions, actual distribution differences, tuning leakage and existing equivalent stress tests.",
    ),
  ),
  keywordCandidate(
    "uncertainty",
    "opportunity",
    bi("可靠性与不确定性测试", "Reliability and uncertainty testing"),
    /uncertainty|calibrat|reliab|failure detect/i,
    bi(
      "若可靠性线索对应可观测失败，校准与拒绝策略可成为与任务性能并列的验证问题",
      "if reliability clues correspond to observable failures, calibration and abstention could become validation questions alongside task performance",
    ),
    bi(
      "预设错误发现或拒绝策略，比较覆盖率—风险曲线与简单置信度基线；先核对文献已有设置，不能把摘要未提及当作空白。",
      "Prespecify error detection or abstention, compare risk-coverage curves with a simple confidence baseline, and check existing literature; omission from abstracts is not evidence of a gap.",
    ),
    bi(
      "观察不确定性是否校准、是否定位失败，以及阈值选择是否独立于测试集。",
      "Watch calibration, failure localization and whether threshold selection is separate from the test set.",
    ),
  ),
];

function enoughPeriod(works: Work[]): boolean {
  if (works.length < MIN_COMPARISON) return false;
  const days = works.map((work) => work.day).sort(compare);
  return (Date.parse(days[days.length - 1]) - Date.parse(days[0])) / DAY >= 45;
}
function sourceCollection(paper: Paper): string {
  const source = paper.source.toLowerCase().replace(/[\s_-]+/g, ""),
    collection = paper.sourceCollection?.trim().toUpperCase();
  // MED and PubMed are the same bibliographic collection despite different retrieval APIs.
  if (source === "pubmed" || source === "medline") return "pubmed";
  if (["europepmc", "epmc"].includes(source)) {
    if (!collection || collection === "MED" || collection === "PUBMED" || paper.pmid) return "pubmed";
    if (collection === "PMC") return "pmc";
    return `europepmc:${collection.toLowerCase()}`;
  }
  if (source === "pubmedcentral" || source === "pmc") return paper.pmid ? "pubmed" : "pmc";
  return source || "unknown";
}
function compareCoverage(
  current: Work[],
  previous: Work[],
): { enoughPeriods: boolean; similarCoverage: boolean; ready: boolean } {
  const enoughPeriods = enoughPeriod(current) && enoughPeriod(previous);
  const smaller = Math.min(current.length, previous.length),
    larger = Math.max(current.length, previous.length);
  const similarVolume = smaller > 0 && larger / smaller <= MAX_WINDOW_SIZE_RATIO;
  const shares = (works: Work[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const work of works) {
      const source = sourceCollection(work.paper);
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return new Map([...counts].map(([source, count]) => [source, count / works.length]));
  };
  const a = shares(current),
    b = shares(previous),
    sources = new Set([...a.keys(), ...b.keys()]);
  const variation =
    [...sources].reduce((sum, source) => sum + Math.abs((a.get(source) ?? 0) - (b.get(source) ?? 0)), 0) / 2;
  const similarCoverage = similarVolume && variation <= MAX_SOURCE_VARIATION + Number.EPSILON * 10;
  return { enoughPeriods, similarCoverage, ready: enoughPeriods && similarCoverage };
}
function forecast(scenario: Bilingual, horizon: ForesightCard["horizon"]): Bilingual {
  if (horizon === "3–6")
    return bi(
      `未来 3–6 个月的条件假设：${scenario.zh}。优先做小范围验证，暂不推断领域走向。`,
      `A conditional hypothesis for 3–6 months: ${scenario.en}. Start with a small test; this does not predict the field's direction.`,
    );
  if (horizon === "12–24")
    return bi(
      `未来 12–24 个月仅作探索情景：${scenario.zh}。还需跨时间与设置的重复证据；当前材料不足以预测主流路线。`,
      `An exploratory 12–24 month scenario only: ${scenario.en}. Repeated evidence across time and settings is still needed; this evidence cannot predict a dominant approach.`,
    );
  return bi(
    `未来 6–12 个月的条件假设：${scenario.zh}。需在后续研究持续出现且经过全文核查后再调整研究投入。`,
    `A conditional hypothesis for 6–12 months: ${scenario.en}. Reassess research effort only after continued evidence and full-text verification.`,
  );
}
function trajectory(
  candidate: Candidate,
  delta: number | null,
  horizon: ForesightCard["horizon"],
  team: boolean,
): { title: Bilingual; text: Bilingual } {
  const scope = bi(
    team ? "该关注名单匹配作品中" : "本库当前筛选范围内",
    team ? "Within works matched to this watchlist" : "Within this library's selected scope",
  );
  const teamLimit = team
    ? bi(
        "这只是名单相关作品的观察，不代表团队或 PI 的研究计划。",
        "This describes watchlist-matched work, not a team's or PI's research plans.",
      )
    : bi("", "");
  let title: Bilingual, lead: Bilingual;
  if (delta !== null && delta >= 5) {
    title = bi(`${candidate.label.zh}：占比上升线索`, `${candidate.label.en}: rising share in the sample`);
    lead = bi(
      `${scope.zh}，该线索占比比前窗提高 ${delta} 个百分点。若来源覆盖与分类保持相近，后续${team ? "名单相关作品" : "采集作品"}可能继续探索这一问题；两窗差异尚不是持续趋势。`,
      `${scope.en}, this clue's share rose by ${delta} percentage points. If coverage and classification remain comparable, later ${team ? "watchlist-matched" : "collected"} work may continue exploring it; two windows do not establish a sustained trend.`,
    );
  } else if (delta !== null && delta <= -5) {
    title = bi(`${candidate.label.zh}：回落观察项`, `${candidate.label.en}: a declining-share observation`);
    lead = bi(
      `${scope.zh}，该线索占比比前窗回落 ${Math.abs(delta)} 个百分点。尚不能断言放弃或替代；后续应检验是否转向其他问题，或只是来源与摘要表述变化。`,
      `${scope.en}, this clue's share fell by ${Math.abs(delta)} percentage points. This does not establish abandonment or replacement; later work should be checked for other questions or changes in sources and abstract wording.`,
    );
  } else if (delta !== null) {
    title = bi(
      `${candidate.label.zh}：既有路线延伸候选`,
      `${candidate.label.en}: a candidate to extend an existing line`,
    );
    lead = bi(
      `${scope.zh}，两窗都有重复线索，占比差异小于 5 个百分点（${delta > 0 ? "+" : ""}${delta}）。可观察既有路线的延伸，但这个描述性界限不表示统计稳定或效果相同。`,
      `${scope.en}, clues recur in both windows with a share difference below 5 percentage points (${delta > 0 ? "+" : ""}${delta}). Extension of an existing line is worth observing; this descriptive cutoff does not establish statistical stability or equivalent effects.`,
    );
  } else {
    title = bi(
      `${candidate.label.zh}：可观察的延伸候选`,
      `${candidate.label.en}: an extension candidate to observe`,
    );
    lead = bi(
      `${scope.zh}，当前不同作品提供了重复线索，可作为后续延伸候选；两窗证据或覆盖可比性不足，尚不能判断升温、回落或研究转向。`,
      `${scope.en}, distinct current works provide recurring clues that could be followed as an extension candidate; evidence or comparable coverage across windows is insufficient to infer growth, decline or a change of direction.`,
    );
  }
  const longRange =
    horizon === "12–24"
      ? bi(
          "将这一观察延伸到 12–24 个月只是探索情景，不意味着当前分布会持续。",
          "Extending this observation to 12–24 months is exploratory and does not imply that the current distribution will persist.",
        )
      : bi("", "");
  const scenario = forecast(candidate.scenario, horizon);
  return {
    title,
    text: bi(
      `${lead.zh}${teamLimit.zh}${longRange.zh}${scenario.zh}`,
      `${lead.en} ${teamLimit.en} ${longRange.en} ${scenario.en}`.replace(/\s+/g, " ").trim(),
    ),
  };
}

/** Evidence-linked research scenarios from the observed library, never a model or field-wide prediction. */
export function buildForesight(papers: Paper[], options: ForesightOptions = {}): ForesightResult {
  const asOf = beijingDay(options.now ?? new Date());
  if (!asOf) throw new Error("Foresight requires a valid current date");
  const from = offset(asOf, -89),
    previousTo = offset(from, -1),
    previousFrom = offset(from, -90);
  const horizon = options.horizon ?? "6–12",
    track = options.track?.trim() || "all",
    modality = options.modality?.trim() || "all";
  const query = [...new Set(options.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [])].sort(
    compare,
  );
  const team = options.team;
  const key =
    "foresight:" +
    digest(
      JSON.stringify({
        track,
        modality,
        query,
        team: team
          ? {
              id: team.id,
              members: [
                ...new Set(
                  team.members.map((member) =>
                    normalizedName(member.replace(/^https?:\/\/orcid.org\//i, "")),
                  ),
                ),
              ].sort(compare),
              institution: team.institution.toLowerCase(),
            }
          : null,
        horizon,
      }),
    );
  const matches = (paper: Paper): boolean =>
    (track === "all" || paper.tracks.includes(track)) &&
    (modality === "all" || paper.modalities.includes(modality)) &&
    (!team || matchesTeam(paper, team)) &&
    (!query.length ||
      query.every((term) =>
        `${paper.title} ${paper.originalAbstract?.trim() || paper.abstract}`.toLowerCase().includes(term),
      ));
  let excludedFuture = 0,
    excludedInvalid = 0,
    duplicatesRemoved = 0;
  const works: Work[] = [];
  for (const group of groupWorks(papers)) {
    const scoped = group.filter(matches);
    if (!scoped.length) continue;
    const valid = group.flatMap((paper) => {
      return publicationDateStatus(paper, asOf) === "valid"
        ? [{ paper, day: paper.publishedAt.slice(0, 10) }]
        : [];
    });
    const eligible = scoped.filter((paper) => {
      const dateStatus = publicationDateStatus(paper, asOf);
      if (dateStatus === "invalid") {
        excludedInvalid++;
        return false;
      }
      if (dateStatus === "future") {
        excludedFuture++;
        return false;
      }
      return true;
    });
    if (!eligible.length || !valid.length) continue;
    const day = valid.reduce((earliest, row) => (row.day < earliest ? row.day : earliest), asOf);
    if (day < previousFrom) continue;
    duplicatesRemoved += eligible.length - 1;
    // Prefer a complete scoped representative; retain the work's earliest known publication day.
    eligible.sort(
      (a, b) =>
        Number(!!(b.originalAbstract?.trim() || b.abstract.trim())) -
          Number(!!(a.originalAbstract?.trim() || a.abstract.trim())) ||
        Number(b.status === "published") - Number(a.status === "published") ||
        compare(a.id, b.id) ||
        compare(
          JSON.stringify([a.title, a.originalAbstract, a.abstract]),
          JSON.stringify([b.title, b.originalAbstract, b.abstract]),
        ),
    );
    // The detail view receives the original source record; only the internal work date is normalized.
    const paper = eligible[0];
    const abstract = textOnly(paper.originalAbstract?.trim() || paper.abstract),
      analysis = buildPaperAnalysis(paper);
    works.push({ paper, day, abstract, text: `${textOnly(paper.title)}. ${abstract}`, analysis });
  }
  works.sort((a, b) => compare(b.day, a.day) || compare(a.paper.id, b.paper.id));
  const current = works.filter((work) => work.day >= from),
    previous = works.filter((work) => work.day < from);
  const coverage = compareCoverage(current, previous),
    comparisonReady = coverage.ready;
  const currentWithAbstract = current.filter((work) => work.analysis.hasAbstract),
    previousWithAbstract = previous.filter((work) => work.analysis.hasAbstract);
  const currentAbstracts = currentWithAbstract.length,
    previousAbstracts = previousWithAbstract.length;
  const abstractCoverage = compareCoverage(currentWithAbstract, previousWithAbstract);
  const candidates = [
    ...methodCandidates,
    ...dataCandidates,
    ...signalCandidates,
    ...applicationCandidates(current),
    ...opportunityCandidates,
  ];
  const scored = candidates
    .map((candidate) => {
      const evidence = current.flatMap((work) => {
        const value = candidate.match(work);
        return value ? [value] : [];
      });
      const previousEvidence = previous.flatMap((work) => {
        const value = candidate.match(work);
        return value ? [value] : [];
      });
      return { candidate, evidence, previousEvidence };
    })
    .filter((row) => row.evidence.length >= MIN_WORKS)
    .sort((a, b) => b.evidence.length - a.evidence.length || compare(a.candidate.id, b.candidate.id));
  const cards: ForesightCard[] = [];
  for (const dimension of Object.keys(dimensions) as ForesightDimension[]) {
    const row = scored.find((row) => row.candidate.dimension === dimension);
    if (!row) continue;
    const { candidate, evidence, previousEvidence } = row;
    const currentCount = evidence.length,
      previousCount = previousEvidence.length;
    const currentDenominator = candidate.abstractOnly ? currentAbstracts : current.length,
      previousDenominator = candidate.abstractOnly ? previousAbstracts : previous.length;
    const comparable =
      comparisonReady &&
      (!candidate.abstractOnly || abstractCoverage.ready) &&
      previousCount >= MIN_WORKS &&
      currentDenominator >= MIN_COMPARISON &&
      previousDenominator >= MIN_COMPARISON;
    const delta = comparable
      ? Math.round((currentCount / currentDenominator - previousCount / previousDenominator) * 1000) / 10
      : null;
    const countText = bi(
      `当前窗口 ${currentCount}/${currentDenominator} 个不同作品${candidate.abstractOnly ? "（分母为有摘要作品）" : ""}。`,
      `Current window: ${currentCount}/${currentDenominator} distinct works${candidate.abstractOnly ? " with abstracts" : ""}.`,
    );
    const comparison =
      delta === null
        ? bi(
            "样本量、时间或来源覆盖可比性不足以支持该线索的两窗变化判断。",
            "Sample size, time coverage or source comparability does not support a between-window change claim for this clue.",
          )
        : bi(
            `前一窗口为 ${previousCount}/${previousDenominator}，样本内占比相差 ${delta > 0 ? "+" : ""}${delta} 个百分点；不是全领域增长率，也不表示更优。`,
            `The previous window has ${previousCount}/${previousDenominator}; the observed share differs by ${delta > 0 ? "+" : ""}${delta} percentage points, not a field-wide growth rate or evidence of superiority.`,
          );
    const observation = bi(
      `${countText.zh}${candidate.observation.zh}${comparison.zh}`,
      `${countText.en} ${candidate.observation.en} ${comparison.en}`,
    );
    const currentIds = new Set(evidence.map((item) => item.paperId));
    const matchingAbstracts = current.filter(
      (work) => currentIds.has(work.paper.id) && work.analysis.hasAbstract,
    ).length;
    const strength =
      horizon !== "12–24" && currentCount >= 5 && matchingAbstracts >= 4
        ? ("supported" as const)
        : ("limited" as const);
    const outlook = trajectory(candidate, delta, horizon, !!team);
    const displayedEvidence = previousEvidence.length
      ? [...evidence.slice(0, 3), ...previousEvidence.slice(0, 3)]
      : evidence.slice(0, 6);
    const card = {
      id: `${dimension}:${candidate.id}`,
      dimension,
      label: dimensions[dimension],
      title: outlook.title,
      observation,
      forecast: outlook.text,
      strength,
      horizon,
      alternative: candidate.alternative,
      action: candidate.action,
      watch: candidate.watch,
      evidence: displayedEvidence,
      paperIds: [...evidence, ...previousEvidence].map((item) => item.paperId),
      currentCount,
      previousCount,
      currentDenominator,
      previousDenominator,
      delta,
    };
    // Include the actual cited text, claims, scope and comparison evidence, not just paper IDs or counts.
    cards.push({ ...card, signature: digest(JSON.stringify({ key, card, evidence, previousEvidence })) });
  }
  const missingAbstracts = works.filter((work) => !work.analysis.hasAbstract).length;
  const caveats: Bilingual[] = [
    bi(
      "这是现有来源与检索条件下的观察样本，不代表期刊或领域全量。索引时延、补录和检索范围变化都可能改变两窗构成；发表日期用于分窗，首次发现时间不用于推断趋势。",
      "This is the library's observed sample under its source and retrieval conditions, not a complete journal or field census. Indexing delays, backfills and retrieval changes can alter both windows; publication dates, not first-seen timestamps, define them.",
    ),
    bi(
      "DOI、原生标识与关联 DOI 按连通关系合并作品，采用最早已知有效发表日；同名作者、机构、共同数据集或关键词不作为去重依据。不同作品不等于独立团队、独立样本或独立复现。",
      "Works are merged through DOI, native identifiers and related-DOI links and assigned their earliest known valid publication day. Names, institutions, shared datasets and keywords are not deduplication keys. Distinct works do not establish independent teams, samples or replications.",
    ),
    bi(
      "关键词是标题／摘要线索；摘要未提及的事项未知。验证信号只识别肯定表述，仍需核查全文。支持程度描述观察依据，不是预测概率；机会卡是实验建议，不是已证实的文献空白。",
      "Keywords are title/abstract clues; unmentioned details are unknown. Validation signals require affirmative wording but still need full-text review. Strength describes support for the observation, not forecast probability; opportunity cards suggest experiments rather than prove literature gaps.",
    ),
  ];
  if (missingAbstracts)
    caveats.push(
      bi(
        `${missingAbstracts} 个作品缺少摘要；它们不能作为“没有验证或开放资源”的证据，摘要信号的分母排除这些作品。`,
        `${missingAbstracts} works lack abstracts; they are not evidence of absent validation or open resources and are excluded from abstract-signal denominators.`,
      ),
    );
  if (excludedInvalid || excludedFuture)
    caveats.push(
      bi(
        `排除 ${excludedInvalid} 条无效／缺失日期和 ${excludedFuture} 条未来发表日期记录。`,
        `Excluded ${excludedInvalid} records with invalid/missing dates and ${excludedFuture} with future publication dates.`,
      ),
    );
  if (!coverage.enoughPeriods)
    caveats.push(
      bi(
        "两窗比较要求每窗至少 10 个不同作品，且每窗的发表日跨度至少 45 天；当前未达到该条件，不作增减判断。",
        "Comparison requires at least 10 distinct works and a publication-date span of at least 45 days in each window; this scope does not meet that threshold, so no increase/decrease is inferred.",
      ),
    );
  if (coverage.enoughPeriods && !coverage.similarCoverage)
    caveats.push(
      bi(
        "两窗记录量／来源结构差异较大，可能由补录或采集覆盖变化造成，暂不判断升降。比较要求记录量之比不超过 3，规范化来源构成的总变差不超过 25%。",
        "The windows differ substantially in record volume or source composition, possibly because of backfills or collection changes; no rise or fall is inferred. Comparison requires a volume ratio no greater than 3 and total variation in normalized source composition no greater than 25%.",
      ),
    );
  if (comparisonReady)
    caveats.push(
      bi(
        "两窗仅通过本库样本量、发表日跨度和来源构成的保守可比性检查，不保证检索覆盖恒定，不代表全领域可比。摘要信号另按有摘要作品检查这些条件。",
        "The windows pass conservative checks on library sample size, publication-date span and source composition only; constant retrieval coverage and field-wide comparability are not established. Abstract signals are checked separately using works with abstracts.",
      ),
    );
  if (!cards.length)
    caveats.push(
      bi(
        "未找到至少 3 个不同作品共同支持的线索，暂不生成前瞻卡片。",
        "No clue is supported by at least 3 distinct works; no foresight cards are generated.",
      ),
    );
  if (team)
    caveats.push(
      bi(
        "团队范围沿用关注名单：作者姓名／ORCID 与成员匹配，且满足已设置的机构条件。机构相同本身不构成团队归属，名单也不保证覆盖团队全部工作。",
        "Team scope follows the watchlist: author name/ORCID must match a member and any configured institution condition. A shared institution alone does not establish membership, and the list may not cover all team work.",
      ),
    );
  const fingerprint = digest(
    JSON.stringify({
      key,
      comparisonReady,
      excludedInvalid,
      excludedFuture,
      evidence: works.map((work) => [
        work.paper.id,
        work.day,
        work.day >= from ? "current" : "previous",
        work.paper.title,
        work.abstract,
        [...work.paper.tracks].sort(compare),
        [...work.paper.modalities].sort(compare),
      ]),
      signatures: cards.map((card) => card.signature),
    }),
  );
  return {
    key,
    asOf,
    from,
    previousFrom,
    previousTo,
    papers: works.map((work) => work.paper),
    current: current.map((work) => work.paper),
    previous: previous.map((work) => work.paper),
    cards,
    missingAbstracts,
    duplicatesRemoved,
    excludedFuture,
    comparisonReady,
    caveats,
    fingerprint,
  };
}
