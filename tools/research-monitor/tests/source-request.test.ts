import assert from "node:assert/strict";
import test from "node:test";
import { createOfficialTextFetcher, SourceRequestError } from "../lib/source-request";

const arxiv = "https://export.arxiv.org/api/query?search_query=all%3AMRI";
const epmc = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=MRI";
const start = Date.parse("2026-10-16T00:00:00Z");
function clock() {
  let current = start;
  const sleeps:number[] = [], deadlines:number[] = [];
  return {
    sleeps,deadlines,
    now:() => current,
    advance:(ms:number) => {current += ms;},
    sleep:async (ms:number) => {sleeps.push(ms);current += ms;},
    timeout:(ms:number) => {deadlines.push(ms);return new AbortController().signal;},
  };
}

test("arXiv recovers after transient failures with longer deadlines and bounded backoff", async () => {
  const time = clock(); let attempts = 0;
  const events:string[] = [];
  const fetchText = createOfficialTextFetcher({...time,fetch:async (_url,init) => {
    assert.equal(init.redirect,"error"); assert.ok(init.signal);
    attempts++; events.push(`request-${attempts}`);
    if(attempts === 1) throw new TypeError("connection reset");
    if(attempts === 2) return {status:503,ok:false,url:arxiv,headers:new Headers(),text:async () => "unavailable",body:{cancel:async () => {events.push("cancel-503");}}};
    return new Response("<feed>recovered</feed>");
  }});
  assert.deepEqual(await fetchText(arxiv),{body:"<feed>recovered</feed>",httpStatus:200,attempts:3});
  assert.deepEqual(time.sleeps,[5000,10000]);
  assert.deepEqual(time.deadlines,[60000,60000,60000]);
  assert.deepEqual(events,["request-1","request-2","cancel-503","request-3"]);
});

test("a timeout while reading the response body retries and eventually records exhaustion", async () => {
  const time = clock(); let attempts = 0, controller:AbortController;
  const fetchText = createOfficialTextFetcher({...time,
    timeout:ms => {time.deadlines.push(ms);controller = new AbortController();return controller.signal;},
    fetch:async (_url,init) => {
      attempts++;
      return {status:200,ok:true,url:arxiv,headers:new Headers(),text:async () => {
        controller.abort(new DOMException("The operation timed out","TimeoutError"));
        init.signal!.throwIfAborted();
        return "unreachable";
      }};
    },
  });
  await assert.rejects(fetchText(arxiv),error => {
    assert.ok(error instanceof SourceRequestError);
    assert.equal(error.attempts,3); assert.equal(error.httpStatus,200);
    assert.match(error.message,/60 秒，包含响应读取/); assert.match(error.message,/已尝试 3 次/);
    return true;
  });
  assert.equal(attempts,3); assert.deepEqual(time.sleeps,[5000,10000]);
});

test("Retry-After seconds and HTTP dates are honored without the old ten-second truncation", async () => {
  for(const retryAfter of ["20",new Date(start+20000).toUTCString()]) {
    const time = clock(); let attempts = 0;
    const fetchText = createOfficialTextFetcher({...time,fetch:async () => ++attempts === 1 ?
      new Response("limited",{status:429,headers:{"Retry-After":retryAfter}}) : new Response("recovered")});
    assert.equal((await fetchText(arxiv)).attempts,2);
    assert.deepEqual(time.sleeps,[20000]);
  }
});

test("long Retry-After pauses the host without retrying other directions, then permits recovery", async () => {
  const time = clock(); let calls = 0;
  const fetchText = createOfficialTextFetcher({...time,fetch:async () => ++calls === 1 ?
    new Response("limited",{status:429,headers:{"Retry-After":"120"}}) : new Response("recovered")});
  await assert.rejects(fetchText(arxiv),error => error instanceof SourceRequestError && error.httpStatus === 429 && error.attempts === 1 && /暂停后续同源请求/.test(error.message));
  await assert.rejects(fetchText(arxiv+"+segmentation"),error => error instanceof SourceRequestError && error.attempts === 0 && /冷却期/.test(error.message));
  assert.equal(calls,1); assert.deepEqual(time.sleeps,[]);
  assert.equal((await fetchText(epmc)).body,"recovered","arXiv cooling does not block other sources");
  time.advance(120000);
  assert.equal((await fetchText(arxiv)).body,"recovered");
  assert.equal(calls,3);
});

