export interface GitHubDiscoveryGroup {
  id: string;
  labelZh: string;
  labelEn: string;
  queries: string[];
}

/**
 * Retrieval routes, not verified classifications or a completeness claim.
 * Historical repositories remain eligible. Separate fork-inclusive routes find
 * derivatives without letting common forks dominate every initial search.
 * https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
 */
export const GITHUB_DISCOVERY_VERSION = "2026-10-15-v3";
const group = (id: string, labelZh: string, labelEn: string, terms: string[]): GitHubDiscoveryGroup =>
  ({ id, labelZh, labelEn, queries: terms.map(term => `${term} fork:false`) });

// Existing IDs remain stable for saved filters and historical provenance.
export const GITHUB_DISCOVERY_GROUPS: GitHubDiscoveryGroup[] = [
  group("segmentation", "器官与病灶分割", "Organ & lesion segmentation", [
    "medical segmentation in:name,description", "topic:medical-image-segmentation", "医学 图像 分割 in:name,description",
  ]),
  group("detection", "病灶与结节检测", "Lesion & nodule detection", [
    '"lesion detection" in:name,description', '"nodule detection" in:name,description', '"polyp detection" in:name,description',
  ]),
  group("classification", "分类与辅助诊断", "Classification & diagnosis", [
    "medical classification in:name,description", "radiology diagnosis in:name,description", "病灶 分类 in:name,description",
  ]),
  group("reconstruction", "影像重建与加速采集", "Reconstruction & accelerated acquisition", [
    "MRI reconstruction in:name,description", "CT reconstruction in:name,description", "tomographic reconstruction in:name,description",
  ]),
  group("registration", "配准与运动估计", "Registration & motion estimation", [
    "medical registration in:name,description", "topic:medical-image-registration", "影像 配准 in:name,description",
  ]),
  group("radiomics", "影像组学", "Radiomics", ["radiomics in:name,description", "影像组学 in:name,description"]),
  group("prognosis", "预后与生存预测", "Prognosis & survival prediction", ["imaging survival in:name,description", "histopathology prognosis in:name,description"]),
  group("vision-language", "图文模型与报告生成", "Vision-language & reporting", [
    "radiology report in:name,description", 'medical "vision-language" in:name,description', '"medical image" "question answering" in:readme',
  ]),
  group("foundation-models", "基础模型与提示学习", "Foundation models & prompting", [
    "medical foundation in:name,description", 'medical "segment anything" in:name,description', "MedSAM in:name,description",
  ]),
  group("self-supervised", "自监督与表征学习", "Self-supervised & representation learning", ['medical "self-supervised" in:name,description', "imaging contrastive in:name,description"]),
  group("domain-adaptation", "域适应与泛化", "Domain adaptation & generalization", ['medical "domain adaptation" in:name,description', 'medical "domain generalization" in:name,description']),
  group("interactive-annotation", "交互分析与标注", "Interactive analysis & annotation", ['"medical image" annotation in:name,description', "DICOM annotation in:name,description"]),
  group("pathology", "计算病理", "Computational pathology", ['"computational pathology" in:name,description', "histopathology in:name,description", "topic:digital-pathology"]),
  group("retinal", "眼底与视网膜影像", "Fundus & retinal imaging", ["retinal in:name,description", "fundus in:name,description", '"optical coherence tomography" in:name,description']),
  group("ultrasound", "超声与超声心动图", "Ultrasound & echocardiography", ["ultrasound imaging in:name,description", "echocardiography in:name,description", "超声 影像 in:name,description"]),
  group("volumetric", "三维与四维影像分析", "3D & 4D imaging analysis", ['"3D" medical in:name,description', "medical volumetric in:name,description", "4D cardiac in:name,description"]),
  group("datasets", "数据集、挑战赛与评测", "Datasets, challenges & evaluation", ['"medical imaging" dataset in:name,description', "medical imaging benchmark in:name,description", "MICCAI challenge in:name,description"]),
  group("toolkits", "工具框架与工作流", "Toolkits & workflows", ['"medical imaging" toolkit in:name,description', "MONAI in:name,description", "医学影像 in:name,description"]),
  group("ct", "CT 与锥束 CT", "CT & cone-beam CT", ['"computed tomography" in:name,description', "CBCT in:name,description", "CT segmentation in:name,description"]),
  group("mri", "MRI、功能与扩散磁共振", "MRI, fMRI & diffusion MRI", ["topic:mri", "fMRI in:name,description", '"diffusion MRI" in:name,description']),
  group("pet-spect", "PET／SPECT 与核医学", "PET / SPECT & nuclear medicine", ["PET reconstruction in:name,description", "SPECT imaging in:name,description", '"positron emission tomography" in:name,description']),
  group("xray", "X 光与乳腺摄影", "X-ray & mammography", ['"chest x-ray" in:name,description', "mammography in:name,description", "radiograph in:name,description"]),
  group("endoscopy", "内镜、手术视频与息肉", "Endoscopy, surgical video & polyps", ["endoscopy in:name,description", '"surgical video" in:name,description', "colonoscopy in:name,description"]),
  group("dermatology", "皮肤镜与皮肤病灶", "Dermoscopy & skin lesions", ["dermoscopy in:name,description", '"skin lesion" in:name,description']),
  group("microscopy", "细胞与生物医学显微", "Cell & biomedical microscopy", ["cell microscopy in:name,description", "nuclei segmentation in:name,description", "bioimage in:name,description"]),
  group("brain", "脑影像与神经影像", "Brain & neuroimaging", ["neuroimaging in:name,description", "brain segmentation in:name,description", "脑影像 in:name,description"]),
  group("cardiac", "心脏、血管与血流", "Cardiac, vascular & blood flow", ["cardiac imaging in:name,description", "angiography in:name,description", "vessel segmentation in:name,description"]),
  group("chest", "肺部、胸部与气道", "Lung, chest & airways", ["lung segmentation in:name,description", "chest imaging in:name,description"]),
  group("abdominal", "腹部、肝肾与消化系统", "Abdominal, liver & kidney imaging", ["abdominal segmentation in:name,description", "liver tumor in:name,description", "kidney imaging in:name,description"]),
  group("breast", "乳腺影像", "Breast imaging", ["breast imaging in:name,description", "breast ultrasound in:name,description"]),
  group("prostate", "前列腺与盆腔影像", "Prostate & pelvic imaging", ["prostate MRI in:name,description", "pelvic segmentation in:name,description"]),
  group("musculoskeletal", "骨骼、关节与肌肉", "Musculoskeletal imaging", ["musculoskeletal imaging in:name,description", "bone segmentation in:name,description"]),
  group("dental", "口腔、牙科与颌面", "Dental & maxillofacial imaging", ["dental imaging in:name,description", "tooth segmentation in:name,description"]),
  group("radiotherapy", "放疗影像与剂量规划", "Radiotherapy imaging & dose planning", ["radiotherapy in:name,description", "dose prediction in:name,description"]),
  group("synthesis", "影像合成与生成模型", "Image synthesis & generative models", ['medical "diffusion model" in:name,description', "medical synthesis in:name,description", '"CT" "MRI" synthesis in:name,description']),
  group("enhancement", "去噪、超分辨与伪影校正", "Denoising, super-resolution & artifact correction", ["medical denoising in:name,description", 'MRI "super resolution" in:name,description', "CT artifact in:name,description"]),
  group("quality-control", "影像质量、协议与协调", "Image quality, protocols & harmonization", ['MRI "quality control" in:name,description', "imaging harmonization in:name,description"]),
  group("federated", "联邦学习与隐私计算", "Federated learning & privacy", ["medical imaging federated in:name,description", "医学影像 联邦 in:name,description"]),
  group("uncertainty", "不确定性、可解释与稳健性", "Uncertainty, explainability & robustness", ["medical imaging uncertainty in:name,description", "medical imaging explainability in:name,description"]),
  group("multimodal", "多模态影像与临床融合", "Multimodal imaging & clinical integration", ["medical multimodal in:name,description", "radiology pathology in:name,description"]),
  group("longitudinal", "纵向影像与疗效评估", "Longitudinal imaging & treatment response", ["longitudinal imaging in:name,description", "imaging treatment response in:name,description"]),
  group("dicom-pacs", "DICOM、PACS 与影像阅片", "DICOM, PACS & image viewers", ["topic:dicom", "PACS imaging in:name,description", "DICOMweb in:name,description"]),
  group("nifti-itk", "NIfTI、ITK 与影像基础工具", "NIfTI, ITK & imaging infrastructure", ["NIfTI in:name,description", "SimpleITK in:name,description", "ITK medical in:name,description"]),
  group("medical-imaging", "医学影像通用入口与中文资源", "General medical imaging & Chinese resources", ["topic:medical-imaging", '"medical image analysis" in:readme', "医疗影像 in:name,description"]),
  {
    id: "forked-projects", labelZh: "派生项目补充检索（包含 fork）", labelEn: "Derivative discovery (including forks)",
    queries: ["topic:medical-imaging fork:true", "medical segmentation in:name,description fork:true", "DICOM in:name,description fork:true"],
  },
];

export function getGitHubDiscoveryGroup(id: string): GitHubDiscoveryGroup | undefined {
  return GITHUB_DISCOVERY_GROUPS.find(item => item.id === id);
}
