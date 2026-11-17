import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { analysisPreload, analysisPreloadScript, collectAnalysisPreloads } from "../scripts/analysis-preload";

type Link = {
  rel: string;
  href: string;
  as?: string;
  crossOrigin?: string;
  fetchPriority?: string;
  isConnected: boolean;
  getAttribute: (attribute: string) => string;
  error?: () => void;
  addEventListener: (event: string, callback: () => void) => void;
  remove: () => void;
};
function execute(script: string, hash: string, page = "https://web.example/research-monitor/") {
  const links: Link[] = [];
  const calls: { url: string; options: RequestInit }[] = [];
  const events: string[] = [];
  const response = new Response("{}", { headers: { "content-type": "application/json" } });
  const promise = Promise.resolve(response);
  const window: {
    __oevrynAnalysisBootstrap?: { url: string; promise: Promise<Response>; controller: AbortController };
  } = {};
  const context = {
    location: { href: page + hash, hash },
    URL,
    AbortController,
    window,
    fetch(url: string, options: RequestInit) {
      events.push("fetch");
      calls.push({ url, options });
      return promise;
    },
    document: {
      readyState: "loading",
      getElementsByTagName(tag: string) {
        assert.equal(tag, "link");
        return links;
      },
      createElement(tag: string) {
        assert.equal(tag, "link", "preloads never execute a script element");
        let href = "";
        const link: Link = {
          rel: "",
          get href() {
            return new URL(href, page + hash).href;
          },
          set href(value) {
            href = value;
          },
          getAttribute(attribute) {
            assert.equal(attribute, "href");
            return href;
          },
          isConnected: false,
          addEventListener(event, callback) {
            assert.equal(event, "error");
            link.error = callback;
          },
          remove() {
            const index = links.indexOf(link);
            if (index >= 0) links.splice(index, 1);
            link.isConnected = false;
          },
        };
        return link;
      },
      head: {
        appendChild(link: Link) {
          events.push(link.rel);
          const index = links.indexOf(link);
          if (index >= 0) links.splice(index, 1);
          link.isConnected = true;
          links.push(link);
        },
      },
    },
  };
  const run = () => runInNewContext(script, context);
  const domReady = () => {
    context.document.readyState = "interactive";
  };
  run();
  return { links, calls, events, window, context, promise, response, run, domReady };
}

const resources = { modules: ["assets/analysis-123.js"], styles: ["assets/analysis-456.css"] };
const script = analysisPreloadScript(resources, "/research-monitor/");

test("only the current and legacy analysis routes start resources, including query parameters", () => {
  for (const hash of ["#/analysis", "#/outlook", "#/analysis?tab=niche", "#/outlook?scope=all"]) {
    for (const locale of ["", "en/"]) {
      const result = execute(script, hash, `https://web.example/research-monitor/${locale}`);
      result.domReady();
      assert.equal(result.calls.length, 1, `${locale}${hash}`);
      assert.equal(result.calls[0].url, "https://web.example/research-monitor/analysis-bootstrap-v2.json");
      assert.deepEqual(
        result.links.map(({ rel, href }) => [rel, href]),
        [
          ["preload", "https://web.example/research-monitor/assets/analysis-456.css"],
          ["modulepreload", "https://web.example/research-monitor/assets/analysis-123.js"],
        ],
      );
    }
  }
  for (const hash of [
    "",
    "#/papers/overview",
    "#/papers/leads",
    "#/analysis-extra",
    "#/analysis/",
    "#/outlooks",
    "#analysis",
  ]) {
    const result = execute(script, hash);
    assert.equal(result.calls.length, 0, hash);
    assert.equal(result.links.length, 0, hash);
    assert.equal(result.window.__oevrynAnalysisBootstrap, undefined, hash);
  }
});

test("bootstrap exposes the untouched response promise and abort controller without duplicate requests", async () => {
  const result = execute(script, "#/analysis");
  const bootstrap = result.window.__oevrynAnalysisBootstrap!;
  assert.equal(bootstrap.promise, result.promise);
  assert.equal(bootstrap.url, result.calls[0].url);
  assert.deepEqual(result.events, ["preload", "modulepreload", "fetch"]);
  assert.equal(result.calls[0].options.priority, undefined);
  assert.equal(result.links[0].fetchPriority, "high");
  assert.equal(result.calls[0].options.cache, "no-cache");
  assert.equal(result.calls[0].options.credentials, "omit");
  assert.equal(result.calls[0].options.signal, bootstrap.controller.signal);
  assert.equal(await bootstrap.promise, result.response);
  assert.equal(result.response.bodyUsed, false);
  result.run();
  assert.equal(result.calls.length, 1);
  assert.equal(result.links.length, 2);
  bootstrap.controller.abort();
  assert.equal(result.calls[0].options.signal?.aborted, true);
});

test("failed preload links are removed so the normal lazy loader can retry", () => {
  const result = execute(script, "#/analysis");
  const failed = [...result.links];
  for (const link of failed) link.error!();
  assert.equal(result.links.length, 0);
  result.domReady();
  assert.equal(result.links.length, 0, "DOMContentLoaded must not reinsert failed styles");
  result.run();
  assert.equal(result.links.length, 2);
  assert.equal(result.calls.length, 1);
});

