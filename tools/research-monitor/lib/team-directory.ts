import { normalizedName } from "./classify";
import type { Author, Paper } from "./types";

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
};

function normalizeOrcid(value: string | null | undefined): string | null {
  const candidate = (value ?? "").trim().replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, "").replace(/\/$/, "").toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(candidate) ? candidate : null;
}

function isAbbreviated(name: string): boolean {
  const tokens = name.match(/[\p{L}]+/gu) ?? [];
  if (/^[\p{Script=Han}]{2,}$/u.test(name.trim())) return false;
  // Initials and isolated names are deliberately kept out of the default list.
  // Searching still exposes them, with the identity warning in the UI.
  if (tokens.length < 2 || tokens.some(token => /^[A-Za-z]$/.test(token))) return true;
  const allCapitalized = tokens.every(token => /^[A-Z]+$/.test(token));
  return !allCapitalized && tokens.some(token => /^[A-Z]{2,3}$/.test(token));
}

function authorIdentity(author: Author) {
  const name = author.displayName?.trim() || author.name.trim();
  const orcid = normalizeOrcid(author.orcid);
  const normalized = normalizedName(name);
  return { name, orcid, id: orcid ? `directory:orcid:${orcid}` : normalized ? `directory:name:${normalized}` : "" };
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function compareEntries(a: TeamDirectoryEntry, b: TeamDirectoryEntry): number {
  return b.papers.length - a.papers.length || Number(!!b.orcid) - Number(!!a.orcid)
    || Number(a.abbreviated) - Number(b.abbreviated) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function scopeEntry(entry: TeamDirectoryEntry, papers: Paper[]): TeamDirectoryEntry {
  const affiliations = new Set<string>();
  for (const paper of papers) for (const author of paper.authors) {
    if (authorIdentity(author).id !== entry.id) continue;
    for (const affiliation of author.affiliations) if (affiliation.trim()) affiliations.add(affiliation.trim());
  }
  return {
    ...entry,
    papers: [...papers].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)),
    tracks: [...new Set(papers.flatMap(paper => paper.tracks))].sort(),
    affiliations: [...affiliations].sort(),
  };
}

/** Uses only classified, dated public papers; no cross-identity name guessing. */
export function buildTeamDirectory(papers: Paper[], asOf: string): TeamDirectoryEntry[] {
  if (!validDay(asOf)) throw new Error("A valid asOf publication day is required");
  const entries = new Map<string, TeamDirectoryEntry>();
  const paperIds = new Map<string, Set<string>>();
  for (const paper of papers) {
    const publishedAt = paper.publishedAt;
    const day = publishedAt.slice(0, 10);
    if (!paper.tracks.length || !validDay(day) || day > asOf
      || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) continue;
    for (const author of paper.authors) {
      const { id, name, orcid } = authorIdentity(author);
      if (!id) continue;
      const entry = entries.get(id) ?? {
        id, name: name || orcid!, member: orcid || name, orcid,
        affiliations: [], papers: [], tracks: [], abbreviated: isAbbreviated(name),
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
  return [...entries.values()].map(entry => scopeEntry(entry, entry.papers)).sort(compareEntries);
}

/** Recounts the exact direction scope before ranking, searching, or hiding weak candidates. */
export function filterTeamDirectory(entries: TeamDirectoryEntry[], options: { track: string; query: string }): TeamDirectoryEntry[] {
  const query = normalizedName(normalizeOrcid(options.query) ?? options.query);
  const scopedEntries = !options.track || options.track === "all" ? entries : entries.flatMap(entry => {
    const papers = entry.papers.filter(paper => paper.tracks.includes(options.track));
    return papers.length ? [scopeEntry(entry, papers)] : [];
  });
  return scopedEntries
    .filter(entry => entry.papers.length > 0 && (query
      ? normalizedName(`${entry.name} ${entry.orcid ?? ""} ${entry.affiliations.join(" ")}`).includes(query)
      : entry.papers.length >= 2 && (!!entry.orcid || !entry.abbreviated)))
    .sort(compareEntries);
}
