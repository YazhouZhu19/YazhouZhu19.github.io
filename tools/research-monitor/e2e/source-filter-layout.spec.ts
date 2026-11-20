import type { Page } from "@playwright/test";
import { test, expect, navLabels } from "./test-support";

type Source = "github" | "news";
type Theme = "light" | "dark";

async function navigate(page: Page, source: Source, en: boolean) {
  const index = source === "github" ? 1 : 2;
  const desktop = page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: navLabels(en)[index], exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else {
    await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    const sidebar = page.getByRole("dialog");
    await sidebar.getByRole("button", { name: navLabels(en)[index], exact: true }).click();
    await expect(sidebar).not.toBeVisible();
  }
  await expect(page.locator(`.${source}-dashboard-summary`)).toBeVisible();
}

async function filterLayout(page: Page, source: Source) {
  const root = page.locator(`.${source}-signals`);
  await expect(root.locator(`.${source}-dashboard-summary`)).toBeVisible();
  const search = root.locator(".source-search-controls");
  if ((await search.getAttribute("open")) === null) await search.locator("summary").click();
  await expect(search.locator("input")).toBeVisible();
  await expect(page.locator(".page-heading h1")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return root.evaluate((element) => {
    const bodyStyle = getComputedStyle(document.body);
    const headingStyle = getComputedStyle(document.querySelector(".page-heading h1")!);
    const controlStyle = getComputedStyle(element.querySelector(".signals-filters select")!);
    const metricStyle = getComputedStyle(element.querySelector(".dash-metric")!);
    const dimensions = (selector: string, fixedFilters = false) => {
      const grid = element.querySelector<HTMLElement>(selector)!;
      const bounds = grid.getBoundingClientRect();
      const rounded = (value: number) => Math.round(value * 10) / 10;
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        width: rounded(bounds.width),
        // The comparison CTA depends on recordsLoaded; compare the four fixed
        // filters without the CTA or its extra row, while retaining full search geometry.
        ...(!fixedFilters ? { height: rounded(bounds.height) } : {}),
        controls: (fixedFilters
          ? [...grid.querySelectorAll(":scope > .dash-control")]
          : [...grid.children]
        ).map((child) => {
          const box = child.getBoundingClientRect();
          return {
            x: rounded(box.x - bounds.x),
            y: rounded(box.y - bounds.y),
            width: rounded(box.width),
            height: rounded(box.height),
          };
        }),
      };
    };
    return {
      primary: dimensions(".source-filter-toolbar", true),
      search: dimensions(".source-search-controls .signals-filter-toolbar"),
      values: [...element.querySelectorAll<HTMLSelectElement>(".signals-filters select")].map(
        (select) => select.value,
      ),
      query: element.querySelector<HTMLInputElement>(".source-search-controls input")!.value,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      visual: {
        bodyFont: bodyStyle.fontFamily,
        headingFont: headingStyle.fontFamily,
        controlFont: controlStyle.fontFamily,
        headingWeight: headingStyle.fontWeight,
        background: bodyStyle.backgroundColor,
        foreground: bodyStyle.color,
        primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
        metricRadius: metricStyle.borderTopLeftRadius,
        metricShadow: metricStyle.boxShadow,
      },
    };
  });
}

function expectLayout(layout: Awaited<ReturnType<typeof filterLayout>>, width: number, theme: Theme) {
  expect(layout.primary.columns).toBe(width > 1200 ? 5 : 2);
  expect(layout.primary.controls).toHaveLength(4);
  expect(layout.search.columns).toBe(width > 600 ? 2 : 1);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  for (const font of [layout.visual.bodyFont, layout.visual.headingFont, layout.visual.controlFont]) {
    expect(font).toContain("Georgia");
    expect(font).toMatch(/,\s*serif$/);
  }
  expect(layout.visual).toMatchObject({
    headingWeight: "450",
    background: theme === "light" ? "rgb(249, 249, 248)" : "rgb(17, 17, 16)",
    foreground: theme === "light" ? "rgb(33, 32, 28)" : "rgb(238, 238, 236)",
    primary: theme === "light" ? "#2c5d48" : "#61d0b4",
    metricRadius: "0px",
    metricShadow: "none",
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 820, 390]) {
    test(`source filters keep their layout after navigation at ${width}px in ${theme} mode`, async ({
      page,
      context,
    }, info) => {
      const en = info.project.name === "en";
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.goto("./#/news");
      const coldNews = await filterLayout(page, "news");
      expectLayout(coldNews, width, theme);
      expect(coldNews.values).toEqual(["30", "publication", "all", "all", "latest"]);
      expect(coldNews.query).toBe("");

      await navigate(page, "github", en);
      const githubAfterNews = await filterLayout(page, "github");
      expectLayout(githubAfterNews, width, theme);
      await navigate(page, "news", en);
      const returningNews = await filterLayout(page, "news");
      expect(returningNews).toEqual(coldNews);

      // A new document has no previously injected news/GitHub lazy CSS.
      const fresh = await context.newPage();
      await fresh.setViewportSize({ width, height: 1000 });
      await fresh.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await fresh.goto("./#/github");
      const coldGithub = await filterLayout(fresh, "github");
      expect(coldGithub).toEqual(githubAfterNews);
      await navigate(fresh, "news", en);
      const newsAfterGithub = await filterLayout(fresh, "news");
      expect(newsAfterGithub).toEqual(coldNews);
      await info.attach(`source-filter-layout-${width}-${theme}.json`, {
        body: JSON.stringify(
          { coldNews, returningNews, coldGithub, githubAfterNews, newsAfterGithub },
          null,
          2,
        ),
        contentType: "application/json",
      });
      await fresh.close();
    });
  }

  test(`source filters switch at the intended responsive boundaries in ${theme} mode`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    const layouts = [];
    for (const source of ["news", "github"] as const) {
      await page.setViewportSize({ width: 1201, height: 1000 });
      await page.goto(`./#/${source}`);
      for (const width of [1201, 1200, 601, 600]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await filterLayout(page, source);
        expectLayout(layout, width, theme);
        layouts.push({ source, width, layout });
      }
    }
    await info.attach(`source-filter-boundaries-${theme}.json`, {
      body: JSON.stringify(layouts, null, 2),
      contentType: "application/json",
    });
  });
}
