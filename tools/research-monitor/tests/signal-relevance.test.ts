import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGitHubRelevance as github, classifyNewsRelevance as news, RELEVANCE_REASON_LABELS } from "../lib/signal-relevance";

const repository = (summary: string, fullName = "lab/research", topics: string[] = []) => ({ summary, fullName, topics });

test("explicit imaging modalities, specialty tasks and infrastructure survive broad discovery", () => {
  for (const summary of [
    "MRI reconstruction with learned priors", "brain tumor segmentation", "CT image registration", "retinal OCT classification",
    "lung nodule detection", "PET reconstruction benchmark", "breast lesion segmentation dataset", "Radiomics feature extraction",
    "DICOM viewer", "NIfTI processing", "SimpleITK registration", "CBCT artifact removal", "SPECT imaging software",
    "Endoscopy instrument tracking", "dermoscopy melanoma classification", "histopathology survival prediction",
    "nuclei segmentation", "cell microscopy analysis", "fMRI model evaluation", "echocardiography quality control",
    "3D vessel segmentation", "radiotherapy dose prediction", "牙齿图像分割", "医学影像联邦学习", "眼底病灶诊断", "CT segmentation", "Gigapixel Whole Slide Images", "3D organ visualization",
  ]) assert.equal(github(repository(summary))?.level, "direct", summary);
});

test("ambiguous acronym contexts and unrelated products do not become direct research evidence", () => {
  for (const summary of [
    "CT certificate transparency scanner", "PET pet breed classification", "Arduino ultrasound distance measurement",
    "Satellite image segmentation for remote sensing", "stock market imaging model", "generic LLM inference engine",
    "Segment anything foundation model", "Blockchain wallet for EHR", "remote sensing image reconstruction",
  ]) assert.equal(github(repository(summary)), null, summary);
  assert.equal(github(repository("MRI"))?.level, "candidate");
  assert.equal(github(repository("Large Language-and-Vision Assistant for Biomedicine"))?.level, "candidate");
  assert.equal(github(repository("Multi-Label Thorax Disease Classification"))?.level, "candidate");
  assert.equal(github(repository("Deep learning survival models", "PathologyDataScience/SurvivalNet"))?.level, "candidate");
  assert.equal(github(repository("OCT image model"))?.level, "candidate");
  assert.equal(github(repository("Microscopy image processing"))?.level, "candidate");
  assert.equal(github(repository("Medical imaging and remote sensing benchmark"))?.level, "direct");
  assert.equal(github(repository("Config files for my GitHub profile.", "PostboxRetinal/PostboxRetinal")), null);
});

test("educational and paper resources remain discoverable with explicit candidate reasons", () => {
  for (const summary of ["Medical imaging course assignment", "Medical imaging papers reading list", "Curated list of papers about radiology", "Notes and open discussion on medical imaging papers", "Medical image analysis portfolio"])
    assert.equal(github(repository(summary))?.level, "candidate", summary);
  assert(github(repository("Medical imaging paper list"))?.reasons.includes("resource-list"));
  assert(github(repository("Medical imaging tutorial"))?.reasons.includes("educational-resource"));
  assert.equal(github(repository("Medical imaging toolkit with implementations"))?.level, "direct");
});

test("topic-only and README-only evidence is preserved without treating it as a direct match", () => {
  const byTopic = github(repository("General modeling framework", "lab/framework", ["medical-imaging"]));
  assert.deepEqual(byTopic, { level: "candidate", reasons: ["topic-only"] });
  assert.deepEqual(github({ ...repository("A research implementation"), readmeExcerpt: "Experiments for MRI reconstruction." }), { level: "candidate", reasons: ["readme-only"] });
  assert.equal(github(repository("Cryptocurrency wallet", "lab/project", ["medical-imaging"])), null);
});

test("news includes non-AI tools, datasets and clinical validation across specialties", () => {
  for (const title of [
    "Researchers release open AI model for medical imaging", "New DICOM software released", "Public dataset for histopathology research",
    "Prospective study validates MRI reconstruction", "FDA clearance for new mammography algorithm", "Skin lesion model externally validated",
    "Cell microscopy dataset released", "New model detects lung nodules", "医学影像新模型发布", "数字病理多中心验证研究", "发布超声影像数据集",
  ]) assert.equal(news({ title })?.level, "direct", title);
  assert.equal(news({ title: "AI in spatial pathology: Deep learning on tissue data" })?.level, "candidate");
  assert.equal(news({ title: "AI Tool Evaluates Pathology Slides for Cancer" })?.level, "direct");
  assert.equal(news({ title: "DICOM software update released" })?.level, "direct");
  assert.equal(news({ title: "Medical imaging failure training" }), null);
  assert.equal(news({ title: "General language AI model released" }), null);
});

