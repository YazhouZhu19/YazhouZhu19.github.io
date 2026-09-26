import assert from "node:assert/strict";
import test from "node:test";
import { collectSource, EPMC_TRACK_QUERIES, SourceRequestError } from "../lib/collect";
import { applyOutcomes, normalizeRecord } from "../lib/record";
import type { MonitorData } from "../lib/types";

const now = new Date("2026-09-26T16:00:00Z");
const previous = ():MonitorData => ({papers:[],runs:[],queryRuns:[],collectedAt:"2026-09-25T00:00:00Z",lastSuccessfulSync:null,storageAvailable:true,coverage:"bounded"});
const response = (value:unknown) => ({body:JSON.stringify(value),httpStatus:200,attempts:1});
const hit = (id:number,category = "radiology and imaging") => ({doi:`10.1000/${id}`,title:`Brain MRI segmentation ${id}`,abstract:"Medical imaging segmentation.",authors:"A; B",date:"2026-09-25",version:1,category});

test("official medRxiv backup filters categories locally and paginates by raw rows",async () => {
  const offsets:number[] = [];
  const result = await collectSource("medrxiv",previous(),{now,fetchText:async value => {
    const url = new URL(value);
    if (url.hostname === "api.biorxiv.org") throw new SourceRequestError("empty HTTP 200",200,3);
    assert.equal(url.hostname,"api.medrxiv.org");
    const offset = Number(url.pathname.split("/").at(-2)); offsets.push(offset);
    const items = Array.from({length:Math.min(30,65-offset)},(_,i) => hit(offset+i,(offset+i)%10 === 0 ? "radiology and imaging" : "neurology"));
    return response({messages:[{status:"ok",total:65}],collection:items});
  }});
  assert.deepEqual(offsets,[0,60,30]);
  assert.equal(result.run.received,65); assert.equal(result.papers.length,7);
  assert.equal(result.run.status,"ok"); assert.equal(result.run.error,undefined);
  assert.match(result.run.coverage,/api.medrxiv.org/);
  assert.equal(result.requestLogs[0].status,"error");
  assert.equal(result.requestLogs[0].recoveredBy,"https://api.medrxiv.org");
  assert.ok(result.papers.every(p => p.provenance.every(item => item.queryUrl?.startsWith("https://api.medrxiv.org/"))));
  const old = normalizeRecord(hit(999),now.toISOString());
  const data = applyOutcomes({...previous(),papers:[old]},[result],now.toISOString());
  assert.equal(data.error,undefined); assert.ok(data.papers.some(p => p.id===old.id));
});

test("backup failures stay visible and do not advance success timestamps",async () => {
  const result = await collectSource("medrxiv",previous(),{now,fetchText:async url => {
    if(url.includes("api.biorxiv.org")) throw new Error("primary empty body");
    if(url.includes("/0/json")) return response({messages:[{status:"ok",total:60}],collection:[hit(1)]});
    throw new Error("backup unavailable");
  }});
  assert.equal(result.run.status,"partial"); assert.match(result.run.error!,/backup unavailable/);
  assert.equal(result.papers.length,1);
  assert.equal(applyOutcomes(previous(),[result],now.toISOString()).lastSuccessfulSync,null);
});

test("empty or malformed backup cannot turn an outage into success",async () => {
  const result = await collectSource("medrxiv",previous(),{now,fetchText:async url => {
    if(url.includes("api.biorxiv.org")) throw new Error("primary empty body");
    return {body:"",httpStatus:200,attempts:3};
  }});
  assert.equal(result.run.status,"error"); assert.equal(result.run.total,null);
  assert.match(result.run.error!,/primary empty body/); assert.match(result.run.error!,/响应体为空/);
});

