import type { BrowserContext } from "@playwright/test";
import { test, expect } from "./test-support";

const hostChunk = /\/assets\/notification-host-[^/]+\.js(?:\?|$)/;

async function holdNotificationHost(context: BrowserContext) {
  let release!: () => void;
  let requests = 0;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  await context.route(hostChunk, async (route) => {
    requests++;
    await blocked;
    await route.continue();
  });
  return { release, requests: () => requests };
}

test("save notifications load on demand and retain queued ordering and presentation", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const host = await holdNotificationHost(context);
  try {
    await page.goto("./#/papers/library?days=all&q=Atlas&scope=all");
    const row = page.locator(".paper-row");
    await expect(row).toHaveCount(1);
    const save = row.getByRole("button", {
      name: `${en ? "Save: " : "收藏："}Atlas interactive segmentation`,
      exact: true,
    });
    await expect(save).toBeEnabled();
    expect(host.requests()).toBe(0);
    await expect(page.locator("[data-sonner-toaster]")).toHaveCount(0);
    await save.click();
    const unsave = row.getByRole("button", {
      name: `${en ? "Unsave: " : "取消收藏："}Atlas interactive segmentation`,
      exact: true,
    });
    await expect(unsave).toBeEnabled();
    await expect.poll(host.requests).toBe(1);
    await unsave.click();
    await expect(save).toBeEnabled();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    host.release();
    const notices = page.locator("[data-sonner-toast]");
    await expect(notices).toHaveCount(2);
    await expect(notices.locator("[data-title]")).toHaveText(
      en ? ["Removed from saved research.", "Added to saved research."] : ["已取消收藏", "已加入选题收藏"],
    );
    await expect(notices.first()).toHaveAttribute("data-rich-colors", "true");
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute("data-y-position", "bottom");
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "right");
    expect(host.requests()).toBe(1);
  } finally {
    host.release();
  }
});

test("the first backup error loads the notification renderer and remains visible", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const requests: string[] = [];
  context.on("request", (request) => {
    if (hostChunk.test(request.url())) requests.push(request.url());
  });
  await page.goto("./#/analysis");
  await expect(page.locator(".analysis-history article[data-history-id]")).toHaveCount(3);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: en ? "Local data" : "本机数据", exact: true }).click();
  await page.getByLabel(en ? "Choose backup file" : "选择备份文件", { exact: true }).setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  const notice = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(en ? "Invalid backup file format." : "备份文件格式不正确");
  await expect(notice).toHaveAttribute("data-rich-colors", "true");
  expect(requests).toHaveLength(1);
});

test("a paper load completed before the slow notification host never leaves a stale loading toast", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  const host = await holdNotificationHost(context);
  try {
    await page.goto("./#/analysis");
    const analysis = page.locator(".integrated-analysis");
    await analysis
      .getByRole("button", { name: en ? "Mainstream directions" : "主流研究方向", exact: true })
      .click();
    const run = analysis.getByRole("button", {
      name: en ? "View rule analysis" : "查看规则分析",
      exact: true,
    });
    await expect(run).toBeEnabled();
    await run.click();
    await expect(analysis.locator(".integrated-directions > article")).toHaveCount(7);
    const direction = analysis.locator(".integrated-directions > article").first();
    await direction.locator(":scope > details > summary").click();
    await direction.locator(":scope > details .integrated-evidence button").first().click();
    const detail = page.getByRole("dialog");
    await expect(detail).toBeVisible();
    await expect.poll(host.requests).toBe(1);
    const save = detail.getByRole("button", {
      name: en ? "Save notes and paper" : "保存笔记与收藏",
      exact: true,
    });
    await save.click();
    await expect(save).toBeEnabled();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    host.release();
    const success = page.locator('[data-sonner-toast][data-type="success"]');
    await expect(success).toBeVisible();
    await expect(success).toContainText(en ? "Notes saved." : "笔记已保存");
    await expect(page.locator('[data-sonner-toast][data-type="loading"]')).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
    expect(host.requests()).toBe(1);
  } finally {
    host.release();
  }
});

test("an unavailable notification module keeps Analysis usable and delivers later notices", async ({
  page,
  context,
}, info) => {
  const en = info.project.name === "en";
  let requests = 0;
  await context.route(hostChunk, (route) => {
    requests++;
    return route.fulfill({ status: 503, contentType: "text/plain", body: "Temporarily unavailable" });
  });
  await page.goto("./#/analysis");
  const history = page.locator(".analysis-history article[data-history-id]");
  await expect(history).toHaveCount(3);
  await page.getByRole("button", { name: en ? "Local data" : "本机数据", exact: true }).click();
  const file = page.getByLabel(en ? "Choose backup file" : "选择备份文件", { exact: true });
  await file.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
  const fallback = page.locator(".notification-fallback");
  const error = en ? "Invalid backup file format." : "备份文件格式不正确";
  await expect(fallback.getByRole("alert")).toHaveText(error);
  await expect(history).toHaveCount(3);
  await file.setInputFiles({
    name: "still-broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("["),
  });
  await expect(fallback.getByRole("alert")).toHaveText([error, error]);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  const analysis = page.locator(".integrated-analysis");
  await analysis
    .getByRole("button", { name: en ? "Mainstream directions" : "主流研究方向", exact: true })
    .click();
  const view = analysis.getByRole("button", {
    name: en ? "View rule analysis" : "查看规则分析",
    exact: true,
  });
  await expect(view).toBeEnabled();
  await view.click();
  await expect(analysis.locator(".integrated-directions > article")).toHaveCount(7);
  await expect(page.locator("[data-sonner-toaster]")).toHaveCount(0);
  expect(requests).toBe(1);
});
