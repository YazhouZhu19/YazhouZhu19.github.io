import { randomUUID } from "node:crypto";
import { relevant } from "./classify";
import { parseArxiv, parseEpmc, parseJsonResponse, parseMedrxiv, parseMedrxivPage } from "./parse";
import { applyOutcomes, mergePapers, type SourceOutcome } from "./record";
import type { MonitorData, Paper, RequestLog, SyncRun } from "./types";

export const SOURCE_NAMES = {epmc:"Europe PMC",arxiv:"arXiv",medrxiv:"medRxiv"} as const;
export type SourceKey = keyof typeof SOURCE_NAMES;
export type FetchText = (url: string) => Promise<{ body:string; httpStatus:number; attempts:number }>;
export type CollectOptions = {now?:Date; fetchText?:FetchText; id?:() => string};
const DAY = 86400000;
const epmcTracks = {
  segmentation:'TITLE_ABS:segmentation AND (TITLE_ABS:"medical image" OR TITLE_ABS:organ OR TITLE_ABS:lesion OR TITLE_ABS:tumor OR TITLE_ABS:tumour)',
  human_loop:'(TITLE_ABS:"human-in-the-loop" OR TITLE_ABS:"human-AI" OR TITLE_ABS:"reader study" OR TITLE_ABS:"AI-assisted" OR TITLE_ABS:"interactive segmentation") AND (TITLE_ABS:imaging OR TITLE_ABS:radiology OR TITLE_ABS:radiologist* OR TITLE_ABS:MRI OR TITLE_ABS:CT OR TITLE_ABS:ultrasound OR TITLE_ABS:pathology OR TITLE_ABS:mammography OR TITLE_ABS:retinal)',
};
const ARXIV_QUERY = '((ti:segmentation AND (all:medical OR all:organ OR all:lesion OR all:tumor OR all:tumour)) OR ((all:"human-in-the-loop" OR all:"human-AI" OR all:"reader study" OR all:"interactive segmentation" OR all:"interactive correction") AND (all:medical OR all:radiology OR all:radiologist OR all:diagnosis OR all:clinical)))';

export class SourceRequestError extends Error {
  constructor(message:string, public httpStatus:number|undefined, public attempts:number) {super(message);}
}

/** Only official hosts; redirects are checked as well, so no proxy is introduced. */
function officialUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" && ["www.ebi.ac.uk","export.arxiv.org","api.biorxiv.org"].includes(url.hostname);
}

export const fetchOfficialText: FetchText = async url => {
  if (!officialUrl(url)) throw new SourceRequestError("采集地址不是支持的官方 HTTPS 来源",undefined,0);
  for (let attempt = 1; attempt <= 3; attempt++) {
    let status:number|undefined, retryMs = 1500 * 2 ** (attempt-1);
    try {
      const response = await fetch(url, {
        headers:{"User-Agent":"MedicalImageResearchMonitor/2.0 (GitHub Pages public metadata collector)",Accept:"application/json, application/atom+xml, application/xml"},
        signal:AbortSignal.timeout(25000), redirect:"error",
      });
      status = response.status;
      if (response.url && !officialUrl(response.url)) throw new SourceRequestError("来源重定向到非官方地址",status,attempt);
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter)*1000 : Date.parse(retryAfter)-Date.now();
        if (Number.isFinite(delay)) retryMs = Math.max(retryMs,Math.min(10000,delay));
      }
      if (!response.ok) {
        const message = `来源返回 HTTP ${status}`;
        if (status !== 429 && status < 500) throw new SourceRequestError(message,status,attempt);
        throw new Error(message);
      }
      const body = await response.text();
      if (!body.trim()) throw new Error(`来源返回 HTTP ${status} 但响应体为空；无法判定是否有新论文`);
      return {body,httpStatus:status,attempts:attempt};
    } catch (error) {
      if (error instanceof SourceRequestError) throw error;
      const cause = error instanceof Error ? error.cause as {code?:string;message?:string}|undefined : undefined;
      const detail = (error instanceof Error ? error.message : String(error)) + (cause ? ` (${cause.code ?? cause.message ?? "unknown cause"})` : "");
      if (attempt === 3) throw new SourceRequestError(`${detail}（已尝试 ${attempt} 次）`,status,attempt);
      await new Promise(resolve => setTimeout(resolve,retryMs));
    }
  }
  throw new SourceRequestError("请求失败",undefined,3);
};

