import { ANALYSIS_RULE_VERSION } from "./analysis-version";
import { groupWorks } from "./paper-works";
import { paperScope } from "./paper-scope";
import type { Paper } from "./types";
import type { ResearchSignal } from "./research-signals";

export type Text = { zh: string; en: string };
type Rule = { id: string; label: Text; pattern: RegExp };
const rule = (id: string, zh: string, en: string, pattern: RegExp): Rule => ({
  id,
  label: { zh, en },
  pattern,
});
export const DIRECTIONS = [
  rule("segmentation", "分割与结构解析", "Segmentation", /\bsegment\w*|分割/iu),
  rule(
    "diagnosis",
    "检测与辅助诊断",
    "Detection and diagnosis",
    /\b(?:lesion detection|classification|computer.aided diagnos\w*|diagnostic accuracy)\b|病灶检测|分类|辅助诊断/iu,
  ),
  rule(
    "reconstruction",
    "重建与图像增强",
    "Reconstruction and enhancement",
    /\b(?:reconstruction|denois\w*|super.resolution|image enhancement)\b|重建|去噪|超分辨|图像增强/iu,
  ),
  rule(
    "registration",
    "配准与运动分析",
    "Registration and motion",
    /\b(?:registration|motion estimation|deformable alignment)\b|配准|运动估计/iu,
  ),
  rule(
    "generation",
    "图像合成与跨模态转换",
    "Synthesis and translation",
    /\b(?:image synthesis|synthetic imag\w*|image.to.image|image translation|diffusion model\w*)\b|图像合成|影像合成|跨模态转换|扩散模型/iu,
  ),
  rule(
    "foundation",
    "基础模型与视觉语言",
    "Foundation and vision-language models",
    /\b(?:foundation model\w*|vision.language|large multimodal|segment anything|medical report generation)\b|基础模型|视觉语言|影像报告生成/iu,
  ),
  rule(
    "prediction",
    "定量影像与预后预测",
    "Quantitative imaging and prognosis",
    /\b(?:radiomics|prognos\w*|survival prediction|risk prediction|imaging biomarker\w*)\b|影像组学|预后|生存预测|影像生物标志物/iu,
  ),
];
const PROBLEMS = [
  rule(
    "labels",
    "标注稀缺与标注成本",
    "Limited annotations",
    /\b(?:limited label\w*|limited annotation\w*|annotation cost\w*|label scarcity|few.shot|semi.supervised|weakly.supervised)\b|标注稀缺|标注成本|少样本|半监督|弱监督/iu,
  ),
  rule(
    "shift",
    "跨域泛化与中心差异",
    "Domain shift and generalization",
    /\b(?:domain shift|domain adaptation|domain generalization|cross.center|cross.site|generaliz\w*|generalis\w*)\b|域偏移|域适应|跨中心|泛化/iu,
  ),
  rule(
    "reliability",
    "可靠性与不确定性",
    "Reliability and uncertainty",
    /\b(?:uncertainty|calibration|robustness|out.of.distribution)\b|不确定性|校准|鲁棒性|分布外/iu,
  ),
  rule(
    "efficiency",
    "计算成本与部署效率",
    "Efficiency and deployment",
    /\b(?:computational cost|lightweight|real.time|memory.efficient|inference speed)\b|计算成本|轻量|实时|推理速度/iu,
  ),
  rule(
    "privacy",
    "隐私与分布式数据",
    "Privacy and distributed data",
    /\b(?:privacy|federated|decentralized)\b|隐私|联邦|分布式数据/iu,
  ),
  rule("interpretability", "可解释性", "Interpretability", /\b(?:interpretab\w*|explainab\w*)\b|可解释/iu),
  rule(
    "longitudinal",
    "纵向变化与疾病进展",
    "Longitudinal change",
    /\b(?:longitudinal|disease progression|temporal consistency)\b|纵向|疾病进展|时序一致/iu,
  ),
];
const METHODS = [
  rule("cnn", "CNN / U-Net", "CNN / U-Net", /\b(?:cnn|u.net|convolutional)\b|卷积/iu),
  rule(
    "transformer",
    "Transformer / 注意力",
    "Transformer / attention",
    /\b(?:transformer\w*|attention mechanism|vision transformer|vit)\b|注意力机制/iu,
  ),
  rule(
    "diffusion",
    "扩散与生成模型",
    "Diffusion and generative models",
    /\b(?:diffusion|gan|generative adversarial)\b|扩散模型|生成对抗/iu,
  ),
  rule(
    "selfsupervised",
    "自监督 / 对比学习",
    "Self-supervision / contrastive learning",
    /\b(?:self.supervised|contrastive learning|masked autoencoder)\b|自监督|对比学习/iu,
  ),
  rule(
    "adaptation",
    "迁移 / 域适应",
    "Transfer / domain adaptation",
    /\b(?:transfer learning|domain adaptation|fine.tun\w*|lora|adapter\w*)\b|迁移学习|域适应|微调/iu,
  ),
  rule("federated", "联邦学习", "Federated learning", /\bfederated learning\b|联邦学习/iu),
  rule(
    "radiomics",
    "影像组学 / 传统机器学习",
    "Radiomics / classical ML",
    /\b(?:radiomics|random forest|support vector|svm)\b|影像组学|随机森林|支持向量/iu,
  ),
];
const SCENARIOS = [
  rule(
    "brain",
    "脑与神经影像",
    "Brain and neuroimaging",
    /\b(?:brain|neuroimag\w*|glioma|glioblastoma|stroke)\b|脑|神经影像|卒中/iu,
  ),
  rule("chest", "胸部与肺部", "Chest and lung", /\b(?:chest|lung|pulmonary)\b|胸部|肺/iu),
  rule(
    "cardiac",
    "心血管影像",
    "Cardiovascular imaging",
    /\b(?:cardiac|cardiovascular|coronary)\b|心脏|心血管|冠脉/iu,
  ),
  rule(
    "pathology",
    "数字病理",
    "Digital pathology",
    /\b(?:histopatholog\w*|whole.slide|digital pathology)\b|数字病理|病理切片/iu,
  ),
  rule("retina", "眼底与视网膜", "Fundus and retina", /\b(?:fundus|retin\w*|ophthalm\w*)\b|眼底|视网膜/iu),
  rule("breast", "乳腺影像", "Breast imaging", /\b(?:breast|mammogra\w*)\b|乳腺/iu),
  rule(
    "abdominal",
    "腹部与盆腔",
    "Abdominal and pelvic imaging",
    /\b(?:liver|kidney|prostate|abdominal|pelvic)\b|肝脏|肾脏|前列腺|腹部|盆腔/iu,
  ),
];
// Shared with the offline benchmark; this does not change production classification.
export const ANALYSIS_TAXONOMY = {
  directions: DIRECTIONS,
  problems: PROBLEMS,
  methods: METHODS,
  scenarios: SCENARIOS,
};
export { ANALYSIS_RULE_VERSION } from "./analysis-version";
export type Kind = "paper" | "github" | "news";
export type Evidence = { id: string; kind: Kind; title: string; url: string; excerpt: string };
type Facet = { label: Text; counts: Record<Kind, number>; evidence: Evidence[] };
export type Direction = {
  id: string;
  label: Text;
  counts: Record<Kind, number>;
  shares: Record<Kind, number>;
  score: number;
  mainstream: boolean;
  facets: Record<"problems" | "methods" | "scenarios", Facet[]>;
  evidence: Evidence[];
};
export type Niche = {
  id: string;
  label: Text;
  count: number;
  share: number;
  years: number[];
  spanDays: number;
  logicPapers: number;
  data: Evidence[];
  code: Evidence[];
  news: Evidence[];
  dataSpanDays: number;
  ready: boolean;
  evidenceStatus: "sufficient" | "pending";
  gaps: Text[];
  evidence: Evidence[];
};
export type AnalysisResult = {
  version: string;
  historyTotal: number;
  windowStart: string;
  totals: Record<Kind, number>;
  unmatched: Record<Kind, number>;
  excluded: Record<Kind, number>;
  duplicates: Record<Kind, number>;
  directions: Direction[];
  niches: Niche[];
  asOf: string;
};
type Input = { papers: Paper[]; signals: ResearchSignal[]; asOf: string };
const kinds: Kind[] = ["paper", "github", "news"];
const zero = (): Record<Kind, number> => ({ paper: 0, github: 0, news: 0 });
const medical =
  /\b(?:medical imag\w*|mri|ct|ultrasound|radiolog\w*|histopatholog\w*|retina\w*|fundus|mammogra\w*|x.ray|brain|tumou?r|lesion)\b|医学影像|超声|病理|脑|肿瘤|病灶/iu;
