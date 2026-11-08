import { test, expect } from "./test-support";

const paperManifest = /\/data\/(?:public-papers-v[23]|papers)\.json$/;
for (const kind of ["github", "news"] as const) {
  test(`${kind}-only AI stays available when paper loading fails, with retry for joint evidence`, async ({
    page,
  }, info) => {
    const en = info.project.name === "en";
    let unavailable = true;
    await page.route(paperManifest, (route) =>
      unavailable ? route.fulfill({ status: 503, body: "Paper source unavailable" }) : route.continue(),
    );
    await page.goto(`./#/${kind}`);
    const label = kind === "github" ? (en ? "Repository library" : "项目库") : en ? "News library" : "新闻库";
    await page
      .locator(".signals-dashboard-tabs")
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .click();
    await expect(
      page.getByRole("button", {
        name: en ? "Paper links could not load. Retry" : "论文关联读取失败，点击重试",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: en ? "Analyze these results" : "分析当前结果", exact: true })
      .click();
    const panel = page.locator(".ai-research-panel");
    await panel
      .getByRole("textbox", { name: en ? "Your research question" : "你的研究问题", exact: true })
      .fill("medical image segmentation");
    const submit = panel.locator('button[type="submit"]');
    const papers = panel.getByRole("checkbox", { name: en ? "Papers" : "论文", exact: true });
    await expect(papers).not.toBeChecked();
    await expect(submit).toBeEnabled();
    await papers.check();
    const retry = panel.getByRole("button", {
      name: en ? "Retry paper loading" : "重新加载论文",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(panel.locator(".ai-analysis-scope strong")).toHaveCount(0);
    await papers.uncheck();
    await expect(submit).toBeEnabled();
    await expect(retry).toHaveCount(0);
    await papers.check();
    unavailable = false;
    await retry.click();
    await expect(submit).toBeEnabled();
    await expect(
      panel.getByRole("button", {
        name: en ? /Inspect the papers used for analysis/ : /查看将用于分析的论文/,
      }),
    ).toBeVisible();
  });

  test(`${kind}-only AI does not wait for a pending paper download; selected papers remain unknown until ready`, async ({
    page,
  }, info) => {
    const en = info.project.name === "en";
    let release!: () => void;
    const wait = new Promise<void>((done) => {
      release = done;
    });
    let requests = 0;
    await page.route("**/data/public-papers-v3.json", async (route) => {
      requests++;
      await wait;
      await route.continue();
    });
    try {
      await page.goto(`./#/${kind}`);
      const label =
        kind === "github" ? (en ? "Repository library" : "项目库") : en ? "News library" : "新闻库";
      await page
        .locator(".signals-dashboard-tabs")
        .getByRole("button", { name: new RegExp(`^${label}`) })
        .click();
      await page
        .getByRole("button", { name: en ? "Analyze these results" : "分析当前结果", exact: true })
        .click();
      const panel = page.locator(".ai-research-panel");
      await panel
        .getByRole("textbox", { name: en ? "Your research question" : "你的研究问题", exact: true })
        .fill("medical image segmentation");
      const submit = panel.locator('button[type="submit"]');
      await expect(submit).toBeEnabled();
      await panel.getByRole("checkbox", { name: en ? "Papers" : "论文", exact: true }).check();
      await expect(submit).toBeDisabled();
      await expect(panel.locator(".ai-analysis-scope strong")).toHaveCount(0);
      await expect(
        panel.getByText(
          en
            ? "Loading paper evidence. Joint assessment will be available when it is ready."
            : "正在读取论文证据，完成后才能进行联合研判。",
          { exact: true },
        ),
      ).toBeVisible();
      release();
      await expect(submit).toBeEnabled();
      await expect(
        panel.getByRole("button", {
          name: en ? /Inspect the papers used for analysis/ : /查看将用于分析的论文/,
        }),
      ).toBeVisible();
      expect(requests).toBe(1);
    } finally {
      release();
    }
  });
}