test("domain-related financial and personnel news stays candidate instead of technical-progress evidence", () => {
  for (const title of [
    "Medical Imaging AI Appoints Michelle to Board of Directors", "AI in Medical Imaging Market Size",
    "医学影像大模型第一股登陆港交所", "医学影像大模型专精龙头，范式升级驱动增长提速",
    "Top AI in Radiology Companies Transforming Medical Imaging and Diagnostics", "Radiology startup funding announced",
    "Medical imaging market report released", "Medical imaging company appoints new researcher",
  ]) assert.equal(news({ title })?.level, "candidate", title);
  assert.equal(news({ title: "Medical imaging startup raises $5m and releases open model" })?.level, "candidate");
  assert.equal(news({ title: "New system released", summary: "A medical imaging software toolkit" })?.level, "candidate");
});

test("administrative inquiries, market reports and commentary are retained only as contextual candidates", () => {
  for (const title of [
    "Inquiry launched into PIMS CT coronary angiography facility",
    "Medical Image Analysis Software Market to Reach US$ 6.3 Bn by 2031, Growing at 8.5% CAGR",
    "Optical Coherence Tomography Equipment Market To 2035: AI Retinal Diagnostics and Cardiology Expansion Fuel Growth",
    "Agilent to Acquire Proscia for Up to $270 Mn to Expand AI-Enabled Digital Pathology",
    "French surgical AI startup raises €6 million to turn surgical video into clinical records",
    "Ventripoint Expands Subscription Access to AI Cardiac Imaging",
    "Private equity invests in radiology AI firm AIRS Medical",
    "The Reading Room Podcast: Current Perspectives with AI in Breast Imaging",
    "Clarifying how AI really works in your MRI scan | PennLive letters",
    "Artificial Intelligence in Dermoscopy: Why Expert Oversight Still Matters",
    "How to integrate AI into cardiac imaging workflows",
    "Emerging Advances in PET Imaging Software: An Interview with Subtle Medical",
    "J&K To Receive 275 AI-Enabled Handheld X-Ray Machines, 9 MRI Units And 4 Mammography Units Under Prime Ministers Fund",
    "医学影像分析软件市场到2031年将达到64亿元",
  ]) assert.equal(news({ title })?.level, "candidate", title);
  assert(news({ title: "Inquiry launched into PIMS CT coronary angiography facility" })?.reasons.includes("administrative-announcement"));
  assert(news({ title: "MRI software tutorial" })?.reasons.includes("commentary-or-education"));
  assert.equal(news({ title: "Inquiry launched into railway station" }), null);
});

test("real releases, datasets, trials and systematic reviews are not demoted by contextual vocabulary", () => {
  for (const title of [
    "Fujifilm Launches Synapse Pathology v3.0, Advancing Digital Pathology With Expanded AI Capabilities",
    "GE HealthCare Unveils 4D Dynamic PET Imaging Software at SNMMI Conference",
    "A Multi-center MRI Dataset with Expert Annotations and Clinicopathological Data",
    "Peer-Reviewed Study: Novice Users Acquire Diagnostic-Quality Cardiac Ultrasound Images With AI Guidance",
    "AI for Histopathology in Colorectal Cancer: An Updated Systematic Review and Meta-Analysis",
    "How AI model combining ultrasound and 3D breast scans may reduce false alarms",
    "First real-world trial shows AI could reduce need for contrast injections in heart MRI scans",
    "Mammography Study Shows Dynamic Changes of AI Risk Scores Years Before Breast Cancer Diagnosis",
    "Researchers release detailed brain scan database to help train the next generation of AI",
    "Researchers develop tiny probe for intravascular imaging in the brain",
    "Dental Exposure: An Echocardiography-Based Study at a Teaching District General Hospital",
  ]) assert.equal(news({ title })?.level, "direct", title);
});

test("every returned reason has a bounded bilingual explanation without a verification claim", () => {
  const results = [github(repository("Medical imaging tutorial paper list")), github(repository("MRI")), news({ title: "New MRI model" }), news({ title: "New tool", summary: "DICOM software release" })];
  for (const result of results) {
    assert(result);
    assert(result.reasons.length <= 12);
    for (const reason of result.reasons) assert(RELEVANCE_REASON_LABELS[reason]?.zh && RELEVANCE_REASON_LABELS[reason]?.en);
  }
  assert(RELEVANCE_REASON_LABELS["paper-linked"]);
  assert(RELEVANCE_REASON_LABELS["curated-source"]);
});
