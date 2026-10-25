import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type AuditEvent = {
  interactionId: number;
  name: string;
  duration: number;
  startTime: number;
  processingStart: number;
  processingEnd: number;
};

const arg = (name: string, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const base = new URL(arg("--url", "http://127.0.0.1:4173/research-monitor/"));
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  throw new Error("Full-data audit only supports a local preview URL.");
const minPapers = Number(arg("--min-papers", "8000"));
if (!Number.isSafeInteger(minPapers) || minPapers < 1000)
  throw new Error("A full-data audit requires at least 1,000 papers; fixture scores are not accepted.");
const output = resolve(arg("--output", "docs/screenshots"));
const browser = await chromium.launch();
const blocked: string[] = [];
const errors: string[] = [];
const results: unknown[] = [];
const screenshots: unknown[] = [];
const routes = {
  home: "/papers/overview",
  library: "/papers/library",
  github: "/github",
  news: "/news",
  outlook: "/outlook",
  teams: "/teams",
};
const views = arg("--views", "home").split(",");
if (views.some((view) => !(view in routes))) throw new Error("Unknown screenshot view.");
await mkdir(output, { recursive: true });
try {
  for (const locale of ["zh", "en"] as const) {
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === base.origin) await route.continue();
      else {
        blocked.push(route.request().url());
        await route.abort("blockedbyclient");
      }
    });
    const manifestResponse = await context.request.get(new URL("data/public-papers-v3.json", base).href);
    const manifest = await manifestResponse.json();
    if (!manifestResponse.ok() || manifest.totalStored < minPapers)
      throw new Error(`Expected >= ${minPapers} real papers; found ${manifest.totalStored}.`);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const url = new URL(locale === "en" ? "en/" : "./", base);
    await page.addInitScript(() => {
      const entries: AuditEvent[] = [];
      const longTasks: { duration: number; startTime: number }[] = [];
      Object.assign(window, { __auditEvents: entries, __auditLongTasks: longTasks });
      new PerformanceObserver((list) => {
        for (const raw of list.getEntries()) {
          const entry = raw as PerformanceEventTiming & { interactionId: number };
          if (entry.interactionId)
            entries.push({
              interactionId: entry.interactionId,
              name: entry.name,
              duration: entry.duration,
              startTime: entry.startTime,
              processingStart: entry.processingStart,
              processingEnd: entry.processingEnd,
            });
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          longTasks.push({ duration: entry.duration, startTime: entry.startTime });
      }).observe({ type: "longtask", buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(url.href);
    await page.locator(".dash-metric-primary strong").waitFor();
    const directionChanges: {
      view: string;
      selection: string;
      input: string;
      measurementNote?: string;
      start: number;
      end: number;
    }[] = [];
    const selectDirection = async (view: "dashboard" | "library", all: boolean) => {
      const control = page.getByRole("combobox", {
        name:
          view === "dashboard"
            ? locale === "en"
              ? "Dashboard research interests"
              : "仪表盘感兴趣方向"
            : locale === "en"
              ? "Interest area"
              : "感兴趣方向筛选",
        exact: true,
      });
      const selection = all
        ? locale === "en"
          ? "All research interests"
          : "全部感兴趣方向"
        : locale === "en"
          ? "Organ & Lesion Segmentation"
          : "器官与病灶分割";
      const native = await control.evaluate((element) => element.tagName === "SELECT");
      if (native) await control.focus();
      const start = await page.evaluate(() => performance.now());
      let input = native ? "keyboard" : "pointer";
      let measurementNote: string | undefined;
      if (native) {
        // All and segmentation are adjacent options. Trusted keyboard input produces Event Timing;
        // selectOption dispatches synthetic input and cannot establish an interaction latency.
        await expect(control).toHaveValue(all ? "segmentation" : "all");
        await control.press("Space");
        await page.keyboard.press(all ? "ArrowUp" : "ArrowDown");
        await page.keyboard.press("Enter");
        if ((await control.inputValue()) !== (all ? "all" : "segmentation")) {
          input = "synthetic-fallback";
          measurementNote =
            "This headless environment did not commit native keyboard selection. Synthetic selection continues functional checks; its interaction latency is unverified.";
          await control.selectOption(all ? "all" : "segmentation");
        }
        await expect(control).toHaveValue(all ? "all" : "segmentation");
      } else {
        await control.click();
        await page.getByRole("option", { name: selection, exact: true }).click();
        await expect(control).toContainText(selection);
      }
      const end = await page.evaluate(
        () =>
          new Promise<number>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now()))),
          ),
      );
      directionChanges.push({ view, selection, input, measurementNote, start, end });
    };
    await selectDirection("dashboard", false);
    await selectDirection("dashboard", true);
    const title = locale === "en" ? /^Paper library/ : /^论文库/;
    await page.getByRole("button", { name: title }).click();
    await page.locator(".paper-row").first().waitFor();
    await selectDirection("library", false);
    await selectDirection("library", true);
    const search = page.getByRole("textbox", {
      name: locale === "en" ? "Search papers" : "搜索论文",
      exact: true,
    });
    await search.fill("segmentation");
    await page.locator(".paper-row").first().waitFor();
    await page.locator(".paper-title").first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: locale === "en" ? "Overview" : "统计总览", exact: true }).click();
    await page
      .locator(".dash-interests")
      .getByRole("button", { name: /分割|segmentation/i })
      .first()
      .click();
    await page.locator(".dash-drill-banner").waitFor();
    await page
      .getByRole("button", { name: locale === "en" ? "Back to overview" : "返回统计总览", exact: true })
      .click();
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    );
    const measurements = await page.evaluate(() => ({
      events: (window as any).__auditEvents as AuditEvent[],
      longTasks: (window as any).__auditLongTasks,
    }));
    const interactions = new Map<number, number>();
    for (const event of measurements.events)
      interactions.set(
        event.interactionId,
        Math.max(interactions.get(event.interactionId) ?? 0, event.duration),
      );
    const candidate = interactions.size ? Math.max(...interactions.values()) : null;
    const entryScripts = await page
      .locator("script[src]")
      .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src));
    const directionMeasurements = directionChanges.map((change) => {
      const events = measurements.events.filter(
        (event) => event.startTime >= change.start && event.startTime <= change.end,
      );
      const measured = change.input !== "synthetic-fallback" && events.length > 0;
      return {
        ...change,
        maxEventDurationMs: measured ? Math.max(...events.map((event) => event.duration)) : null,
      };
    });
    const coverageIncomplete = directionMeasurements.some((change) => change.maxEventDurationMs === null);
    results.push({
      locale,
      entryScripts,
      dataset: "full local published snapshot",
      totalStored: manifest.totalStored,
      cpuSlowdown: 4,
      sampledInteractions: interactions.size,
      labInpCandidateMs: candidate,
      coverageIncomplete,
      under200ms: candidate === null || coverageIncomplete ? null : candidate < 200,
      directionChanges: directionMeasurements,
      note: "Event Timing worst sampled interaction (<50 interactions); a lab INP candidate, not field INP. Events below 16ms may not be reported.",
      ...measurements,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    if (process.argv.includes("--skip-screenshots")) {
      await context.close();
      continue;
    }
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const width of [375, 768, 1280, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of views) {
          url.hash = routes[view as keyof typeof routes];
          await page.goto(url.href);
          await page.locator("h1").waitFor();
          await page
            .locator(".compact-freshness")
            .getByText(/Data updated|数据截至/)
            .waitFor();
          const markers: Record<string, string> = {
            home: ".dash-metric-primary strong",
            library: ".paper-row",
            github: ".github-dashboard-summary",
            news: ".news-dashboard-summary",
            outlook: ".foresight-view",
            teams: ".team-foresight",
          };
          await page.locator(markers[view]).first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          const filename = `${locale}-${view}-${width}-${theme}.png`;
          await page.screenshot({ path: resolve(output, filename), animations: "disabled", fullPage: false });
          console.log(`Saved ${filename} (${manifest.totalStored} papers).`);
          screenshots.push({
            filename,
            locale,
            view,
            theme,
            width,
            height: 900,
            totalStored: manifest.totalStored,
          });
        }
      }
    }
    await context.close();
  }
  await writeFile(
    resolve(output, "full-data-audit.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        browserVersion: browser.version(),
        origin: base.origin,
        baseURL: base.href,
        results,
        screenshots,
        blocked,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  if (blocked.length || errors.length)
    throw new Error("Full-data audit found external requests or application errors.");
  console.log(JSON.stringify({ results, screenshotCount: screenshots.length }, null, 2));
} finally {
  await browser.close();
}
