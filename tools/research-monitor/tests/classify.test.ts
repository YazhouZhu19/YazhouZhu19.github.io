import assert from "node:assert/strict";
import test from "node:test";
import { classify, relevant, TRACKS, TRACK_DESCRIPTIONS } from "../lib/classify";

const fixtures:Record<string,[string,string]> = {
 segmentation:["Automatic liver lesion segmentation on CT", "A network delineates organs and tumors in medical images."],
 human_loop:["Human-AI collaboration in mammography", "A reader study compared radiologists with and without AI assistance."],
 diagnosis:["Lung nodule detection on chest CT", "Computer-aided detection and disease classification from radiographs."],
 reconstruction:["MRI reconstruction with diffusion models", "Medical image denoising and super-resolution."],
 registration:["Deformable image registration for brain MRI", "Cross-modal alignment and motion estimation of medical images."],
 quantification:["CT radiomics as an imaging biomarker for lung cancer", "Quantitative imaging and texture analysis."],
 prognosis:["Predicting survival using breast MRI", "An imaging model forecasts treatment response and clinical outcomes."],
 language:["Radiology report generation from chest radiographs", "A vision-language model performs visual question answering."],
 intervention:["Image-guided surgical navigation", "Intraoperative ultrasound supports surgical planning and radiotherapy dose prediction."],
 foundation:["A foundation model for medical imaging", "A general-purpose model is evaluated on MRI and CT."],
};

test("all ten interest directions have stable IDs, descriptions and positive evidence", () => {
 assert.equal(Object.keys(TRACKS).length,10);
 assert.deepEqual(Object.keys(TRACKS),Object.keys(fixtures));
 for(const [track,[title,abstract]] of Object.entries(fixtures)) {
  assert.ok(TRACK_DESCRIPTIONS[track]);
  assert.equal(relevant(title,abstract),true,track);
  assert.ok(classify(title,abstract).tracks.includes(track),track);
 }
});

test("directions support overlap while retaining task and method distinctions", () => {
 const result = classify("Interactive medical image segmentation with MedSAM", "Human-in-the-loop correction uses a foundation model on liver CT.");
 assert.deepEqual(result.tracks,["segmentation","human_loop","foundation"]);
 assert.ok(result.tasks.includes("segmentation"));
 assert.ok(result.methods.includes("基础模型"));
 assert.ok(result.modalities.includes("CT"));
 const pretraining = classify("Self-supervised MRI reconstruction", "We use contrastive learning to reconstruct magnetic resonance images.");
 assert.ok(pretraining.tracks.includes("reconstruction"));
 assert.ok(!pretraining.tracks.includes("foundation"));
});

test("expert annotations, simulated clicks and negated participation alone do not establish human-in-the-loop research", () => {
 for(const abstract of ["Expert annotations define the reference standard.","Simulated user clicks are used for training.","The model works without human feedback or interactive correction."]) {
  const result = classify("Medical image segmentation for brain MRI",abstract);
  assert.ok(result.tracks.includes("segmentation"));
  assert.ok(!result.tracks.includes("human_loop"),abstract);
 }
});

test("nonmedical vision, text-only diagnosis and non-imaging prognostic studies are rejected", () => {
 const negatives = [
  ["Satellite image segmentation with foundation models","We identify building footprints and roads."],
  ["Plant disease classification","A foundation model detects leaf lesions in crop disease images."],
  ["Organization of language models for diagnosis","A text-only chatbot answers clinical questions."],
  ["Predicting lung cancer prognosis using genomics","Gene expression and blood biomarkers predict survival."],
  ["Patient segmentation for prognosis prediction","We segment patients into risk groups from electronic health records without imaging."],
  ["PCR cycle threshold predicts clinical outcome in patients","The CT value from quantitative PCR is used to predict disease progression."],
  ["Drug combination improves lung cancer prognosis","Randomized drug treatment study without imaging endpoints."],
 ];
 for(const [title,abstract] of negatives) {
  assert.equal(relevant(title,abstract),false,title);
  assert.deepEqual(classify(title,abstract).tracks,[],title);
 }
});


test("clinical findings that prompt action and degenerative anatomy do not imply AI methods", () => {
 const realExamples = [
  ["Design of a multitissue osteoarticular 3D-Printed knee model for initial training in meniscal repair.",
   "Meniscal preservation is essential, given the degenerative risk associated with meniscectomy. Modeling and design were jointly performed by orthopedic surgeons and engineers based on segmentation of medical imaging data."],
  ["Intraoperative MRI in pediatric brain tumor surgery: Optimizing surgical decision-making and extent of resection.",
   "In 48 cases (40.7%), ioMRI findings prompted further intraoperative evaluation; additional tumor resection was performed in 45 cases (93.8%), resulting in improved EoR."],
  ["Normal and Pathological Incidental Breast Implant Findings on Chest Computed Tomography: What the Radiologist Needs to Know.",
   "These findings may range from normal postoperative appearances and expected findings to degenerative changes and clinically significant complications. These incidental findings may prompt appropriate recommendations for targeted breast imaging with ultrasound or magnetic resonance imaging and guide clinical decision-making."],
 ];
 for (const [title, abstract] of realExamples) {
  const result = classify(title, abstract);
  assert.ok(!result.methods.includes("提示式学习"), title);
  assert.ok(!result.methods.includes("生成式方法"), title);
 }
});

test("ordinary prompt verbs and regenerative or degenerative words are not method evidence", () => {
 const negatives = [
  "Brain MRI findings are prompting resection.",
  "Prompt diagnosis and prompt treatment are important in brain imaging.",
  "The radiologist promptly reviewed the MRI.",
  "Regenerative medicine and degenerative disease are evaluated using MRI.",
 ];
 for (const abstract of negatives) {
  const methods = classify("Clinical MRI study", abstract).methods;
  assert.ok(!methods.includes("提示式学习"), abstract);
  assert.ok(!methods.includes("生成式方法"), abstract);
 }
});

test("explicit prompting and generative model terminology retains its method tags", () => {
 for (const phrase of ["prompt-based learning", "prompt based segmentation", "visual prompt", "visual prompting", "promptable learning", "prompt tuning", "prompt-guided segmentation", "point prompts", "learnable prompts"]) {
  assert.ok(classify("Medical image analysis", `We use ${phrase} for MRI segmentation.`).methods.includes("提示式学习"), phrase);
 }
 for (const phrase of ["generative AI", "generative models", "diffusion models", "diffusion probabilistic models", "denoising diffusion", "GAN"]) {
  assert.ok(classify("Medical image reconstruction", `We use ${phrase} for MRI reconstruction.`).methods.includes("生成式方法"), phrase);
 }
});
