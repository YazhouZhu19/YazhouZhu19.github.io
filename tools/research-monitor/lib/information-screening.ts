import { groupWorks } from "./paper-works";
import { explicitEvidenceKeys } from "./signal-evidence";
import type { ResearchSignal } from "./research-signals";
import type { Paper } from "./types";

export type ScreeningText = { zh: string; en: string };
export type ScreeningFinding = {
  id: string;
  status: "observed" | "review" | "unknown";
  message: ScreeningText;
  excerpt?: string;
  comparison?: { label: ScreeningText; excerpts: string[]; count: number }[];
};
export type ScreeningReference = { id: string; title: string; url: string; basis: ScreeningText };
export type PaperScreening = {
  paperId: string;
  history: {
    state: "new" | "known" | "related-version" | "unknown";
    findings: ScreeningFinding[];
    references: ScreeningReference[];
  };
  crossSource: {
    state: "linked" | "none" | "incomplete";
    findings: ScreeningFinding[];
    references: ScreeningReference[];
  };
  priorWork: {
    state: "candidates" | "none";
    findings: ScreeningFinding[];
    references: ScreeningReference[];
  };
  logic: { state: "review" | "insufficient" | "cues-found"; findings: ScreeningFinding[] };
};

type Input = {
  papers: Paper[];
  candidateIds: string[];
  signals: ResearchSignal[];
  loaded: { github: boolean; news: boolean };
  since: string;
  asOf: string;
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const text = (zh: string, en: string): ScreeningText => ({ zh, en });
const finding = (
  id: string,
  status: ScreeningFinding["status"],
  zh: string,
  en: string,
  excerpt?: string,
): ScreeningFinding => ({ id, status, message: text(zh, en), ...(excerpt ? { excerpt } : {}) });

function calendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
/** Date-only values and timezone-qualified timestamps; calendar rollover is never accepted. */
function day(value: string | null | undefined): string | null {
  if (!value || !calendarDay(value.slice(0, 10))) return null;
  if (value.length === 10) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
function firstDiscovery(paper: Paper): string | null {
  return (
    [paper.firstSeenAt, ...paper.provenance.map((entry) => entry.collectedAt)]
      .map(day)
      .filter((value): value is string => value !== null)
      .sort(compare)[0] ?? null
  );
}
function available(paper: Paper, asOf: string): boolean {
  if (paper.dateAnomaly === "future") return false;
  // We cannot recover the text of a current record revised/collected after the cutoff.
  return [
    paper.publishedAt,
    paper.updatedAt,
    paper.firstSeenAt,
    ...paper.provenance.map((p) => p.collectedAt),
  ].every((value) => !value || (day(value) !== null && day(value)! <= asOf));
}
function identityPaper(paper: Paper): Paper {
  // Only the primary record URL may supply missing identity fields. Abstract links
  // and shared project URLs are associations, never bibliographic identities.
  const keys = explicitEvidenceKeys([paper.url]);
  return {
    ...paper,
    doi: paper.doi || keys.find((key) => key.startsWith("doi:"))?.slice(4) || null,
    arxivId: paper.arxivId || keys.find((key) => key.startsWith("arxiv:"))?.slice(6) || null,
  };
}
function reference(paper: Paper, basis: ScreeningText): ScreeningReference {
  return { id: paper.id, title: paper.title, url: paper.url, basis };
}

const historyScope = () =>
  finding(
    "history-scope",
    "unknown",
    "仅比较当前库记录及采集溯源，不恢复旧快照，也不推断历史摘要或版本内容差异。首次采集不是发表日期；库中新发现不代表科学创新。",
    "Compares current library records and collection provenance only; no old snapshots, historical abstracts or version diffs are reconstructed. First collection is not publication, and a new library discovery does not establish scientific novelty.",
  );
function historyFor(paper: Paper, group: Paper[], since: string): PaperScreening["history"] {
  const first = firstDiscovery(paper);
  const others = group.filter((other) => other.id !== paper.id);
  const findings = [historyScope()];
  if (first)
    findings.push(
      finding(
        "first-discovery",
        "observed",
        `当前记录中最早的 firstSeenAt／采集溯源日期为 ${first}（UTC）；${first < since ? "早于" : "位于或晚于"}观察起点 ${since}。`,
        `Earliest firstSeenAt/collection provenance in the current record is ${first} (UTC), ${first < since ? "before" : "on or after"} the window start ${since}.`,
      ),
    );
  else
    findings.push(
      finding(
        "first-discovery",
        "unknown",
        "缺少有效的首次采集／溯源日期，无法确定是否为库中新发现。",
        "No valid first-collection/provenance date; library discovery timing is unknown.",
      ),
    );
  if (others.length)
    findings.push(
      finding(
        "same-work",
        "observed",
        `库中另有 ${others.length} 条记录通过 DOI、arXiv、PMID 或来源原生标识关联为同作品，可能为重复或版本记录；显示至多 5 条。标识关联不证明内容发生变化。`,
        `${others.length} other library record(s) share DOI, arXiv, PMID or source-native work identifiers, possibly duplicates or versions; up to 5 shown. Identity links do not establish content changes.`,
      ),
    );
  return {
    state: others.length ? "related-version" : first ? (first < since ? "known" : "new") : "unknown",
    findings,
    references: others
      .slice(0, 5)
      .map((other) =>
        reference(
          other,
          text(
            "可靠作品标识关联（含显式 relatedDoi 版本链接）；不是标题相似、摘要引用或共享代码库推断。",
            "Linked by work identifiers (including explicit relatedDoi version links), not title similarity, abstract citations or a shared repository.",
          ),
        ),
      ),
  };
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}
type SignalGroup = { records: ResearchSignal[]; keys: Set<string> };
function signalIndex(signals: ResearchSignal[], asOf: string) {
  const eligible = signals
    .filter((signal) => {
      const required = [signal.observedAt, signal.firstSeenAt];
      const optional = [
        signal.publishedAt,
        signal.updatedAt,
        ...(signal.kind === "github" ? [signal.pushedAt, signal.releasedAt] : []),
      ];
      return (
        required.every((value) => !!day(value) && day(value)! <= asOf) &&
        optional.every((value) => !value || (!!day(value) && day(value)! <= asOf))
      );
    })
    .sort((a, b) => compare(a.id, b.id) || compare(a.url, b.url));
  const parent = eligible.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const urls = new Map<string, number>();
  eligible.forEach((signal, index) => {
    // Deduplicate actual URLs and news originalUrl, not every related paper URL:
    // two distinct articles linking to one paper remain distinct associations.
    for (const url of [signal.url, signal.kind === "news" ? signal.originalUrl : null]) {
      const key = url && canonicalUrl(url);
      if (!key) continue;
      const previous = urls.get(key);
      if (previous !== undefined) parent[root(index)] = root(previous);
      urls.set(key, index);
    }
  });
  const groups = new Map<number, SignalGroup>();
  eligible.forEach((signal, index) => {
    const key = root(index);
    const group = groups.get(key) ?? { records: [], keys: new Set<string>() };
    group.records.push(signal);
    for (const value of explicitEvidenceKeys([
      signal.url,
      ...signal.relatedUrls,
      signal.kind === "news" ? signal.originalUrl : null,
    ]))
      group.keys.add(value);
    groups.set(key, group);
  });
  const byKey = new Map<string, Set<SignalGroup>>();
  for (const group of groups.values())
    for (const key of group.keys) {
      const bucket = byKey.get(key) ?? new Set<SignalGroup>();
      bucket.add(group);
      byKey.set(key, bucket);
    }
  return { byKey, excluded: signals.length - eligible.length };
}
function crossSourceFor(
  paper: Paper,
  index: ReturnType<typeof signalIndex>,
  loaded: Input["loaded"],
): PaperScreening["crossSource"] {
  const direct = new Set(
    explicitEvidenceKeys([
      paper.url,
      paper.doi,
      paper.relatedDoi,
      paper.arxivId,
      /^arxiv:/i.test(paper.id) ? paper.id : null,
    ]),
  );
  const keys = new Set([...direct, ...explicitEvidenceKeys([paper.abstract, paper.originalAbstract])]);
  const matches = new Map<SignalGroup, string[]>();
  for (const key of [...keys].sort(compare))
    for (const group of index.byKey.get(key) ?? []) {
      const basis = matches.get(group) ?? [];
      basis.push(key);
      matches.set(group, basis);
    }
  const references = [...matches]
    .map(([group, basis]): ScreeningReference => {
      const representative = group.records[0];
      const viaAbstract = basis.every((key) => !direct.has(key));
      const reason = basis.join(", ");
      return {
        id: representative.id,
        title: representative.title,
        url:
          representative.kind === "news"
            ? representative.originalUrl || representative.url
            : representative.url,
        basis: text(
          `${viaAbstract ? "仅通过摘要引用／链接关联，不证明该报道描述本论文" : "记录字段存在显式标识／URL 指向关系，不证明同一作品"}：${reason}。${group.records.length > 1 ? `已合并 ${group.records.length} 条同 URL／原文 URL 记录。` : ""}`,
          `${viaAbstract ? "Association via an abstract citation/link only; the coverage may concern a cited work" : "Explicit identifier/URL association in record fields; not proof of work identity"}: ${reason}.${group.records.length > 1 ? ` Collapsed ${group.records.length} records with the same URL/original URL.` : ""}`,
        ),
      };
    })
    .sort((a, b) => compare(a.id, b.id) || compare(a.url, b.url));
  const complete = loaded.github && loaded.news;
  const findings = [
    finding(
      "cross-source-scope",
      "unknown",
      "仅检查截止日期内可用的显式 DOI、arXiv 或 URL 链接；报道、转载和代码仓库不是独立科学验证，未核验全文。",
      "Checks explicit DOI, arXiv or URL links available by the cutoff only. Coverage, reposts and repositories are not independent scientific validation; full texts were not checked.",
    ),
  ];
  if (!complete)
    findings.push(
      finding(
        "source-coverage",
        "unknown",
        `来源尚未完全加载：${[!loaded.github && "GitHub", !loaded.news && "News"].filter(Boolean).join("、")}；不能报告完整的无匹配结论。`,
        `Sources not fully loaded: ${[!loaded.github && "GitHub", !loaded.news && "News"].filter(Boolean).join(", ")}; absence of matches is incomplete.`,
      ),
    );
  if (index.excluded)
    findings.push(
      finding(
        "source-cutoff",
        "unknown",
        `有 ${index.excluded} 条来源记录因日期无效或采集／观察／修订／发布日期晚于截止日期而未参与关联。`,
        `${index.excluded} source record(s) excluded for invalid dates or collection/observation/revision/publication after the cutoff.`,
      ),
    );
  findings.push(
    finding(
      "explicit-links",
      references.length ? "observed" : "unknown",
      references.length
        ? `找到 ${references.length} 组显式链接关联（已按 URL／原文 URL 去重）。`
        : "在可用来源记录中未找到显式链接；这不表示不存在相关代码或报道。",
      references.length
        ? `Found ${references.length} explicit link group(s), deduplicated by URL/original URL.`
        : "No explicit links found in available source records; related code or coverage may still exist.",
    ),
  );
  return { state: !complete ? "incomplete" : references.length ? "linked" : "none", findings, references };
}

const stopWords = new Set(
  "the and for with from using based toward towards into via study studies novel new method methods model models learning deep medical image images imaging analysis approach framework data a an of in on to by is are as we our this that".split(
    " ",
  ),
);
function titleWords(value: string): string[] {
  return [
    ...new Set(
      (
        value
          .normalize("NFKC")
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
      ).filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !stopWords.has(word)),
    ),
  ].sort(compare);
}
const labels = (values: string[]) =>
  [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort(compare);
type PriorEntry = { paper: Paper; words: Set<string>; tasks: string[]; modalities: string[]; date: string };
function priorIndex(papers: Paper[]) {
  const entries: PriorEntry[] = [];
  const postings = new Map<string, PriorEntry[]>();
  for (const paper of papers) {
    const date = day(paper.publishedAt);
    if (!date) continue;
    const entry = {
      paper,
      date,
      words: new Set(titleWords(paper.title)),
      tasks: labels(paper.tasks),
      modalities: labels(paper.modalities),
    };
    entries.push(entry);
    for (const word of entry.words) {
      const bucket = postings.get(word) ?? [];
      bucket.push(entry);
      postings.set(word, bucket);
    }
  }
  // Hard bounds avoid a common title token turning screening into an all-pairs scan.
  const maxPosting = Math.min(128, Math.max(32, Math.ceil(entries.length * 0.1)));
  return { postings, maxPosting };
}
function priorWorkFor(
  paper: Paper,
  index: ReturnType<typeof priorIndex>,
  workIds: Map<string, string>,
): PaperScreening["priorWork"] {
  const cutoff = day(paper.publishedAt);
  const findings = [
    finding(
      "prior-work-scope",
      "unknown",
      "在当前完整参照库中，用至多 8 个稀有标题词及任务／模态标签检索较早发表的不同作品；排除晚于候选发表日期的修订，至多显示 5 个候选。这不是系统综述；未找到不表示创新或无前人，全文未检查。",
      "Searches the full current reference corpus for distinct, earlier-published works using up to 8 rare title terms plus task/modality labels; excludes revisions after candidate publication and shows at most 5 candidates. This is not a systematic review; no matches does not establish novelty or absence of prior work. Full texts were not checked.",
    ),
  ];
  if (!cutoff) {
    findings.push(
      finding(
        "prior-date",
        "unknown",
        "缺少有效发表日期，未用首次采集日期替代先后顺序。",
        "No valid publication date; first collection was not substituted to establish chronology.",
      ),
    );
    return { state: "none", findings, references: [] };
  }
  const terms = titleWords(paper.title)
    .filter((word) => {
      const count = index.postings.get(word)?.length ?? 0;
      return count > 0 && count <= index.maxPosting;
    })
    .sort((a, b) => index.postings.get(a)!.length - index.postings.get(b)!.length || compare(a, b))
    .slice(0, 8);
  const pool = new Set(terms.flatMap((word) => index.postings.get(word) ?? []));
  const tasks = new Set(labels(paper.tasks)),
    modalities = new Set(labels(paper.modalities));
  const matches = [...pool]
    .flatMap((entry) => {
      if (
        entry.paper.id === paper.id ||
        workIds.get(entry.paper.id) === workIds.get(paper.id) ||
        entry.date >= cutoff
      )
        return [];
      const revised = day(entry.paper.updatedAt);
      if (entry.paper.updatedAt && (!revised || revised > cutoff)) return [];
      const words = terms.filter((word) => entry.words.has(word));
      const sharedTasks = entry.tasks.filter((task) => tasks.has(task));
      const sharedModalities = entry.modalities.filter((modality) => modalities.has(modality));
      if (
        !(sharedTasks.length || sharedModalities.length) ||
        (words.length < 2 && !(sharedTasks.length && sharedModalities.length))
      )
        return [];
      const score =
        words.reduce((sum, word) => sum + 1 / index.postings.get(word)!.length, 0) +
        sharedTasks.length +
        sharedModalities.length;
      return [{ entry, words, sharedTasks, sharedModalities, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        compare(b.entry.date, a.entry.date) ||
        compare(a.entry.paper.id, b.entry.paper.id),
    );
  const seen = new Set<string>();
  const references: ScreeningReference[] = [];
  for (const match of matches) {
    const id = workIds.get(match.entry.paper.id)!;
    if (seen.has(id)) continue;
    seen.add(id);
    const { entry, words, sharedTasks, sharedModalities } = match;
    references.push(
      reference(
        entry.paper,
        text(
          `发表 ${entry.date}，早于 ${cutoff}；稀有标题词：${words.join("、")}；共同任务：${sharedTasks.join("、") || "未见"}；共同模态：${sharedModalities.join("、") || "未见"}。标签是检索线索，需核对实际贡献与实验。`,
          `Published ${entry.date}, before ${cutoff}; rare title terms: ${words.join(", ")}; shared tasks: ${sharedTasks.join(", ") || "none visible"}; shared modalities: ${sharedModalities.join(", ") || "none visible"}. Labels are retrieval cues; compare actual contributions and experiments.`,
        ),
      ),
    );
    if (references.length === 5) break;
  }
  findings.push(
    finding(
      "prior-candidates",
      references.length ? "observed" : "unknown",
      references.length
        ? `检索到 ${references.length} 个需人工对照的既有工作候选。`
        : "本次有界检索未找到符合规则的较早工作；常见标题词、缺少标签及未收录文献可能导致遗漏。",
      references.length
        ? `Retrieved ${references.length} prior-work candidate(s) for manual comparison.`
        : "The bounded search found no eligible earlier work; common title terms, missing labels and unindexed literature can cause omissions.",
    ),
  );
  return { state: references.length ? "candidates" : "none", findings, references };
}

// Preserve whole sentences, including negation. These lexical cues describe what
// is visible in an abstract, not whether a method, experiment or claim is valid.
function logicFor(paper: Paper): PaperScreening["logic"] {
  const abstract = (paper.originalAbstract?.trim() || paper.abstract.trim()).replace(/<[^>]*>/g, " ").trim();
  const findings = [
    finding(
      "logic-scope",
      "unknown",
      "只检查摘要中的可见表述；全文、实验设计与科学真伪未核验。摘要未见不代表全文缺失，概念论文不因没有实验线索被判低质量。",
      "Only visible abstract wording is checked; full text, experimental design and scientific validity were not verified. Not visible in the abstract does not mean absent from the full text; conceptual work is not downgraded for lacking experiments.",
    ),
  ];
  if (!abstract) {
    findings.push(
      finding(
        "abstract-missing",
        "unknown",
        "缺少摘要，无法提取研究逻辑线索。",
        "No abstract is available to extract research-logic cues.",
      ),
    );
    return { state: "insufficient", findings };
  }
  const sentences = abstract
    .split(/(?<=[.!?。！？])\s+(?=[A-Z\p{Script=Han}])|(?<=[。！？])\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const negation =
    /\b(?:no|not|never|neither|without|cannot|can't|didn't|doesn't|don't|failed\s+to|fails?\s+to|lack(?:s|ing)?|unable\s+to)\b|并未|未能|没有|不能|并不|不优于|未优于/i;
  const cues: { id: string; zh: string; en: string; rule: RegExp }[] = [
    {
      id: "question",
      zh: "研究问题／目标",
      en: "research question/objective",
      rule: /\b(?:aim|aims|objective|challenge|problem|investigate|investigates|whether|hypothesis|address|addresses)\b|研究问题|旨在|目标|挑战|探讨|假设/i,
    },
    {
      id: "method",
      zh: "方法／论证",
      en: "method/argument",
      rule: /\b(?:propose|proposes|develop|develops|introduce|introduces|framework|algorithm|theorem|proof|conceptual|theoretical)\b|提出|方法|算法|定理|证明|概念|理论/i,
    },
    {
      id: "experiment",
      zh: "实验／观察",
      en: "experiment/observation",
      rule: /\b(?:experiment|experiments|evaluat\w*|dataset|datasets|cohort|cohorts|retrospective|prospective|observational|patients|benchmark)\b|实验|评估|数据集|队列|观察性|回顾性|患者/i,
    },
    {
      id: "comparison",
      zh: "比较／结果",
      en: "comparison/result",
      rule: /\b(?:compar\w*|baseline|baselines|outperform\w*|superior|results|achiev\w*|accuracy|auc|dice|significant\w*)\b|比较|基线|优于|结果|准确率|显著/i,
    },
  ];
  let visible = 0;
  const cueSentences = new Map<string, string[]>();
  for (const cue of cues) {
    const matches = sentences.filter((sentence) => cue.rule.test(sentence));
    const sentence = matches[0];
    cueSentences.set(cue.id, matches);
    if (sentence) visible++;
    findings.push(
      finding(
        `logic-${cue.id}`,
        sentence ? "observed" : "unknown",
        sentence
          ? `摘要出现${cue.zh}相关表述；摘录保留否定与限定，不据此确认研究已完成或结果成立。`
          : `摘要未见明确的${cue.zh}词语线索；不代表全文缺失。`,
        sentence
          ? `Abstract wording contains a ${cue.en} cue. The excerpt retains negation and qualifications; it does not confirm completion or validity.`
          : `No explicit ${cue.en} wording detected in the abstract; this does not establish absence from the full text.`,
        sentence,
      ),
    );
  }
  // Presence is not logical entailment. Show the actual evidence on each side;
  // neither word overlap nor absence of overlap establishes a contradiction.
  for (const [leftKey, rightKey] of [
    ["question", "method"],
    ["method", "experiment"],
    ["experiment", "comparison"],
  ]) {
    const left = cues.find((cue) => cue.id === leftKey)!;
    const right = cues.find((cue) => cue.id === rightKey)!;
    const before = cueSentences.get(leftKey) ?? [];
    const after = cueSentences.get(rightKey) ?? [];
    const distinct = before.some((a) => after.some((b) => a !== b));
    findings.push({
      ...finding(
        `chain-${leftKey}-${rightKey}`,
        distinct ? "observed" : "unknown",
        `${left.zh} → ${right.zh}：${!before.length || !after.length ? "一侧或两侧未提取到摘要线索，无法判断承接关系。" : distinct ? "已列出两侧原句，请核对是否研究同一问题、对象与条件。" : "两侧只命中同一句，不能作为相互支持的证据。"}用词重合或不同均不据此判定逻辑成立或矛盾；每侧最多显示 3 句。`,
        `${left.en} → ${right.en}: ${!before.length || !after.length ? "Abstract cues are missing on one or both sides; continuity is unknown." : distinct ? "Evidence from both sides is shown; check that the question, population and conditions align." : "Both sides match only the same sentence; this is not mutually supporting evidence."} Shared or different wording establishes neither validity nor contradiction. Up to 3 excerpts per side are shown.`,
      ),
      comparison: [
        { label: text(left.zh, left.en), excerpts: before.slice(0, 3), count: before.length },
        { label: text(right.zh, right.en), excerpts: after.slice(0, 3), count: after.length },
      ],
    });
  }
  const superiority =
    /\b(?:outperform\w*|superior(?:ity)?|state[- ]of[- ]the[- ]art|surpass\w*|best[- ]performing)\b|优于|超越|最先进|最佳性能/i;
  const qualified =
    /\b(?:may|might|could|hypothes\w*|aim\w*|whether|potential\w*|expect\w*|previous|prior|earlier|reported|reportedly|claim\w*)\b|可能|有望|是否|旨在|以往|前人|据报道|声称/i;
  const claims = sentences.filter(
    (sentence) => superiority.test(sentence) && !negation.test(sentence) && !qualified.test(sentence),
  );
  claims.forEach((claim, index) => {
    const position = sentences.indexOf(claim);
    const next = sentences[position + 1] ?? "";
    // Only an explicitly linked following result sentence can supply local evidence.
    // Background figures and unrelated sample counts elsewhere cannot support a claim.
    const linkedNext =
      /^(?:Our results|These results|This comparison|In this comparison|Specifically|具体而言|本次比较|上述比较|我们的结果)\b|^(?:具体而言|本次比较|上述比较|我们的结果)/i.test(
        next,
      ) &&
      !negation.test(next) &&
      !qualified.test(next);
    const context = linkedNext ? `${claim} ${next}` : claim;
    const baseline =
      /\b(?:baseline\w*|compar(?:ed|ison|isons|ing)|versus|vs\.?|relative\s+to|than)\b|基线|相比|比较|对比/i.test(
        context,
      );
    const quantitative =
      /\b(?:auc|dice|accuracy|sensitivity|specificity|f1|iou|auroc|auprc)\s*(?:score\s*)?(?:of|=|:|was|is)?\s*\d|\b\d+(?:\.\d+)?\s*(?:%\s*)?(?:auc|dice|accuracy|f1)\b|(?:准确率|灵敏度|特异度|敏感度)\s*(?:为|达到|[:：=])?\s*\d/i.test(
        context,
      );
    if (!baseline || !quantitative)
      findings.push(
        finding(
          index ? `superiority-review-${index + 1}` : "superiority-review",
          "review",
          `肯定性的优越性表述及紧接的显式结果句中，${!baseline ? "未见比较对象／基线提示" : ""}${!baseline && !quantitative ? "，且" : ""}${!quantitative ? "未见带指标名的量化性能提示" : ""}。请核对全文的比较对象、指标和条件；这不是虚假或低质量判定。`,
          `The affirmative superiority statement and explicitly linked following result sentence lack ${!baseline ? "a comparator/baseline cue" : ""}${!baseline && !quantitative ? " and " : ""}${!quantitative ? "a quantitative performance cue with a named metric" : ""}. Check comparators, metrics and conditions in the full text; this is not a falsehood or quality verdict.`,
          context,
        ),
      );
  });
  const observational = sentences.find((sentence) =>
    /\b(?:observational|retrospective|associat\w*|correlat\w*)\b|观察性|回顾性|相关性/i.test(sentence),
  );
  if (observational)
    findings.push(
      finding(
        "observational-scope",
        "unknown",
        "摘要含观察／关联性表述；不由此推断因果或临床有效性。",
        "Observational/association wording is visible; it does not establish causality or clinical effectiveness.",
        observational,
      ),
    );
  return {
    state: findings.some((item) => item.status === "review")
      ? "review"
      : visible
        ? "cues-found"
        : "insufficient",
    findings,
  };
}

/** Pure, deterministic screening. Dates are inclusive UTC days; IDs are returned
 * once in lexical order. Candidate selection never truncates the reference corpus.
 * No quality scores, automatic rejection, network calls or wall-clock reads.
 */
export function screenInformation(input: Input): PaperScreening[] {
  for (const key of ["since", "asOf"] as const)
    if (!calendarDay(input[key]))
      throw new Error(
        `screenInformation: ${key} must be a valid calendar date in YYYY-MM-DD format (received ${JSON.stringify(input[key])})`,
      );
  if (input.since > input.asOf) throw new Error("screenInformation: since must be on or before asOf");
  const papers = [...input.papers].sort((a, b) => compare(a.id, b.id));
  const byId = new Map(papers.map((paper) => [paper.id, paper]));
  const eligible = papers.filter((paper) => available(paper, input.asOf));
  const eligibleIds = new Set(eligible.map((paper) => paper.id));
  const groups = groupWorks(eligible.map(identityPaper), { titleAuthors: false });
  const byWork = new Map<string, Paper[]>(),
    workIds = new Map<string, string>();
  for (const group of groups)
    for (const paper of group) {
      byWork.set(paper.id, group);
      workIds.set(paper.id, group[0].id);
    }
  const signals = signalIndex(input.signals, input.asOf);
  const prior = priorIndex(eligible);
  return [...new Set(input.candidateIds)].sort(compare).map((id) => {
    const paper = byId.get(id);
    if (!paper || !eligibleIds.has(id)) {
      const unavailable = finding(
        "record-unavailable",
        "unknown",
        paper
          ? "当前记录含无效日期或截止日之后的发表／采集／修订信息，未用该记录的当前文本进行筛选，无法恢复当时版本。"
          : "候选 ID 不在提供的论文库中，无法进行比对。",
        paper
          ? "The current record contains invalid dates or publication/collection/revision after the cutoff. Its current text was not screened; the historical version cannot be recovered."
          : "The candidate ID is absent from the supplied paper corpus; comparison is unavailable.",
      );
      return {
        paperId: id,
        history: { state: "unknown", findings: [unavailable, historyScope()], references: [] },
        crossSource: { state: "incomplete", findings: [unavailable], references: [] },
        priorWork: { state: "none", findings: [unavailable], references: [] },
        logic: { state: "insufficient", findings: [unavailable] },
      };
    }
    return {
      paperId: id,
      history: historyFor(paper, byWork.get(id) ?? [], input.since),
      crossSource: crossSourceFor(paper, signals, input.loaded),
      priorWork: priorWorkFor(paper, prior, workIds),
      logic: logicFor(paper),
    };
  });
}
