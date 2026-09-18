import { randomUUID } from "node:crypto";
import { INTEREST_TAXONOMY_VERSION, relevant } from "./classify";
import { parseArxiv, parseEpmc, parseJsonResponse, parseMedrxiv, parseMedrxivPage } from "./parse";
import { applyOutcomes, mergePapers, type SourceOutcome } from "./record";
import type { MonitorData, Paper, RequestLog, SyncRun } from "./types";

export const SOURCE_NAMES = {epmc:"Europe PMC",arxiv:"arXiv",medrxiv:"medRxiv"} as const;
export type SourceKey = keyof typeof SOURCE_NAMES;
export type FetchText = (url: string) => Promise<{ body:string; httpStatus:number; attempts:number }>;
export type CollectOptions = {now?:Date; fetchText?:FetchText; id?:() => string};
const DAY = 86400000;
const EPMC_IMAGING = '(TITLE_ABS:"medical image" OR TITLE_ABS:"medical imaging" OR TITLE_ABS:radiology OR TITLE_ABS:radiologist* OR TITLE_ABS:MRI OR TITLE_ABS:"magnetic resonance" OR TITLE_ABS:CT OR TITLE_ABS:"computed tomography" OR TITLE_ABS:ultrasound OR TITLE_ABS:histopathology OR TITLE_ABS:mammography OR TITLE_ABS:retinal OR TITLE_ABS:fundus OR TITLE_ABS:radiograph* OR TITLE_ABS:PET OR TITLE_ABS:endoscopy)';
const ARXIV_IMAGING = '(all:"medical imaging" OR all:"medical image" OR all:radiology OR all:radiologist OR all:MRI OR all:"computed tomography" OR all:ultrasound OR all:histopathology OR all:mammography OR all:retinal OR all:fundus OR all:radiograph OR all:endoscopy OR all:"positron emission")';
export const EPMC_TRACK_QUERIES: Record<string,string> = {
 segmentation:'(TITLE_ABS:segmentation OR TITLE_ABS:delineation OR TITLE_ABS:contouring) AND ('+EPMC_IMAGING+' OR TITLE_ABS:organ OR TITLE_ABS:lesion OR TITLE_ABS:tumor OR TITLE_ABS:tumour)',
 human_loop:'(TITLE_ABS:"human-in-the-loop" OR TITLE_ABS:"human-AI" OR TITLE_ABS:"reader study" OR TITLE_ABS:"AI-assisted" OR TITLE_ABS:"interactive segmentation" OR TITLE_ABS:"clinician feedback") AND '+EPMC_IMAGING,
 diagnosis:'(TITLE_ABS:diagnosis OR TITLE_ABS:detection OR TITLE_ABS:classification OR TITLE_ABS:screening) AND '+EPMC_IMAGING,
 reconstruction:'(TITLE_ABS:reconstruction OR TITLE_ABS:denoising OR TITLE_ABS:"super-resolution" OR TITLE_ABS:synthesis OR TITLE_ABS:"artifact reduction") AND '+EPMC_IMAGING,
 registration:'(TITLE_ABS:registration OR TITLE_ABS:"motion estimation" OR TITLE_ABS:"motion tracking" OR TITLE_ABS:"motion correction" OR TITLE_ABS:"image alignment") AND '+EPMC_IMAGING,
 quantification:'(TITLE_ABS:radiomics OR TITLE_ABS:radiomic OR TITLE_ABS:"imaging biomarker" OR TITLE_ABS:"quantitative imaging" OR TITLE_ABS:morphometry OR TITLE_ABS:volumetric) AND '+EPMC_IMAGING,
 prognosis:'(TITLE_ABS:prognosis OR TITLE_ABS:prognostic OR TITLE_ABS:"survival prediction" OR TITLE_ABS:"treatment response" OR TITLE_ABS:"disease progression" OR TITLE_ABS:"outcome prediction") AND '+EPMC_IMAGING,
 language:'(TITLE_ABS:"report generation" OR TITLE_ABS:"visual question" OR TITLE_ABS:"vision-language" OR TITLE_ABS:"image-text" OR TITLE_ABS:"image-language" OR TITLE_ABS:"multimodal large language") AND '+EPMC_IMAGING,
 intervention:'(TITLE_ABS:radiotherapy OR TITLE_ABS:"treatment planning" OR TITLE_ABS:"dose prediction" OR TITLE_ABS:"surgical navigation" OR TITLE_ABS:"image-guided" OR TITLE_ABS:intraoperative) AND '+EPMC_IMAGING,
 foundation:'(TITLE_ABS:"foundation model" OR TITLE_ABS:"foundation models" OR TITLE_ABS:"segment anything" OR TITLE_ABS:MedSAM OR TITLE_ABS:"SAM-Med" OR TITLE_ABS:"large vision-language model" OR TITLE_ABS:"universal segmentation model") AND '+EPMC_IMAGING,
};
export const ARXIV_TRACK_QUERIES: Record<string,string> = {
 segmentation:'(all:segmentation OR all:delineation OR all:contouring) AND ('+ARXIV_IMAGING+' OR all:organ OR all:lesion OR all:tumor OR all:tumour)',
 human_loop:'(all:"human-in-the-loop" OR all:"human-AI" OR all:"reader study" OR all:"AI-assisted" OR all:"interactive segmentation" OR all:"clinician feedback") AND '+ARXIV_IMAGING,
 diagnosis:'(all:diagnosis OR all:detection OR all:classification OR all:screening) AND '+ARXIV_IMAGING,
 reconstruction:'(all:reconstruction OR all:denoising OR all:"super-resolution" OR all:synthesis OR all:"artifact reduction") AND '+ARXIV_IMAGING,
 registration:'(all:registration OR all:"motion estimation" OR all:"motion tracking" OR all:"motion correction" OR all:"image alignment") AND '+ARXIV_IMAGING,
 quantification:'(all:radiomics OR all:radiomic OR all:"imaging biomarker" OR all:"quantitative imaging" OR all:morphometry OR all:volumetric) AND '+ARXIV_IMAGING,
 prognosis:'(all:prognosis OR all:prognostic OR all:"survival prediction" OR all:"treatment response" OR all:"disease progression" OR all:"outcome prediction") AND '+ARXIV_IMAGING,
 language:'(all:"report generation" OR all:"visual question" OR all:"vision-language" OR all:"image-text" OR all:"image-language" OR all:"multimodal large language") AND '+ARXIV_IMAGING,
 intervention:'(all:radiotherapy OR all:"treatment planning" OR all:"dose prediction" OR all:"surgical navigation" OR all:"image-guided" OR all:intraoperative) AND '+ARXIV_IMAGING,
 foundation:'(all:"foundation model" OR all:"foundation models" OR all:"segment anything" OR all:MedSAM OR all:"SAM-Med" OR all:"large vision-language model" OR all:"universal segmentation model") AND '+ARXIV_IMAGING,
};

