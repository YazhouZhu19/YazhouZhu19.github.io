/** Explainable metadata rules; neither the level nor its reasons imply human/AI review. */
export type SignalRelevance = { level: "direct" | "candidate"; reasons: string[] };
export type GitHubRelevanceInput = {
  fullName?: string;
  description?: string;
  summary?: string;
  topics?: readonly string[];
  readmeExcerpt?: string;
};
export type NewsRelevanceInput = { title: string; summary?: string; publisher?: string };
export const SIGNAL_RELEVANCE_VERSION = "2026-10-15-v2";
export const RELEVANCE_REASON_LABELS: Record<string, { zh: string; en: string }> = {
  "explicit-medical-imaging": {
    zh: "名称或摘要含明确医学影像词",
    en: "Explicit medical imaging terms in name or description",
  },
  "modality-and-task": { zh: "影像模态与任务同时出现", en: "Imaging modality and task co-occur" },
  "anatomy-and-imaging": { zh: "解剖部位与影像任务同时出现", en: "Anatomy and an imaging task co-occur" },
  "imaging-infrastructure": { zh: "医学影像格式或基础工具", en: "Medical imaging format or infrastructure" },
  "topic-only": { zh: "医学影像线索仅见于主题标签", en: "Medical imaging evidence only in topic tags" },
  "readme-only": {
    zh: "医学影像线索仅见于 README 摘录",
    en: "Medical imaging evidence only in a README excerpt",
  },
  "ambiguous-domain": { zh: "模态或术语存在领域歧义", en: "Modality or terminology has ambiguous scope" },
  "resource-list": {
    zh: "论文清单或资源汇编，需核对实现内容",
    en: "Paper list or resource collection; implementation unverified",
  },
  "educational-resource": { zh: "课程、教程或学习资料", en: "Coursework, tutorial or learning material" },
  "demonstration-project": {
    zh: "演示、原型或个人展示项目",
    en: "Demonstration, prototype or portfolio project",
  },
  "research-progress": {
    zh: "标题或摘要含研究、模型、工具或验证进展",
    en: "Research, model, tool or validation signal in title or summary",
  },
  "snippet-only": { zh: "相关性线索主要来自摘要", en: "Relevance evidence primarily comes from the summary" },
  "mixed-announcement": {
    zh: "技术进展与商业或人事消息混合",
    en: "Technical progress mixed with business or personnel news",
  },
  "business-announcement": {
    zh: "投融资、人事、市场或渠道消息，尚非技术进展证据",
    en: "Finance, personnel, market or distribution news, not technical-progress evidence",
  },
  "administrative-announcement": {
    zh: "行政调查、设施或设备配置消息",
    en: "Administrative inquiry, facility or equipment-allocation news",
  },
  "commentary-or-education": {
    zh: "评论、访谈、播客或操作教学",
    en: "Commentary, interview, podcast or practical instruction",
  },
  "paper-linked": { zh: "现有论文库中的明确仓库链接", en: "Explicit repository link in the paper library" },
  "curated-source": {
    zh: "既有精选来源，元数据尚不足以确认范围",
    en: "Existing curated source; metadata does not establish scope",
  },
  "legacy-unmatched": {
    zh: "旧库保留记录，当前规则未确认相关性",
    en: "Retained historical record; current rules do not establish relevance",
  },
};

const normalize = (value = "") => value.slice(0, 12000).replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
const EXPLICIT =
  /\b(?:medical|biomedical|clinical|healthcare)\s+imag(?:e|es|ing)|\bradiolog(?:y|ical|ist)|\bradiograph|\bhistopatholog|\bhistolog|\b(?:computational|digital) pathology\b|\bwhole slide imag|\bpathology slides?\b|\bneuroimag|\bradiomics?\b|\bdermoscop|\bmammograph|\bangiograph|\bechocardiograph|\bfundus\b|\bretinal?\b|\bcolonoscopy\b|\bendoscop|\bbioimag|\bradiotherap|\bsurgical video\b|\b(?:skin|breast) lesion\b|\bnuclear medicine\b|医[学疗]影像|医[学疗]图像|影像诊断|计算病理|数字病理|组织病理|影像组学|放射影像|磁共振|超声影像|超声图像|超声心动|胸片|眼底|皮肤镜|内镜影像|脑影像|心脏影像|细胞影像/i;
