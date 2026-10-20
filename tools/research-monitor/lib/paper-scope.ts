import { scopeOf } from "./classify";
import type { Paper, PaperScope } from "./types";
export type ScopeSelection = "core" | "adjacent" | "all";
export function paperScope(paper: Paper): PaperScope {
  return paper.scope ?? scopeOf(paper.title, paper.abstract).scope;
}
export function matchesPaperScope(paper: Paper, selection: string | undefined): boolean {
  if (selection === "all") return true;
  const scope = paperScope(paper);
  return selection === "adjacent" ? scope !== "out" : scope === "core";
}
export function paperScopeCounts(papers: Paper[]) {
  const counts = { core: 0, adjacent: 0, out: 0 };
  for (const paper of papers) counts[paperScope(paper)]++;
  return counts;
}