test("backup pagination budget remains partial and prioritizes the tail of a long range",async () => {
  const offsets:number[]=[];
  const result=await collectSource("medrxiv",previous(),{now,fetchText:async url => {
    if(url.includes("api.biorxiv.org")) throw new Error("primary unavailable");
    const offset=Number(new URL(url).pathname.split("/").at(-2)); offsets.push(offset);
    return response({messages:[{status:"ok",total:3000}],collection:Array.from({length:30},(_,i)=>hit(offset+i))});
  }});
  assert.equal(offsets.length,60); assert.deepEqual(offsets.slice(0,3),[0,2970,2940]);
  assert.equal(result.run.received,1800); assert.equal(result.papers.length,240);
  assert.equal(result.run.status,"partial"); assert.equal(result.run.error,undefined);
  assert.equal(result.requestLogs.at(-1)?.truncated,true);
});

test("backup replay does not consume the version cap or discard unique recovered papers",async () => {
  const records = [...Array.from({length:211},(_,i) => hit(i)),{...hit(0),version:2,date:"2026-09-26"}];
  const result = await collectSource("medrxiv",previous(),{now,fetchText:async value => {
    const url = new URL(value), offset = Number(url.pathname.split("/").at(-2));
    if (url.hostname === "api.biorxiv.org" && offset === 210) throw new Error("primary failed after seven valid pages");
    return response({messages:[{status:"ok",total:records.length}],collection:records.slice(offset,offset+30)});
  }});
  assert.equal(result.run.received,422,"raw request counts retain the replayed rows");
  assert.equal(result.papers.length,211);
  assert.ok(result.papers.some(p => p.doi === "10.1000/210"),"the final unique paper survives backup replay");
  assert.equal(result.run.status,"ok"); assert.equal(result.run.error,undefined);
  const versioned = result.papers.find(p => p.doi === "10.1000/0")!;
  assert.deepEqual(new Set(versioned.versions?.map(v => (v as {version:number}).version)),new Set([1,2]));
  const replayed = result.papers.find(p => p.doi === "10.1000/1")!;
  assert.deepEqual(new Set(replayed.provenance.map(p => new URL(p.queryUrl!).hostname)),new Set(["api.biorxiv.org","api.medrxiv.org"]));
});

test("medRxiv cap still counts distinct versions rather than distinct papers",async () => {
  const records = Array.from({length:121},(_,i) => [hit(i),{...hit(i),version:2,date:"2026-09-26"}]).flat();
  const result = await collectSource("medrxiv",previous(),{now,fetchText:async value => {
    const url = new URL(value);
    if (url.hostname === "api.biorxiv.org") throw new Error("primary unavailable");
    const offset = Number(url.pathname.split("/").at(-2));
    return response({messages:[{status:"ok",total:records.length}],collection:records.slice(offset,offset+30)});
  }});
  assert.equal(result.run.received,242);
  assert.equal(result.run.status,"partial"); assert.equal(result.run.error,undefined);
  assert.equal(result.papers.length,121);
  assert.equal(result.papers.reduce((sum,p) => sum+(p.versions?.length ?? 0),0),240);
  assert.ok(result.papers.every(p => p.version === 2),"the latest version of every paper survives the date-sorted cap");
});

test("EPMC confirmed terminal count discrepancy is limited coverage, not an outage",async () => {
  const result = await collectSource("epmc",previous(),{now,fetchText:async value => {
    const url=new URL(value), cursor=url.searchParams.get("cursorMark")!;
    if(!url.searchParams.get("query")!.startsWith(EPMC_TRACK_QUERIES.segmentation)) return response({hitCount:0,resultList:{result:[]}});
    const count=cursor==="*"?99:cursor==="next"?33:0;
    return response({hitCount:134,request:{cursorMark:cursor},...(count?{nextCursorMark:cursor==="*"?"next":"end"}:{}),resultList:{result:Array.from({length:count},(_,i)=>({id:`${cursor}-${i}`,source:"MED",title:"Brain MRI segmentation",firstPublicationDate:"2026-09-25"}))}});
  }});
  assert.equal(result.run.received,132); assert.equal(result.run.status,"partial");
  assert.equal(result.run.error,undefined);
  const terminal=result.requestLogs.find(log=>log.paginationExhausted && log.countDiscrepancy===2);
  assert.equal(terminal?.status,"ok"); assert.equal(terminal?.truncated,true);
});