// arXiv asks clients to leave at least 3 seconds between calls. The shared queue
// includes retries and protects concurrent callers, not merely each query loop.
export const ARXIV_REQUEST_INTERVAL_MS = 3100;
let arxivLastStarted = 0;
let arxivQueue = Promise.resolve();
async function waitForOfficialSlot(url:string) {
 if(new URL(url).hostname !== "export.arxiv.org") return;
 const slot = arxivQueue.then(async () => {
   const wait = ARXIV_REQUEST_INTERVAL_MS - (Date.now()-arxivLastStarted);
   if(wait > 0) await new Promise(resolve => setTimeout(resolve,wait));
   arxivLastStarted = Date.now();
 });
 arxivQueue = slot.catch(() => {});
 await slot;
}

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
      await waitForOfficialSlot(url);
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

function sourceHasCurrentTaxonomy(previous:MonitorData, source:string):boolean {
 const versions = previous.sourceTaxonomyVersions;
 return !!versions && typeof versions === "object" && (versions as Record<string,unknown>)[source] === INTEREST_TAXONOMY_VERSION;
}
export function sourceDateWindow(previous: MonitorData, source: string, now: Date) {
  let last = previous.runs.filter(run => run.source === source && run.status !== "error" && !run.error)
    .map(run => Date.parse(run.completedAt)).filter(Number.isFinite).sort((a,b) => b-a)[0];
  // A recent two-direction run must not exclude the new directions' backfill.
  if(!sourceHasCurrentTaxonomy(previous,source)) last = Math.min(last ?? Infinity,now.getTime()-30*DAY);
  const start = Math.max(now.getTime()-90*DAY,(last ?? now.getTime()-30*DAY)-7*DAY);
  return {since:new Date(Math.min(start,now.getTime())).toISOString().slice(0,10),to:now.toISOString().slice(0,10)};
}

