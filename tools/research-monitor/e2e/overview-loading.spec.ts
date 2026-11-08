import { test, expect, openHome, openLibrary } from "./test-support";

test("dashboard uses only its projection; full records start when the library is requested", async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openHome(page);
  expect(requests.some((url) => url.endsWith("/data/paper-overview.json"))).toBe(true);
  expect(requests.some((url) => /public-papers|\/data\/papers\/|data-worker-/.test(url))).toBe(false);
  await openLibrary(page, info.project.name === "en");
  expect(requests.some((url) => url.endsWith("/data/public-papers-v3.json"))).toBe(true);
  await page.locator(".paper-title").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/deep learning|neural network|foundation model/);
});
for (const route of ["github", "news"])
  test(`${route} opens without requesting paper data`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(`./#/${route}`);
    await expect(
      page.locator(route === "github" ? ".github-dashboard-summary" : ".news-dashboard-summary"),
    ).toBeVisible();
    expect(
      requests.some((url) => /paper-overview\.json|public-papers|\/data\/papers\/|data-worker-/.test(url)),
    ).toBe(false);
  });
test("a missing overview falls back to complete records", async ({ page }) => {
  await page.route("**/data/paper-overview.json", (route) =>
    route.fulfill({ status: 404, body: "Unavailable" }),
  );
  await openHome(page);
});

test("one interrupted overview retries before requesting complete records", async ({ page }) => {
  const requests: string[] = [];
  let attempts = 0;
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/data/paper-overview.json", (route) =>
    ++attempts === 1 ? route.abort("connectionreset") : route.continue(),
  );
  await openHome(page);
  expect(attempts).toBe(2);
  expect(requests.some((url) => /public-papers|\/data\/papers\/|data-worker-/.test(url))).toBe(false);
});

test("repeated overview interruptions still fall back after one retry", async ({ page }) => {
  const requests: string[] = [];
  let attempts = 0;
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/data/paper-overview.json", (route) => {
    attempts++;
    return route.abort("connectionreset");
  });
  await openHome(page);
  expect(attempts).toBe(2);
  expect(requests.some((url) => url.endsWith("/data/public-papers-v3.json"))).toBe(true);
});

test("opening a recent overview item loads a complete paper before showing its details", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openHome(page);
  await page.locator(".dash-recent-list button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(requests.some((url) => url.endsWith("/data/public-papers-v3.json"))).toBe(true);
  await expect(page.getByRole("dialog")).toContainText(/deep learning|neural network|foundation model/);
});

test("returning to a dashboard after full loading does not restart the overview loader", async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openHome(page);
  await openLibrary(page, info.project.name === "en");
  const initial = requests.filter((url) => url.endsWith("/paper-overview.json")).length;
  await page
    .getByRole("button", { name: info.project.name === "en" ? "Overview" : "统计总览", exact: true })
    .click();
  await expect(page.locator(".dash-metric-primary strong")).toHaveText(/[1-9]/);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(requests.filter((url) => url.endsWith("/paper-overview.json"))).toHaveLength(initial);
});