const INFRASTRUCTURE =
  /\b(?:dicom|dicomweb|nifti|simpleitk|itk snap|monai|nnunet|medsam|totalsegmentator|dcm2niix|nibabel)\b/i;
const STRONG_MODALITY =
  /\b(?:mri|fmri|dmri|cbct)\b|magnetic resonance|computed tomography|positron emission tomography|single photon emission|optical coherence tomography/i;
const AMBIGUOUS_MODALITY =
  /\b(?:ct|pet|spect|oct|ultrasound|microscopy|microscopic|pathology|tomography)\b|超声|显微|断层/i;
const IMAGING_TASK =
  /\bimag(?:e|es|ing)\b|segment|reconstruct|registrat|radiomic|\bscan(?:s|ner|ning)?\b|denois|super resolution|tomograph|volumetric|annotation|\bartifact|visualiz|图像|影像|分割|重建|配准|去噪|超分辨|阅片/i;
const DETECTION_TASK = /detect|classif|diagnos|model|预测|检测|分类|诊断|模型/i;
const ANATOMY =
  /\b(?:brain|breast|prostate|lung|thorax|thoracic|cardiac|heart|kidney|liver|pancrea\w*|abdominal|pelvic|bone|musculoskeletal|dental|tooth|teeth|retin\w*|fundus|tumou?r|lesion|organ|tissue|nuclei|cells?|polyp|airway|vessel|vascular)\b|脑|肺|肝|肾|心脏|乳腺|前列腺|骨骼|牙齿|器官|病灶|细胞/i;
const MEDICAL_CONTEXT =
  /\b(?:medical|biomedical|biomedicine|patient|clinical|cancer|oncolog|hospital|radiation|healthcare)\b|医学|医疗|患者|临床|肿瘤|医院/i;
const NONMEDICAL_HARD =
  /certificate transparency|\b(?:stock market|trading bot|crypto trading|ultrasonic ranging|obstacle avoidance|distance sensor|distance measurement)\b|\b(?:pet adoption|pet shop|pet food|pet breed)\b|股市|股票交易|超声波测距/i;
const NONMEDICAL_SOFT =
  /\b(?:arduino|blockchain|wallet|cryptocurrency|satellite|remote sensing|astronomy|astronomical|industrial inspection|non destructive testing)\b|遥感|卫星|天文|工业检测|无损检测/i;
const RESOURCE =
  /\bawesome\b|reading list|papers? reading|curated (?:list|collection)|(?:paper|publication)s? list|list of (?:papers|publications)|\bpapers\s+(?:on|for|about|in)\b|notes and open discussion|论文清单|论文列表|资源汇总/i;
const EDUCATIONAL =
  /course assignment|\bhomework\b|\bcoursework\b|\bcoursera\b|\btutorial\b|\bcourse\b|课程|作业|学习笔记/i;
const DEMONSTRATION =
  /\bportfolio\b|front end(?: only)? (?:prototype|mockup|demo)|fictional data for demonstration|(?:mockup|prototype) (?:website|landing page)|个人主页|展示页面/i;

