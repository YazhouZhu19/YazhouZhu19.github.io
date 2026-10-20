import { normalizeDoi, normalizedName, textOnly } from "./classify";
import type { Author, Paper } from "./types";

function doi(value: unknown): string | null {
  const normalized = normalizeDoi(value);
  return normalized && /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : null;
}
function arxiv(value: unknown): string | null {
  const id = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .toLowerCase();
  return /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/.test(id) ? id : null;
}
function identityKeys(paper: Paper): string[] {
  const keys = paper.id ? [`id:${paper.id}`] : [];
  for (const value of [paper.doi, paper.relatedDoi]) {
    const id = doi(value);
    if (id) keys.push(`doi:${id}`);
  }
  if (/^\d+$/.test(paper.pmid ?? "")) keys.push(`pmid:${paper.pmid}`);
  const arxivId = arxiv(paper.arxivId);
  if (arxivId) keys.push(`arxiv:${arxivId}`);
  const nativeId = paper.id.match(/^(?:pubmed:|pmid:|(?:europepmc|epmc):(?:med:)?)\s*(\d+)$/i);
  if (nativeId) keys.push(`pmid:${nativeId[1]}`);
  if (/^arxiv:/i.test(paper.id)) {
    const id = arxiv(paper.id);
    if (id) keys.push(`arxiv:${id}`);
  }
  for (const entry of paper.provenance ?? []) {
    const id = entry.sourceRecordId?.trim();
    if (!id) continue;
    if (/^(?:Europe PMC|PubMed)$/i.test(paper.source) && /^(?:MED:)?\d+$/i.test(id))
      keys.push(`pmid:${id.replace(/^MED:/i, "")}`);
    else if (/^arxiv$/i.test(paper.source)) {
      const native = arxiv(id);
      if (native) keys.push(`arxiv:${native}`);
    } else keys.push(`native:${paper.source.toLowerCase()}:${id.toLowerCase()}`);
  }
  return keys;
}

export const WORK_GROUPING_VERSION = "2026-10-21-title-authors-v1";

/** Exact normalized equality only: no semantic, substring or fuzzy title matching. */
export function normalizedWorkTitle(title: string): string {
  return textOnly(title)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function nameKey(value: string): string {
  return normalizedName(value.normalize("NFKC"));
}

function surnameOfFirstAuthor(author: Author | undefined): string | null {
  if (!author) return null;
  const name = author.name.trim() || author.displayName?.trim() || "";
  // A collective author is not an inferred person or surname.
  if (/\b(?:consortium|collaboration|committee|group|team|investigators|society)\b/i.test(name)) return null;
  const display = author.displayName?.trim() || "";
  const comma = name.indexOf(",");
  if (comma > 0) return nameKey(name.slice(0, comma)) || null;
  // Europe PMC exposes family-name + initials in displayName while name is usually given-name first.
  for (const value of [display, name]) {
    const match = value.match(/^(.+?)\s+(?:[A-Z]\.?\s*){1,4}$/u);
    if (match) {
      const surname = nameKey(match[1]);
      if (surname.length >= 2) return surname;
    }
  }
  const tokens = name.match(/[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu) ?? [];
  if (tokens.length < 2) return null; // A single unstructured name does not establish a surname.
  const last = /^(?:jr|sr|ii|iii|iv)$/i.test(tokens.at(-1)!) ? tokens.at(-2)! : tokens.at(-1)!;
  return last.length >= 2 ? nameKey(last) : null;
}

function authorNames(paper: Paper): Set<string> {
  return new Set(
    paper.authors.map((author) => nameKey(author.name || author.displayName || "")).filter(Boolean),
  );
}

export type TitleAuthorMatch = {
  title: string;
  firstAuthorSurname: string | null;
  authorJaccard: number;
};

/** A possible version link, not a claim of verified bibliographic equivalence. */
export function titleAuthorMatch(a: Paper, b: Paper): TitleAuthorMatch | null {
  const title = normalizedWorkTitle(a.title);
  if (!title || title !== normalizedWorkTitle(b.title)) return null;
  const aNames = authorNames(a),
    bNames = authorNames(b);
  const intersection = [...aNames].filter((name) => bNames.has(name)).length;
  const union = aNames.size + bNames.size - intersection;
  const authorJaccard = union ? intersection / union : 0;
  const aSurname = surnameOfFirstAuthor(a.authors[0]),
    bSurname = surnameOfFirstAuthor(b.authors[0]);
  const firstAuthorSurname = aSurname && aSurname === bSurname ? aSurname : null;
  return firstAuthorSurname || authorJaccard >= 0.5 ? { title, firstAuthorSurname, authorJaccard } : null;
}

/** Group known identifiers first, then exact-title matches with explicit author support. */
export function groupWorks(papers: Paper[], options: { titleAuthors?: boolean } = {}): Paper[][] {
  const parent = papers.map((_, index) => index);
  const members = papers.map((_, index) => [index]);
  const keys = new Map<string, number>();
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (left: number, right: number) => {
    let a = root(left),
      b = root(right);
    if (a === b) return;
    if (members[a].length < members[b].length) [a, b] = [b, a];
    parent[b] = a;
    members[a].push(...members[b]);
    members[b] = [];
  };
  papers.forEach((paper, index) => {
    for (const key of identityKeys(paper)) {
      const previous = keys.get(key);
      if (previous === undefined) keys.set(key, index);
      else join(index, previous);
    }
  });
  if (options.titleAuthors !== false) {
    const titles = new Map<string, number[]>();
    const titleKeys = papers.map((paper) => normalizedWorkTitle(paper.title));
    papers.forEach((paper, index) => {
      const title = titleKeys[index];
      if (!title || !paper.authors.length) return;
      const bucket = titles.get(title) ?? [];
      bucket.push(index);
      titles.set(title, bucket);
    });
    // Stable pair order prevents input order from choosing a different ambiguous bridge.
    for (const bucket of titles.values()) {
      bucket.sort((a, b) => papers[a].id.localeCompare(papers[b].id));
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i],
            b = bucket[j];
          if (root(a) === root(b) || !titleAuthorMatch(papers[a], papers[b])) continue;
          // An author-overlap bridge must not silently combine conflicting same-title records.
          const compatible = members[root(a)].every((left) =>
            members[root(b)].every(
              (right) =>
                titleKeys[left] !== titleKeys[right] ||
                !papers[left].authors.length ||
                !papers[right].authors.length ||
                titleAuthorMatch(papers[left], papers[right]) !== null,
            ),
          );
          if (compatible) join(a, b);
        }
      }
    }
  }
  const groups = new Map<number, Paper[]>();
  papers.forEach((paper, index) => {
    const key = root(index),
      group = groups.get(key) ?? [];
    group.push(paper);
    groups.set(key, group);
  });
  return [...groups.values()];
}

/** One shared index supports headline counts and version links without modifying source records. */
export function buildWorkIndex(papers: Paper[]) {
  const groups = groupWorks(papers);
  const byPaperId = new Map<string, Paper[]>();
  for (const group of groups) for (const paper of group) byPaperId.set(paper.id, group);
  return {
    groups,
    byPaperId,
    recordCount: papers.length,
    workCount: groups.length,
    duplicateGroupCount: groups.filter((group) => group.length > 1).length,
    duplicatesRemoved: papers.length - groups.length,
    version: WORK_GROUPING_VERSION,
  };
}
