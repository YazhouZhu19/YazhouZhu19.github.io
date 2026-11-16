import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const template = readFileSync("scripts/templates/integrated-analysis-offline.html", "utf8");
const script = [...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)![1];

class Element {
  innerHTML = "";
  textContent = "";
  value = "";
  checked = false;
  hidden = false;
  open = false;
  attributes = new Map<string, string>();
  handlers = new Map<string, () => void>();
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  addEventListener(key: string, callback: () => void) {
    this.handlers.set(key, callback);
  }
  scrollIntoView() {}
}

function mount(history?: unknown) {
  const els = new Map([...template.matchAll(/\bid="([^"]+)"/g)].map((m) => [m[1], new Element()]));
  const get = (id: string) => {
    const e = els.get(id);
    assert.ok(e, `Missing element ${id}`);
    return e;
  };
  get("main-only").checked = true;
  get("niche-status").value = get("link-status").value = "all";
  get("niche-sort").value = "evidence";
  get("runtime-error").hidden = true;
  const niche = (id: string, status: string) => ({
    id,
    label: { zh: id, en: id },
    evidenceStatus: status,
    ready: status === "sufficient",
    count: 3,
    share: 0.01,
    spanDays: 730,
    years: [2023, 2024, 2025],
    logicPapers: 2,
    dataSpanDays: 365,
    gaps: status === "pending" ? [{ zh: "缺少代码" }] : [],
    evidence: [],
    data: [],
    code: [],
    news: [],
  });
  const rows = Array.from({ length: 15 }, (_, i) => ({
    paperId: `p${i}`,
    paperTitle: `Paper ${i}`,
    paperUrl: `https://example.org/p${i}`,
    explicit: i === 0 ? [{ id: "g1", title: "Explicit repository", url: "https://github.com/a/b" }] : [],
    candidates:
      i !== 14
        ? [
            {
              id: "g2",
              title: "Candidate repository",
              url: "https://github.com/c/d",
              tfidf: 0.2,
              bm25: 3.4,
              rankTfidf: 1,
              rankBm25: 2,
              sharedTerms: ["retina"],
            },
          ]
        : [],
  }));
  rows[1].paperTitle = '<img src=x onerror="attack()">';
  rows[1].paperUrl = "javascript:attack()";
  rows[1].candidates[0].title = "<script>attack()</script>";
  const zeros = { paper: 0, github: 0, news: 0 };
  get("analysis-data").textContent = JSON.stringify({
    history,
    result: {
      directions: [],
      niches: [niche("sufficient topic", "sufficient"), niche("pending topic", "pending")],
      historyTotal: 200,
      totals: zeros,
      excluded: zeros,
      duplicates: zeros,
      unmatched: zeros,
      asOf: "2026-11-16",
      windowStart: "2025-11-17",
      version: "test",
    },
    paperCodeLinks: { stats: { repositories: 8 }, links: rows },
    sourceStates: [],
    inputPapers: 15,
    inputSignals: 8,
  });
  const root = { querySelector: (selector: string) => get(selector.slice(1)) };
  const window: Record<string, unknown> = {};
  runInNewContext(
    script,
    { document: { getElementById: (id: string) => (id === "oevryn-offline" ? root : get(id)) }, window, URL },
    { timeout: 1000 },
  );
  assert.equal(get("runtime-error").hidden, true, get("runtime-error").textContent);
  return { get, window };
}

test("offline association filters keep explicit, candidate and missing states distinct", () => {
  const { get } = mount();
  assert.match(get("link-count").textContent, /匹配 15 篇论文 · 已显示 12 篇/);
  get("link-status").value = "explicit";
  get("link-status").handlers.get("change")!();
  assert.match(get("link-count").textContent, /匹配 1 篇论文/);
  assert.match(get("link-cards").innerHTML, /明确链接/);
  assert.match(get("link-cards").innerHTML, /候选关联/);
  get("link-status").value = "candidate";
  get("link-status").handlers.get("change")!();
  assert.match(get("link-count").textContent, /匹配 13 篇论文/);
  get("link-status").value = "none";
  get("link-status").handlers.get("change")!();
  assert.match(get("link-count").textContent, /匹配 1 篇论文/);
  assert.match(get("link-cards").innerHTML, /暂未找到关联/);
});

test("offline evidence states and association pagination/search work without network APIs", () => {
  const { get } = mount();
  get("niche-status").value = "pending";
  get("niche-status").handlers.get("change")!();
  assert.match(get("niche-cards").innerHTML, /pending topic/);
  assert.doesNotMatch(get("niche-cards").innerHTML, /sufficient topic/);
  get("niche-status").value = "sufficient";
  get("niche-status").handlers.get("change")!();
  assert.match(get("niche-cards").innerHTML, /证据充分/);
  get("link-more").handlers.get("click")!();
  assert.match(get("link-count").textContent, /已显示 15 篇/);
  assert.equal(get("link-more").hidden, true);
  get("link-search").value = "retina";
  get("link-search").handlers.get("input")!();
  assert.match(get("link-count").textContent, /匹配 14 篇论文 · 已显示 12 篇/);
  get("link-search").value = "nonexistent";
  get("link-search").handlers.get("input")!();
  assert.match(get("link-cards").innerHTML, /没有符合/);
});

test("offline source text is escaped and unsafe source URLs never become links", () => {
  const { get } = mount();
  const html = get("link-cards").innerHTML;
  assert.doesNotMatch(html, /<img|<script|href="javascript:/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(template, /<script[^>]+src=|<link[^>]+href=/i);
});

function historyFixture() {
  const direction = (id: string, title: string, evidenceStatus: string) => ({
    id,
    title,
    scope: "A focused historical evidence supplement",
    archiveCount: 4,
    archiveShare: 0.02,
    evidenceStatus,
    checks: [
      {
        id: "versions",
        label: "数据版本",
        passed: evidenceStatus === "sufficient",
        detail: "Version evidence <review>",
      },
    ],
    gaps: evidenceStatus === "pending" ? ["缺少第二个数据版本"] : [],
    papers: [
      {
        id: "p",
        title: "Historical paper",
        date: "2021-01-01",
        url: "https://example.org/paper",
        doi: "10.1234/test",
        cues: { problem: ["motion"], method: ["registration"], validation: ["tested"], result: ["improved"] },
        logicComplete: true,
        rawAbstract: "RAW_ABSTRACT_MUST_NOT_RENDER",
      },
    ],
    datasets: [
      {
        id: "d",
        title: "Dataset <version>",
        url: "https://example.org/data",
        versions: [
          {
            version: "v2",
            date: null,
            url: "javascript:attack()",
            participants: null,
            changeDescription: "<img src=x onerror=attack()>",
          },
        ],
        spanDays: 0,
        contentGrowth: false,
        linked: true,
      },
    ],
    repositories: [
      {
        repository: id + "/toolkit",
        url: "https://github.com/example/toolkit",
        events: [
          {
            date: "2026-01-01",
            label: "v2",
            kind: "release",
            url: "https://github.com/example/toolkit/releases/tag/v2",
            description: "Brain processing update",
          },
        ],
        years: [2023, 2026],
        spanDays: 900,
        recent: true,
        linked: true,
        archived: false,
      },
    ],
    sources: [{ id: "Primary source", url: "javascript:attack()", retrievedAt: "2026-11-17" }],
    limitations: ["<script>attack()</script>"],
  });
  return {
    version: "history-test",
    asOf: "2026-11-17",
    basePaperCount: 200,
    enrichedPaperCount: 203,
    directions: [
      direction("fetal", "Fetal MRI pending", "pending"),
      direction("spinal", "Spinal MRI sufficient", "sufficient"),
    ],
  };
}

test("offline history is a separate default view with shared status and resource search", () => {
  const { get, window } = mount(historyFixture());
  assert.equal(get("main-panel").hidden, true);
  assert.equal(get("niche-panel").hidden, false);
  assert.equal(get("lexical-section").open, false);
  assert.equal(get("history-section").hidden, false);
  assert.match(
    get("history-description").textContent,
    /补证前论文库 200 篇.*本次核查 203 个独立作品（单独统计）/,
  );
  assert.match(get("history-count").textContent, /2 \/ 2 个专题/);
  assert.ok(
    get("history-cards").innerHTML.indexOf("Spinal MRI sufficient") <
      get("history-cards").innerHTML.indexOf("Fetal MRI pending"),
  );
  get("niche-status").value = "sufficient";
  get("niche-status").handlers.get("change")!();
  assert.match(get("history-cards").innerHTML, /Spinal MRI sufficient/);
  assert.doesNotMatch(get("history-cards").innerHTML, /Fetal MRI pending/);
  assert.match(get("niche-cards").innerHTML, /sufficient topic/);
  get("niche-status").value = "pending";
  get("niche-status").handlers.get("change")!();
  assert.match(get("history-cards").innerHTML, /缺少第二个数据版本/);
  assert.doesNotMatch(get("history-cards").innerHTML, /Spinal MRI sufficient/);
  get("niche-status").value = "all";
  get("niche-search").value = "spinal/toolkit";
  get("niche-search").handlers.get("input")!();
  assert.match(get("history-count").textContent, /1 \/ 2 个专题/);
  assert.match(get("history-cards").innerHTML, /Spinal MRI sufficient/);
  assert.match(get("history-cards").innerHTML, /href="https:\/\/example.org\/paper"/);
  assert.match(get("history-cards").innerHTML, /日期未核实/);
  get("niche-search").value = "absent topic";
  get("niche-search").handlers.get("input")!();
  assert.match(get("history-cards").innerHTML, /没有符合筛选条件的补证专题/);
  assert.equal((window.__oevrynOfflineReady as { historySufficient: number }).historySufficient, 1);
});

test("history source content is escaped, unsafe links excluded and raw abstracts not rendered", () => {
  const { get } = mount(historyFixture());
  const html = get("history-cards").innerHTML;
  assert.doesNotMatch(html, /<img|<script|href="javascript:|RAW_ABSTRACT_MUST_NOT_RENDER/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Version evidence &lt;review&gt;/);
});

test("old snapshots without history retain the main view and accessible lexical candidates", () => {
  const { get } = mount();
  assert.equal(get("history-section").hidden, true);
  assert.equal(get("history-update").hidden, true);
  assert.equal(get("main-panel").hidden, false);
  assert.equal(get("lexical-section").open, true);
  assert.match(get("niche-cards").innerHTML, /sufficient topic/);
});