test("429 without Retry-After exhausts three attempts and gives later queries a cooldown", async () => {
  const time = clock(); let calls = 0;
  const fetchText = createOfficialTextFetcher({...time,fetch:async () => {calls++;return new Response("limited",{status:429});}});
  await assert.rejects(fetchText(arxiv),error => error instanceof SourceRequestError && error.httpStatus === 429 && error.attempts === 3);
  await assert.rejects(fetchText(arxiv+"+radiology"),error => error instanceof SourceRequestError && error.attempts === 0);
  assert.equal(calls,3); assert.deepEqual(time.sleeps,[5000,10000]);
});

test("permanent HTTP errors do not retry and release the response body", async () => {
  const time = clock(); let calls = 0, canceled = 0;
  const fetchText = createOfficialTextFetcher({...time,fetch:async () => {
    calls++;
    return {status:400,ok:false,url:arxiv,headers:new Headers(),text:async () => "bad query",body:{cancel:async () => {canceled++;}}};
  }});
  await assert.rejects(fetchText(arxiv),error => error instanceof SourceRequestError && error.httpStatus === 400 && error.attempts === 1);
  assert.equal(calls,1);assert.equal(canceled,1);assert.deepEqual(time.sleeps,[]);
});

test("official host checks reject unsafe inputs and unexpected redirect responses", async () => {
  const time = clock(); let calls = 0;
  const fetchText = createOfficialTextFetcher({...time,fetch:async (_url,init) => {
    calls++; assert.equal(init.redirect,"error");
    return {status:200,ok:true,url:"https://example.org/mirror",headers:new Headers(),text:async () => "mirror"};
  }});
  for(const url of ["bad-url","http://export.arxiv.org/api/query","https://export.arxiv.org.evil.example/api/query","https://user:pass@export.arxiv.org/api/query","https://export.arxiv.org:8443/api/query"]) {
    await assert.rejects(fetchText(url),error => error instanceof SourceRequestError && error.attempts === 0);
  }
  assert.equal(calls,0);
  await assert.rejects(fetchText(arxiv),/重定向到非官方地址/);
  assert.equal(calls,1);
});

test("concurrent arXiv callers remain serial through body reads and respect start spacing", async () => {
  const time = clock(); const starts:number[] = [];
  let finishFirst!:() => void, active = 0, peak = 0;
  const firstBody = new Promise<void>(resolve => {finishFirst=resolve;});
  const fetchText = createOfficialTextFetcher({...time,fetch:async () => {
    starts.push(time.now()); const index = starts.length; peak = Math.max(peak,++active);
    return {status:200,ok:true,url:arxiv,headers:new Headers(),text:async () => {
      if(index === 1) await firstBody;
      active--;return "feed";
    }};
  }});
  const first = fetchText(arxiv),second = fetchText(arxiv+"+segmentation");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(starts.length,1,"second request must wait for the first body to finish");
  finishFirst();
  await Promise.all([first,second]);
  assert.equal(peak,1);assert.deepEqual(starts,[start,start+3100]);
});

test("other official sources retain their existing timeout, retries and empty-body recovery", async () => {
  const time = clock(); let attempts = 0;
  const fetchText = createOfficialTextFetcher({...time,fetch:async () => {
    attempts++;
    if(attempts === 1) throw new Error("network unavailable");
    return new Response(attempts === 2 ? " " : "{\"hitCount\":0}");
  }});
  assert.equal((await fetchText(epmc)).attempts,3);
  assert.deepEqual(time.deadlines,[25000,25000,25000]);
  assert.deepEqual(time.sleeps,[1500,3000]);
});