/** A daily cache is valid only after every query in the current taxonomy succeeded. */
export function canReuseArxivToday(previous:MonitorData, now:Date):boolean {
 if(!sourceHasCurrentTaxonomy(previous,SOURCE_NAMES.arxiv)) return false;
 const latest = previous.runs.filter(run => run.source === SOURCE_NAMES.arxiv)
   .sort((a,b) => b.completedAt.localeCompare(a.completedAt))[0];
 return !!latest && latest.status !== "error" && !latest.error && latest.completedAt.slice(0,10) === now.toISOString().slice(0,10);
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
    run.coverage = "10个感兴趣方向的发表/首次收录重叠窗口；每方向最多300条，查询结果可能重叠；新分类首次至少回溯37天。";
    for (const [track,terms] of Object.entries(EPMC_TRACK_QUERIES)) {
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
    run.query = Object.values(ARXIV_TRACK_QUERIES).join("\n\n"); run.dateFrom = "";
    run.coverage = "10个方向各按版本更新时间读取最近100条；方向间可能重叠。全部查询成功后同一UTC日复用缓存，未读取历史记录不计入趋势。";
    for(const [track,query] of Object.entries(ARXIV_TRACK_QUERIES)) {
      const url = "https://export.arxiv.org/api/query?"+new URLSearchParams({search_query:query,start:"0",max_results:"100",sortBy:"lastUpdatedDate",sortOrder:"descending"});
      const result = await page(url,query,track,body => {
        const parsed = parseArxiv(body,url,startedAt);
        return {...parsed,papers:parsed.papers.map(paper => ({...paper,provenance:paper.provenance.map(item => ({...item,queryTrack:track}))}))};
      });
      if (result) {
        run.total! += result.total;
        const capped = result.total > result.papers.length; truncated ||= capped;
        requestLogs[requestLogs.length-1].truncated = capped;
      }
    }
  } else {
    run.query = `radiology and imaging; ${since} → ${to}; 本地10个感兴趣方向规则筛选`;
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
  return {papers,run,requestLogs,taxonomyVersion:errors.length === 0 && validPages > 0 ? INTEREST_TAXONOMY_VERSION : undefined};
}

export async function collectAll(previous: MonitorData, options: CollectOptions = {}): Promise<{data:MonitorData;allFailed:boolean;outcomes:SourceOutcome[]}> {
  // Independent requests cannot prevent other sources from recording their outcomes.
  const cachedArxiv = canReuseArxivToday(previous,options.now ?? new Date());
  const sources = (Object.keys(SOURCE_NAMES) as SourceKey[]).filter(key => key !== "arxiv" || !cachedArxiv);
  const outcomes = await Promise.all(sources.map(async key => {
    try { return await collectSource(key,previous,options); }
    catch (error) {
      const timestamp = (options.now ?? new Date()).toISOString(), window = sourceDateWindow(previous,SOURCE_NAMES[key],options.now ?? new Date());
      return {papers:[],requestLogs:[],run:{id:randomUUID(),source:SOURCE_NAMES[key],startedAt:timestamp,completedAt:timestamp,status:"error" as const,received:0,kept:0,added:0,updated:0,total:null,query:"",dateFrom:window.since,dateTo:window.to,coverage:"采集异常；保留既有来源数据。",error:error instanceof Error ? error.message : String(error)}};
    }
  }));
  const data = applyOutcomes(previous,outcomes,(options.now ?? new Date()).toISOString());
  // A still-valid arXiv snapshot remains available if the other sources fail.
  // Do not append a pretend arXiv run or advance its actual fetch timestamp.
  if(cachedArxiv && data.status === "error") data.status = "partial";
  return {data,allFailed:!cachedArxiv && outcomes.every(o => o.run.status === "error"),outcomes};
}
