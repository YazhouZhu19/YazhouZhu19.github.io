/** Controlled local, gzip-enabled, shared-bandwidth before/after audit. No external services. */
import { chromium, expect } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const after = resolve(arg("--after", "dist"));
const before = resolve(arg("--before", "/private/tmp/oevryn-loading-before/tools/research-monitor/dist"));
const output = resolve(arg("--output", "docs/loading-audit.json"));
const bodies = new Map<string, { body: Buffer; etag: string; type: string }>();
async function compressed(path: string) {
  if (!bodies.has(path)) {
    const source = await readFile(path);
    bodies.set(path, {
      body: gzipSync(source, { level: 9 }),
      etag: `"${createHash("sha256").update(source).digest("hex")}"`,
      type:
        (
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".html": "text/html",
          } as Record<string, string>
        )[extname(path)] ?? "application/octet-stream",
    });
  }
  return bodies.get(path)!;
}
const manifest = JSON.parse(await readFile(resolve(after, "data/public-papers-v3.json"), "utf8"));
for (const file of [
  "data/public-papers-v3.json",
  "data/paper-overview.json",
  ...manifest.shards.map((s: { path: string }) => `data/${s.path}`),
])
  await compressed(resolve(after, file));
for (const root of [before, after]) {
  for (const name of await readdir(resolve(root, "assets")))
    if (/\.(css|js)$/.test(name)) await compressed(resolve(root, "assets", name));
  await compressed(resolve(root, "index.html"));
}
function server(root: string) {
  let bytes = 0;
  let paths: string[] = [];
  const queue: { response: ServerResponse; body: Buffer; offset: number }[] = [];
  const timer = setInterval(() => {
    const entry = queue.shift();
    if (!entry) return;
    if (entry.response.destroyed) return;
    const end = Math.min(entry.offset + 8192, entry.body.length);
    entry.response.write(entry.body.subarray(entry.offset, end));
    bytes += end - entry.offset;
    entry.offset = end;
    if (end === entry.body.length) entry.response.end();
    else queue.push(entry);
  }, 16);
  const http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, "http://localhost");
      const relative = url.pathname.replace(/^\/research-monitor\//, "") || "index.html";
      if (relative.includes("..") || relative.startsWith("/")) {
        response.writeHead(404).end();
        return;
      }
      const path = resolve(
        relative.startsWith("data/") ? after : root,
        relative.endsWith("/") ? relative + "index.html" : relative,
      );
      const value = await compressed(path);
      paths.push(url.pathname);
      setTimeout(() => {
        if (response.destroyed) return;
        response.setHeader("ETag", value.etag);
        response.setHeader("Cache-Control", "public, max-age=3600");
        if (request.headers["if-none-match"] === value.etag) {
          response.writeHead(304).end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": value.type,
          "Content-Encoding": "gzip",
          "Content-Length": value.body.length,
        });
        queue.push({ response, body: value.body, offset: 0 });
      }, 80);
    } catch {
      response.writeHead(404).end();
    }
  });
  return {
    http,
    reset() {
      bytes = 0;
      paths = [];
    },
    stats: () => ({ wireBodyBytes: bytes, requests: paths }),
    close: () =>
      new Promise<void>((done) => {
        clearInterval(timer);
        http.close(() => done());
      }),
  };
}
const browser = await chromium.launch();
const results: unknown[] = [];
try {
  for (const [label, root] of [
    ["before", before],
    ["after", after],
  ]) {
    const host = server(root);
    await new Promise<void>((done) => host.http.listen(0, "127.0.0.1", done));
    const address = host.http.address() as { port: number };
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (new URL(r.url()).hostname !== "127.0.0.1") errors.push(`External request: ${r.url()}`);
    });
    await page.addInitScript(() => {
      const tasks: number[] = [];
      Object.assign(window, { __loadingLongTasks: tasks });
      new PerformanceObserver((list) => {
        for (const item of list.getEntries()) tasks.push(item.duration);
      }).observe({ type: "longtask", buffered: true });
    });
    for (const state of ["cold", "warm"]) {
      host.reset();
      const start = performance.now();
      await page.goto(`http://127.0.0.1:${address.port}/research-monitor/`);
      await expect(page.locator(".dash-metric-primary strong")).toHaveText(/[1-9]/, { timeout: 180000 });
      await page.getByRole("combobox", { name: "仪表盘感兴趣方向", exact: true }).focus();
      const result = {
        version: label,
        cache: state,
        readyMs: Math.round(performance.now() - start),
        count: await page.locator(".dash-metric-primary strong").innerText(),
        ...host.stats(),
        longTasks: await page.evaluate(() => (window as any).__loadingLongTasks),
        errors: [...errors],
      };
      results.push(result);
      console.log(
        JSON.stringify({
          version: label,
          cache: state,
          readyMs: result.readyMs,
          wireBodyBytes: result.wireBodyBytes,
          count: result.count,
        }),
      );
      if (errors.length) throw new Error(errors.join("\n"));
    }
    await context.close();
    await host.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        browser: browser.version(),
        papers: manifest.totalStored,
        conditions:
          "Local gzip level 9; aggregate server budget 8192 bytes every 16 ms (~4 Mbps), 80 ms response latency; same full dataset; normal CPU; one cold and one warm navigation per version. Laboratory measurements, not Internet latency or field percentiles.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
