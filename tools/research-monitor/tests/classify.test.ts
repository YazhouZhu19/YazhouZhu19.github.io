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
