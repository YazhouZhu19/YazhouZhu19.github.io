import { test, expect, openHome } from "./test-support";

test("paper-code retrieval separates candidates, filters results and stays local", async ({ page }, info) => {
  const en = info.project.name === "en";
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/ai-worker|web-llm|webllm|\/assets\/lib-/.test(r.url())) requests.push(r.url());
  });
  await openHome(page);
  await page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: en ? "Analysis" : "分析", exact: true })
    .click();
  const panel = page.locator(".paper-code-links");
  await panel.locator(":scope > summary").click();
  await panel
    .getByRole("button", { name: en ? "Find code associations" : "查找代码关联", exact: true })
    .click();
  await expect(panel.locator(".paper-code-stats")).toBeVisible();
  await panel.getByRole("combobox").selectOption("candidate");
  await expect(panel.locator(".paper-code-row").first()).toBeVisible();
  await panel.locator(".paper-code-row details > summary").first().click();
  await expect(panel.locator(".paper-code-row details").first()).toContainText("BM25");
  await expect(panel.locator(".paper-code-row details").first()).toContainText(
    en ? "Shared terms:" : "匹配词：",
  );
  await panel.getByRole("textbox").fill("a-query-that-cannot-match-any-result");
  await expect(panel.locator(".paper-code-row")).toHaveCount(0);
  await panel.getByRole("textbox").fill("");
  await panel.getByRole("combobox").selectOption("explicit");
  // This fixture deliberately contains no DOI/arXiv/repository link from a paper.
  await expect(panel.locator(".paper-code-row")).toHaveCount(0);
  await panel.getByRole("combobox").selectOption("all");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toEqual([]);
});

test("paper-code worker failure can be retried", async ({ page }, info) => {
  const en = info.project.name === "en";
  let fail = true;
  await page.route("**/assets/paper-code-links-worker-*.js", (route) =>
    fail ? route.abort("failed") : route.continue(),
  );
  await openHome(page);
  await page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: en ? "Analysis" : "分析", exact: true })
    .click();
  const panel = page.locator(".paper-code-links");
  await panel.locator(":scope > summary").click();
  const run = panel.getByRole("button", {
    name: en ? "Find code associations" : "查找代码关联",
    exact: true,
  });
  await run.click();
  await expect(panel.getByRole("alert")).toBeVisible();
  fail = false;
  await run.click();
  await expect(panel.locator(".paper-code-stats")).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
});
