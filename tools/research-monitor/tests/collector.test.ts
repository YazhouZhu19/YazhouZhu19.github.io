import assert from "node:assert/strict";
import test from "node:test";
import { collectAll, collectSource, sourceDateWindow, SourceRequestError, type FetchText } from "../lib/collect";
import { parseArxiv, parseEpmc, parseMedrxivPage } from "../lib/parse";
import { applyOutcomes, mergePapers, normalizeRecord, parseMonitorData } from "../lib/record";
import type { MonitorData, Paper, SyncRun } from "../lib/types";

const now = "2026-09-17T08:00:00.000Z";
const paper = (overrides:Record<string,unknown> = {}):Paper => normalizeRecord({
  id:"doi:10.1000/example",doi:"10.1000/example",title:"Medical image segmentation of brain tumors",abstract:"Full original abstract about MRI segmentation.",
  authors:[{name:"Jane Researcher",affiliations:["Institute A"]}],source:"Europe PMC",publishedAt:"2026-09-01",updatedAt:null,
  firstSeenAt:"2026-09-02T00:00:00.000Z",url:"https://doi.org/10.1000/example",provenance:[],...overrides,
},now);
const previous = (papers:Paper[] = [paper()]):MonitorData => ({papers,runs:[],queryRuns:[],collectedAt:"2026-09-02T00:00:00.000Z",lastSuccessfulSync:"2026-09-02T00:00:00.000Z",storageAvailable:true,coverage:"existing"});
const run = (overrides:Partial<SyncRun> = {}):SyncRun => ({id:"run",source:"Europe PMC",startedAt:now,completedAt:now,status:"ok",received:0,kept:0,added:0,updated:0,total:0,query:"test",dateFrom:"2026-08-01",dateTo:"2026-09-17",coverage:"limited",...overrides});
const atom = (id = "2609.12345v2") => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/${id}</id><title>Medical image segmentation &amp; diagnosis</title><summary>Full original MRI abstract with &#945; and patient &lt; 10.</summary><published>2026-09-01T12:00:00Z</published><updated>2026-09-16T13:00:00Z</updated><author><name>Zo&#235; A.</name><arxiv:affiliation>Institute &amp; Lab</arxiv:affiliation></author><arxiv:doi>10.1000/published</arxiv:doi></entry></feed>`;

test("DOI merge keeps earlier firstSeen, authors, abstract, sources and version history", () => {
  const old = paper({versions:[{version:1}],provenance:[{collectedAt:"2026-09-02",sourceRecordId:"123"}]});
  const fresh = paper({doi:" https://doi.org/10.1000/EXAMPLE ",source:"medRxiv",abstract:"",authors:[],updatedAt:"2026-09-16",firstSeenAt:now,version:2,versions:[{version:2}]});
  const result = mergePapers([old],[fresh]);
  assert.equal(result.papers.length,1); assert.equal(result.added,0); assert.equal(result.updated,1);
  const merged = result.papers[0];
  assert.equal(merged.id,"doi:10.1000/example"); assert.equal(merged.firstSeenAt,old.firstSeenAt);
  assert.equal(merged.abstract,old.abstract); assert.deepEqual(merged.authors,old.authors);
  assert.equal(merged.originalAbstract,old.originalAbstract);
  assert.deepEqual(new Set(merged.sources),new Set(["Europe PMC","medRxiv"]));
  assert.equal(merged.versions?.length,2);
});

test("arXiv version stable identity remains distinct from related publication DOI", () => {
  const first = parseArxiv(atom("2609.12345v1"),"https://export.arxiv.org/api/query",now).papers[0];
  const second = parseArxiv(atom(),"https://export.arxiv.org/api/query",now).papers[0];
  const journal = paper({doi:"10.1000/published"});
  const result = mergePapers([first,journal],[second]);
  assert.equal(result.papers.length,2);
  assert.equal(result.papers.find(p => p.arxivId)?.version,2);
  assert.equal(second.id,"arxiv:2609.12345"); assert.equal(second.relatedDoi,"10.1000/published");
  assert.equal(second.authors[0].name,"Zoë A.");
  assert.deepEqual(second.authors[0].affiliations,["Institute & Lab"]);
  assert.match(second.abstract,/α/); assert.match(second.abstract,/patient < 10/);
});

test("later DOI metadata coalesces a PMID record without losing existing content", () => {
  const old = paper({id:"epmc:MED:123",doi:null,pmid:"123"});
  const fresh = paper({doi:"10.1000/new",pmid:"123",updatedAt:"2026-09-16"});
  const result = mergePapers([old],[fresh]);
  assert.equal(result.papers.length,1); assert.equal(result.papers[0].id,"doi:10.1000/new");
  assert.equal(result.papers[0].firstSeenAt,old.firstSeenAt);
});

test("EPMC parser preserves full official abstract, collective authors and affiliations", () => {
  const p = parseEpmc({id:"42",source:"MED",title:"Medical image segmentation",abstractText:"<p>Original full abstract.</p>",firstPublicationDate:"2026-09-01",authorList:{author:[{collectiveName:"Research Consortium",authorAffiliationDetailsList:{authorAffiliation:[{affiliation:"University"}]}}]}},"https://www.ebi.ac.uk/europepmc/webservices/rest/search",now);
  assert.equal(p.abstract,"Original full abstract."); assert.equal((p as any).originalAbstract,"<p>Original full abstract.</p>");
  assert.equal(p.authors[0].name,"Research Consortium"); assert.equal(p.pmid,"42"); assert.deepEqual(p.affiliations,["University"]);
});

