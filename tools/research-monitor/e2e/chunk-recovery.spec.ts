import { test, expect } from "@playwright/test";
import { openHome, navLabels } from "./test-support";

// This failure-injection test owns its error guard so the ordinary suite keeps
// rejecting every pageerror. Only the deliberately blocked chunk is allowlisted.
test("missing lazy view chunk offers an explicit reload and restores the same entry", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const en = testInfo.project.name === "en";
  const origin = new URL(baseURL!).origin;
  const blockedExternal: string[] = [];
  const blockedChunks = new Set<string>();
  const errors: string[] = [];
  let rejectChunk = true;
  let documentLoads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++;
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blockedExternal.push(url.href);
      await route.abort("blockedbyclient");
    } else if (rejectChunk && /\/assets\/foresight-view-[^/]+\.js$/.test(url.pathname)) {
      blockedChunks.add(url.href);
      await route.fulfill({ status: 404, contentType: "text/plain", body: "Retired deployment chunk" });
    } else await route.continue();
  });

  await openHome(page);
  await page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: navLabels(en)[3], exact: true })
    .click();
  const reload = page.getByRole("button", { name: en ? "Reload page" : "刷新页面", exact: true });
  await expect(reload).toBeVisible();
  await expect(
    page.getByRole("heading", { name: en ? "This page could not be loaded" : "页面加载遇到问题" }),
  ).toBeVisible();
  expect(blockedChunks.size, "The test must actually reject an unloaded view chunk").toBeGreaterThan(0);
  const failedURL = page.url();
  expect(new URL(failedURL).hash).toMatch(/^#\/outlook(?:\?|$)/);
  expect(documentLoads, "Recovery must wait for the user's reload action").toBe(1);

  rejectChunk = false;
  await Promise.all([page.waitForEvent("domcontentloaded"), reload.click()]);
  await expect(page.locator(".foresight-view")).toBeVisible();
  await expect(reload).not.toBeVisible();
  expect(page.url()).toBe(failedURL);
  expect(documentLoads).toBe(2);
  expect(blockedExternal, "No browser request may leave the fixture origin").toEqual([]);
  const unexpected = errors.filter(
    (message) =>
      !(
        /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
          message,
        ) && [...blockedChunks].some((url) => message.includes(url))
      ),
  );
  expect(unexpected, "Only the injected dynamic-import failure is permitted").toEqual([]);
});
