import type { Page } from "@playwright/test";
import { test, expect, mainView } from "./test-support";

type Source = "github" | "news";
const year = new Date().getUTCFullYear();
const from = `${year - 1}-01-01`;
const to = `${year + 1}-12-31`;
const routes: Record<Source, string> = {
  github: `#/github?tab=library&category=diagnostic-tasks&relevance=direct&range=custom&from=${from}&to=${to}&clock=creation&sort=stars&q=Atlas&early=1`,
  news: "#/news?tab=library&range=90&clock=discovery&sort=oldest&group=0&q=Atlas",
};

async function restored(page: Page, source: Source, en: boolean, tab = "library") {
  const github = source === "github";
  const choice = (zh: string, english: string) =>
    page.getByRole("combobox", { name: en ? english : zh, exact: true });
  await expect(choice("统计时间", "Time range")).toHaveValue(github ? "custom" : "90");
  await expect(choice("日期口径", "Date basis")).toHaveValue(github ? "creation" : "discovery");
  await expect(choice("研究方向", "Research area")).toHaveValue(github ? "diagnostic-tasks" : "all");
  await expect(choice("相关性", "Relevance")).toHaveValue(github ? "direct" : "all");
  await expect(choice("列表排序", "Library sort")).toHaveValue(github ? "stars" : "oldest");
  await expect(
    page.getByRole("searchbox", {
      name: github ? (en ? "Search repositories" : "搜索项目") : en ? "Search announcements" : "搜索公开消息",
      exact: true,
    }),
  ).toHaveValue("Atlas");
  const tabName = github ? (en ? /^Repository library/ : /^项目库/) : en ? /^News library/ : /^新闻库/;
  await expect(
    page.locator(".signals-dashboard-tabs").getByRole("button", { name: tabName }),
  ).toHaveAttribute("aria-pressed", String(tab === "library"));
  if (github) {
    await expect(page.getByLabel(en ? "From" : "起始日期", { exact: true })).toHaveValue(from);
    await expect(page.getByLabel(en ? "To" : "截止日期", { exact: true })).toHaveValue(to);
    expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("early")).toBe("1");
  } else {
    await expect(
      page.getByRole("checkbox", { name: en ? "Group by event" : "按事件整理", exact: true }),
    ).not.toBeChecked();
  }
}

for (const source of ["github", "news"] as const) {
  test(`${source} share URL restores filters through navigation, history and language switch`, async ({
    page,
    context,
  }, testInfo) => {
    const en = testInfo.project.name === "en";
    await page.goto(`./${routes[source]}`);
    await restored(page, source, en);
    const sharedURL = page.url();

    await mainView(page, en, 0);
    await page.goBack();
    await restored(page, source, en);
    await page.goForward();
    await expect(page.locator(".research-dashboard")).toBeVisible();
    await page.goBack();
    await restored(page, source, en);

    const shared = await context.newPage();
    await shared.goto(sharedURL);
    await restored(shared, source, en);
    await shared.close();

    const beforeLanguage = new URL(page.url()).hash;
    await page
      .locator(".language-switch")
      .getByRole("link", { name: en ? "中文" : "EN", exact: true })
      .click();
    await restored(page, source, !en);
    expect(new URL(page.url()).hash).toBe(beforeLanguage);
    expect(new URL(page.url()).pathname).toBe(en ? "/research-monitor/" : "/research-monitor/en/");

    if (source === "github") {
      await page
        .locator(".signals-dashboard-tabs")
        .getByRole("button", { name: en ? "统计总览" : "Overview", exact: true })
        .click();
      await page.locator(".github-research-dashboard .dash-metric").first().click();
      await expect(page.locator(".signals-dashboard-drill")).toBeVisible();
      expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).has("drill")).toBeTruthy();
      const freshDrill = await context.newPage();
      await freshDrill.goto(page.url());
      await restored(freshDrill, source, !en, "overview");
      await expect(freshDrill.locator(".signals-dashboard-drill")).toHaveCount(0);
      const freshParams = new URLSearchParams(new URL(freshDrill.url()).hash.split("?")[1]);
      expect(freshParams.has("drill")).toBeFalsy();
      expect(freshParams.has("ids")).toBeFalsy();
      await freshDrill.close();
    }
  });
}

async function restoredAuthor(page: Page, en: boolean) {
  await expect(
    page.getByRole("combobox", { name: en ? "Research direction" : "研究方向", exact: true }),
  ).toHaveValue("segmentation");
  await expect(
    page.getByRole("combobox", { name: en ? "Sort authors" : "排序方式", exact: true }),
  ).toHaveValue("works");
  await expect(
    page.getByRole("textbox", {
      name: en ? "Find a name, ORCID or affiliation" : "查找姓名、ORCID 或署名机构",
      exact: true,
    }),
  ).toHaveValue("Alex");
  await expect(page.locator(".team-author-candidates .is-selected")).toContainText("Alex Example");
  await expect(page.locator(".team-assessment-heading h3")).toHaveText("Alex Example");
  await expect(page.locator(".ai-analysis-actions button[type=submit]")).toHaveText(
    en ? "Analyze with free AI" : "免费 AI 分析",
  );
  await expect(page.locator(".ai-result")).toHaveCount(0);
  const params = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
  expect(params.get("author")).toBe("directory:name:alexexample");
  expect([...params.keys()].sort()).toEqual(["author", "q", "sort", "track"]);
}

test("public author URL restores directory selection without starting AI", async ({
  page,
  context,
}, testInfo) => {
  const en = testInfo.project.name === "en";
  await page.goto("./#/teams?track=segmentation&sort=works&q=Alex&author=directory%3Aname%3Aalexexample");
  await restoredAuthor(page, en);
  const sharedURL = page.url();
  await mainView(page, en, 0);
  await page.goBack();
  await restoredAuthor(page, en);
  const shared = await context.newPage();
  await shared.goto(sharedURL);
  await restoredAuthor(shared, en);
  await shared.close();
});
