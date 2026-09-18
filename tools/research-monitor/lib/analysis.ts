import { normalizedName, textOnly, TRACKS } from "./classify";
import { beijingDay, matchesTeam, type DashboardFilters } from "./dashboard";
import type { Author, MonitorData, Paper, Team } from "./types";

export const SIGNAL_LABELS = {
  external_validation: "外部验证线索",
  multicentre: "多中心研究线索",
  prospective: "前瞻性研究线索",
  clinician_evaluation: "临床人员评估线索",
  code_availability: "代码开放线索",
  data_availability: "数据开放线索",
} as const;
export type EvidenceSignalId = keyof typeof SIGNAL_LABELS;
export type EvidenceSignal = { id: EvidenceSignalId; label: string; excerpt: string };
export type PaperAnalysis = {
  paperId: string; hasAbstract: boolean;
  objective: string | null; methods: string | null; results: string | null;
  signals: EvidenceSignal[];
};
export type AnalysisCount = { id: string; label: string; count: number; share: number; denominator: number; paperIds: string[] };
export type MethodCombination = AnalysisCount & { trackId: string; trackLabel: string; method: string };
export type AnalysisTopic = AnalysisCount & { kind: "organ" | "modality" };
export type AnalysisAuthor = {
  id: string; name: string; orcid: string | null; identityUncertain: boolean;
  affiliations: string[]; count: number; paperIds: string[];
};
export type CoauthorPair = { id: string; a: AnalysisAuthor; b: AnalysisAuthor; count: number; paperIds: string[] };
export type ReadingCandidate = { paper: Paper; analysis: PaperAnalysis; reasons: {kind: "combination" | "signal" | "recent"; label: string; trackLabel?: string; method?: string; signalId?: EvidenceSignalId}[] };
export type PreliminaryAnalysis = {
  scope: { rows: Paper[]; total: number; withAbstractCount: number; from: string; to: string; clock: "publication"; duplicatesRemoved: number; excludedInvalidDate: number; excludedFuture: number };
  directions: AnalysisCount[]; topics: AnalysisTopic[]; combinations: MethodCombination[];
  signals: AnalysisCount[]; authorsTop: AnalysisAuthor[]; coauthorPairs: CoauthorPair[];
  coauthorExcludedLargePapers: number;
  watchlistMatches: { team: Team; count: number; paperIds: string[] }[];
  paperAnalyses: Record<string, PaperAnalysis>;
  readingCandidates: ReadingCandidate[];
};

