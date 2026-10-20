import type { PaperScope } from "./types";

/** Independent from the stable ten-direction taxonomy and source-query version. */
export const SCOPE_CLASSIFIER_VERSION = "2026-10-21-scope-v1";
export type ScopeResult = { scope: PaperScope; reasons: string[] };

/** Local negation is evidence absence, not a claim that the paper is noncomputational. */
export function affirmativeMatches(text: string, pattern: RegExp): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(pattern.source, "gi"))].filter((match) => {
    const prefix = text.slice(Math.max(0, match.index! - 120), match.index);
    const clause = prefix.split(/[.!?;]|\bbut\b|\bhowever\b/i).pop() ?? "";
    return !/\b(?:without|no|neither|not(?! only\b)|does not (?:use|require)|did not (?:use|involve)|do not (?:use|require)|excluding|eliminat(?:e|es|ing) the need for)\b[^,]{0,85}$/i.test(
      clause,
    );
  });
}

const computational =
  /\bdeep learning\b|neural network|convolutional|transformer|machine learning|artificial intelligence|\bAI\b|\balgorithm\w*|\bautomat(?:ed|ic)\b|computer.aided|radiomic|foundation model|segment anything|self.supervis|diffusion model|network architecture|(?:proposed|novel) (?:method|framework|model|pipeline)|\bsoftware\b|open.source|\bbenchmark\w*|\bdataset\w*/i;
const clinical =
  /randomi[sz]ed|placebo|phase (?:iii|ii|iv|i|1|2|3|4)\b|double.blind|case report|case series|\bdose\b|pharmacokinetic|questionnaire|dietary|cohort study/i;
const accuracy = /diagnostic accuracy|sensitivity and specificity|inter.?reader|interobserver/i;

/** Text rules are inspectable screening clues; they cannot replace a full-text scope review. */
export function inferScope(
  title: string,
  abstract: string,
  imagingRelevant: boolean,
  methodEvidence: string[],
): ScopeResult {
  if (!imagingRelevant) return { scope: "out", reasons: ["未识别到肯定的医学影像研究语境"] };
  const text = `${title}. ${abstract}`;
  const computation = affirmativeMatches(text, computational);
  if (computation.length || methodEvidence.length) {
    return {
      scope: "core",
      reasons: [
        "医学影像语境",
        ...[...new Set(computation.map((match) => `计算方法线索：${match[0]}`))].slice(0, 4),
        ...methodEvidence.slice(0, 4).map((label) => `方法标签线索：${label}`),
        ...(!abstract.trim() ? ["缺少摘要，仅依据标题，范围待核实"] : []),
      ],
    };
  }
  const accuracyEvidence = affirmativeMatches(text, accuracy);
  if (accuracyEvidence.length) {
    return {
      scope: "adjacent",
      reasons: ["医学影像语境", `诊断或读片一致性评价：${accuracyEvidence[0][0]}`, "未识别到计算方法线索"],
    };
  }
  const clinicalEvidence = affirmativeMatches(text, clinical);
  if (clinicalEvidence.length) {
    return {
      scope: "out",
      reasons: [
        `临床研究线索：${clinicalEvidence[0][0]}`,
        "未识别到计算方法线索；影像是否为研究中心仍需阅读全文核实",
      ],
    };
  }
  return {
    scope: "adjacent",
    reasons: [
      "医学影像语境",
      "未识别到计算方法线索",
      ...(!abstract.trim() ? ["缺少摘要，仅依据标题，范围待核实"] : []),
    ],
  };
}