test("empty medRxiv HTTP-200 body is an error, while explicit zero count is a valid response", () => {
  assert.throws(() => parseMedrxivPage(""),/HTTP 200.*响应体为空/);
  assert.throws(() => parseMedrxivPage("<html>unavailable</html>"),/非 JSON/);
  assert.deepEqual(parseMedrxivPage(JSON.stringify({messages:[{status:"ok",total:"0"}],collection:[]})),{hits:[],total:0});
  assert.throws(() => parseMedrxivPage(JSON.stringify({messages:[{status:"ok",total:"1"}],collection:[]})),/空 collection/);
  assert.throws(() => parseArxiv("<html>error</html>","url",now),/Atom feed/);
});

test("one failed source retains all previous papers and records a real source error", async () => {
  const oldMed = paper({doi:"10.1000/old-med",source:"medRxiv"});
  const fetchText:FetchText = async url => {
    if (url.includes("api.biorxiv.org")) return {body:"",httpStatus:200,attempts:1};
    if (url.includes("arxiv")) return {body:atom(),httpStatus:200,attempts:1};
    return {body:JSON.stringify({hitCount:0,resultList:{result:[]}}),httpStatus:200,attempts:1};
  };
  const result = await collectAll(previous([oldMed]),{now:new Date(now),fetchText});
  assert.equal(result.allFailed,false); assert.equal(result.data.status,"partial");
  assert.equal(result.data.papers.length,2); assert.ok(result.data.papers.some(p => p.id === oldMed.id));
  assert.match(result.data.errors?.find(e => e.source === "medRxiv")?.message ?? "",/HTTP 200.*响应体为空/);
  assert.equal(result.data.runs.find(r => r.source === "medRxiv")?.total,null);
  assert.equal(result.data.lastSuccessfulSync,now);
  assert.equal(result.data.requestLogs?.find(q => q.source === "medRxiv")?.httpStatus,200);
});

test("all sources failing retains public library and previous lastSuccessfulSync", async () => {
  const initial = previous();
  const result = await collectAll(initial,{now:new Date(now),fetchText:async () => {throw new SourceRequestError("HTTP 503",503,3);}});
  assert.equal(result.allFailed,true); assert.equal(result.data.status,"error");
  assert.deepEqual(result.data.papers,initial.papers);
  assert.equal(result.data.lastSuccessfulSync,initial.lastSuccessfulSync);
  assert.equal(result.data.errors?.length,3); assert.equal(result.data.runs.length,3);
});

test("a failed later page records partial and keeps already validated records", async () => {
  let call = 0;
  const result = await collectSource("medrxiv",previous(),{now:new Date(now),fetchText:async () => {
    if (call++ > 0) throw new Error("network unavailable");
    return {body:JSON.stringify({messages:[{status:"ok",total:60}],collection:[{doi:"10.1000/new",title:"Medical image segmentation",abstract:"MRI brain segmentation",authors:"A; B",date:"2026-09-16",version:1}]}),httpStatus:200,attempts:1};
  }});
  assert.equal(result.run.status,"partial"); assert.match(result.run.error ?? "",/network unavailable/);
  assert.equal(result.papers.length,1); assert.equal(result.run.received,1);
  const data = applyOutcomes(previous(),[result],now);
  assert.equal(data.papers.length,2); assert.equal(data.lastSuccessfulSync,previous().lastSuccessfulSync);
});

test("history is not capped at 3000; only latest 45 source runs retained", () => {
  const many = Array.from({length:3001},(_,i) => paper({doi:`10.1000/p${i}`}));
  const initial = previous(many); initial.runs = Array.from({length:50},(_,i) => run({id:`old-${i}`,completedAt:"2026-09-01"}));
  const data = applyOutcomes(initial,[{papers:[paper({doi:"10.1000/new"})],run:run(),requestLogs:[]}],now);
  assert.equal(data.papers.length,3002); assert.equal(data.totalStored,3002); assert.equal(data.runs.length,45);
});

test("initial queryRuns remain unchanged; new and prior requestLogs use separate bounded history", () => {
  const initial = previous();
  initial.queryRuns = [{source:"Europe PMC",track:"segmentation",retrieved:45,hitCount:100,startDate:"2025-09-17",endDate:"2026-09-17",dateField:"FIRST_PDATE",query:"initial snapshot",collectedAt:now}];
  initial.requestLogs = Array.from({length:500},(_,i) => ({url:`https://example.org/${i}`,collectedAt:now,source:"Europe PMC",runId:`old-${i}`}));
  const freshLog = {url:"https://www.ebi.ac.uk/europepmc/webservices/rest/search",collectedAt:now,source:"Europe PMC",runId:"new"};
  const data = applyOutcomes(initial,[{papers:[],run:run(),requestLogs:[freshLog]}],now);
  assert.deepEqual(data.queryRuns,initial.queryRuns);
  assert.equal(data.requestLogs?.length,500);
  assert.equal(data.requestLogs?.[0].runId,"old-1");
  assert.deepEqual(data.requestLogs?.at(-1),freshLog);
});

test("date window overlaps 7 days, caps catch-up at 90 days and ignores source failures", () => {
  const initial = previous();
  assert.equal(sourceDateWindow(initial,"Europe PMC",new Date(now)).since,"2026-08-11");
  initial.runs = [run({completedAt:"2026-01-01"}),run({status:"error",completedAt:"2026-09-16"})];
  assert.equal(sourceDateWindow(initial,"Europe PMC",new Date(now)).since,"2026-06-19");
});

test("input validator accepts legacy seed shape and rejects invalid library", () => {
  const normalized = parseMonitorData({papers:[paper()],collectedAt:now,queryRuns:[]});
  assert.equal(normalized.totalStored,1); assert.deepEqual(normalized.runs,[]);
  assert.throws(() => parseMonitorData({papers:null,collectedAt:now}),/MonitorData/);
  assert.throws(() => parseMonitorData({papers:[{}],collectedAt:now}),/稳定标识/);
});
