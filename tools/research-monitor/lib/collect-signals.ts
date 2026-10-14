import { createHash } from "node:crypto";
import { GITHUB_DISCOVERY_GROUPS, GITHUB_DISCOVERY_VERSION } from "./github-discovery";
import { evaluateGitHubRelevance, classifyNewsRelevance } from "./signal-relevance";
import { NEWS_QUERIES } from "./news-discovery";
import { collectNewsWindows } from "./collect-news-signals";
export { NEWS_QUERIES } from "./news-discovery";
import { emptyResearchSignalsData, parseResearchSignalsData, safeSignalUrl, SIGNALS_LIMITATIONS,
  type GitHubDiscoveryState, type GitHubSignal, type NewsSignal, type ResearchSignal, type ResearchSignalsData, type SignalSourceState } from "./research-signals";

const API = "https://api.github.com";
export const CURATED_REPOSITORIES = ["Project-MONAI/MONAI", "MIC-DKFZ/nnUNet", "bowang-lab/MedSAM", "bowang-lab/MedSAM2", "microsoft/BiomedParse", "microsoft/LLaVA-Med", "StanfordMIMI/Merlin", "wasserth/TotalSegmentator", "Google-Health/medgemma", "Project-MONAI/VISTA"];
export const GITHUB_QUERIES = GITHUB_DISCOVERY_GROUPS.flatMap(group => group.queries);
export const GITHUB_SEARCH_REQUEST_BUDGET = 80;
export const GITHUB_BACKFILL_SEARCH_REQUEST_BUDGET = 240;
export const GITHUB_ENRICHMENT_LIMIT = 24;
export const GITHUB_RESULTS_PER_QUERY = 100;
const ANONYMOUS_REQUEST_BUDGET = 60;
const AUTHENTICATED_REQUEST_BUDGET = 130;
const AUTHENTICATED_BACKFILL_REQUEST_BUDGET = 300;
const GITHUB_QUEUE_LIMIT = 2000;
const PAPER_REPOSITORIES_PER_RUN = 20;
const CACHE_MS = 6 * 60 * 60 * 1000;
const RESPONSE_MAX_BYTES = 3 * 1024 * 1024;
export type SignalFetch = (url: string) => Promise<{ body: string; status: number }>;
export type SignalCollectOptions = { now?: Date; fetchText?: SignalFetch; newsDays?: number; force?: boolean; githubToken?: string; githubOnly?: boolean; newsOnly?: boolean; discoveryMode?: "incremental" | "backfill"; repositoryUrls?: string[]; wait?: (milliseconds: number) => Promise<void> };
/** Safe public metadata only; raw response bodies and tokens never enter errors. */
export class SignalRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) { super("GitHub 请求受到限制；已有记录保留"); }
}

