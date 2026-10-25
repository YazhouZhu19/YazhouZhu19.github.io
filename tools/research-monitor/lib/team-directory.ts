import { normalizedName, scopeOf } from "./classify";
import { groupWorks } from "./paper-works";
import { publicationDateStatus } from "./publication-date";
import type { Author, Paper } from "./types";

export type TeamDirectorySort = "senior" | "works";
export type PossibleAuthorIdentity = {
  id: string;
  name: string;
  orcid: string | null;
  sharedAffiliations: string[];
  sharedCoauthors: string[];
};
/** A source-backed author candidate, not a verified PI or a declared research team. */
export type TeamDirectoryEntry = {
  id: string;
  name: string;
  member: string;
  orcid: string | null;
  affiliations: string[];
  papers: Paper[];
  tracks: string[];
  abbreviated: boolean;
  works: number;
  firstAuthorCount: number;
  lastAuthorCount: number;
  seniorShare: number;
  possibleIdentities: PossibleAuthorIdentity[];
};

function normalizeOrcid(value: string | null | undefined): string | null {
  const candidate = (value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, "")
    .replace(/\/$/, "")
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(candidate) ? candidate : null;
}

function isAbbreviated(name: string): boolean {
  const tokens = name.match(/[\p{L}]+/gu) ?? [];
  if (/^[\p{Script=Han}]{2,}$/u.test(name.trim())) return false;
  // Initials and isolated names are deliberately kept out of the default list.
  // Searching still exposes them, with the identity warning in the UI.
  if (tokens.length < 2 || tokens.some((token) => /^[A-Za-z]$/.test(token))) return true;
  const allCapitalized = tokens.every((token) => /^[A-Z]+$/.test(token));
  return !allCapitalized && tokens.some((token) => /^[A-Z]{2,3}$/.test(token));
}

function authorName(author: Author) {
  const name = author.name.trim(),
    display = author.displayName?.trim() || "";
  return !isAbbreviated(name) ? name : display && !isAbbreviated(display) ? display : name || display;
}

