import { normalizeDoi, textOnly } from "./classify";
import { normalizeRecord } from "./record";
import type { Paper } from "./types";

const decode = (value: string) => value.replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
  const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1),16) : Number(code);
  return n <= 0x10ffff ? String.fromCodePoint(n) : "�";
});
function xmlText(value: string) {
  return decode(textOnly(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")));
}
function elements(xml: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = name.includes(":") ? escaped : `(?:[\\w-]+:)?${escaped}`;
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))].map(m => m[1]);
}
const tag = (xml: string, name: string) => xmlText(elements(xml,name)[0] ?? "");
const provenance = (url: string, now: string, sourceRecordId: string, queryTrack?: string) => [{queryUrl:url,collectedAt:now,sourceRecordId,queryTrack}];

export function parseEpmc(hit: any, url: string, now: string, track?: string): Paper {
  if (!hit || !hit.id || !hit.source) throw new Error("Europe PMC 记录缺少 id/source");
  const authors = (hit.authorList?.author ?? []).map((a: any) => ({
    name: textOnly([a.firstName,a.lastName].filter(Boolean).join(" ") || a.fullName || a.collectiveName),
    displayName: a.fullName, orcid: a.authorId?.type === "ORCID" ? a.authorId.value : null,
    affiliations: (a.authorAffiliationDetailsList?.authorAffiliation ?? []).map((x: any) => textOnly(x.affiliation)),
  }));
  // authorString is kept when the source does not supply a structured author list.
  const doi = normalizeDoi(hit.doi);
  const preprint = hit.source === "PPR" || (hit.pubTypeList?.pubType ?? []).some((x: string) => /preprint/i.test(x));
  return normalizeRecord({
    id:`epmc:${hit.source}:${hit.id}`, title:hit.title, abstract:hit.abstractText,
    originalAbstract:hit.abstractText ?? null, authors, authorString:hit.authorString ?? null,
    doi, pmid:hit.pmid ?? (hit.source === "MED" ? hit.id : null), pmcid:hit.pmcid ?? null,
    source:"Europe PMC", sourceCollection:hit.source, status:preprint ? "preprint" : "published",
    publishedAt:hit.firstPublicationDate ?? "", updatedAt:hit.dateOfRevision ?? null, firstSeenAt:now,
    venue:hit.journalInfo?.journal?.title ?? null,
    url:doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${hit.source}/${hit.id}`,
    version:hit.versionNumber, versions:hit.versionList?.version ?? [],
    provenance:provenance(url,now,String(hit.id),track),
  }, now);
}

export function parseArxiv(xml: string, url: string, now: string): { papers: Paper[]; total: number } {
  if (!/<(?:[\w-]+:)?feed(?:\s|>)/i.test(xml) || !/<\/(?:[\w-]+:)?feed\s*>/i.test(xml)) throw new Error("arXiv 返回了无效或截断的 Atom feed");
  const totalText = tag(xml,"totalResults");
  if (!/^\d+$/.test(totalText)) throw new Error(`arXiv 响应缺少有效结果总数${tag(xml,"summary") ? `：${tag(xml,"summary").slice(0,240)}` : ""}`);
  const papers = elements(xml,"entry").map(entry => {
    const entryId = tag(entry,"id");
    const rawId = entryId.match(/^https?:\/\/arxiv\.org\/abs\/(.+)$/)?.[1];
    if (!rawId || !/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(rawId)) throw new Error(`arXiv 记录ID无效：${entryId.slice(0,120)}`);
    const baseId = rawId.replace(/v\d+$/, "");
    const authors = elements(entry,"author").map(a => ({name:tag(a,"name"),affiliations:elements(a,"arxiv:affiliation").map(xmlText)}));
    const relatedDoi = normalizeDoi(tag(entry,"arxiv:doi"));
    return normalizeRecord({
      id:`arxiv:${baseId}`, arxivId:baseId, title:tag(entry,"title"), abstract:tag(entry,"summary"),
      originalAbstract:elements(entry,"summary")[0] ?? null, authors,
      doi:relatedDoi, relatedDoi, source:"arXiv", status:"preprint",
      publishedAt:tag(entry,"published").slice(0,10), updatedAt:tag(entry,"updated") || null,
      firstSeenAt:now, venue:tag(entry,"arxiv:journal_ref") || null, url:`https://arxiv.org/abs/${rawId}`,
      version:Number(rawId.match(/v(\d+)$/)?.[1] ?? 1),
      versions:[{version:Number(rawId.match(/v(\d+)$/)?.[1] ?? 1),updatedAt:tag(entry,"updated"),url:`https://arxiv.org/abs/${rawId}`}],
      provenance:provenance(url,now,rawId),
    }, now);
  });
  const total = Number(totalText);
  if (!Number.isSafeInteger(total)) throw new Error("arXiv 结果总数无效");
  if (total > 0 && papers.length === 0) throw new Error("arXiv 声明存在结果，但未返回任何有效记录");
  return {papers,total};
}

export function parseMedrxiv(hit: any, url: string, now: string): Paper {
  const doi = normalizeDoi(hit?.doi);
  if (!doi) throw new Error("medRxiv 记录缺少 DOI");
  const institution = textOnly(hit.author_corresponding_institution);
  const authors = String(hit.authors ?? "").split(";").map(textOnly).filter(Boolean).map(name => ({
    name, affiliations:name.toLowerCase() === textOnly(hit.author_corresponding).toLowerCase() && institution ? [institution] : [],
  }));
  return normalizeRecord({
    id:`doi:${doi}`, title:hit.title, abstract:hit.abstract, originalAbstract:hit.abstract ?? null,
    authors, authorString:hit.authors ?? null, affiliations:institution ? [institution] : [],
    doi, source:"medRxiv", status:"preprint", publishedAt:hit.date, updatedAt:hit.date, firstSeenAt:now,
    url:`https://doi.org/${doi}`, version:Number(hit.version ?? 1),
    relatedDoi:hit.published && hit.published !== "NA" ? hit.published : null,
    versions:[{version:hit.version,date:hit.date}], provenance:provenance(url,now,doi),
  }, now);
}

export function parseJsonResponse(body: string, source: string): any {
  if (!body.trim()) throw new Error(`${source} 返回 HTTP 200 但响应体为空；无法判定是否有新论文`);
  try { return JSON.parse(body); }
  catch { throw new Error(`${source} 返回非 JSON 响应；无法判定是否有新论文`); }
}

export function parseMedrxivPage(body: string): { hits: any[]; total: number } {
  const data = parseJsonResponse(body,"medRxiv");
  const message = data.messages?.[0];
  if (message?.status !== "ok" || !Array.isArray(data.collection)) throw new Error(`medRxiv 返回无法识别的结果${message?.status ? `（status=${String(message.status).slice(0,120)}）` : ""}`);
  const total = Number(message.total);
  if (message.total === undefined || message.total === null || message.total === "" || !Number.isSafeInteger(total) || total < 0) throw new Error("medRxiv 总数无效");
  if (total > 0 && data.collection.length === 0) throw new Error("medRxiv 声明存在结果，但返回空 collection");
  return {hits:data.collection,total};
}
