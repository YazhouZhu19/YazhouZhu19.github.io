import dictionary from "./query-expansion.json";

export const RETRIEVAL_VERSION = "2026-10-21-bm25-v1";
export type RetrievalDocument = { id: string; title: string; abstract: string; tags: string[] };
export type RetrievalMetadata = { method: "bm25"; candidates: number; expandedTerms: string[] };
const stopWords = new Set(
  "a an the of in on at to for with and or is are was were be been by as from this that these those we our it its can could may using use used study studies research latest recent new method methods how what which evaluate validation".split(
    " ",
  ),
);
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[-_/]/g, " ");
export function retrievalTokens(text: string): string[] {
  return (normalize(text).match(/[a-z][a-z0-9]*|[\p{Script=Han}]+/gu) ?? []).flatMap((word) => {
    if (/\p{Script=Han}/u.test(word)) {
      // Chinese originals remain searchable; bigrams avoid relying on browser segmenters.
      return word.length > 1 ? [...word].slice(1).map((_, i) => word.slice(i, i + 2)) : [word];
    }
    if (stopWords.has(word)) return [];
    if (word.length > 5 && /(?:ing|ed)$/.test(word)) return [word.replace(/(?:ing|ed)$/, "")];
    if (word.length > 5 && word.endsWith("ies")) return [word.slice(0, -3) + "y"];
    if (word.length > 4 && /(?:ches|shes|xes|zes|ses)$/.test(word)) return [word.slice(0, -2)];
    if (word.length > 3 && word.endsWith("s") && !/(?:ss|is|us)$/.test(word)) return [word.slice(0, -1)];
    return [word];
  });
}
export function expandedQuery(question: string) {
  const normalized = normalize(question);
  const expandedTerms = dictionary
    .filter(({ aliases }) =>
      aliases.some((alias) => {
        const value = normalize(alias);
        return /[\p{Script=Han}]/u.test(value)
          ? normalized.includes(value)
          : new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized);
      }),
    )
    .flatMap(({ terms }) => terms);
  return {
    expandedTerms: [...new Set(expandedTerms)],
    tokens: [...new Set(retrievalTokens(`${question} ${expandedTerms.join(" ")}`))],
  };
}

/** BM25 with title term frequency weighted ×2, k1=1.2 and b=0.75. No network/model calls. */
export function retrieve<T extends RetrievalDocument>(documents: T[], question: string, limit: number) {
  const query = expandedQuery(question);
  const rows = documents.map((document) => {
    const tokens = [
      ...retrievalTokens(document.title),
      ...retrievalTokens(document.title),
      ...retrievalTokens(document.abstract),
    ];
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { document, length: tokens.length, frequencies };
  });
  const averageLength = rows.reduce((sum, row) => sum + row.length, 0) / Math.max(1, rows.length) || 1;
  const documentFrequency = new Map(
    query.tokens.map((token) => [token, rows.filter((row) => row.frequencies.has(token)).length]),
  );
  const ranked = rows
    .map((row) => {
      const score = query.tokens.reduce((sum, token) => {
        const frequency = row.frequencies.get(token) ?? 0;
        if (!frequency) return sum;
        const df = documentFrequency.get(token)!;
        const idf = Math.log(1 + (rows.length - df + 0.5) / (df + 0.5));
        return (
          sum + (idf * (frequency * 2.2)) / (frequency + 1.2 * (0.25 + (0.75 * row.length) / averageLength))
        );
      }, 0);
      return { document: row.document, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id))
    .slice(0, Math.max(limit * 4, 40));
  return {
    ranked,
    metadata: { method: "bm25" as const, candidates: ranked.length, expandedTerms: query.expandedTerms },
  };
}

function similarity(left: string[], right: string[]) {
  const a = new Set(left),
    b = new Set(right);
  const union = new Set([...a, ...b]).size;
  if (!union) return 1;
  return [...a].filter((tag) => b.has(tag)).length / union;
}
/** Greedy MMR with equal relevance; stable IDs break ties. Global chosen tags reduce redundancy. */
export function diversityPick<T extends RetrievalDocument>(rows: T[], chosen: RetrievalDocument[]): T {
  return [...rows].sort((a, b) => {
    const redundancy = (row: T) => Math.max(0, ...chosen.map((other) => similarity(row.tags, other.tags)));
    return redundancy(a) - redundancy(b) || a.id.localeCompare(b.id);
  })[0];
}
