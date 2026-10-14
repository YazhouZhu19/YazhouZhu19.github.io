export interface GitHubDiscoveryGroup {
  id: string;
  labelZh: string;
  labelEn: string;
  queries: string[];
}

/**
 * These are retrieval routes, not verified research-task classifications.
 * GitHub repository search supports in:name,description,readme and topic:
 * https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
 * Keep the catalog bounded so each route can receive an independent search budget.
 * Bump the version when routes change to invalidate the collector's source cache.
 */
export const GITHUB_DISCOVERY_VERSION = "2026-10-14-v2";
const query = (terms: string): string => `${terms} fork:false archived:false`;

export const GITHUB_DISCOVERY_GROUPS: GitHubDiscoveryGroup[] = [
  {
    id: "segmentation", labelZh: "器官与病灶分割", labelEn: "Organ & lesion segmentation",
    queries: [query("medical segmentation in:name,description"), query("topic:medical-image-segmentation")],
  },
  {
    id: "detection", labelZh: "病灶与结节检测", labelEn: "Lesion & nodule detection",
    queries: [query('"lesion detection" in:name,description'), query('"nodule detection" in:name,description')],
  },
  {
    id: "classification", labelZh: "分类与辅助诊断", labelEn: "Classification & diagnosis",
    queries: [query("medical classification in:name,description")],
  },
  {
    id: "reconstruction", labelZh: "影像重建与加速采集", labelEn: "Reconstruction & accelerated acquisition",
    queries: [query("MRI reconstruction in:name,description"), query("CT reconstruction in:name,description")],
  },
  {
    id: "registration", labelZh: "配准与运动估计", labelEn: "Registration & motion estimation",
    queries: [query("medical registration in:name,description")],
  },
  {
    id: "radiomics", labelZh: "影像组学", labelEn: "Radiomics",
    queries: [query("radiomics in:name,description")],
  },
  {
    id: "prognosis", labelZh: "预后与生存预测", labelEn: "Prognosis & survival prediction",
    queries: [query("imaging survival in:name,description")],
  },
  {
    id: "vision-language", labelZh: "图文模型与报告生成", labelEn: "Vision-language & reporting",
    queries: [query("radiology report in:name,description"), query('medical "vision-language" in:name,description,readme')],
  },
  {
    id: "foundation-models", labelZh: "基础模型与提示学习", labelEn: "Foundation models & prompting",
    queries: [query("medical foundation in:name,description")],
  },
  {
    id: "self-supervised", labelZh: "自监督与表征学习", labelEn: "Self-supervised & representation learning",
    queries: [query('medical "self-supervised" in:name,description')],
  },
  {
    id: "domain-adaptation", labelZh: "域适应与泛化", labelEn: "Domain adaptation & generalization",
    queries: [query('medical "domain adaptation" in:name,description')],
  },
  {
    id: "interactive-annotation", labelZh: "交互分析与标注", labelEn: "Interactive analysis & annotation",
    queries: [query('"medical image" annotation in:name,description,readme')],
  },
  {
    id: "pathology", labelZh: "计算病理", labelEn: "Computational pathology",
    queries: [query('"computational pathology" in:name,description')],
  },
  {
    id: "retinal", labelZh: "眼底与视网膜影像", labelEn: "Fundus & retinal imaging",
    queries: [query("retinal in:name,description")],
  },
  {
    id: "ultrasound", labelZh: "超声影像", labelEn: "Ultrasound imaging",
    queries: [query("ultrasound imaging in:name,description"), query("ultrasound segmentation in:name,description")],
  },
  {
    id: "volumetric", labelZh: "三维 CT／MRI 分析", labelEn: "3D CT / MRI analysis",
    queries: [query('"3D" medical in:name,description'), query("medical volumetric in:name,description,readme")],
  },
  {
    id: "datasets", labelZh: "数据集与评测", labelEn: "Datasets & evaluation",
    queries: [query('"medical imaging" dataset in:name,description,readme')],
  },
  {
    id: "toolkits", labelZh: "工具框架与工作流", labelEn: "Toolkits & workflows",
    queries: [query('"medical imaging" toolkit in:name,description,readme')],
  },
];

export function getGitHubDiscoveryGroup(id: string): GitHubDiscoveryGroup | undefined {
  return GITHUB_DISCOVERY_GROUPS.find(group => group.id === id);
}