function authorIdentity(author: Author) {
  const name = authorName(author);
  const orcid = normalizeOrcid(author.orcid);
  const normalized = normalizedName(name);
  return {
    name,
    orcid,
    id: orcid ? `directory:orcid:${orcid}` : normalized ? `directory:name:${normalized}` : "",
  };
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function compareEntries(a: TeamDirectoryEntry, b: TeamDirectoryEntry, sort: TeamDirectorySort): number {
  return (
    (sort === "senior" ? b.lastAuthorCount - a.lastAuthorCount : 0) ||
    b.works - a.works ||
    b.papers.length - a.papers.length ||
    Number(!!b.orcid) - Number(!!a.orcid) ||
    Number(a.abbreviated) - Number(b.abbreviated) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

function scopeEntry(entry: TeamDirectoryEntry, papers: Paper[]): TeamDirectoryEntry {
  const affiliations = new Set<string>();
  for (const paper of papers)
    for (const author of paper.authors) {
      if (authorIdentity(author).id !== entry.id) continue;
      for (const affiliation of author.affiliations)
        if (affiliation.trim()) affiliations.add(affiliation.trim());
    }
  const works = groupWorks(papers);
  const positionCount = (position: "first" | "last") =>
    works.filter((group) =>
      group.some((paper) => {
        const author = position === "first" ? paper.authors[0] : paper.authors.at(-1);
        return author && authorIdentity(author).id === entry.id;
      }),
    ).length;
  const lastAuthorCount = positionCount("last");
  return {
    ...entry,
    papers: [...papers].sort(
      (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
    ),
    tracks: [...new Set(papers.flatMap((paper) => paper.tracks))].sort(),
    affiliations: [...affiliations].sort(),
    works: works.length,
    firstAuthorCount: positionCount("first"),
    lastAuthorCount,
    seniorShare: works.length ? lastAuthorCount / works.length : 0,
    possibleIdentities: [],
  };
}

function addIdentityHints(entries: TeamDirectoryEntry[]): TeamDirectoryEntry[] {
  const details = entries.map((entry) => {
    const names = new Set<string>(),
      coauthors = new Set<string>();
    for (const paper of entry.papers) {
      for (const author of paper.authors) {
        const name = authorName(author);
        if (isAbbreviated(name)) continue;
        if (authorIdentity(author).id === entry.id) names.add(normalizedName(name));
        else coauthors.add(normalizedName(name));
      }
    }
    for (const name of names) coauthors.delete(name);
    const affiliations = new Map(
      entry.affiliations
        .map((value) => [value.trim().toLowerCase().replace(/\s+/g, " "), value] as const)
        .filter(([value]) => normalizedName(value)),
    );
    return { names, coauthors, affiliations };
  });
  const byName = new Map<string, number[]>();
  details.forEach((detail, index) => {
    for (const name of detail.names) {
      const list = byName.get(name) ?? [];
      list.push(index);
      byName.set(name, list);
    }
  });
  const compared = new Set<string>();
  for (const indices of byName.values()) {
    for (let i = 0; i < indices.length; i++)
      for (let j = i + 1; j < indices.length; j++) {
        const a = indices[i],
          b = indices[j],
          pair = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (compared.has(pair) || !!entries[a].orcid === !!entries[b].orcid) continue;
        compared.add(pair);
        const sharedAffiliations = [...details[a].affiliations]
          .filter(([key]) => details[b].affiliations.has(key))
          .map(([, value]) => value);
        const sharedCoauthors = [...details[a].coauthors]
          .filter((name) => details[b].coauthors.has(name))
          .sort();
        if (!sharedAffiliations.length && sharedCoauthors.length < 2) continue;
        for (const [own, peer] of [
          [a, b],
          [b, a],
        ])
          entries[own].possibleIdentities.push({
            id: entries[peer].id,
            name: entries[peer].name,
            orcid: entries[peer].orcid,
            sharedAffiliations,
            sharedCoauthors,
          });
      }
  }
  for (const entry of entries) entry.possibleIdentities.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

/** Uses only classified, dated public papers; no cross-identity name guessing. */
export function buildTeamDirectory(
  papers: Paper[],
  asOf: string,
  options: { scope?: "core" | "all" } = {},
): TeamDirectoryEntry[] {
  if (!validDay(asOf)) throw new Error("A valid asOf publication day is required");
  const entries = new Map<string, TeamDirectoryEntry>();
  const paperIds = new Map<string, Set<string>>();
  for (const paper of papers) {
    if (
      !paper.tracks.length ||
      publicationDateStatus(paper, asOf) !== "valid" ||
      (options.scope !== "all" && (paper.scope ?? scopeOf(paper.title, paper.abstract).scope) !== "core")
    )
      continue;
    for (const author of paper.authors) {
      const { id, name, orcid } = authorIdentity(author);
      if (!id) continue;
      const entry = entries.get(id) ?? {
        id,
        name: name || orcid!,
        member: orcid || name,
        orcid,
        affiliations: [],
        papers: [],
        tracks: [],
        abbreviated: isAbbreviated(name),
        works: 0,
        firstAuthorCount: 0,
        lastAuthorCount: 0,
        seniorShare: 0,
        possibleIdentities: [],
      };
      if (name && entry.abbreviated && !isAbbreviated(name)) {
        entry.name = name;
        entry.abbreviated = false;
      }
      const seen = paperIds.get(id) ?? new Set<string>();
      if (!seen.has(paper.id)) {
        entry.papers.push(paper);
        seen.add(paper.id);
      }
      paperIds.set(id, seen);
      entries.set(id, entry);
    }
  }
  return addIdentityHints([...entries.values()].map((entry) => scopeEntry(entry, entry.papers))).sort(
    (a, b) => compareEntries(a, b, "senior"),
  );
}

/** Recounts the exact direction scope before ranking, searching, or hiding weak candidates. */
export function filterTeamDirectory(
  entries: TeamDirectoryEntry[],
  options: { track: string; query: string; sort?: TeamDirectorySort },
): TeamDirectoryEntry[] {
  const query = normalizedName(normalizeOrcid(options.query) ?? options.query);
  const scopedEntries =
    !options.track || options.track === "all"
      ? entries
      : addIdentityHints(
          entries.flatMap((entry) => {
            const papers = entry.papers.filter((paper) => paper.tracks.includes(options.track));
            return papers.length ? [scopeEntry(entry, papers)] : [];
          }),
        );
  return scopedEntries
    .filter(
      (entry) =>
        entry.papers.length > 0 &&
        (query
          ? normalizedName(`${entry.name} ${entry.orcid ?? ""} ${entry.affiliations.join(" ")}`).includes(
              query,
            )
          : entry.works >= 2 && (!!entry.orcid || !entry.abbreviated)),
    )
    .sort((a, b) => compareEntries(a, b, options.sort ?? "senior"));
}