function allowedFetchUrl(value: string) {
  if (!safeSignalUrl(value)) return false;
  const url = new URL(value);
  return (url.hostname === "api.github.com" && (/^\/repos\/[\w.-]+\/[\w.-]+(?:\/(readme|releases\/latest))?$/.test(url.pathname) || url.pathname === "/search/repositories")) ||
    (url.hostname === "news.google.com" && url.pathname === "/rss/search");
}
/** A token is attached only to the GitHub API; redirects are never followed. */
export function createSignalFetcher(token?: string, fetcher: typeof fetch = fetch): SignalFetch {
  return async value => {
    if (!allowedFetchUrl(value)) throw new Error("不支持的公开采集地址");
    const github = new URL(value).hostname === "api.github.com";
    const headers: Record<string, string> = { Accept: github ? "application/vnd.github+json" : "application/rss+xml, application/xml", "User-Agent": "MedicalImageResearchMonitor/3.0 public-metadata" };
    if (github) { headers["X-GitHub-Api-Version"] = "2022-11-28"; if (token) headers.Authorization = `Bearer ${token}`; }
    let response: Response;
    try { response = await fetcher(value, { headers, redirect: "error", signal: AbortSignal.timeout(25000) }); }
    catch { throw new Error("公开来源连接失败或超时；保留已有记录"); }
    if (!response.ok) {
      if (github && (response.status === 429 || response.status === 403)) {
        const retryHeader = response.headers.get("retry-after"), reset = Number(response.headers.get("x-ratelimit-reset"));
        const retrySeconds = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) : null;
        const retryDate = retryHeader && retrySeconds === null ? Date.parse(retryHeader) : NaN;
        const delay = retrySeconds !== null ? retrySeconds * 1000 : Number.isFinite(retryDate) ? retryDate - Date.now() : response.headers.get("x-ratelimit-remaining") === "0" && reset > 0 ? reset * 1000 - Date.now() : 60000;
        throw new SignalRateLimitError(Math.max(1000, Math.min(Number.isFinite(delay) ? delay : 60000, 3600000)));
      }
      if (github && response.status === 404 && /\/(readme|releases\/latest)$/.test(new URL(value).pathname)) return { body: "", status: 404 };
      throw new Error(`公开来源返回 HTTP ${response.status}`);
    }
    if (response.url && !allowedFetchUrl(response.url)) throw new Error("来源重定向到不支持的地址");
    if (Number(response.headers.get("content-length")) > RESPONSE_MAX_BYTES) throw new Error("来源响应超过大小上限");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("来源返回空响应");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const { done, value: chunk } = await reader.read(); if (done) break;
        bytes += chunk.byteLength; if (bytes > RESPONSE_MAX_BYTES) { await reader.cancel(); throw new Error("来源响应超过大小上限"); } chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const body = Buffer.concat(chunks).toString("utf8");
    if (!body.trim()) throw new Error("来源返回 HTTP 200 但响应为空");
    return { body, status: response.status };
  };
}
const text = (value: unknown, max = 1000) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";
const stamp = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
function json(body: string): any { try { return JSON.parse(body); } catch { throw new Error("来源 JSON 格式无效"); } }
function shortError(error: unknown) { return error instanceof Error && /^(来源|公开|GitHub|Google|RSS|检索)/.test(error.message) ? error.message.slice(0, 180) : "来源数据无效或请求失败"; }
export function publicRelatedUrls(value: string): string[] {
  const urls = [...value.matchAll(/https:\/\/[^\s<>"'\])}]+/g)].map(match => match[0].replace(/[.,;]+$/, "")).filter(safeSignalUrl);
  return [...new Set(urls)].sort((a, b) => Number(/doi\.org|arxiv\.org|github\.com/.test(b)) - Number(/doi\.org|arxiv\.org|github\.com/.test(a))).slice(0, 40);
}
export function parseGitHubRepository(value: any, observedAt: string): GitHubSignal {
  if (!value || value.private !== false || !/^[\w.-]+\/[\w.-]+$/.test(value.full_name ?? "") || value.html_url?.toLowerCase() !== `https://github.com/${value.full_name}`.toLowerCase() ||
    [value.stargazers_count, value.forks_count, value.open_issues_count].some(item => count(item) === null) || typeof value.archived !== "boolean" || !stamp(value.created_at)) throw new Error("GitHub 仓库响应字段无效");
  return {
    id: `github:${value.full_name.toLowerCase()}`, kind: "github", title: value.full_name, fullName: value.full_name,
    url: value.html_url, summary: text(value.description, 1200), summaryKind: "repository-description", publisher: value.full_name.split("/")[0],
    publishedAt: stamp(value.created_at), firstSeenAt: observedAt, observedAt, updatedAt: stamp(value.updated_at),
    topics: Array.isArray(value.topics) ? value.topics.filter((item: unknown) => typeof item === "string").map((item: string) => item.slice(0, 100)).slice(0, 30) : [],
    sourceId: "github-public", relatedUrls: publicRelatedUrls(text(value.homepage, 2048)),
    stars: value.stargazers_count, forks: value.forks_count, openIssues: value.open_issues_count,
    license: value.license?.spdx_id && value.license.spdx_id !== "NOASSERTION" ? text(value.license.spdx_id, 100) : null,
    language: text(value.language, 100) || null, archived: value.archived, pushedAt: stamp(value.pushed_at),
    releasedAt: null, releaseUrl: null, readmeExcerpt: "",
  };
}
export function isImagingRelevant(value: string): boolean {
  return /medical imag|biomedical imag|medical-image|radiolog|radiograph|chest.x.ray|patholog|histolog|histopatholog|mammograph|computed tomography|magnetic resonance|ultrasound|retinal|fundus|医[学疗]影像|影像诊断|病理|放射|超声|胸片|磁共振/i.test(value);
}
export function isGitHubProjectRelevant(repo: Pick<GitHubSignal, "fullName" | "summary" | "topics">): boolean {
  return evaluateGitHubRelevance(repo) !== null;
}
export function isNewsProgressRelevant(value: string): boolean {
  return classifyNewsRelevance({ title: value }) !== null;
}

function decode(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, code: string) => {
    if (code.startsWith("#")) { const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? full;
  });
}
const plain = (value: string) => decode(decode(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (value: string, name: string) => value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";
export function googleNewsUrl(query: typeof NEWS_QUERIES[number], days: number): string {
  if (!Number.isSafeInteger(days) || days < 1 || days > 730) throw new Error("检索时间跨度必须为 1–730 天");
  return "https://news.google.com/rss/search?" + new URLSearchParams({ q: `${query.query} when:${days}d`, hl: query.hl, gl: query.gl, ceid: query.ceid });
}
export function parseGoogleNewsRss(body: string, sourceId: string, discoveryUrl: string, observedAt: string, days: number): { records: NewsSignal[]; received: number } {
  if (!/<rss\b/i.test(body) || !/<\/rss>\s*$/i.test(body) || !/<channel\b/i.test(body) || !/<\/channel>/i.test(body) || !tag(body, "title") || !tag(body, "link")) throw new Error("Google RSS 响应结构无效");
  const items = [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if ((body.match(/<item\b/gi) ?? []).length !== items.length) throw new Error("Google RSS 结果未完整闭合");
  if (items.length > 300) throw new Error("Google RSS 结果超过解析上限");
  const records: NewsSignal[] = []; let invalid = 0;
  for (const [, item] of items) {
    const publisher = plain(tag(item, "source")).slice(0, 200), rawTitle = plain(tag(item, "title")), link = decode(tag(item, "link")).trim(), publishedAt = stamp(plain(tag(item, "pubDate")));
    if (!rawTitle || !publisher || !safeSignalUrl(link) || new URL(link).hostname !== "news.google.com" || !publishedAt) { invalid++; continue; }
    const title = rawTitle.endsWith(` - ${publisher}`) ? rawTitle.slice(0, -publisher.length - 3) : rawTitle;
    const summary = plain(tag(item, "description")).slice(0, 500);
    if (!isNewsProgressRelevant(title + " " + summary)) continue;
    const age = Date.parse(observedAt) - Date.parse(publishedAt);
    if (age < -86400000 || age > (days + 1) * 86400000) continue;
    const id = createHash("sha256").update(`${publisher.toLowerCase()}\n${title.toLowerCase().replace(/\s+/g, " ")}`).digest("hex").slice(0, 24);
    records.push({
      id: `news:${id}`, kind: "news", title: title.slice(0, 500), url: link, summary, summaryKind: "search-snippet", publisher,
      publishedAt, firstSeenAt: observedAt, observedAt, updatedAt: null, topics: [], sourceId,
      relatedUrls: [], newsType: /model|foundation|模型/i.test(title) ? "model" : /open.source|release|tool|开源|工具/i.test(title) ? "tooling" : "research",
      discoveryUrl, originalUrl: null,
    });
  }
  // Malformed rows are not silently accepted as an empty successful collection.
  if (invalid) throw new Error(`Google RSS 含 ${invalid} 条缺少必要元数据的结果`);
  return { records, received: items.length };
}

export type GitHubSearchStep = { groupId: string; query: string; sort: "best-match" | "updated" };
type GitHubSearchTask = GitHubDiscoveryState["queue"][number];
/** Every group receives its first query before a group receives additional queries. */
export function githubSearchPlan(budget = GITHUB_SEARCH_REQUEST_BUDGET): GitHubSearchStep[] {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 5000) throw new Error("GitHub 搜索预算无效");
  const plan: GitHubSearchStep[] = [];
  const queryCount = Math.max(...GITHUB_DISCOVERY_GROUPS.map(group => group.queries.length));
  for (let queryIndex = 0; queryIndex < queryCount; queryIndex++) {
    for (const sort of ["best-match", "updated"] as const) {
      for (const group of GITHUB_DISCOVERY_GROUPS) {
        if (group.queries[queryIndex] && plan.length < budget) plan.push({ groupId: group.id, query: group.queries[queryIndex], sort });
      }
    }
  }
  return plan;
}
export function githubDiscoveryFingerprint(): string {
  return `${GITHUB_DISCOVERY_VERSION}-${createHash("sha256").update(JSON.stringify(GITHUB_DISCOVERY_GROUPS)).digest("hex").slice(0, 16)}`;
}
export function githubDiscoveryCacheUrl(): string {
  return `${API}/search/repositories?${new URLSearchParams({ q: '"medical imaging"', discovery: githubDiscoveryFingerprint() })}`;
}
/** Extract only public GitHub repository identities; subsequent requests always use api.github.com. */
export function githubRepositoryFromUrl(value: string): string | null {
  if (!safeSignalUrl(value)) return null;
  const url = new URL(value);
  if (url.hostname !== "github.com" || url.port || url.username || url.password) return null;
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)(?:\/|$)/);
  if (!match || [".", ".."].includes(match[1]) || [".", ".."].includes(match[2]) ||
    /^(?:topics|collections|marketplace|settings|orgs|users|features|sponsors|search)$/i.test(match[1])) return null;
  const repository = match[2].replace(/\.git$/i, "");
  return repository && ![".", ".."].includes(repository) ? `${match[1]}/${repository}` : null;
}
function splitSearchWindow(task: GitHubSearchTask, now: string): GitHubSearchTask[] | null {
  const from = task.from ?? "2008-01-01", to = task.to ?? now.slice(0, 10);
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  if (start >= end) return null;
  const middle = start + Math.floor((end - start) / 86400000 / 2) * 86400000;
  return [
    { ...task, page: 1, from, to: new Date(middle).toISOString().slice(0, 10) },
    { ...task, page: 1, from: new Date(middle + 86400000).toISOString().slice(0, 10), to },
  ];
}
async function collectGitHub(fetchText: SignalFetch, now: string, previous: ResearchSignalsData, options: SignalCollectOptions) {
  const candidates = new Map<string, GitHubSignal>(), errors: string[] = [];
  const backfill = options.discoveryMode === "backfill";
  const requestBudget = options.githubToken ? backfill ? AUTHENTICATED_BACKFILL_REQUEST_BUDGET : AUTHENTICATED_REQUEST_BUDGET : ANONYMOUS_REQUEST_BUDGET;
  const searchBudget = options.githubToken && backfill ? GITHUB_BACKFILL_SEARCH_REQUEST_BUDGET : GITHUB_SEARCH_REQUEST_BUDGET;
  const pause = options.wait ?? (options.fetchText ? async () => {} : (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const interval = options.githubToken ? 2200 : 6100;
  const plan = githubSearchPlan(GITHUB_QUERIES.length * 2);
  const fingerprint = githubDiscoveryFingerprint();
  const storedState = previous.discoveryState?.github;
  const state: GitHubDiscoveryState = storedState?.catalogVersion === fingerprint
    ? { ...storedState, queue: storedState.queue.map(task => ({ ...task })) }
    : { catalogVersion: fingerprint, cursor: 0, queue: [], completedQueries: 0, repositoryCursor: 0, cycles: 0 };
  const rootKey = (task: GitHubSearchStep) => `${task.groupId}\n${task.query}\n${task.sort}`;
  const validRoots = new Set(plan.map(rootKey));
  // Only catalog queries can be resumed; stale or tampered task text is never used.
  state.queue = state.queue.filter(task => validRoots.has(rootKey(task)));
  state.cursor %= Math.max(plan.length, 1);
  const deferred: GitHubSearchTask[] = [], startedRoots = new Set<string>();
  const truncated = new Set<string>(), incomplete = new Set<string>();
  let received = 0, successes = 0, requests = 0, searchRequests = 0, retried = false, halted = false, previousSearchAt = 0, enriched = 0, splitQueries = 0, turn = 0;
  const hasBudget = () => requests < requestBudget - (retried ? 0 : 1);
  async function request(url: string): ReturnType<SignalFetch> {
    if (halted || !hasBudget()) throw new Error("GitHub 本次请求预算已用完；已有记录保留");
    const search = new URL(url).pathname === "/search/repositories";
    if (search) {
      if (searchRequests >= searchBudget) throw new Error("GitHub 本次搜索预算已用完；游标已保留");
      if (previousSearchAt) await pause(Math.max(0, interval - (Date.now() - previousSearchAt)));
      previousSearchAt = Date.now(); searchRequests++;
    }
    requests++;
    try { return await fetchText(url); }
    catch (error) {
      if (!(error instanceof SignalRateLimitError)) throw error;
      if (!retried && error.retryAfterMs <= 15000 && requests < requestBudget && (!search || searchRequests < searchBudget)) {
        retried = true; await pause(Math.max(error.retryAfterMs, search ? interval : 0)); requests++;
        if (search) { previousSearchAt = Date.now(); searchRequests++; }
        try { return await fetchText(url); } catch (retryError) { halted = true; throw retryError; }
      }
      halted = true; throw error;
    }
  }
  function add(result: GitHubSignal, groupId?: string, fallbackReason?: string) {
    const relevance = evaluateGitHubRelevance(result) ?? (fallbackReason ? { level: "candidate" as const, reasons: [fallbackReason] } : null);
    if (!relevance) return;
    const old = candidates.get(result.id);
    candidates.set(result.id, { ...result, relevance: {
      level: old?.relevance?.level === "direct" || relevance.level === "direct" ? "direct" : "candidate",
      reasons: [...new Set([...(old?.relevance?.reasons ?? []), ...relevance.reasons])].slice(0, 12),
    }, discoveryGroups: [...new Set([...(old?.discoveryGroups ?? []), ...(groupId ? [groupId] : [])])] });
  }
  for (const fullName of CURATED_REPOSITORIES) {
    if (halted || !hasBudget()) break;
    try { const result = parseGitHubRepository(json((await request(`${API}/repos/${fullName}`)).body), now); add(result, undefined, "curated-source"); received++; successes++; }
    catch (error) { errors.push(`${fullName}: ${shortError(error)}`); }
  }
  const curated = new Set(CURATED_REPOSITORIES.map(name => name.toLowerCase()));
  const paperRepositories = [...new Map((options.repositoryUrls ?? []).map(githubRepositoryFromUrl).filter((name): name is string => Boolean(name))
    .filter(name => !curated.has(name.toLowerCase())).map(name => [name.toLowerCase(), name])).values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const paperCount = Math.min(PAPER_REPOSITORIES_PER_RUN, paperRepositories.length);
  for (let index = 0; index < paperCount; index++) {
    if (halted || !hasBudget()) break;
    const fullName = paperRepositories[state.repositoryCursor % paperRepositories.length];
    // Advance failed links too, so a deleted repository cannot block all following paper links.
    state.repositoryCursor = (state.repositoryCursor + 1) % paperRepositories.length;
    try { const result = parseGitHubRepository(json((await request(`${API}/repos/${fullName}`)).body), now); add(result, undefined, "paper-linked"); received++; successes++; }
    catch (error) { errors.push(`${fullName}: ${shortError(error)}`); }
  }
  function nextRoot(): GitHubSearchTask | undefined {
    if (state.queue.length + deferred.length >= GITHUB_QUEUE_LIMIT) return undefined;
    const pending = new Set([...state.queue, ...deferred].map(rootKey));
    for (let attempts = 0; attempts < plan.length; attempts++) {
      const root = plan[state.cursor];
      state.cursor = (state.cursor + 1) % plan.length;
      if (!state.cursor) state.cycles++;
      const key = rootKey(root);
      if (pending.has(key) || startedRoots.has(key)) continue;
      startedRoots.add(key); return { ...root, page: 1 };
    }
    return undefined;
  }
  while (!halted && hasBudget() && searchRequests < searchBudget) {
    // Alternate fresh discovery and pending pages/windows, keeping both routes moving.
    const task = turn++ % 2 === 0 ? nextRoot() ?? state.queue.shift() : state.queue.shift() ?? nextRoot();
    if (!task) break;
    try {
      const query = task.from && task.to ? `${task.query} created:${task.from}..${task.to}` : task.query;
      const parameters = new URLSearchParams({ q: query, per_page: String(GITHUB_RESULTS_PER_QUERY), page: String(task.page) });
      if (task.sort === "updated") { parameters.set("sort", "updated"); parameters.set("order", "desc"); }
      const value = json((await request(`${API}/search/repositories?${parameters}`)).body);
      if (!value || !Array.isArray(value.items) || value.items.length > GITHUB_RESULTS_PER_QUERY || count(value.total_count) === null || typeof value.incomplete_results !== "boolean") throw new Error("GitHub 搜索响应字段无效");
      if ((task.page - 1) * GITHUB_RESULTS_PER_QUERY < value.total_count && !value.items.length) throw new Error("GitHub 搜索声明有结果但返回空列表");
      const key = `${rootKey(task)}\n${task.from ?? "*"}..${task.to ?? "*"}`;
      if (value.incomplete_results) incomplete.add(key);
      for (const item of value.items) {
        received++;
        try { add(parseGitHubRepository(item, now), task.groupId); }
        catch (error) { errors.push(shortError(error)); }
      }
      successes++;
      // Later pages can time out or grow beyond GitHub's result cap too. Restart
      // the current window as smaller windows instead of advancing past a gap.
      const split = value.total_count > 1000 || value.incomplete_results ? splitSearchWindow(task, now) : null;
      if (split) {
        if (state.queue.length + deferred.length + split.length > GITHUB_QUEUE_LIMIT) {
          deferred.push(task); errors.push("GitHub 待续检索队列达到上限；原查询保留等待下轮"); break;
        }
        state.queue.push(...split); splitQueries++; continue;
      }
      if (value.total_count > 1000) truncated.add(key);
      if (value.incomplete_results) {
        errors.push("GitHub 搜索单日分片仍返回不完整结果；已有命中与当前页保留等待下轮");
        deferred.push(task); continue;
      }
      if (task.page < 10 && task.page * GITHUB_RESULTS_PER_QUERY < Math.min(value.total_count, 1000)) {
        state.queue.push({ ...task, page: task.page + 1 });
      } else if (![...state.queue, ...deferred].some(pending => rootKey(pending) === rootKey(task))) {
        state.completedQueries++;
      }
    } catch (error) { errors.push(shortError(error)); deferred.push(task); }
  }
  state.queue.push(...deferred);
  const oldRepos = new Map(previous.records.filter((record): record is GitHubSignal => record.kind === "github").map(record => [record.id, record]));
  const ordered = [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Prefer missing README metadata, then rotate a fixed-size window every cache period.
  const missing = ordered.filter(repo => !oldRepos.get(repo.id)?.readmeExcerpt), known = ordered.filter(repo => oldRepos.get(repo.id)?.readmeExcerpt);
  const rotate = <T>(values: T[]) => { const offset = values.length ? (Math.floor(Date.parse(now) / CACHE_MS) * GITHUB_ENRICHMENT_LIMIT) % values.length : 0; return [...values.slice(offset), ...values.slice(0, offset)]; };
  const enrichment = [...rotate(missing), ...rotate(known)].slice(0, Math.min(GITHUB_ENRICHMENT_LIMIT, Math.max(0, Math.floor((requestBudget - requests - (retried ? 0 : 1)) / 2))));
  for (const repo of enrichment) {
    if (halted) break;
    enriched++;
    try {
      const response = await request(`${API}/repos/${repo.fullName}/readme`);
      if (response.status !== 404) {
        const value = json(response.body);
        if (value.encoding !== "base64" || typeof value.content !== "string" || value.content.length > 2 * 1024 * 1024) throw new Error("GitHub README 格式无效");
        const readme = Buffer.from(value.content, "base64").toString("utf8");
        repo.readmeExcerpt = plain(readme.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s*/gm, "")).slice(0, 850);
        repo.relatedUrls = [...new Set([...repo.relatedUrls, ...publicRelatedUrls(readme)])].slice(0, 40);
      }
    } catch (error) { errors.push(`${repo.fullName} README: ${shortError(error)}`); }
    if (halted) break;
    try {
      const response = await request(`${API}/repos/${repo.fullName}/releases/latest`);
      if (response.status !== 404) {
        const value = json(response.body);
        if (value.draft !== false || value.prerelease !== false || !stamp(value.published_at) || !safeSignalUrl(value.html_url) || !value.html_url.startsWith(repo.url + "/releases/")) throw new Error("GitHub release 响应字段无效");
        repo.releasedAt = stamp(value.published_at); repo.releaseUrl = value.html_url;
      }
    } catch (error) { errors.push(`${repo.fullName} release: ${shortError(error)}`); }
  }
  for (const repo of candidates.values()) {
    const enrichedRelevance = evaluateGitHubRelevance(repo);
    if (enrichedRelevance) repo.relevance = {
      level: repo.relevance?.level === "direct" || enrichedRelevance.level === "direct" ? "direct" : "candidate",
      reasons: [...new Set([...(repo.relevance?.reasons ?? []), ...enrichedRelevance.reasons])].slice(0, 12),
    };
  }
  state.lastRun = { searchRequests, requests, truncatedQueries: truncated.size, incompleteQueries: incomplete.size, splitQueries, pendingQueries: state.queue.length };
  return { records: [...candidates.values()], received, successes, errors, requests, searchRequests, enriched, planned: searchBudget, state };
}
export async function collectResearchSignals(previous: ResearchSignalsData = emptyResearchSignalsData(), options: SignalCollectOptions = {}): Promise<{ data: ResearchSignalsData; allFailed: boolean }> {
  parseResearchSignalsData(previous);
  if (options.githubOnly && options.newsOnly) throw new Error("检索来源选项冲突");
  const now = (options.now ?? new Date()).toISOString(), days = options.newsDays ?? 365;
  const request = options.fetchText ?? createSignalFetcher(options.githubToken);
  // Validation happens before issuing any requests or replacing the snapshot.
  if (!options.githubOnly) NEWS_QUERIES.forEach(query => googleNewsUrl(query, days));
  const records = new Map(previous.records.map(record => [record.id, record])), sources: SignalSourceState[] = [];
  const discoveryState = { ...previous.discoveryState };
  function merge(incoming: ResearchSignal[]) {
    for (const item of incoming) {
      const old = records.get(item.id);
      records.set(item.id, { ...item, firstSeenAt: old?.firstSeenAt ?? item.firstSeenAt,
        discoveryGroups: [...new Set([...(item.discoveryGroups ?? []), ...(old?.discoveryGroups ?? [])])],
        ...(item.kind === "github" && old?.kind === "github" ? {
          readmeExcerpt: item.readmeExcerpt || old.readmeExcerpt,
          discoveryGroups: [...new Set([...(item.discoveryGroups ?? []), ...(old.discoveryGroups ?? [])])],
          ...(item.relevance || old.relevance ? { relevance: {
            level: item.relevance?.level === "direct" || old.relevance?.level === "direct" ? "direct" as const : "candidate" as const,
            reasons: [...new Set([...(item.relevance?.reasons ?? []), ...(old.relevance?.reasons ?? [])])].slice(0, 12),
          } } : {}),
          relatedUrls: [...new Set([...item.relatedUrls, ...old.relatedUrls])].slice(0, 40),
          releasedAt: item.releasedAt ?? old.releasedAt, releaseUrl: item.releaseUrl ?? old.releaseUrl,
        } : {}),
      });
    }
  }
  function cached(id: string, targetUrl: string) {
    const source = previous.sources.find(item => item.id === id);
    if (!options.force && source?.status === "ok" && source.url === targetUrl && Date.parse(now) - Date.parse(source.checkedAt) >= 0 && Date.parse(now) - Date.parse(source.checkedAt) < CACHE_MS) { sources.push(source); return true; }
    return false;
  }
  const githubUrl = githubDiscoveryCacheUrl();
  if (!options.newsOnly && (options.discoveryMode === "backfill" || !cached("github-public", githubUrl))) {
    const result = await collectGitHub(request, now, previous, options); merge(result.records); discoveryState.github = result.state;
    sources.push({ id: "github-public", name: "GitHub public repositories", kind: "github", url: githubUrl,
      status: result.errors.length ? result.successes ? "partial" : "error" : "ok", checkedAt: now,
      lastSuccessAt: result.errors.length ? previous.sources.find(source => source.id === "github-public")?.lastSuccessAt ?? null : now,
      received: result.received, retained: [...records.values()].filter(item => item.kind === "github").length,
      error: result.errors.length ? result.errors.join("；").slice(0, 1600) : null,
      coverage: `${CURATED_REPOSITORIES.length} 个精选项目 + 论文代码链接 + ${GITHUB_DISCOVERY_GROUPS.length} 个方向（${GITHUB_QUERIES.length} 条查询）；目录轮换、双排序、每页 ${GITHUB_RESULTS_PER_QUERY} 项。超过 1000 项或返回不完整时递归按创建日期分片，单日仍超过 1000 项无法保证穷尽。本轮搜索 ${result.searchRequests}/${result.planned} 次、API ${result.requests} 次，分裂 ${result.state.lastRun!.splitQueries} 个检索窗口，未解决截断 ${result.state.lastRun!.truncatedQueries} 个，不完整响应 ${result.state.lastRun!.incompleteQueries} 个（已尝试分片），待续 ${result.state.queue.length} 个分页/分片任务；目录下次从第 ${result.state.cursor + 1} 项继续。相关性分为直接相关与候选，标签不是质量背书。本轮最多补全 ${result.enriched} 个 README/非预发布 release；未覆盖的公开项目可能遗漏，保留旧记录，每 6 小时增量运行。检索目录 ${GITHUB_DISCOVERY_VERSION}。`,
    });
  }
  if (!options.githubOnly) {
    const news = await collectNewsWindows(previous, now, days, request, parseGoogleNewsRss, {
      force: options.force || options.discoveryMode === "backfill", discoveryMode: options.discoveryMode,
      wait: options.wait ?? (options.fetchText ? async () => {} : (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))),
    });
    merge(news.records); sources.push(...news.sources); discoveryState.news = news.state;
  }
  // Old configured sources remain discoverable if a future collector removes one.
  for (const source of previous.sources) if (!sources.some(item => item.id === source.id)) sources.push(source);
  // Re-evaluate retained metadata with the current transparent rules. Keep old
  // IDs even when they become candidates; never preserve an obsolete direct label.
  const mergedRecords = [...records.values()].map(record => {
    if ((options.githubOnly && record.kind === "news") || (options.newsOnly && record.kind === "github")) return record;
    const relevance = (record.kind === "github" ? evaluateGitHubRelevance(record) : classifyNewsRelevance(record)) ?? { level: "candidate" as const, reasons: record.relevance?.level === "candidate" ? record.relevance.reasons : ["legacy-unmatched"] };
    return { ...record, relevance };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const finalSources = sources.map(source => ({ ...source, retained: mergedRecords.filter(record => record.sourceId === source.id).length }));
  const data = parseResearchSignalsData({ schemaVersion: 1, generatedAt: now, records: mergedRecords, sources: finalSources, limitations: [...SIGNALS_LIMITATIONS], discoveryState });
  const activeIds = new Set([...(options.newsOnly ? [] : ["github-public"]), ...(options.githubOnly ? [] : NEWS_QUERIES.map(query => query.id))]);
  const selectedSources = sources.filter(source => activeIds.has(source.id));
  return { data, allFailed: selectedSources.length > 0 && selectedSources.every(source => source.status === "error") };
}
