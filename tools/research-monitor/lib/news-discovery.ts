export interface NewsDiscoveryQuery {
  id: string;
  name: string;
  query: string;
  hl: string;
  gl: string;
  ceid: string;
  groupId?: string;
}
export const NEWS_DISCOVERY_VERSION = "2026-10-15-v3";
const en = (id: string, name: string, groupId: string, query: string): NewsDiscoveryQuery =>
  ({ id, name: `Google News · ${name}`, groupId, query, hl: "en-US", gl: "US", ceid: "US:en" });
const zh = (id: string, name: string, groupId: string, query: string): NewsDiscoveryQuery =>
  ({ id, name: `Google News · ${name}`, groupId, query, hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" });

const imaging = '("medical imaging" OR radiology OR MRI OR "computed tomography" OR "digital pathology" OR ultrasound OR retinal OR endoscopy)';
const progress = '(AI OR model OR algorithm OR research OR dataset OR software OR validation)';
const imagingZh = '(医学影像 OR 医疗影像 OR 磁共振 OR 数字病理 OR 计算病理 OR 超声影像 OR 内镜 OR 眼底)';
const progressZh = '(模型 OR 人工智能 OR 研究 OR 开源 OR 数据集 OR 算法 OR 验证)';

/** Named-publisher discovery complements direct feeds, especially for older posts. */
export const NEWS_PUBLISHER_QUERIES: NewsDiscoveryQuery[] = [
  en("google-news-source-rsna", "RSNA 官方发布", "medical-imaging", `site:rsna.org ${imaging} ${progress}`),
  en("google-news-source-google", "Google Research", "foundation-models", 'site:research.google (MedGemma OR MedSigLIP OR "medical imaging" OR radiology OR pathology) (model OR AI OR research)'),
  en("google-news-source-microsoft", "Microsoft Research", "foundation-models", 'site:microsoft.com (BiomedParse OR MAIRA OR "medical imaging" OR "digital pathology") (model OR research OR release)'),
  en("google-news-source-nvidia", "NVIDIA 医疗影像", "toolkits", 'site:nvidia.com (MONAI OR "medical imaging" OR "surgical AI" OR "digital pathology") (model OR research OR release OR software)'),
  en("google-news-source-auntminnie", "AuntMinnie", "medical-imaging", `site:auntminnie.com ${imaging} ${progress}`),
  en("google-news-source-health-imaging", "Health Imaging", "medical-imaging", `site:healthimaging.com ${imaging} ${progress}`),
  en("google-news-source-radiology-business", "Radiology Business", "medical-imaging", `site:radiologybusiness.com ${imaging} ${progress}`),
  en("google-news-source-itn", "Imaging Technology News", "medical-imaging", `site:itnonline.com ${imaging} ${progress}`),
  en("google-news-source-diagnostic-imaging", "Diagnostic Imaging", "medical-imaging", `site:diagnosticimaging.com ${imaging} ${progress}`),
  en("google-news-source-stanford", "Stanford Medicine", "medical-imaging", `site:med.stanford.edu/news ${imaging} ${progress}`),
  en("google-news-source-mit", "MIT News", "medical-imaging", `site:news.mit.edu ${imaging} ${progress}`),
  en("google-news-source-mayo", "Mayo Clinic", "medical-imaging", `site:newsnetwork.mayoclinic.org ${imaging} ${progress}`),
  en("google-news-source-ucsf", "UCSF", "medical-imaging", `site:ucsf.edu ${imaging} ${progress}`),
  en("google-news-source-ge", "GE HealthCare", "medical-imaging", `site:gehealthcare.com ${imaging} ${progress}`),
  en("google-news-source-siemens", "Siemens Healthineers", "medical-imaging", `site:siemens-healthineers.com ${imaging} ${progress}`),
  en("google-news-source-philips", "Philips", "medical-imaging", `site:philips.com ${imaging} ${progress}`),
  en("google-news-source-aidoc", "Aidoc", "clinical-validation", `site:aidoc.com ${imaging} ${progress}`),
  en("google-news-source-qure", "Qure.ai", "xray", 'site:qure.ai ("chest X-ray" OR radiology OR "medical imaging") (AI OR model OR research OR validation)'),
  en("google-news-source-pathai", "PathAI", "pathology", 'site:pathai.com (pathology OR histopathology OR PLUTO) (AI OR model OR research OR release)'),
  zh("google-news-source-cas", "中国科学院", "medical-imaging", `site:cas.cn ${imagingZh} ${progressZh}`),
  zh("google-news-source-tsinghua", "清华大学", "medical-imaging", `site:tsinghua.edu.cn ${imagingZh} ${progressZh} -招生 -招聘`),
  zh("google-news-source-sjtu", "上海交通大学", "medical-imaging", `site:sjtu.edu.cn ${imagingZh} ${progressZh} -招生 -招聘`),
  zh("google-news-source-fudan", "复旦大学", "medical-imaging", `site:newsroom.fudan.edu.cn ${imagingZh} ${progressZh}`),
  zh("google-news-source-sciencenet", "科学网", "medical-imaging", `site:sciencenet.cn ${imagingZh} ${progressZh}`),
];

/** Discovery routes only: Google RSS snippets do not verify the underlying release. */
export const NEWS_QUERIES: NewsDiscoveryQuery[] = [
  // Preserve existing source IDs and provenance.
  en("google-news-imaging", "medical imaging", "medical-imaging", '"medical imaging" (model OR research OR release OR dataset OR trial OR software)'),
  en("google-news-radiology", "radiology models", "foundation-models", '(radiology OR pathology) ("foundation model" OR "open source" OR "AI model")'),
  zh("google-news-zh", "医学影像模型", "medical-imaging", '(医学影像 OR 医疗影像 OR 影像诊断) (模型 OR 开源 OR 发布 OR 研究 OR 验证 OR 数据集)'),
  en("google-news-ct-mri", "CT and MRI", "ct-mri", '(MRI OR "computed tomography") (reconstruction OR segmentation OR "AI model" OR "clinical study")'),
  en("google-news-nuclear", "PET and SPECT", "pet-spect", '("PET imaging" OR "SPECT imaging" OR "nuclear medicine") (model OR software OR reconstruction OR study)'),
  en("google-news-xray", "X-ray and mammography", "xray", '("chest X-ray" OR mammography) (AI OR model OR trial OR validation)'),
  en("google-news-ultrasound", "ultrasound", "ultrasound", '("ultrasound imaging" OR echocardiography) (AI OR model OR software OR study)'),
  en("google-news-pathology", "digital pathology", "pathology", '("digital pathology" OR histopathology) (model OR dataset OR release OR validation)'),
  en("google-news-retinal", "retinal and OCT", "retinal", '("retinal imaging" OR "optical coherence tomography" OR "fundus image") (AI OR model OR research OR trial)'),
  en("google-news-endoscopy", "endoscopy and surgical video", "endoscopy", '(endoscopy OR "surgical video" OR colonoscopy) (AI OR model OR dataset OR validation)'),
  en("google-news-dermatology", "dermoscopy", "dermatology", '(dermoscopy OR "skin lesion imaging") (AI OR model OR dataset OR study)'),
  en("google-news-microscopy", "cell microscopy", "microscopy", '("cell imaging" OR "biomedical microscopy" OR "bioimage analysis") (model OR software OR dataset OR release)'),
  en("google-news-neuro", "neuroimaging", "brain", '(neuroimaging OR "brain MRI") (model OR software OR dataset OR validation)'),
  en("google-news-cardiac", "cardiac imaging", "cardiac", '("cardiac imaging" OR "cardiac MRI" OR angiography) (AI OR model OR software OR trial)'),
  en("google-news-segmentation", "segmentation and detection", "segmentation", '("medical image segmentation" OR "lesion detection" OR "organ segmentation") (release OR model OR dataset OR research)'),
  en("google-news-generative", "generative and multimodal models", "vision-language", '("medical imaging" OR radiology) ("vision language" OR "diffusion model" OR "report generation" OR "multimodal model")'),
  en("google-news-datasets", "datasets and benchmarks", "datasets", '("medical imaging" OR radiology OR pathology) ("open dataset" OR benchmark OR challenge OR "data release")'),
  en("google-news-tools", "imaging tools", "toolkits", '(DICOM OR PACS OR MONAI OR SimpleITK) (release OR software OR "open source" OR update)'),
  en("google-news-clinical", "clinical validation", "clinical-validation", '("medical imaging" OR radiology) ("prospective study" OR "randomized trial" OR "external validation" OR "FDA clearance")'),
  en("google-news-robustness", "privacy and robust models", "federated", '("medical imaging" OR radiology) ("federated learning" OR "domain adaptation" OR "self-supervised" OR uncertainty)'),
  zh("google-news-zh-modalities", "多模态影像进展", "ct-mri", '(磁共振 OR CT影像 OR 超声影像 OR PET影像) (重建 OR 分割 OR 人工智能 OR 开源 OR 临床验证)'),
  zh("google-news-zh-pathology", "病理与细胞影像", "pathology", '(数字病理 OR 计算病理 OR 细胞影像) (模型 OR 数据集 OR 开源 OR 研究)'),
  zh("google-news-zh-specialties", "专科影像模型", "retinal", '(眼底影像 OR 内镜影像 OR 皮肤镜 OR 心脏影像) (模型 OR 人工智能 OR 研究 OR 验证)'),
  zh("google-news-zh-data-tools", "影像数据、工具与验证", "datasets", '(医学影像 OR 医疗影像) (数据集 OR 评测 OR 工具 OR 联邦学习 OR 多中心 OR 临床试验)'),
  ...NEWS_PUBLISHER_QUERIES,
];

const labels: Array<[string, string, string]> = [
  ["medical-imaging", "医学影像综合", "Medical imaging"], ["foundation-models", "基础模型", "Foundation models"],
  ["ct-mri", "CT 与 MRI", "CT & MRI"], ["pet-spect", "PET／SPECT", "PET / SPECT"], ["xray", "X 光与乳腺摄影", "X-ray & mammography"],
  ["ultrasound", "超声与心超", "Ultrasound & echocardiography"], ["pathology", "病理与细胞", "Pathology & cells"],
  ["retinal", "眼底及专科影像", "Retinal & specialty imaging"], ["endoscopy", "内镜与手术视频", "Endoscopy & surgical video"],
  ["dermatology", "皮肤镜", "Dermoscopy"], ["microscopy", "显微与生物影像", "Microscopy & bioimaging"],
  ["brain", "神经影像", "Neuroimaging"], ["cardiac", "心血管影像", "Cardiovascular imaging"],
  ["segmentation", "分割与检测", "Segmentation & detection"], ["vision-language", "生成与多模态", "Generative & multimodal"],
  ["datasets", "数据集与评测", "Datasets & evaluation"], ["toolkits", "软件与工具", "Software & tools"],
  ["clinical-validation", "临床验证", "Clinical validation"], ["federated", "隐私与稳健性", "Privacy & robustness"],
];
export const NEWS_DISCOVERY_GROUPS = labels.map(([id, labelZh, labelEn]) => ({
  id, labelZh, labelEn, queries: NEWS_QUERIES.filter(item => item.groupId === id).map(item => item.query),
}));