test("module href attributes match Vite selectors; CSS activation and ordering remain with Vite", () => {
  const result = execute(script, "#/analysis");
  assert.equal(result.links[1].getAttribute("href"), "/research-monitor/assets/analysis-123.js");
  assert.equal(result.links[0].rel, "preload");
  assert.equal(result.links[0].as, "style");
  assert.equal(result.links[0].getAttribute("href"), "/research-monitor/assets/analysis-456.css");
  const main = result.context.document.createElement("link");
  main.href = "https://web.example/research-monitor/assets/main.css";
  main.rel = "stylesheet";
  result.context.document.head.appendChild(main);
  result.domReady();
  assert.deepEqual(
    result.links.filter(({ rel }) => rel === "stylesheet").map(({ href }) => href),
    [main.href],
  );
  const loaded = result.context.document.createElement("link");
  loaded.href = result.links[0].getAttribute("href");
  loaded.rel = "stylesheet";
  result.context.document.head.appendChild(loaded);
  result.run();
  assert.deepEqual(
    result.links.filter(({ rel }) => rel === "stylesheet"),
    [main, loaded],
  );
  assert.equal(result.links.filter(({ rel }) => rel === "preload").length, 1);
});

test("bootstrap rejection is handled without replacing the promise the store will claim", async () => {
  const result = execute(script, "#/papers/overview");
  const failed = Promise.reject(new Error("Offline"));
  result.context.location.hash = "#/analysis";
  result.context.fetch = () => failed;
  result.run();
  assert.equal(result.window.__oevrynAnalysisBootstrap!.promise, failed);
  // Node's test runner also treats an unhandled rejection as a test failure.
  await new Promise<void>((done) => setImmediate(done));
  await assert.rejects(failed, /Offline/);
});

test("inline JSON cannot terminate its HTML script element", () => {
  const unsafe = analysisPreloadScript(
    { modules: ["assets/a</script><script>alert(1)</script>&\u2028\u2029.js"], styles: [] },
    "/research-monitor/",
  );
  assert.doesNotMatch(unsafe, /[<\u2028\u2029]/);
  assert.match(unsafe, /\\u003e/);
  assert.match(unsafe, /\\u0026/);
  assert.equal(execute(unsafe, "#/analysis").links.length, 1);
});

test("a real Vite build injects hashed static dependencies in the head with an early charset in both locales", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "analysis-preload-test-")));
  try {
    await Promise.all(["components", "lib", "en"].map((directory) => mkdir(join(root, directory))));
    const html =
      '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/main.ts"></script></body></html>';
    const sources: Record<string, string> = {
      "index.html": html,
      "en/index.html": html.replace("<html>", '<html lang="en">'),
      "main.ts":
        'window.start=()=>Promise.all([import("./components/integrated-analysis"),import("./lib/analysis-store")]);',
      "components/integrated-analysis.tsx":
        'import { shared } from "../lib/shared"; import "./analysis.css"; export const analysis=shared; export const history=()=>import("./analysis-history-panel"); export const optional=()=>import("./optional");',
      "components/analysis-history-panel.tsx":
        'import { history } from "../lib/history"; import "./history.css"; export { history };',
      "components/optional.ts": 'export const optional="should not preload";',
      "components/analysis.css": ".analysis{color:red}",
      "components/history.css": ".history{color:blue}",
      "lib/analysis-store.ts": 'import { shared } from "./shared"; export const store=shared;',
      "lib/shared.ts": "export const shared=Math.random();",
      "lib/history.ts": "export const history=Math.random();",
    };
    await Promise.all(Object.entries(sources).map(([path, source]) => writeFile(join(root, path), source)));
    const result = await build({
      root,
      configFile: false,
      base: "/research-monitor/",
      plugins: [analysisPreload()],
      logLevel: "silent",
      build: {
        write: false,
        rolldownOptions: { input: { zh: join(root, "index.html"), en: join(root, "en/index.html") } },
      },
    });
    assert.ok(!Array.isArray(result) && "output" in result);
    const bundle = Object.fromEntries(result.output.map((file) => [file.fileName, file]));
    const actual = collectAnalysisPreloads(bundle, root);
    for (const target of ["integrated-analysis", "analysis-store", "analysis-history-panel", "shared"]) {
      assert.ok(
        actual.modules.some((file) => file.includes(`${target}-`)),
        target,
      );
    }
    assert.equal(
      actual.modules.some((file) => file.includes("optional-")),
      false,
    );
    assert.equal(actual.styles.length, 2);
    assert.ok(actual.modules.every((file) => bundle[file]?.type === "chunk"));
    assert.ok(actual.styles.every((file) => bundle[file]?.type === "asset"));
    for (const path of ["index.html", "en/index.html"]) {
      const page = bundle[path];
      assert.ok(page?.type === "asset");
      const html = String(page.source);
      const injected = html.match(/<script data-analysis-preload>([\s\S]*?)<\/script>/);
      assert.ok(injected, path);
      assert.ok(html.indexOf(injected[0]) < html.indexOf("</head>"), path);
      assert.ok(html.indexOf('charset="UTF-8"') < 1024, path);
      const observed = execute(injected[1], "#/analysis", `https://web.example/research-monitor/${path}`);
      observed.domReady();
      assert.deepEqual(
        observed.links.filter(({ rel }) => rel === "modulepreload").map(({ href }) => href),
        actual.modules.map((file) => `https://web.example/research-monitor/${file}`),
      );
      assert.deepEqual(
        observed.links.filter(({ rel }) => rel === "preload").map(({ href }) => href),
        actual.styles.map((file) => `https://web.example/research-monitor/${file}`),
      );
      assert.equal(execute(injected[1], "#/news").calls.length, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
