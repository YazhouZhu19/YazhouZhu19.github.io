import { test as base, expect, type Page } from "@playwright/test";

export const test = base.extend<{ offlineOnly: void }>({
  offlineOnly: [
    async ({ context, baseURL }, use) => {
      const blocked: string[] = [];
      const errors: string[] = [];
      const origin = new URL(baseURL!).origin;
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) await route.continue();
        else {
          blocked.push(url.href);
          await route.abort("blockedbyclient");
        }
      });
      context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
      await use();
      expect(blocked, "No browser request may leave the local fixture server").toEqual([]);
      expect(errors, "No uncaught application error").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function openHome(page: Page) {
  await page.goto("./");
  await expect(page.locator(".dash-metric")).toHaveCount(4);
  await expect(page.locator(".dash-metric-primary strong")).toHaveText(/[1-9]/);
}
export async function openLibrary(page: Page, en: boolean) {
  await page.getByRole("button", { name: en ? /^Paper library/ : /^论文库/ }).click();
  await expect(
    page.getByRole("textbox", { name: en ? "Search papers" : "搜索论文", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".paper-row").first()).toBeVisible();
}
export const navLabels = (en: boolean) =>
  en
    ? ["Paper insights", "Open-source insights", "Frontier updates", "Research outlook", "PI / Teams"]
    : ["论文洞察", "开源洞察", "前沿动态", "方向研判", "PI / 团队"];

export async function mainView(page: Page, en: boolean, index: number) {
  await page
    .locator(".workspace-main-nav")
    .getByRole("button", { name: navLabels(en)[index], exact: true })
    .click();
  const markers = [
    ".research-dashboard",
    ".github-dashboard-summary",
    ".news-dashboard-summary",
    ".foresight-view",
    ".team-foresight",
  ];
  await expect(page.locator(markers[index])).toBeVisible();
}