const sentences = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .split(/(?<=[.!?。！？])\s+(?=[A-Z\p{Script=Han}])|(?<=[。！？])\s*/u)
    .filter(Boolean);
function urlKey(value: string): string {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) return "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid)$/.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return "";
  }
}
function validDate(value: string | null | undefined, asOf: string) {
  if (!value) return false;
  const day = value.slice(0, 10);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day &&
    day <= asOf
  );
}
function links(value: string) {
  return value.match(/https?:\/\/[^\s<>"']+/g)?.map((s) => s.replace(/[.,;:)\]}]+$/, "")) ?? [];
}
function repoKey(value: string) {
  const match = urlKey(value).match(/^github\.com\/([^/]+\/[^/?#]+)/i);
  return match ? match[1].replace(/\.git$/i, "").toLowerCase() : "";
}
function identifiers(p: Paper) {
  return [p.doi, p.relatedDoi]
    .filter(Boolean)
    .map((v) => `doi:${v!.replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "").toLowerCase()}`)
    .concat(p.arxivId ? [`arxiv:${p.arxivId.replace(/v\d+$/, "")}`] : []);
}
function signalKeys(s: ResearchSignal) {
  return s.relatedUrls.flatMap((u) => {
    const key = urlKey(u);
    if (/^(?:dx\.)?doi.org\//i.test(key))
      return [`doi:${key.replace(/^(?:dx\.)?doi.org\//i, "").toLowerCase()}`];
    if (/^arxiv.org\/abs\//i.test(key))
      return [`arxiv:${key.replace(/^arxiv.org\/abs\//i, "").replace(/v\d+$/, "")}`];
    return [];
  });
}

export function analyzeResearch(input: Input): AnalysisResult {
  if (!validDate(input.asOf, input.asOf) || input.asOf.length !== 10)
    throw new Error("Invalid analysis date");
  const totals = zero(),
    excluded = zero(),
    duplicates = zero(),
    unmatched = zero();
  const eligible = input.papers.filter((p) => {
    const ok = p.dateAnomaly !== "future" && validDate(p.publishedAt, input.asOf) && paperScope(p) === "core";
    if (!ok) excluded.paper++;
    return ok;
  });
  const groups = groupWorks(eligible, { titleAuthors: false });
  const papers = groups
    .map(
      (group) =>
        [...group].sort((a, b) => b.abstract.length - a.abstract.length || a.id.localeCompare(b.id))[0],
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  duplicates.paper = eligible.length - papers.length;
  const refs = new Map(papers.map((p) => [p.id, p]));
  // Union actual URLs and declared news original URLs, including transitive reposts.
  const signals = input.signals
    .filter((s) => {
      const ok =
        validDate(s.observedAt, input.asOf) &&
        (!s.publishedAt || validDate(s.publishedAt, input.asOf)) &&
        (s.relevance?.level === "direct" || (!s.relevance && medical.test(`${s.title} ${s.summary}`)));
      if (!ok) excluded[s.kind]++;
      return ok;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const parents = signals.map((_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const seen = new Map<string, number>();
  signals.forEach((s, i) => {
    for (const u of [s.url, s.kind === "news" ? s.originalUrl : null]) {
      const key = u && (s.kind === "github" ? repoKey(u) : urlKey(u));
      if (!key) continue;
      const k = `${s.kind}:${key}`;
      const prev = seen.get(k);
      if (prev !== undefined) parents[root(i)] = root(prev);
      seen.set(k, i);
    }
  });
  const unique = signals.filter((s, i) => {
    if (root(i) !== i) {
      duplicates[s.kind]++;
      return false;
    }
    return true;
  });
  const newsByKey = new Map<string, ResearchSignal[]>();
  for (const s of unique.filter((s) => s.kind === "news"))
    for (const key of [
      ...signalKeys(s),
      ...s.relatedUrls
        .map(repoKey)
        .filter(Boolean)
        .map((key) => `repo:${key}`),
    ]) {
      const bucket = newsByKey.get(key) ?? [];
      bucket.push(s);
      newsByKey.set(key, bucket);
    }
  const codeByKey = new Map<string, ResearchSignal[]>();
  for (const s of unique.filter((s) => s.kind === "github"))
    for (const key of [`repo:${repoKey(s.url)}`, ...signalKeys(s)]) {
      const bucket = codeByKey.get(key) ?? [];
      bucket.push(s);
      codeByKey.set(key, bucket);
    }
  const rows = [
    ...papers.map((p) => ({
      id: p.id,
      kind: "paper" as Kind,
      title: p.title,
      url: p.url,
      text: `${p.title}. ${p.originalAbstract || p.abstract}`,
      date: p.publishedAt,
    })),
    ...unique.map((s) => ({
      id: s.id,
      kind: s.kind as Kind,
      title: s.title,
      url: s.url,
      text: `${s.title}. ${s.summary} ${s.kind === "github" ? s.readmeExcerpt : ""}`,
      date: s.kind === "github" ? s.pushedAt : s.publishedAt,
    })),
  ];
  const directionMap = new Map(
    DIRECTIONS.map((d) => [
      d.id,
      {
        id: d.id,
        label: d.label,
        counts: zero(),
        shares: zero(),
        score: 0,
        mainstream: false,
        facets: { problems: [], methods: [], scenarios: [] } as Direction["facets"],
        evidence: [] as Evidence[],
      },
    ]),
  );
  const facetMap = new Map<string, Facet>();
  const nicheMap = new Map<string, { label: Text; papers: Set<string> }>();
  const addEvidence = (list: Evidence[], e: Evidence) => {
    if (list.filter((x) => x.kind === e.kind).length < 3)
      list.push({ id: e.id, kind: e.kind, title: e.title, url: e.url, excerpt: e.excerpt });
  };
  const windowStart = new Date(Date.parse(input.asOf) - 364 * 86400000).toISOString().slice(0, 10);
  for (const row of rows) {
    const inWindow = validDate(row.date, input.asOf) && row.date!.slice(0, 10) >= windowStart;
    if (inWindow) totals[row.kind]++;
    const parts = sentences(row.text);
    const matched = DIRECTIONS.filter((d) => d.pattern.test(row.text));
    if (inWindow && !matched.length) unmatched[row.kind]++;
    const facets = {
      problems: PROBLEMS.filter((r) => r.pattern.test(row.text)),
      methods: METHODS.filter((r) => r.pattern.test(row.text)),
      scenarios: SCENARIOS.filter((r) => r.pattern.test(row.text)),
    };
    for (const d of matched) {
      if (inWindow) {
        const target = directionMap.get(d.id)!;
        target.counts[row.kind]++;
        addEvidence(target.evidence, { ...row, excerpt: parts.find((s) => d.pattern.test(s)) ?? row.title });
        for (const dimension of ["problems", "methods", "scenarios"] as const)
          for (const r of facets[dimension]) {
            const key = `${d.id}:${dimension}:${r.id}`;
            let facet = facetMap.get(key);
            if (!facet) {
              facet = { label: r.label, counts: zero(), evidence: [] };
              facetMap.set(key, facet);
              target.facets[dimension].push(facet);
            }
            facet.counts[row.kind]++;
            addEvidence(facet.evidence, {
              ...row,
              excerpt: parts.find((s) => r.pattern.test(s)) ?? row.title,
            });
          }
      }
      if (row.kind === "paper")
        for (const problem of facets.problems)
          for (const scenario of facets.scenarios) {
            const key = `${d.id}:${problem.id}:${scenario.id}`;
            const niche = nicheMap.get(key) ?? {
              label: {
                zh: `${scenario.label.zh} · ${d.label.zh} · ${problem.label.zh}`,
                en: `${scenario.label.en} · ${d.label.en} · ${problem.label.en}`,
              },
              papers: new Set<string>(),
            };
            niche.papers.add(row.id);
            nicheMap.set(key, niche);
          }
    }
  }
  const shareScore = (counts: Record<Kind, number>) =>
    kinds.reduce((n, k) => n + (totals[k] ? counts[k] / totals[k] : 0), 0) / 3;
  const directions = [...directionMap.values()]
    .map((d) => {
      d.score = shareScore(d.counts);
      d.shares = Object.fromEntries(kinds.map((k) => [k, totals[k] ? d.counts[k] / totals[k] : 0])) as Record<
        Kind,
        number
      >;
      d.mainstream =
        d.counts.paper >= 3 && kinds.filter((k) => d.counts[k] >= 2).length >= 2 && d.score >= 0.05;
      for (const f of Object.values(d.facets))
        f.sort((a, b) => shareScore(b.counts) - shareScore(a.counts) || a.label.en.localeCompare(b.label.en));
      return d;
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const niches: Niche[] = [];
  for (const [id, n] of nicheMap) {
    const share = n.papers.size / (papers.length || 1);
    if (share >= 0.1) continue;
    const members = [...n.papers].map((id) => refs.get(id)!);
    const dates = members.map((p) => p.publishedAt.slice(0, 10)).sort();
    const years = [...new Set(dates.map((d) => Number(d.slice(0, 4))))];
    const spanDays = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86400000;
    const data: Evidence[] = [],
      code: Evidence[] = [],
      evidence: Evidence[] = [];
    let logicPapers = 0;
    const codeIds = new Set<string>();
    const news: Evidence[] = [];
    const newsIds = new Set<string>();
    const datasetDates = new Map<string, Set<string>>();
    for (const p of members) {
      const body = p.originalAbstract || p.abstract;
      const affirmative = sentences(body)
        .filter(
          (s) =>
            !/\b(?:not|no|never|without|cannot|lack|will|plan|aims?)\b|未进行|未验证|没有|计划|旨在/iu.test(
              s,
            ),
        )
        .join(" ");
      if (
        PROBLEMS.some((r) => r.pattern.test(body)) &&
        METHODS.some((r) => r.pattern.test(affirmative)) &&
        /\b(?:evaluat\w*|experiment\w*|validation|benchmark\w*)\b|实验|验证|评估/iu.test(affirmative) &&
        /\b(?:results|achiev\w*|dice|auc|accuracy)\b|结果|准确率/iu.test(affirmative)
      )
        logicPapers++;
      const dataSentence = sentences(body).find(
        (s) =>
          !/\b(?:not|no|unavailable|will|plan|future)\b|不公开|未开放|将开放/iu.test(s) &&
          (links(s).some((u) =>
            /^(?:www\.)?(?:zenodo\.org|figshare\.com|openneuro\.org|physionet\.org|kaggle\.com|grand-challenge\.org)\//i.test(
              urlKey(u),
            ),
          ) ||
            (/\b(?:data|dataset)\w*\b.{0,100}\b(?:available|released|accessible)\b/iu.test(s) &&
              links(s).length > 0)),
      );
      const dataLinks = dataSentence ? links(dataSentence) : [];
      const knownDataLinks = dataLinks.filter((u) =>
        /^(?:zenodo\.org|figshare\.com|openneuro\.org|physionet\.org|kaggle\.com|grand-challenge\.org)\//i.test(
          urlKey(u),
        ),
      );
      const resourceLinks = knownDataLinks.length ? knownDataLinks : dataLinks.length === 1 ? dataLinks : [];
      if (dataSentence)
        for (const link of resourceLinks) {
          const key = urlKey(link);
          if (!key) continue;
          const dates = datasetDates.get(key) ?? new Set<string>();
          dates.add(p.publishedAt.slice(0, 10));
          datasetDates.set(key, dates);
        }
      if (dataSentence && data.length < 3)
        data.push({ id: p.id, kind: "paper", title: p.title, url: p.url, excerpt: dataSentence });
      const keys = [
        ...identifiers(p),
        ...links(body)
          .map(repoKey)
          .filter(Boolean)
          .map((k) => `repo:${k}`),
      ];
      for (const key of keys)
        for (const s of newsByKey.get(key) ?? [])
          if (!newsIds.has(s.id)) {
            newsIds.add(s.id);
            if (news.length < 5)
              news.push({
                id: s.id,
                kind: "news",
                title: s.title,
                url: s.url,
                excerpt: `${key} · ${s.summary}`,
              });
          }
      for (const key of keys)
        for (const s of codeByKey.get(key) ?? [])
          if (
            s.kind === "github" &&
            !s.archived &&
            validDate(s.publishedAt, input.asOf) &&
            Date.parse(input.asOf) - Date.parse(s.publishedAt!) >= 730 * 86400000 &&
            validDate(s.pushedAt, input.asOf) &&
            Date.parse(input.asOf) - Date.parse(s.pushedAt!) <= 365 * 86400000 &&
            !codeIds.has(s.id)
          ) {
            codeIds.add(s.id);
            code.push({
              id: s.id,
              kind: "github",
              title: s.title,
              url: s.url,
              excerpt: `${key} · created ${s.publishedAt} · pushed ${s.pushedAt}`,
            });
          }
      if (evidence.length < 3)
        evidence.push({
          id: p.id,
          kind: "paper",
          title: p.title,
          url: p.url,
          excerpt: `${p.publishedAt.slice(0, 10)} · ${p.abstract.slice(0, 600)}`,
        });
    }
    const dataSpanDays = Math.max(
      0,
      ...[...datasetDates.values()].map((set) => {
        const dates = [...set].sort();
        return (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86400000;
      }),
    );
    const gaps: Text[] = [];
    if (members.length < 3 || spanDays < 730 || years.length < 3)
      gaps.push({
        zh: "尚不足 3 篇独立作品、730 天跨度及 3 个发表年份",
        en: "Requires 3 works, a 730-day span and 3 publication years",
      });
    if (logicPapers < 2)
      gaps.push({
        zh: "不足 2 篇同时包含问题、方法、验证和结果线索的论文",
        en: "Fewer than 2 papers contain problem, method, evaluation and result cues",
      });
    if (!data.length || dataSpanDays < 365)
      gaps.push({
        zh: "未找到跨至少一年重复出现的同一数据资源开放链接",
        en: "No shared data availability link documented across at least one year",
      });
    if (!code.length)
      gaps.push({
        zh: "未找到明确关联、创建满两年且近一年有提交的非归档仓库",
        en: "No explicitly linked, non-archived repository created at least two years ago and pushed within a year",
      });
    niches.push({
      id,
      label: n.label,
      count: members.length,
      share,
      years,
      spanDays,
      logicPapers,
      data,
      code: code.slice(0, 5),
      news,
      dataSpanDays,
      ready: !gaps.length,
      evidenceStatus: gaps.length ? "pending" : "sufficient",
      gaps,
      evidence,
    });
  }
  niches.sort(
    (a, b) =>
      Number(b.ready) - Number(a.ready) ||
      a.gaps.length - b.gaps.length ||
      b.spanDays - a.spanDays ||
      a.id.localeCompare(b.id),
  );
  return {
    version: ANALYSIS_RULE_VERSION,
    historyTotal: papers.length,
    windowStart,
    totals,
    excluded,
    duplicates,
    unmatched,
    directions,
    niches,
    asOf: input.asOf,
  };
}
