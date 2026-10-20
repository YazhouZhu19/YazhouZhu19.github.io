import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openHome, openLibrary, mainView } from "./test-support";

for (const view of ["home", "library", "github", "teams"] as const) {
  test(`axe: ${view} has no serious or critical violation`, async ({ page }, testInfo) => {
    const en = testInfo.project.name === "en";
    await openHome(page);
    if (view === "library") await openLibrary(page, en);
    if (view === "github") await mainView(page, en, 1);
    if (view === "teams") await mainView(page, en, 4);
    const results = await new AxeBuilder({ page }).analyze();
    await testInfo.attach(`axe-${view}.json`, {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
    const severe = results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""));
    expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
  });
}

async function minimumTarget(control: Locator) {
  const box = await control.boundingBox();
  expect(box, "Visible control must have a bounding box").not.toBeNull();
  expect(box!.width, "Mobile hit target width").toBeGreaterThanOrEqual(40);
  expect(box!.height, "Mobile hit target height").toBeGreaterThanOrEqual(40);
}

async function visibleTargets(page: Page) {
  const small = await page
    .locator('button, [role="button"], [role="combobox"], select')
    .evaluateAll((controls) =>
      controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          rect.right > 0 &&
          rect.left < innerWidth;
        return visible && (rect.width < 40 || rect.height < 40)
          ? [
              {
                name: control.getAttribute("aria-label") || control.textContent?.trim(),
                width: rect.width,
                height: rect.height,
              },
            ]
          : [];
      }),
    );
  expect(small, "Visible mobile controls must have a 40px hit target").toEqual([]);
}

async function changeNativeControl(control: Locator, value: string) {
  await minimumTarget(control);
  const original = await control.inputValue();
  await control.selectOption(value);
  await expect(control).toHaveValue(value);
  await control.selectOption(original);
  await expect(control).toHaveValue(original);
}

test("375px sidebar, filter panel and detail drawer open and close with 40px targets", async ({
  page,
}, testInfo) => {
  const en = testInfo.project.name === "en";
  await page.setViewportSize({ width: 375, height: 812 });
  await openHome(page);
  await visibleTargets(page);
  const direction = page.getByRole("combobox", {
    name: en ? "Dashboard research interests" : "仪表盘感兴趣方向",
    exact: true,
  });
  await changeNativeControl(direction, "segmentation");
  await changeNativeControl(
    page.getByRole("combobox", { name: en ? "Dashboard time range" : "仪表盘时间范围", exact: true }),
    "7",
  );
  await changeNativeControl(
    page.getByRole("combobox", { name: en ? "Dashboard data source" : "仪表盘数据来源", exact: true }),
    "Europe PMC",
  );
  const trigger = page.getByRole("button", { name: "Toggle Sidebar", exact: true });
  await minimumTarget(trigger);
  await trigger.click();
  const sidebar = page.getByRole("dialog");
  await expect(sidebar).toBeVisible();
  await visibleTargets(page);
  const paperNav = sidebar.getByRole("button", { name: en ? "Paper insights" : "论文洞察", exact: true });
  await minimumTarget(paperNav);
  await paperNav.click();
  await expect(sidebar).not.toBeVisible();
  await openLibrary(page, en);
  const filters = page.getByRole("button", { name: en ? "More filters" : "高级筛选", exact: true });
  await minimumTarget(filters);
  await filters.click();
  await expect(page.locator("#advanced-paper-filters")).toBeVisible();
  await visibleTargets(page);
  await filters.click();
  await expect(page.locator("#advanced-paper-filters")).not.toBeVisible();
  const title = page.getByRole("button", { name: "Atlas interactive segmentation", exact: true });
  await minimumTarget(title);
  await title.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toBeVisible();
  await visibleTargets(page);
  const close = detail.getByRole("button", { name: "Close", exact: true });
  await minimumTarget(close);
  await close.click();
  await expect(detail).not.toBeVisible();
  for (const index of [1, 2]) {
    await mainView(page, en, index);
    await changeNativeControl(
      page.getByRole("combobox", { name: en ? "Time range" : "统计时间", exact: true }),
      "7",
    );
    const category = page.getByRole("combobox", { name: en ? "Research area" : "研究方向", exact: true });
    const nextValue = await category.locator("option").nth(1).getAttribute("value");
    expect(nextValue).toBeTruthy();
    await changeNativeControl(category, nextValue!);
    await visibleTargets(page);
  }
});