export function sourceDateWindow(previous: MonitorData, source: string, now: Date) {
  const last = previous.runs.filter(run => run.source === source && run.status !== "error" && !run.error)
    .map(run => Date.parse(run.completedAt)).filter(Number.isFinite).sort((a,b) => b-a)[0];
  const start = Math.max(now.getTime()-90*DAY,(last ?? now.getTime()-30*DAY)-7*DAY);
  return {since:new Date(Math.min(start,now.getTime())).toISOString().slice(0,10),to:now.toISOString().slice(0,10)};
}

export async function collectSource(key: SourceKey, previous: MonitorData, options: CollectOptions = {}): Promise<SourceOutcome> {
  const now = options.now ?? new Date(), startedAt = now.toISOString();
  const {since,to} = sourceDateWindow(previous,SOURCE_NAMES[key],now);
  const run: SyncRun = {
    id:(options.id ?? randomUUID)(),source:SOURCE_NAMES[key],startedAt,completedAt:"",status:"ok",
    received:0,kept:0,added:0,updated:0,total:0,query:"",dateFrom:since,dateTo:to,coverage:"",
  };
  const request = options.fetchText ?? fetchOfficialText;
  const requestLogs: RequestLog[] = [], errors:string[] = [], incoming:Paper[] = [];
  let validPages = 0, truncated = false;
  async function page(url:string, query:string, track:string, parse:(body:string) => {papers:Paper[];total:number;next?:string}): Promise<{papers:Paper[];total:number;next?:string} | null> {
    const log:RequestLog = {url,source:run.source,runId:run.id,collectedAt:startedAt,query,track,status:"error"};
    requestLogs.push(log);
    try {
      const response = await request(url);
      log.httpStatus = response.httpStatus; log.attempts = response.attempts;
      const result = parse(response.body);
      validPages++; run.received += result.papers.length; incoming.push(...result.papers);
      log.status = "ok"; log.hitCount = result.total; log.retrieved = result.papers.length;
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error = detail;
      if (error instanceof SourceRequestError) {log.httpStatus = error.httpStatus;log.attempts = error.attempts;}
      errors.push(`${track}: ${detail}`);
      return null;
    }
  }
  if (key === "epmc") {
    const queries:string[] = [];
    run.coverage = "两个重点方向的发表/首次收录重叠窗口；每方向最多300条，查询结果可能重叠。";
    for (const [track,terms] of Object.entries(epmcTracks)) {
      let cursor = "*", received = 0, total = 0;
      const query = `${terms} AND (FIRST_IDATE:[${since} TO ${to}] OR FIRST_PDATE:[${since} TO ${to}]) AND (SRC:MED OR SRC:PPR OR SRC:PMC) sort_date:y`;
      queries.push(query);
      for (let index = 0; index < 3; index++) {
        const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?"+new URLSearchParams({query,format:"json",resultType:"core",pageSize:"100",cursorMark:cursor});
        const result = await page(url,query,track,body => {
          const data = parseJsonResponse(body,"Europe PMC");
          if (!Number.isSafeInteger(data.hitCount) || data.hitCount < 0 || !Array.isArray(data.resultList?.result)) throw new Error("Europe PMC 返回了无法识别的结果");
          if (data.hitCount > received && !data.resultList.result.length) throw new Error("Europe PMC 声明仍有结果，但返回空页");
          return {papers:data.resultList.result.map((hit:any) => parseEpmc(hit,url,startedAt,track)),total:data.hitCount,next:data.nextCursorMark};
        });
        if (!result) break;
        total = result.total; received += result.papers.length;
        requestLogs[requestLogs.length-1].truncated = received < total;
        if (received >= total) break;
        if (!result.next || result.next === cursor) {
          errors.push(`${track}: Europe PMC 未提供有效的下一页游标，已保留已返回记录`); break;
        }
        cursor = result.next;
      }
      run.total! += total; truncated ||= received < total;
    }
    run.query = queries.join("\n\n");
  } else if (key === "arxiv") {
    run.query = ARXIV_QUERY; run.dateFrom = "";
    run.coverage = "按版本更新时间读取最近100条匹配记录；未读取历史记录不计入趋势。";
    const url = "https://export.arxiv.org/api/query?"+new URLSearchParams({search_query:ARXIV_QUERY,start:"0",max_results:"100",sortBy:"lastUpdatedDate",sortOrder:"descending"});
    const result = await page(url,ARXIV_QUERY,"segmentation-and-human-loop",body => parseArxiv(body,url,startedAt));
    if (result) {
      run.total = result.total; truncated = result.total > result.papers.length;
      requestLogs[requestLogs.length-1].truncated = truncated;
    }
  } else {
    run.query = `radiology and imaging; ${since} → ${to}; 本地分割与人机协同关键词筛选`;
    run.coverage = "仅 radiology and imaging 分类，最多240条版本记录；来源日期是该版本发布时间。";
    let cursor = 0;
    for (let index = 0; index < 8; index++) {
      const url = `https://api.biorxiv.org/details/medrxiv/${since}/${to}/${cursor}/json?category=radiology%20and%20imaging`;
      const result = await page(url,run.query,"radiology-and-imaging",body => {
        const {hits,total} = parseMedrxivPage(body);
        return {papers:hits.map(hit => parseMedrxiv(hit,url,startedAt)),total};
      });
      if (!result) break;
      cursor += result.papers.length; run.total = result.total;
      requestLogs[requestLogs.length-1].truncated = cursor < result.total;
      if (cursor >= result.total) break;
    }
    truncated = cursor < (run.total ?? 0);
  }
  const retained = incoming.filter(p => p.title && p.publishedAt && relevant(p.title,p.abstract) && p.tracks.length);
  const papers = mergePapers([],retained).papers;
  run.kept = papers.length;
  run.status = errors.length ? (validPages > 0 ? "partial" : "error") : truncated ? "partial" : "ok";
  if (!validPages && errors.length) run.total = null;
  if (errors.length) run.error = errors.join("；");
  run.completedAt = options.now ? startedAt : new Date().toISOString();
  return {papers,run,requestLogs};
}

export async function collectAll(previous: MonitorData, options: CollectOptions = {}): Promise<{data:MonitorData;allFailed:boolean;outcomes:SourceOutcome[]}> {
  // Independent requests cannot prevent other sources from recording their outcomes.
  const outcomes = await Promise.all((Object.keys(SOURCE_NAMES) as SourceKey[]).map(async key => {
    try { return await collectSource(key,previous,options); }
    catch (error) {
      const timestamp = (options.now ?? new Date()).toISOString(), window = sourceDateWindow(previous,SOURCE_NAMES[key],options.now ?? new Date());
      return {papers:[],requestLogs:[],run:{id:randomUUID(),source:SOURCE_NAMES[key],startedAt:timestamp,completedAt:timestamp,status:"error" as const,received:0,kept:0,added:0,updated:0,total:null,query:"",dateFrom:window.since,dateTo:window.to,coverage:"采集异常；保留既有来源数据。",error:error instanceof Error ? error.message : String(error)}};
    }
  }));
  const data = applyOutcomes(previous,outcomes,(options.now ?? new Date()).toISOString());
  return {data,allFailed:outcomes.every(o => o.run.status === "error"),outcomes};
}
