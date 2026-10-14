import type { ResearchSignal } from "./research-signals";

export interface SignalBrowseCategory {
  id: string;
  labelZh: string;
  labelEn: string;
  discoveryGroups: readonly string[];
  fallback?: boolean;
}

// These broad browsing categories summarize retrieval routes. They neither
// change the collection queries nor assert a verified semantic classification.
const githubCategories: readonly SignalBrowseCategory[] = [
  { id: "diagnostic-tasks", labelZh: "分割、检测与诊断", labelEn: "Segmentation, detection & diagnosis", discoveryGroups: ["segmentation", "detection", "classification"] },
  { id: "image-formation", labelZh: "重建、增强与生成", labelEn: "Reconstruction, enhancement & generation", discoveryGroups: ["reconstruction", "enhancement", "synthesis"] },
  { id: "spatial-temporal", labelZh: "配准、三维与纵向分析", labelEn: "Registration, 3D & longitudinal analysis", discoveryGroups: ["registration", "volumetric", "longitudinal"] },
  { id: "foundation-multimodal", labelZh: "基础模型、图文与多模态", labelEn: "Foundation, vision-language & multimodal models", discoveryGroups: ["foundation-models", "vision-language", "multimodal"] },
  { id: "learning-trustworthiness", labelZh: "自监督、泛化与可信 AI", labelEn: "Self-supervision, generalization & trustworthy AI", discoveryGroups: ["self-supervised", "domain-adaptation", "federated", "uncertainty", "quality-control"] },
  { id: "radiomics-treatment", labelZh: "影像组学、预后与放疗", labelEn: "Radiomics, prognosis & radiotherapy", discoveryGroups: ["radiomics", "prognosis", "radiotherapy"] },
  { id: "radiology-nuclear", labelZh: "放射与核医学影像", labelEn: "Radiology & nuclear imaging", discoveryGroups: ["ct", "mri", "pet-spect", "xray"] },
  { id: "ultrasound-specialties", labelZh: "超声、眼科、内镜与皮肤", labelEn: "Ultrasound, ophthalmology, endoscopy & skin", discoveryGroups: ["ultrasound", "retinal", "endoscopy", "dermatology"] },
  { id: "pathology-microscopy", labelZh: "病理与生物医学显微", labelEn: "Pathology & biomedical microscopy", discoveryGroups: ["pathology", "microscopy"] },
  { id: "organ-disease", labelZh: "器官与疾病应用", labelEn: "Organ & disease applications", discoveryGroups: ["brain", "cardiac", "chest", "abdominal", "breast", "prostate", "musculoskeletal", "dental"] },
  { id: "data-annotation-evaluation", labelZh: "数据、标注与评测", labelEn: "Data, annotation & evaluation", discoveryGroups: ["datasets", "interactive-annotation"] },
  { id: "software-workflows", labelZh: "软件平台与影像工作流", labelEn: "Software platforms & imaging workflows", discoveryGroups: ["toolkits", "dicom-pacs", "nifti-itk"] },
  { id: "general-resources", labelZh: "综合资源与交叉方向", labelEn: "General resources & cross-cutting topics", discoveryGroups: ["medical-imaging", "forked-projects"], fallback: true },
];

const newsCategories: readonly SignalBrowseCategory[] = [
  { id: "foundation-multimodal", labelZh: "基础、生成与多模态模型", labelEn: "Foundation, generative & multimodal models", discoveryGroups: ["foundation-models", "vision-language"] },
  { id: "radiology-nuclear", labelZh: "放射与核医学影像", labelEn: "Radiology & nuclear imaging", discoveryGroups: ["ct-mri", "pet-spect", "xray"] },
  { id: "ultrasound-cardiovascular", labelZh: "超声与心血管影像", labelEn: "Ultrasound & cardiovascular imaging", discoveryGroups: ["ultrasound", "cardiac"] },
  { id: "pathology-microscopy", labelZh: "病理与生物医学显微", labelEn: "Pathology & biomedical microscopy", discoveryGroups: ["pathology", "microscopy"] },
  { id: "specialty-imaging", labelZh: "眼科、皮肤与内镜影像", labelEn: "Ophthalmic, skin & endoscopic imaging", discoveryGroups: ["retinal", "dermatology", "endoscopy"] },
  { id: "neuroimaging", labelZh: "脑与神经影像", labelEn: "Brain & neuroimaging", discoveryGroups: ["brain"] },
  { id: "segmentation-detection", labelZh: "分割与检测", labelEn: "Segmentation & detection", discoveryGroups: ["segmentation"] },
  { id: "data-software", labelZh: "数据、评测与软件工具", labelEn: "Data, evaluation & software tools", discoveryGroups: ["datasets", "toolkits"] },
  { id: "clinical-trustworthiness", labelZh: "临床验证与可信 AI", labelEn: "Clinical validation & trustworthy AI", discoveryGroups: ["clinical-validation", "federated"] },
  { id: "general-progress", labelZh: "综合进展与交叉方向", labelEn: "General progress & cross-cutting topics", discoveryGroups: ["medical-imaging"], fallback: true },
];

export function getSignalBrowseCategories(kind: ResearchSignal["kind"]): readonly SignalBrowseCategory[] {
  return kind === "github" ? githubCategories : newsCategories;
}

const categoryByRoute = Object.fromEntries((["github", "news"] as const).map(kind => [
  kind,
  new Map(getSignalBrowseCategories(kind).flatMap(category =>
    category.discoveryGroups.map(route => [route, category] as const))),
])) as Record<ResearchSignal["kind"], Map<string, SignalBrowseCategory>>;

export function getSignalBrowseCategoryIds(
  record: Pick<ResearchSignal, "kind" | "discoveryGroups">,
): string[] {
  const matched = new Set<string>();
  for (const route of record.discoveryGroups ?? []) {
    const category = categoryByRoute[record.kind].get(route);
    if (category && !category.fallback) matched.add(category.id);
  }
  const categories = getSignalBrowseCategories(record.kind);
  // One category per record per bucket; preserve multiple concrete directions.
  // General, missing and future routes are a fallback, not an extra catch-all tag.
  return categories.filter(category => matched.size ? matched.has(category.id) : category.fallback)
    .map(category => category.id);
}
