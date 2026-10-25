import { z } from "zod";
import type { ForesightResult } from "./foresight-types";

export const ASSESSMENT_HISTORY_KEY = "medical-research-monitor:assessments:v1";
const bilingual = z.object({ zh: z.string().max(6000), en: z.string().max(6000) });
const cardSchema = z.object({
  id: z.string().max(600),
  title: bilingual,
  forecast: bilingual,
  signature: z.string().max(20000),
  evidenceCount: z.number().int().nonnegative(),
  strength: z.enum(["limited", "supported"]),
});
const revisionSchema = z.object({
  id: z.string().max(120),
  recordedAt: z.string().datetime(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fingerprint: z.string().max(200000),
  cards: z.array(cardSchema).max(6),
  review: z.enum(["pending", "supported", "not-supported", "unclear"]).default("pending"),
  note: z.string().max(2000).default(""),
});
const historySchema = z.object({
  schema: z.literal("research-assessment-history-v1"),
  contexts: z.record(z.array(revisionSchema).max(12)).refine((v) => Object.keys(v).length <= 40),
});
export type AssessmentRevision = z.infer<typeof revisionSchema>;
export type AssessmentHistory = z.infer<typeof historySchema>;
export function emptyAssessmentHistory(): AssessmentHistory {
  return { schema: "research-assessment-history-v1", contexts: {} };
}
export function readAssessmentHistory(raw: string | null): AssessmentHistory {
  if (raw === null) return emptyAssessmentHistory();
  if (raw.length > 3_000_000) throw new Error("Assessment history exceeds the local size limit");
  return historySchema.parse(JSON.parse(raw));
}
export function serializeAssessmentHistory(history: AssessmentHistory): string {
  const raw = JSON.stringify(historySchema.parse(history));
  if (raw.length > 3_000_000) throw new Error("Assessment history exceeds the local size limit");
  return raw;
}
export function recordAssessment(
  history: AssessmentHistory,
  result: ForesightResult,
  recordedAt: string,
): AssessmentHistory {
  const existing = history.contexts[result.key] ?? [];
  // Initial absence is not a prediction; disappearance after a recorded hypothesis is retained.
  if ((!existing.length && !result.cards.length) || existing[0]?.fingerprint === result.fingerprint)
    return history;
  const revision: AssessmentRevision = {
    id: `${recordedAt}:${result.asOf}`,
    recordedAt,
    asOf: result.asOf,
    fingerprint: result.fingerprint,
    cards: result.cards.map((card) => ({
      id: card.id,
      title: card.title,
      forecast: card.forecast,
      signature: card.signature,
      evidenceCount: card.paperIds.length,
      strength: card.strength,
    })),
    review: "pending",
    note: "",
  };
  const contexts = { ...history.contexts, [result.key]: [revision, ...existing].slice(0, 12) };
  const entries = Object.entries(contexts).sort((a, b) =>
    (b[1][0]?.recordedAt ?? "").localeCompare(a[1][0]?.recordedAt ?? ""),
  );
  return historySchema.parse({ schema: history.schema, contexts: Object.fromEntries(entries.slice(0, 40)) });
}
export function assessmentChanges(current: AssessmentRevision, previous?: AssessmentRevision) {
  if (!previous)
    return { initial: true, added: current.cards.length, changed: 0, removed: 0, stronger: 0, weaker: 0 };
  const old = new Map(previous.cards.map((c) => [c.id, c]));
  const next = new Map(current.cards.map((c) => [c.id, c]));
  return {
    initial: false,
    added: current.cards.filter((c) => !old.has(c.id)).length,
    changed: current.cards.filter((c) => old.has(c.id) && old.get(c.id)!.signature !== c.signature).length,
    removed: previous.cards.filter((c) => !next.has(c.id)).length,
    stronger: current.cards.filter((c) => old.get(c.id)?.strength === "limited" && c.strength === "supported")
      .length,
    weaker: current.cards.filter((c) => old.get(c.id)?.strength === "supported" && c.strength === "limited")
      .length,
  };
}
export function reviewAssessment(
  history: AssessmentHistory,
  key: string,
  id: string,
  review: AssessmentRevision["review"],
  note: string,
): AssessmentHistory {
  const revisions = history.contexts[key];
  if (!revisions?.some((r) => r.id === id)) return history;
  return historySchema.parse({
    ...history,
    contexts: {
      ...history.contexts,
      [key]: revisions.map((r) => (r.id === id ? { ...r, review, note } : r)),
    },
  });
}