const DAY = 86400000;
const signalRules: Record<EvidenceSignalId, RegExp> = {
  external_validation: /extern(?:al|ally)[ -](?:validat|evaluat|test)|(?:validat|evaluat|test)\w*\b.{0,70}\bexternal (?:cohort|dataset|data set|test|data|hospital|population)|independent external/i,
  multicentre: /multi[ -]?(?:cent(?:er|re)|institution|site)|(?:across|from|at) (?:\d+|two|three|four|five|six|seven|eight|nine|ten) (?:hospitals|cent(?:er|re)s|institutions|sites)/i,
  prospective: /\bprospective\b.{0,45}\b(?:study|trial|cohort|design|validation|evaluation|investigation|analysis)|\bprospectively (?:evaluat|validat|enroll|recruit|collect|stud|assess|test)/i,
  clinician_evaluation: /(?:reader|observer) stud|multi[ -]?reader|(?:radiologists?|clinicians?|physicians?|pathologists?|readers?|surgeons?)\b.{0,65}\b(?:evaluat|assess|review|interpret|read |rated|compared)|(?:evaluat|assess|review|rated)\w*\b.{0,65}\b(?:radiologists?|clinicians?|physicians?|pathologists?|readers?|surgeons?)/i,
  code_availability: /\b(?:code|software|implementation)\b.{0,90}\b(?:available|released|accessible|open[ -]source)|\b(?:release|share|provide|publish)\w*\b.{0,45}\b(?:code|software|implementation)\b/i,
  data_availability: /\b(?:data|dataset|data set)\b(?![- ](?:split|availability|sharing|indices|index|augmentation|preprocessing)).{0,90}\b(?:available|released|accessible|open[ -]access)|\b(?:release|share|provide|publish)\w*\b.{0,45}\b(?:data|dataset|data set)\b(?![- ](?:split|availability|sharing|indices|index|augmentation|preprocessing))/i,
};
const futureOrBackground = /\b(?:will|would|could|should|future|planned|planning|intend|propos(?:e|ed) to|aim(?:ed|s|ing)? to|need(?:s|ed)?|warrant(?:s|ed)?)\b|\b(?:prior|previous|earlier|existing) (?:work|studies|study|research|literature)|^(?:background|introduction)\s*:/i;
const negation = /\b(?:no|not|without|never|neither|lack(?:s|ed|ing)?)\b/i;
const performed = /\b(?:included|involved|enrolled|recruited|collected|conducted|performed|evaluated|validated|assessed|tested|demonstrated|achieved|showed|found|used|using)\b|\bwe (?:evaluat|validat|assess|test|conduct|perform|enroll|recruit|collect|analy[sz])/i;
function sentences(abstract: string): string[] {
  return (" " + abstract).replace(/\s+((?:BACKGROUND|OBJECTIVES?|PURPOSE|AIMS?|(?:MATERIALS\s*(?:&|AND)\s*)?METHODS?|RESULTS?|CONCLUSIONS?|FINDINGS):)/gi, "\n$1")
    .split(/\n|(?<=[.!?])\s+(?=[A-Z([])/).map(value => value.trim()).filter(Boolean);
}
function excerpt(sentence: string, size = 420): string {
  if (sentence.length <= size) return sentence;
  const cut = sentence.lastIndexOf(" ", size - 1);
  return sentence.slice(0, cut > size / 2 ? cut : size - 1) + "…";
}
function signalExcerpt(sentence: string, id: EvidenceSignalId): string {
  const index = sentence.search(signalRules[id]);
  const start = Math.max(0, index - 65);
  return (start ? "…" : "") + excerpt(sentence.slice(start), 300);
}
function isSignal(sentence: string, id: EvidenceSignalId): boolean {
  if (!signalRules[id].test(sentence) || futureOrBackground.test(sentence) || negation.test(sentence)) return false;
  if (id === "code_availability" || id === "data_availability") {
    if (/upon (?:reasonable )?request|on request|restricted access|subject to approval/i.test(sentence)) return false;
    if (id === "data_availability" && /supplementary (?:information|data|material)/i.test(sentence)) return false;
    // Merely using someone else's public code/data does not establish this paper's availability.
    if (/\b(?:us(?:e|ed|ing)|utiliz(?:e|ed|ing)|adopt(?:ed|ing)?)\b.{0,75}\b(?:code|software|implementation|data|dataset|data set)\b/i.test(sentence) && !/\bwe (?:release|share|provide|publish)\b/i.test(sentence)) return false;
    return /\b(?:our|we|all|the)\b.{0,70}\b(?:code|software|implementation|data|dataset|data set)\b.{0,70}\b(?:available|released|accessible|open[ -])|\b(?:code|software|implementation|data|dataset|data set)\b.{0,35}\b(?:is|are|was|were|has been|have been)\b.{0,50}\b(?:available|released|accessible|open[ -])|\bwe (?:release|share|provide|publish)\b/i.test(sentence);
  }
  return performed.test(sentence);
}
export function buildPaperAnalysis(paper: Paper): PaperAnalysis {
  const abstract = textOnly(paper.originalAbstract?.trim() ? paper.originalAbstract : paper.abstract);
  const lines = sentences(abstract);
  const choose = (pattern: RegExp, reject?: RegExp) => {
    const line = lines.find(line => pattern.test(line) && (!reject || !reject.test(line)));
    return line ? excerpt(line) : null;
  };
  const objective = choose(/\b(?:we|this study|our study)\b.{0,60}\baim(?:ed|s)?\b|\b(?:aim|objective|purpose) of (?:this|the|our) (?:study|project|research)/i, /^(?:background|introduction)\s*:/i)
    ?? choose(/\b(?:we|this study|our study)\b.{0,60}\b(?:investigat|introduc|propos|develop|present|evaluat)/i, /^(?:background|introduction)\s*:/i)
    ?? choose(/^(?:objectives?|purpose|aims?)\s*:/i);
  const notPerformedMethod = /\b(?:will|planned|intend|future|aim(?:ed|s|ing)? to)\b|\b(?:objective|purpose) of (?:this|the|our)\b|^(?:objectives?|purpose|aims?)\s*:/i;
  const methods = choose(/^(?:materials\s*(?:&|and)\s*)?methods?\s*:/i, notPerformedMethod)
    ?? choose(/\b(?:we|our study|this study)\b.{0,60}\b(?:train|develop|design|implement|use|conduct|collect|enroll)|\b(?:was|were) (?:trained|evaluated|collected|enrolled|conducted|used)\b/i, notPerformedMethod);
  const results = choose(/^(?:results?|findings?)\s*:|\b(?:achieved|outperformed|demonstrated|showed|yielded|found)\b|\b(?:auc|dice|accuracy|sensitivity|specificity)\b.{0,40}\b\d+(?:\.\d+)?/i, futureOrBackground);
  const isProtocol = /\b(?:study|trial|research) protocol\b|\bprotocol for (?:a |an |the )?(?:prospective|multi|clinical|randomized|study|trial)/i.test(paper.title + " " + abstract);
  const reviewKind = "(?:(?:narrative|systematic|scoping|comprehensive|literature|critical|umbrella) )?(?:review|survey|meta[ -]analysis)";
  const isReview = /\b(?:review|meta[ -]analysis|survey)\b/i.test(paper.title)
    || new RegExp(`\\b(?:this|our|the present) ${reviewKind}\\b|\\bwe (?:conducted|performed|present|provide) (?:a |an )?${reviewKind}\\b`, "i").test(abstract);
  const signals = (Object.keys(SIGNAL_LABELS) as EvidenceSignalId[]).flatMap(id => {
    if ((isProtocol || isReview) && id !== "code_availability" && id !== "data_availability") return [];
    const line = lines.find(sentence => isSignal(sentence, id));
    return line ? [{id, label: SIGNAL_LABELS[id], excerpt: signalExcerpt(line, id)}] : [];
  });
  return {paperId: paper.id, hasAbstract: !!abstract, objective, methods, results, signals};
}

function validPublicationDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  const date = new Date(day + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}
function countRow(id: string, label: string, paperIds: string[], denominator: number): AnalysisCount {
  return {id, label, paperIds, count: paperIds.length, denominator, share: denominator ? paperIds.length / denominator * 100 : 0};
}
function authorIdentity(author: Author): {id: string; name: string; orcid: string | null; identityUncertain: boolean} | null {
  const name = (author.displayName || author.name).trim();
  const rawOrcid = (author.orcid || "").replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, "").trim().toUpperCase();
  const orcid = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(rawOrcid) ? rawOrcid : null;
  const normalized = normalizedName(name);
  if (!orcid && !normalized) return null;
  return {id: orcid ? `orcid:${orcid}` : `name:${normalized}`, name: name || orcid!, orcid, identityUncertain: !orcid};
}

/** Always uses publication dates, even when a caller supplies a discovery-clock filter. */
export function buildPreliminaryAnalysis(data: MonitorData, filters: DashboardFilters, teams: Team[], now = new Date()): PreliminaryAnalysis {
  const today = beijingDay(now);
  if (!today) throw new Error("Analysis requires a valid current date");
  const days = Number(filters.days);
  const windowDays = Number.isFinite(days) && days > 0 ? Math.min(36500, Math.floor(days)) : 30;
  const start = filters.days === "all" ? "" : new Date(Date.parse(today) - (windowDays - 1) * DAY).toISOString().slice(0, 10);
  const pool = data.papers.filter(paper => (filters.track === "all" || paper.tracks.includes(filters.track)) && (filters.source === "all" || paper.sources.includes(filters.source)));
  const unique = [...new Map(pool.map(paper => [paper.id, paper])).values()];
  let excludedInvalidDate = 0, excludedFuture = 0;
  const rows = unique.filter(paper => {
    const day = validPublicationDay(paper.publishedAt);
    if (!day) {excludedInvalidDate++; return false;}
    if (day > today) {excludedFuture++; return false;}
    return !start || day >= start;
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const total = rows.length;
  const paperAnalyses = Object.fromEntries(rows.map(paper => [paper.id, buildPaperAnalysis(paper)]));
  const withAbstractCount = rows.filter(paper => paperAnalyses[paper.id].hasAbstract).length;
  const scope = {rows, total, withAbstractCount, from: start || rows.reduce((min, paper) => paper.publishedAt.slice(0, 10) < min ? paper.publishedAt.slice(0, 10) : min, today), to: today, clock: "publication" as const, duplicatesRemoved: pool.length - unique.length, excludedInvalidDate, excludedFuture};
  const directions = Object.entries(TRACKS).map(([id, label]) => countRow(id, label, rows.filter(paper => paper.tracks.includes(id)).map(paper => paper.id), total));
  const topics: AnalysisTopic[] = (["organ", "modality"] as const).flatMap(kind => {
    const field = kind === "organ" ? "organs" : "modalities";
    return [...new Set(rows.flatMap(paper => paper[field]))].map(label => ({...countRow(`${kind}:${label}`, label, rows.filter(paper => paper[field].includes(label)).map(paper => paper.id), total), kind}));
  }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const combinations: MethodCombination[] = directions.flatMap(direction => {
    const selected = rows.filter(paper => paper.tracks.includes(direction.id));
    // A foundation-model direction and foundation-model method are the same rule, not a finding.
    return [...new Set(selected.flatMap(paper => paper.methods))].filter(method => !(direction.id === "foundation" && method === "基础模型")).map(method => ({...countRow(`${direction.id}:${method}`, `${direction.label} × ${method}`, selected.filter(paper => paper.methods.includes(method)).map(paper => paper.id), direction.count), trackId: direction.id, trackLabel: direction.label, method}));
  }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, 20);
  const signals = (Object.keys(SIGNAL_LABELS) as EvidenceSignalId[]).map(id => countRow(id, SIGNAL_LABELS[id], rows.filter(paper => paperAnalyses[paper.id].signals.some(signal => signal.id === id)).map(paper => paper.id), withAbstractCount));
  const authorMap = new Map<string, AnalysisAuthor>();
  const pairIds = new Map<string, {a: string; b: string; papers: Set<string>}>();
  let coauthorExcludedLargePapers = 0;
  for (const paper of rows) {
    const seen = new Set<string>();
    for (const author of paper.authors) {
      const identity = authorIdentity(author);
      if (!identity || seen.has(identity.id)) continue;
      seen.add(identity.id);
      const entry = authorMap.get(identity.id) ?? {...identity, affiliations: [], count: 0, paperIds: []};
      entry.paperIds.push(paper.id); entry.count++;
      entry.affiliations = [...new Set([...entry.affiliations, ...author.affiliations])];
      authorMap.set(identity.id, entry);
    }
    if (seen.size > 40) {coauthorExcludedLargePapers++; continue;}
    const ids = [...seen].sort();
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const key = JSON.stringify([ids[a], ids[b]]);
      const pair = pairIds.get(key) ?? {a: ids[a], b: ids[b], papers: new Set<string>()};
      pair.papers.add(paper.id); pairIds.set(key, pair);
    }
  }
  const authorsTop = [...authorMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 12);
  const coauthorPairs: CoauthorPair[] = [...pairIds.entries()].map(([id, pair]) => ({id, a: authorMap.get(pair.a)!, b: authorMap.get(pair.b)!, count: pair.papers.size, paperIds: [...pair.papers]})).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, 12);
  const watchlistMatches = teams.map(team => ({team, paperIds: rows.filter(paper => matchesTeam(paper, team)).map(paper => paper.id)})).map(row => ({...row, count: row.paperIds.length})).sort((a, b) => b.count - a.count || a.team.id.localeCompare(b.team.id));
  const readingCandidates: ReadingCandidate[] = [];
  const chosen = new Set<string>(), represented = new Set<string>();
  const addCandidate = (paper: Paper, initial: ReadingCandidate["reasons"][number]) => {
    if (readingCandidates.length >= 6 || chosen.has(paper.id)) return;
    const analysis = paperAnalyses[paper.id];
    const reasons: ReadingCandidate["reasons"] = [initial];
    for (const signal of analysis.signals) if (reasons.length < 3 && !reasons.some(reason => reason.signalId === signal.id)) reasons.push({kind: "signal", label: signal.label, signalId: signal.id});
    chosen.add(paper.id);
    for (const combo of combinations) if (combo.paperIds.includes(paper.id)) represented.add(combo.id);
    readingCandidates.push({paper, analysis, reasons});
  };
  // Recent representative records diversify combinations; this is not a quality ranking.
  for (const paper of rows.filter(paper => paperAnalyses[paper.id].hasAbstract)) {
    const combo = combinations.find(combo => combo.paperIds.includes(paper.id) && !represented.has(combo.id));
    if (combo) addCandidate(paper, {kind: "combination", label: "方向与方法组合代表", trackLabel: combo.trackLabel, method: combo.method});
  }
  for (const paper of rows.filter(paper => paperAnalyses[paper.id].signals.length)) addCandidate(paper, {kind: "signal", label: paperAnalyses[paper.id].signals[0].label, signalId: paperAnalyses[paper.id].signals[0].id});
  for (const paper of rows.filter(paper => paperAnalyses[paper.id].hasAbstract)) addCandidate(paper, {kind: "recent", label: "近期来源记录"});
  for (const paper of rows) addCandidate(paper, {kind: "recent", label: "近期来源记录"});
  return {scope, directions, topics, combinations, signals, authorsTop, coauthorPairs, coauthorExcludedLargePapers, watchlistMatches, paperAnalyses, readingCandidates};
}
