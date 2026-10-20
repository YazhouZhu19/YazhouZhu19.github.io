/** Lossless public transport; wrappers never reuse a business-record field name. */
export type AffiliationReference = number | string;
export type CompactAuthor = [string, string | null, AffiliationReference[], (string | null)?, number?, Record<string, unknown>?];
export type CompactProvenance = [unknown, unknown, unknown, unknown, number?, Record<string, unknown>?];
export type CompactPaper = [number, Record<string, any>];

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(`Invalid v3 paper ${message}`); };

function encodeAffiliations(values: unknown, indices: ReadonlyMap<string, number>): AffiliationReference[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string")) fail("affiliations");
  return (values as string[]).map(value => indices.get(value) ?? value);
}

function decodeAffiliations(values: unknown, dictionary: readonly string[]): string[] {
  if (!Array.isArray(values)) fail("affiliations");
  return (values as unknown[]).map(value => {
    if (typeof value === "string") return value;
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= dictionary.length) fail("affiliation reference");
    return dictionary[value as number];
  });
}

function encodeAuthor(author: unknown, indices: ReadonlyMap<string, number>): CompactAuthor {
  if (!object(author) || typeof author.name !== "string") fail("author");
  const value = author as Record<string, any>;
  const hasOrcid = own(value, "orcid"), hasAffiliations = own(value, "affiliations"), hasDisplayName = own(value, "displayName");
  if (hasOrcid && value.orcid !== null && typeof value.orcid !== "string") fail("author ORCID");
  if (hasDisplayName && typeof value.displayName !== "string") fail("author display name");
  const mask = Number(hasOrcid) | (Number(hasAffiliations) << 1) | (Number(hasDisplayName) << 2);
  const tuple: CompactAuthor = [value.name, hasOrcid ? value.orcid : null,
    hasAffiliations ? encodeAffiliations(value.affiliations, indices) : []];
  const { name: _name, orcid: _orcid, affiliations: _affiliations, displayName: _displayName, ...extra } = value;
  if (hasDisplayName || mask !== 3 || Object.keys(extra).length) tuple.push(hasDisplayName ? value.displayName : null);
  if ((tuple.length > 3 && mask !== 7) || Object.keys(extra).length) tuple.push(mask);
  if (Object.keys(extra).length) tuple.push(extra);
  return tuple;
}

function decodeAuthor(tuple: unknown, dictionary: readonly string[]) {
  if (!Array.isArray(tuple) || tuple.length < 3 || tuple.length > 6
    || typeof tuple[0] !== "string" || (tuple[1] !== null && typeof tuple[1] !== "string")) fail("author tuple");
  const value = tuple as CompactAuthor;
  const mask = value.length > 4 ? value[4] : value.length > 3 ? 7 : 3;
  if (!Number.isInteger(mask) || mask! < 0 || mask! > 7) fail("author presence");
  const extra = value.length > 5 ? value[5] : {};
  if (!object(extra) || ["name", "orcid", "affiliations", "displayName"].some(key => own(extra, key))) fail("author extra fields");
  const affiliations = decodeAffiliations(value[2], dictionary);
  if (!(mask! & 1) && value[1] !== null) fail("absent author ORCID");
  if (!(mask! & 2) && affiliations.length) fail("absent author affiliations");
  if (mask! & 4 ? typeof value[3] !== "string" : value.length > 3 && value[3] !== null) fail("author display name");
  return { ...extra, name: value[0], ...(mask! & 1 ? { orcid: value[1] } : {}),
    ...(mask! & 2 ? { affiliations } : {}), ...(mask! & 4 ? { displayName: value[3] } : {}) };
}

const provenanceKeys = ["queryUrl", "collectedAt", "queryTrack", "sourceRecordId"] as const;

function encodeProvenance(entry: unknown): CompactProvenance {
  if (!object(entry)) fail("provenance entry");
  const value = entry as Record<string, any>;
  const mask = provenanceKeys.reduce((bits, key, index) => bits | (Number(own(value, key)) << index), 0);
  const tuple = provenanceKeys.map(key => own(value, key) ? value[key] : null) as CompactProvenance;
  const { queryUrl: _url, collectedAt: _at, queryTrack: _track, sourceRecordId: _id, ...extra } = value;
  if (mask !== 15 || Object.keys(extra).length) tuple.push(mask);
  if (Object.keys(extra).length) tuple.push(extra);
  return tuple;
}

function decodeProvenance(tuple: unknown) {
  if (!Array.isArray(tuple) || tuple.length < 4 || tuple.length > 6) fail("provenance tuple");
  const value = tuple as CompactProvenance, mask = value.length > 4 ? value[4] : 15;
  if (!Number.isInteger(mask) || mask! < 0 || mask! > 15) fail("provenance presence");
  const extra = value.length > 5 ? value[5] : {};
  if (!object(extra) || provenanceKeys.some(key => own(extra, key))) fail("provenance extra fields");
  const result: Record<string, unknown> = { ...extra };
  for (const [index, key] of provenanceKeys.entries()) {
    if (mask! & (1 << index)) result[key] = value[index];
    else if (value[index] !== null) fail("absent provenance field");
  }
  return result;
}

export function encodeV3Paper(record: unknown, affiliationIndices: ReadonlyMap<string, number>): CompactPaper {
  if (!object(record) || !Array.isArray(record.authors) || !Array.isArray(record.provenance)) fail("record");
  const source = record as Record<string, any>;
  const paper: Record<string, any> = { ...source, authors: source.authors.map((author: unknown) => encodeAuthor(author, affiliationIndices)),
    provenance: source.provenance.map(encodeProvenance) };
  if (own(source, "affiliations")) paper.affiliations = encodeAffiliations(source.affiliations, affiliationIndices);
  let flags = 0;
  if (own(source, "originalAbstract") && typeof source.abstract === "string" && source.originalAbstract === source.abstract) {
    flags |= 1;
    delete paper.originalAbstract;
  }
  return [flags, paper];
}

export function decodeV3Paper(record: unknown, affiliations: readonly string[]): Record<string, any> {
  if (!Array.isArray(record) || record.length !== 2 || !Number.isInteger(record[0])
    || record[0] < 0 || record[0] > 1 || !object(record[1])) fail("wrapper");
  const [flags, source] = record as CompactPaper;
  if (!Array.isArray(source.authors) || !Array.isArray(source.provenance)) fail("authors or provenance");
  const paper: Record<string, any> = { ...source, authors: source.authors.map((author: unknown) => decodeAuthor(author, affiliations)),
    provenance: source.provenance.map(decodeProvenance) };
  if (own(source, "affiliations")) paper.affiliations = decodeAffiliations(source.affiliations, affiliations);
  if (flags & 1) {
    if (own(source, "originalAbstract") || typeof source.abstract !== "string") fail("shared abstract");
    paper.originalAbstract = source.abstract;
  }
  return paper;
}