function directEvidence(value: string): string | null {
  if (EXPLICIT.test(value)) return "explicit-medical-imaging";
  if (INFRASTRUCTURE.test(value)) return "imaging-infrastructure";
  if (
    /\bx\s?rays?\b/i.test(value) &&
    (MEDICAL_CONTEXT.test(value) || /\bsurg(?:ery|eries|ical)\b/i.test(value))
  )
    return "modality-and-task";
  if (STRONG_MODALITY.test(value) && (IMAGING_TASK.test(value) || DETECTION_TASK.test(value)))
    return "modality-and-task";
  if (
    AMBIGUOUS_MODALITY.test(value) &&
    (IMAGING_TASK.test(value) || DETECTION_TASK.test(value)) &&
    (ANATOMY.test(value) || MEDICAL_CONTEXT.test(value))
  )
    return "modality-and-task";
  // Established modality/task phrases do not need the generic word "medical".
  if (
    /\b(?:CT|PET|SPECT)\s+(?:image|imaging|reconstruction|segmentation|scan)\b|\bultrasound\s+(?:imaging|segmentation)\b|\bOCT\s+(?:retinal|retina)\b/i.test(
      value,
    )
  )
    return "modality-and-task";
  if (/\b(?:lesions?|nodules?|polyps?)\b|病灶|结节|息肉/i.test(value) && DETECTION_TASK.test(value))
    return "anatomy-and-imaging";
  if (/\bmicroscop/i.test(value) && (ANATOMY.test(value) || MEDICAL_CONTEXT.test(value)))
    return "modality-and-task";
  if (ANATOMY.test(value) && IMAGING_TASK.test(value)) return "anatomy-and-imaging";
  return null;
}
function domainCandidate(value: string): boolean {
  return (
    STRONG_MODALITY.test(value) ||
    (AMBIGUOUS_MODALITY.test(value) &&
      (IMAGING_TASK.test(value) ||
        DETECTION_TASK.test(value) ||
        /\bAI\b|learning|report|人工智能|学习|报告/i.test(value))) ||
    (ANATOMY.test(value) && DETECTION_TASK.test(value)) ||
    (MEDICAL_CONTEXT.test(value) && /vision|multimodal|视觉|多模态/i.test(value))
  );
}

export function classifyGitHubRelevance(input: GitHubRelevanceInput): SignalRelevance | null {
  if (/^config files for (?:my|the) github profile\.?$/i.test(normalize(input.description ?? input.summary)))
    return null;
  const fullName = input.fullName ?? "";
  const primary = normalize(
    `${fullName} ${fullName.replace(/([a-z])([A-Z])/g, "$1 $2")} ${input.description ?? input.summary ?? ""}`,
  );
  const topics = normalize((input.topics ?? []).join(" "));
  const readme = normalize(input.readmeExcerpt);
  // Metadata tags alone cannot rescue an explicitly unrelated project.
  if (NONMEDICAL_HARD.test(primary) && !EXPLICIT.test(primary) && !INFRASTRUCTURE.test(primary)) return null;
  if (
    NONMEDICAL_SOFT.test(primary) &&
    !EXPLICIT.test(primary) &&
    !INFRASTRUCTURE.test(primary) &&
    !MEDICAL_CONTEXT.test(primary)
  )
    return null;
  if (/\b(?:wallet|blockchain)\b/i.test(primary) && !EXPLICIT.test(primary) && !INFRASTRUCTURE.test(primary))
    return null;
  const evidence = directEvidence(primary);
  const reasons: string[] = evidence ? [evidence] : [];
  if (!evidence) {
    if (directEvidence(topics)) reasons.push("topic-only");
    else if (directEvidence(readme)) reasons.push("readme-only");
    else if (domainCandidate(primary)) reasons.push("ambiguous-domain");
    else return null;
  }
  const scope = `${primary} ${readme}`;
  if (RESOURCE.test(scope)) reasons.push("resource-list");
  if (EDUCATIONAL.test(primary)) reasons.push("educational-resource");
  if (DEMONSTRATION.test(primary)) reasons.push("demonstration-project");
  return { level: evidence && reasons.length === 1 ? "direct" : "candidate", reasons };
}

const PROGRESS =
  /\b(?:models?|AI|algorithm|software|datasets?|benchmarks?|releases?|released|launch(?:es|ed)?|trials?|validation|validated|research|researchers|study|studies|updates?)\b|artificial intelligence|deep learning|machine learning|open source|FDA clearance|模型|人工智能|深度学习|开源|数据集|评测|发布|研究|验证|试验|软件|工具|获批/i;
const BUSINESS =
  /\b(?:earnings|IPO|stock price|investor conference|market size|market share|market forecast|market report|market update|market companies|market research|market push|market to|CAGR|private equity|recurring revenue)\b|\bmarket\b.{0,55}\b(?:billion|million|growth|boom|reach|20\d\d)\b|\bacquires\b(?!\s+(?:images?|scans?|knowledge|data|signals?))|\b(?:acquire|acquired|acquisition)\b.{0,60}(?:\$|€|£|million|billion|company|business|deal)|\b(?:appoints?|invests?|investing|investors|funding)\b|board of directors|\bnew CEO\b|\braises?\s+[$€£¥]|\b(?:funds|grant|contract)\b|\b(?:partnership|partners?)\b.{0,45}\b(?:expand|access|market|globally)\b|\bexpand\w*\s+(?:subscription|access|partnership|market)\b|\btop AI\b.*\bcompanies\b|\b(?:ASX|NYSE|NASDAQ):|\(\d+\.HK\)|港交所|港股|招股|募资|融资|营收|新股消息|上市|市值|专精龙头|增长提速|人事任命|出任|市场.{0,20}(?:规模|份额|增长|亿)/i;
