import type { Paper } from "./types";

export const PAPER_FACETS = ["modalities", "organs", "methods", "sources", "tasks", "tracks", "humanSignals"] as const;
type Facet = (typeof PAPER_FACETS)[number];
export type PaperIndexSummary = Record<Facet, string[]> & { statuses: string[] };
export type PaperSearchIndex = { rows: { id: string; text: string }[]; summary: PaperIndexSummary };

/** Preserve the existing literal substring search, including DOI and affiliations. */
export function paperSearchText(paper: Paper) {
  return `${paper.title} ${paper.abstract} ${paper.authors.map(author => author.name).join(" ")} ${paper.affiliations.join(" ")} ${paper.doi ?? ""}`.toLowerCase();
}

function accumulator() {
  const facets = Object.fromEntries(PAPER_FACETS.map(key => [key, new Set<string>()])) as Record<Facet, Set<string>>;
  const statuses = new Set<string>();
  const rows: PaperSearchIndex["rows"] = [];
  return {
    add(paper: Paper) {
      rows.push({ id: paper.id, text: paperSearchText(paper) });
      for (const key of PAPER_FACETS) for (const value of paper[key]) facets[key].add(value);
      statuses.add(paper.status);
    },
    finish(): PaperSearchIndex {
      const summary = Object.fromEntries(PAPER_FACETS.map(key => [key, [...facets[key]].sort()])) as Record<Facet, string[]>;
      return { rows, summary: { ...summary, statuses: [...statuses].sort() } };
    },
  };
}

export function buildPaperIndex(papers: readonly Paper[]): PaperSearchIndex {
  const builder = accumulator();
  for (const paper of papers) builder.add(paper);
  return builder.finish();
}

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Yield in the fallback too, so indexing never requires a single unbounded task. */
export async function buildPaperIndexAsync(papers: readonly Paper[], signal?: AbortSignal): Promise<PaperSearchIndex> {
  const builder = accumulator();
  for (let index = 0; index < papers.length; index++) {
    signal?.throwIfAborted();
    builder.add(papers[index]);
    if ((index + 1) % 256 === 0) await yieldToEventLoop();
  }
  signal?.throwIfAborted();
  return builder.finish();
}

export async function searchPaperIndex(index: PaperSearchIndex, query: string, signal?: AbortSignal) {
  const needle = query.trim().toLowerCase();
  const ids: string[] = [];
  for (let offset = 0; offset < index.rows.length; offset++) {
    signal?.throwIfAborted();
    const row = index.rows[offset];
    if (!needle || row.text.includes(needle)) ids.push(row.id);
    if ((offset + 1) % 512 === 0) await yieldToEventLoop();
  }
  signal?.throwIfAborted();
  return ids;
}
