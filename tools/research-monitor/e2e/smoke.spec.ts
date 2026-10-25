import { test, expect, openHome, openLibrary, mainView } from "./test-support";

test("home loads local snapshot and shows metric cards", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openHome(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    testInfo.project.name === "en" ? "Paper insights" : "论文洞察",
  );
  expect(requests.some((url) => url.includes("/public-papers-v3.json"))).toBeTruthy();
  expect(requests.some((url) => url.includes("/signals-v2/"))).toBeFalsy();
});

test("five main entries load, including lazy signals v2", async ({ page }, testInfo) => {
  const en = testInfo.project.name === "en";
  const responses: string[] = [];
  page.on("response", (response) => {
    if (response.ok()) responses.push(response.url());
  });
  await openHome(page);
  for (let i = 0; i < 5; i++) {
    await mainView(page, en, i);
    if (i === 1 || i === 2) {
      const label = i === 1 ? (en ? "Repository library" : "项目库") : en ? "News library" : "新闻库";
      await page
        .locator(".signals-dashboard-tabs")
        .getByRole("button", { name: new RegExp(`^${label}`) })
        .click();
      await expect
        .poll(() => responses.filter((url) => /\/signals-v2\/shards\/.*\.json/.test(url)).length)
        .toBeGreaterThan(i - 1);
      if (i === 2) {
        const event = page.locator(".news-event-card").first();
        await event.locator("summary").click();
        await expect(event.locator(".news-event-reports .signal-card").first()).toBeVisible();
        await expect(
          event.getByRole("link", { name: en ? "Read original" : "查看原文", exact: true }).first(),
        ).toHaveAttribute("href", /^https:\/\/example\.org\//);
      }
    }
  }
  expect(responses.some((url) => url.includes("/signals-v2/manifest.json"))).toBeTruthy();
  expect(responses.some((url) => /\/signals-v2\/shards\/.*\.json/.test(url))).toBeTruthy();
});

test("library search opens original paper details", async ({ page }, testInfo) => {
  const en = testInfo.project.name === "en";
  await openHome(page);
  await openLibrary(page, en);
  await page.getByRole("textbox", { name: en ? "Search papers" : "搜索论文", exact: true }).fill("Atlas");
  await expect(page.locator(".paper-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Atlas interactive segmentation", exact: true }).click();
  const detail = page.getByRole("dialog");
  await expect(
    detail.getByRole("heading", { name: "Atlas interactive segmentation", exact: true }),
  ).toBeVisible();
  await expect(detail).toContainText("Radiologists correct masks with clicks");
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(detail).not.toBeVisible();
});

test("chart drill keeps its ID set through history and returns to overview", async ({ page }, testInfo) => {
  const en = testInfo.project.name === "en";
  await openHome(page);
  await page
    .locator(".dash-interests")
    .getByRole("button", { name: /分割|segmentation/i })
    .first()
    .click();
  await expect(page.locator(".dash-drill-banner")).toBeVisible();
  await expect(page.locator(".paper-row").first()).toBeVisible();
  const label = await page.locator(".dash-drill-banner strong").innerText();
  const count = await page.locator(".paper-row").count();
  expect(count).toBeGreaterThan(0);
  await mainView(page, en, 1);
  await page.goBack();
  await expect(page.locator(".dash-drill-banner strong")).toHaveText(label);
  await expect(page.locator(".paper-row")).toHaveCount(count);
  await page.getByRole("button", { name: en ? "Back to overview" : "返回统计总览", exact: true }).click();
  await expect(page.locator(".research-dashboard")).toBeVisible();
});

test("hash restores search and browser back/forward restores the view", async ({
  page,
  context,
}, testInfo) => {
  const en = testInfo.project.name === "en";
  await page.goto("./#/papers/library?track=segmentation&days=all&q=Atlas&scope=all");
  const search = page.getByRole("textbox", { name: en ? "Search papers" : "搜索论文", exact: true });
  await expect(search).toHaveValue("Atlas");
  await expect(page.locator(".paper-row")).toHaveCount(1);
  const shareURL = page.url();
  await mainView(page, en, 1);
  await page.goBack();
  await expect(search).toHaveValue("Atlas");
  await expect(page.locator(".paper-row")).toHaveCount(1);
  await page.goForward();
  await expect(page.locator(".github-dashboard-summary")).toBeVisible();
  const shared = await context.newPage();
  await shared.goto(shareURL);
  await expect(
    shared.getByRole("textbox", { name: en ? "Search papers" : "搜索论文", exact: true }),
  ).toHaveValue("Atlas");
  await expect(shared.locator(".paper-row")).toHaveCount(1);
  await shared.close();
});