const SUBSTANTIVE_TITLE =
  /\b(?:validated|validation|trials?|study|studies)\b|FDA clearance|clinical study|验证|试验|获批|(?:release[sd]?|launch(?:es|ed)?|introduces?|发布|开源).{0,70}(?:model|algorithm|software|dataset|benchmark|scanner|viewer|模型|算法|软件|数据集)|(?:model|algorithm|software|dataset|benchmark|scanner|viewer|模型|算法|软件|数据集).{0,70}(?:release[sd]?|launch(?:es|ed)?|发布|开源)/i;
const ADMINISTRATIVE =
  /\binquiry\b|\bprobe\s+(?:into|launched)\b|\b(?:launches?|orders?)\s+(?:a\s+)?probe\b|\binvestigation\s+(?:launched|into)\b|\b(?:facility|facilities|department|hospital)\b.{0,45}\b(?:opens?|opening|expansion|renovation|inaugurat\w*)\b|\b(?:opens?|opening|inaugurat\w*)\b.{0,45}\b(?:facility|department|hospital)\b|\bto receive\b.{0,90}\b(?:machines|units|fund)\b|行政调查|立案调查|问责|院区扩建|设备采购|设备配置|揭牌/i;
const COMMENTARY =
  /\b(?:podcast|editorial|commentary|opinion|webinar|tutorial)\b|\ban interview with\b|\bletters\b|\bhow to (?:integrate|use|implement|read|interpret)\b|\bhow AI (?:is )?(?:transforming|reshaping|solving)\b|\bAI is transforming\b|\bwhy\b.{0,70}\b(?:matters|prefer)\b|\bcan it be trusted\b|\b(?:training course|continuing education)\b|播客|社论|评论文章|访谈|操作教学|培训课程|科普讲座/i;

export function classifyNewsRelevance(input: NewsRelevanceInput): SignalRelevance | null {
  const title = normalize(input.title),
    summary = normalize(input.summary),
    combined = `${title} ${summary}`;
  if (NONMEDICAL_HARD.test(combined) && !EXPLICIT.test(combined) && !INFRASTRUCTURE.test(combined))
    return null;
  if (
    NONMEDICAL_SOFT.test(combined) &&
    !EXPLICIT.test(combined) &&
    !INFRASTRUCTURE.test(combined) &&
    !MEDICAL_CONTEXT.test(combined)
  )
    return null;
  // Domain-related announcements and commentary remain discoverable, but do not
  // enter the default technical-progress view on the strength of words like "AI"
  // or "launched" alone. A real software release or study is not excluded.
  const business = BUSINESS.test(title),
    administrative = ADMINISTRATIVE.test(title),
    commentary = COMMENTARY.test(title);
  const contextual = business || administrative || commentary;
  if (!PROGRESS.test(combined) && !contextual) return null;
  const titleEvidence = directEvidence(title),
    evidence = titleEvidence ?? directEvidence(combined);
  if (!evidence && !domainCandidate(combined)) return null;
  const reasons = evidence ? [evidence] : ["ambiguous-domain"];
  if (!contextual || SUBSTANTIVE_TITLE.test(title)) reasons.push("research-progress");
  if (!titleEvidence && evidence) reasons.push("snippet-only");
  if (business) reasons.push(SUBSTANTIVE_TITLE.test(title) ? "mixed-announcement" : "business-announcement");
  if (administrative) reasons.push("administrative-announcement");
  if (commentary) reasons.push("commentary-or-education");
  return { level: titleEvidence && !contextual ? "direct" : "candidate", reasons };
}

export const evaluateGitHubRelevance = classifyGitHubRelevance;
export const evaluateNewsRelevance = classifyNewsRelevance;
