import { test, expect, openHome, openLibrary } from "./test-support";

test("screening compares selected papers, explains evidence and invalidates changed inputs", async ({
  page,
}, info) => {
  const en = info.project.name === "en";
  await openHome(page);
  await openLibrary(page, en);
  await page
    .getByRole("textbox", { name: en ? "Search papers" : "搜索论文", exact: true })
    .fill("Atlas interactive segmentation");
  await expect(page.locator(".paper-row")).toHaveCount(1);
  const panel = page.getByRole("region", { name: en ? "Information screening" : "信息筛选", exact: true });
  await panel.getByRole("button", { name: en ? "Information screening" : "信息筛选", exact: true }).click();
  const run = panel.getByRole("button", { name: en ? "Run comparison" : "开始比对", exact: true });
  await run.click();
  await expect(panel.locator(".screening-result")).toHaveCount(1);
  await expect(panel.locator(".screening-statuses")).toContainText(
    en ? "Cross-source check incomplete" : "跨源检查未完成",
  );
  await panel.locator("summary").click();
  await expect(panel.locator(".screening-evidence")).toHaveCount(4);
  await expect(panel.locator("blockquote").first()).toBeVisible();
  await expect(panel.locator(".screening-chain")).toHaveCount(3);
  await expect(panel.locator(".screening-chain > section")).toHaveCount(6);
  await expect(panel.locator(".screening-chain").first()).toContainText(
    en ? "research question/objective" : "研究问题／目标",
  );
  await panel.getByRole("button", { name: en ? "Load source records" : "载入跨源资料", exact: true }).click();
  await expect(panel.locator(".screening-sources")).toContainText(en ? "News loaded" : "资讯 已载入");
  await expect(panel.locator(".screening-result")).toHaveCount(0);
  await run.click();
  await expect(panel.locator(".screening-result")).toHaveCount(1);
  await panel
    .getByRole("combobox", { name: en ? "Cross-source links" : "跨来源关联", exact: true })
    .selectOption("linked");
  await expect(panel.locator(".screening-result")).toHaveCount(1);
  await panel.locator("summary").click();
  await expect(panel.locator(".screening-reference")).not.toHaveCount(0);
  await panel.screenshot({ path: `test-results/information-screening-desktop-${info.project.name}.png` });
  await panel.getByRole("button", { name: "Atlas interactive segmentation", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await panel.getByLabel(en ? "Collection window start (UTC)" : "收录观察起点（UTC）").fill("2020-01-01");
  await expect(panel.locator(".screening-result")).toHaveCount(0);
});

test("source failure remains incomplete and can be retried; mobile layout stays bounded", async ({
  page,
}, info) => {
  const en = info.project.name === "en";
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route("**/data/signals-v2/**", (route) =>
    fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue(),
  );
  await openHome(page);
  await openLibrary(page, en);
  const panel = page.getByRole("region", { name: en ? "Information screening" : "信息筛选", exact: true });
  await panel.getByRole("button", { name: en ? "Information screening" : "信息筛选", exact: true }).click();
  await panel.getByRole("button", { name: en ? "Load source records" : "载入跨源资料", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    en ? "Some sources could not load" : "部分来源载入失败",
  );
  await panel.getByRole("button", { name: en ? "Run comparison" : "开始比对", exact: true }).click();
  await expect(panel.locator(".screening-result").first()).toBeVisible();
  await expect(panel.locator(".screening-statuses").first()).toContainText(
    en ? "Cross-source check incomplete" : "跨源检查未完成",
  );
  fail = false;
  await panel.getByRole("button", { name: en ? "Load source records" : "载入跨源资料", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.locator(".screening-sources")).toContainText(en ? "News loaded" : "资讯 已载入");
  await panel.getByRole("button", { name: en ? "Run comparison" : "开始比对", exact: true }).click();
  await expect(panel.locator(".screening-result").first()).toBeVisible();
  await panel.locator("summary").first().click();
  const chain = panel.locator(".screening-chain").first();
  await expect(chain).toBeVisible();
  const sides = chain.locator(":scope > section");
  const before = await sides.nth(0).boundingBox();
  const after = await sides.nth(1).boundingBox();
  expect(after!.y).toBeGreaterThanOrEqual(before!.y + before!.height);
  const bounds = await panel.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: `test-results/information-screening-mobile-${info.project.name}.png`,
    fullPage: true,
  });
});
