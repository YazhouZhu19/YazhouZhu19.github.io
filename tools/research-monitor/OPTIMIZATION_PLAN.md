# OEVRYN Engine（research-monitor）优化执行计划

> 本文件供 Codex 逐项执行。建议放在 `tools/research-monitor/OPTIMIZATION_PLAN.md`。
> 基线来源：2026-10-20 对 `main` 分支（`tools/research-monitor/` 源码与 `research-monitor/` 发布产物）的实际检查、构建与测试结果。

---

## 0. 执行总则（Codex 必须遵守）

### 0.1 不可改变的项目目标
1. 定位不变：面向**医学影像分析**的中英双语研究情报平台；纯静态 GitHub Pages 部署；无登录、无后端、无需 API key 即可浏览。
2. 五个主入口不变：论文洞察、开源洞察、前沿动态、方向研判、PI／团队。10 个"感兴趣方向"的 ID 与 `INTEREST_TAXONOMY_VERSION` 语义不变（新增字段可以，改名或删除不行）。
3. 数据保全原则不变：**不得删除任何已采集记录**；数据源失败时保留旧数据；空响应不能记为零新增。新增的过滤或分层只能影响"默认展示"，必须提供"显示全部"的入口。
4. 隐私原则不变：个人数据只存在 `localStorage` 的 `medical-research-monitor:personal:v1` 与 `medical-research-monitor:assessments:v1`，备份格式向后兼容。
5. AI 原则不变：只在用户点击后运行；免费模式不得回退到付费模型；每条结论必须引用证据 ID；不得伪造预测历史。
6. 公开 URL 不变：`/research-monitor/`、`/research-monitor/en/`、`data/papers.json`（v1 兼容端点）与 `data/public-papers-v2.json` 必须继续可用，直到第 6 节明确的废弃步骤。

### 0.2 工作方式
- **一个任务一个提交**，提交信息用 `perf:`、`refactor:`、`feat(analysis):`、`style(ui):`、`ci:` 等前缀，并在正文引用任务编号（例如 `Task P1.2`）。
- 每个任务完成后必须运行，并全部通过：
  ```sh
  cd tools/research-monitor
  npm test          # 基线：326 + 23 个测试全部通过
  npm run build     # 基线：tsc 无错误，vite 构建成功
  ```
- 新增的界面文字必须走现有 i18n 机制：中文写在 `tr()`／`ui()` 调用里，英文加到 `lib/en.json`（分析模块的文字加到 `lib/analysis-en.json`）。中英文页面都要检查。
- **不要手动编辑** `data/` 和 `research-monitor/data/` 下的快照文件；数据格式变更只能通过脚本和工作流生成。
- 修改了行为的任务要同步更新对应文档（`README.md`、`ANALYSIS.md`、`COLLECTOR.md`、`SIGNALS.md`、`FORESIGHT.md`）。
- 标有 **【需人工确认】** 的步骤：Codex 只准备代码或方案，停下来等仓库维护者确认后再合并。

### 0.3 基线数据（用于验收对比）

| 指标 | 当前值 | 说明 |
|---|---|---|
| 论文库记录数 | 8,326 | `public-papers-v2.json` → 16 个分片，未压缩共 66.6 MB |
| 平均每篇论文大小 | 约 7.0 KB | `abstract` 与 `originalAbstract` 各约 1.85 KB；其中 3,266 篇两者完全相同 |
| `research-signals.json` | 48.6 MB（gzip 后 7.96 MB） | 48,410 个 GitHub 记录、2,380 条新闻；JSON 键名重复约占三分之一体积 |
| 首次进入页面的数据传输 | 约 20 MB（gzip），解析约 115 MB JSON | 论文与 signals 在启动时**同时全量加载** |
| 轮询 | 每 5 分钟，`cache: "no-cache"` 重新获取 manifest 与 signals | 快照每小时变化，页面开着时每小时重下约 20 MB |
| 分片稳定性 | 每次同步**全部分片哈希都会变化** | `mergePapers` 按 `publishedAt` 倒序排序后贪心切片，新论文插入会让所有分片边界整体移位 |
| 发布目录 `research-monitor/` | 494 MB（其中 `data/papers` 431 MB） | GitHub Pages 站点上限 1 GB；源码目录 `tools/research-monitor/data` 另有 352 MB |
| 工作流 checkout | `fetch-depth: 0`，每小时运行 | 仓库历史随每小时数十 MB 的分片变动持续膨胀 |
| `main` JS | 571 KB（gzip 179 KB） | 超过 Vite 500 KB 警告线 |
| `main` CSS | 264 KB（gzip 44 KB） | 手写 CSS 17 个文件共 180 KB，另加 Tailwind 与 shadcn |
| shadcn/ui 组件 | `components/ui/` 约 60 个文件 | 业务代码直接引用的只有 16 个 |
| 相关性 | `relevant()` 只要求"出现影像词汇"即收录 | 抽查可见纯临床药物试验、饮食队列、病例报告被归入方向（例如 filgotinib 治疗中轴型脊柱关节炎的 III 期试验） |
| `diagnosis` 方向 | 4,257 篇（占 51%） | 正则 `\bdiagnos` 会命中几乎所有临床论文 |
| 未来日期 | 43 篇 `publishedAt` 晚于今天 | Europe PMC `firstPublicationDate` 有时是期刊出版日期 |
| 疑似重复作品 | 168 组标题完全相同（336 条记录），其中 27 组为预印本加正式发表 | 现有 `identityKeys` 只用 DOI、arXiv、PMID、EPMC ID 做身份识别 |
| 缺摘要 | 253 篇 | |
| GitHub 记录质量 | 42,707 个仓库 star 数为个位数，27,189 个为 0 | 87% 被标为 `direct` 相关 |
| AI 自定义问题模式 | 证据抽样**不使用问题文本** | `prepareAiEvidence` 只按时间×来源分层，再按哈希顺序选取 |

---

## 阶段 P0：建立度量与护栏（先做，约半天）

### Task P0.1 性能与体积基线脚本
- **目标**：后续每项优化都能量化对比。
- **步骤**：
  1. 新建 `scripts/measure-budget.ts`：读取 `dist/`，输出每个 JS/CSS 资源的原始和 gzip 大小；读取 `dist/data/` 下的 manifest，统计首屏必需数据（manifest 加上首屏视图需要的分片）的原始和 gzip 大小；结果写到 `dist/budget-report.json` 并打印表格。
  2. 在 `package.json` 增加 `"measure": "tsx scripts/measure-budget.ts"`。
  3. 新建 `budget.json`，先填入**当前基线值**作为上限（只防止退化），后续任务完成后逐步收紧。
  4. 在 `npm run build` 末尾调用预算检查：任何资源超过 `budget.json` 上限即构建失败。
- **验收**：`npm run build && npm run measure` 输出与 0.3 节表格一致的数字。

### Task P0.2 相关性评测集（为阶段 P4 准备）
- **目标**：没有标注集就无法证明分类算法变好了。
- **步骤**：
  1. 新建 `scripts/export-eval-sample.ts`：按"来源 × 方向 × 月份"分层，从当前快照随机抽取 400 篇（固定随机种子），导出 `eval/relevance-sample.csv`，列为 `id, title, abstract_excerpt(前 600 字符), current_tracks, current_tasks`，另加空列 `label_scope`（`core`、`adjacent`、`out`）、`label_tracks`、`notes`。
  2. Codex 先根据下方定义给出**临时标注**，并在 `notes` 中写明判断理由；文件头部注明 "provisional labels, pending maintainer review"。
     - `core`：提出、评估或应用**计算方法**（算法、模型、软件、AI、定量分析流水线）处理医学影像。
     - `adjacent`：以影像为主要证据的临床研究，没有计算方法贡献（例如诊断准确性研究、影像表现描述、影像随访队列）。
     - `out`：影像只是附带提及（药物试验、病例报告、非影像生物标志物、饮食或流行病学研究等）。
  3. **【需人工确认】** 维护者复核标注后，把文件改名为 `eval/relevance-gold.csv` 并提交。
  4. 新建 `scripts/eval-classifier.ts`：读取金标准，输出 scope 三分类的混淆矩阵，以及每个 track 的 precision、recall、F1，写入 `eval/report.md`。
- **验收**：`npx tsx scripts/eval-classifier.ts` 能跑出当前算法的基线指标并记录在 `eval/report.md`。

---

## 阶段 P1：数据层与加载性能（收益最大，优先执行）

### Task P1.1 稳定分片：按月份分桶，旧分片不再变化
- **问题**：新论文按日期插入后，所有分片边界整体移位，导致每小时全部分片哈希改变。这同时造成：仓库历史膨胀、Pages 目录逼近 1 GB、浏览器每次都得重新下载全部数据。
- **步骤**：
  1. 修改 `scripts/snapshot-files.ts` 的 `writeSnapshotFile` 和 `scripts/public-snapshot.ts` 的 `writePublicSnapshot`：
     - 先按**分桶键**分组，再在桶内按 `id` 排序后切片。分桶键用 `publishedAt` 的 `YYYY-MM`；无效或未来日期归入 `undated` 桶。
     - 单个桶超过 `MAX_SHARD_BYTES` 时，在桶内按 `id` 的稳定顺序继续切成 `YYYY-MM.part-N`。
     - 分片路径仍然是 `papers/<sha256>.json`（保持内容寻址），manifest 的每个分片增加可选字段 `bucket`。
  2. `parseSnapshotManifest` 接受可选的 `bucket` 字段；旧 manifest 没有该字段时照常解析（向后兼容）。
  3. 浏览器端合并分片后，按原逻辑（`publishedAt` 倒序，再按 `id`）在内存中排序，确保界面顺序与之前一致。
  4. 新增测试 `tests/snapshot-stable-shards.test.ts`：构造快照 → 写出 → 加入 5 篇当月新论文 → 再写出，断言**只有当月桶（和 `undated` 桶）的分片哈希改变**，其他分片哈希完全相同。
  5. 保留"每片 ≤ 4 MiB""完整性校验""原子写入""v1 兼容端点"等现有约束，相关测试全部通过。
- **验收**：模拟一次同步后，变化的分片数 ≤ 3；`npx tsx scripts/snapshot-cli.ts check data/papers.json` 通过。

### Task P1.2 公开快照瘦身（v3 公开格式，v1/v2 端点保留）
- **步骤**：
  1. 在 `scripts/public-snapshot.ts` 增加 `research-monitor-shards-v3` 输出，文件名 `data/public-papers-v3.json`：
     - 当 `originalAbstract === abstract` 时省略 `originalAbstract`，解码时补回（`decodePaper` 中 `originalAbstract ??= abstract`）。只在两者完全相等时省略，不改变任何语义。
     - 作者数组改为紧凑元组 `[name, orcid|null, affiliationIndex[]]`，机构字符串放进 manifest 级字典（沿用 v2 的 `queryUrls` 字典做法）。
     - `provenance` 继续使用 v2 的 URL 字典。
  2. 浏览器优先读取 v3；v3 缺失或校验失败时回退到 v2，再回退到 v1。
  3. Python 检查脚本 `scripts/snapshot_checks.py` 与 `tests/public-snapshot.test.ts` 同步扩展：**v3 解码结果必须与源数据逐字段完全相等**（沿用现有的"完整解码相等"验证方式）。
  4. 在 README 的 Development 一节记录 v3 格式及回退顺序。
- **验收**：v3 公开分片总大小相比 v2 至少下降 30%；完整解码相等测试通过。

### Task P1.3 浏览器端分片缓存（不变的分片不重复下载）
- **步骤**：
  1. 新建 `lib/shard-cache.ts`：用 Cache Storage（`caches.open("rm-shards-v1")`）以 `sha256` 为键缓存已校验的分片文本；`caches` 不可用（隐私模式等）时直接走网络，不报错。
  2. 修改快照加载逻辑：manifest 用 `cache: "no-cache"` 获取；分片先查缓存，命中则跳过下载（仍校验哈希）；未命中时下载、校验、写入缓存。
  3. 加载成功后，删除缓存中不在当前 manifest、也不在上一代 manifest 里的分片，控制缓存体积。
  4. 加测试：模拟 fetch 计数，断言第二次加载相同 manifest 时分片请求数为 0；只有一个分片变化时请求数为 1。
- **验收**：结合 P1.1，正常每小时更新时用户只需重新下载 1–3 个分片。

### Task P1.4 拆分 signals 数据并按需加载
- **问题**：48.6 MB 的 `research-signals.json` 在启动时与论文同时加载，而只有"开源洞察""前沿动态"和选择了这些来源的 AI 分析才会用到。
- **步骤**：
  1. 在 `scripts/copy-data.ts`（或新建 `scripts/public-signals.ts`）把 signals 转成公开格式 `data/signals-v2/`：
     - `manifest.json`：`schemaVersion`、`generatedAt`、`sources`、`limitations`、`discoveryState`、分片列表（`kind`、`sha256`、`count`、`bytes`）、**每个 kind 预先计算好的总览聚合**（见第 3 步）。
     - 记录按 `kind`（github／news）分开，再按 P1.1 的月份分桶规则切片；分片内部用**列式编码**（`{"columns":[...],"rows":[[...],...]}`），消除重复键名。
  2. 保留旧的 `data/research-signals.json` 作为兼容端点（构建时照常生成），但前端不再默认读取它。
  3. 预聚合：把 `lib/github-dashboard.ts`、`lib/news-dashboard.ts` 里不依赖用户筛选的默认视图统计（默认时间窗口的指标卡、折线图序列、构成分布）放到构建阶段计算，写进 manifest。总览首屏只需 manifest；用户修改筛选或进入资源库时再加载分片。
  4. 修改 `components/monitor-workspace.tsx`：启动时**不再调用** `loadSignals()`；只在 `view` 切换到 `github`／`news`，或 AI 面板勾选 GitHub／新闻来源时才加载对应 kind 的分片。
  5. 分片同样走 P1.3 的缓存。
  6. 测试：列式编解码往返相等；预聚合结果与浏览器端用全量数据实时计算的结果完全一致（对比 `buildGitHubDashboard`／`buildNewsDashboard` 的输出）。
- **验收**：打开默认的论文洞察页面时，不发起任何 signals 分片请求；进入开源洞察时首屏只需请求 manifest。

### Task P1.5 在 Web Worker 中解析、校验与建立索引
- **步骤**：
  1. 新建 `lib/data-worker.ts`（模块 Worker）：负责获取分片、SHA-256 校验、`JSON.parse`、v3 解码、合并排序，并为每篇论文生成搜索文本（小写的标题、摘要、作者、机构、DOI）。
  2. 主线程通过消息接口拿到 `Paper[]`（结构化克隆）。搜索在 Worker 内执行，返回匹配的 ID 列表，替换 `monitor-workspace.tsx` 里基于 `WeakMap` 的 `searchableText`。
  3. 不支持模块 Worker 的环境回退到现有主线程逻辑（保留原代码路径并加特性检测）。
  4. 保留现有的取消语义（`AbortSignal`、`createSnapshotLoader().cancel()`）。
- **验收**：加载过程中主线程不出现超过 200 ms 的长任务（用 Chrome Performance 面板或 `PerformanceObserver('longtask')` 记录，结果写入 PR 描述）；输入搜索时界面不卡顿。

### Task P1.6 轮询改为"只看 manifest"
- **步骤**：
  1. 5 分钟定时器只请求 manifest（论文与 signals 各一个），并带上 `If-None-Match`／`ETag`；manifest 未变化则不做任何事。
  2. manifest 变化时，只下载变化的分片（借助 P1.3）。
  3. 连续请求失败时指数退避（5 → 10 → 20 分钟，上限 60 分钟），页面重新可见时立即检查一次。
  4. "检查最新数据"按钮的行为与文案不变。
- **验收**：快照未更新时，每次轮询的网络流量 < 5 KB。

### Task P1.7 仓库与 Pages 体积治理
- **步骤**：
  1. `.github/workflows/research-monitor-sync.yml`：checkout 改为 `fetch-depth: 1`。若后续步骤依赖完整历史（检查 `git log`、`git diff` 的用法），改用 `git fetch --depth=2` 等最小深度方案。
  2. 在工作流的发布前检查中加入：`du -sb research-monitor` 超过 **800 MB** 时失败并给出明确提示，防止静默撞上 Pages 的 1 GB 上限。
  3. 发布目录只保留：当前代 v3 分片、**上一代**分片（兼容部署切换期间的客户端）、v1 与 v2 兼容端点所需的分片。清理其他孤立分片（现有逻辑基础上加测试）。
  4. **【需人工确认】** 长期方案二选一，Codex 只写方案文档 `docs/data-hosting-options.md`，不执行：
     - (a) 把发布数据迁到独立的孤儿分支（如 `gh-data`），每次强制推送覆盖，让 `main` 历史不再包含数据；
     - (b) 继续存放在 `main`，但改为每日一次提交数据，每小时只在有新增时提交。
     文档中写明历史清理（`git filter-repo`）的影响和回滚方法，由维护者决定是否执行。
- **验收**：工作流的 checkout 时间与提交体积在 PR 描述中有前后对比；稳定分片生效后，每小时提交的数据变动应降到个位数 MB。

---

## 阶段 P2：前端运行流畅度

### Task P2.1 清理未使用的 shadcn 组件和依赖
- **步骤**：
  1. 用 `grep` 或 import 图工具（例如 `npx knip` 或 `npx madge --orphans`）找出 `components/ui/` 中没有被业务代码直接或间接引用的文件（注意 `sidebar` 依赖 `sheet`、`tooltip`、`skeleton`、`input`、`separator`、`button` 等）。
  2. 删除未被引用的组件；从 `package.json` 移除随之无用的依赖（候选：`embla-carousel-react`、`input-otp`、`react-day-picker`、`vaul`、`react-resizable-panels`、`cmdk`、`react-hook-form`、`@hookform/resolvers`、`next-themes`；每一个都要先确认没有引用再删）。
  3. 检查 `tw-animate-css` 和 `vendor/shadcn-tailwind-4.13.0.css` 是否还有用到的类，没有就移除对应的 `@import`。
- **验收**：构建通过；`main` CSS 与 JS 体积下降，记录到 `budget.json`。

### Task P2.2 JS 分包
- **步骤**：
  1. 用 `rollup-plugin-visualizer`（或 rolldown 等价方案）生成 `dist/stats.html`，在 PR 描述中列出 `main` 中最大的 10 个模块。
  2. 把 Recharts 及只在图表视图中使用的代码改为动态导入（README 已说明 Recharts 按需加载，需核实 `main` 中是否仍然包含）。
  3. `github-dashboard`、`news-dashboard`、`signal-dashboard`、`research-dashboard` 中非默认视图的组件改为 `lazy()`。
  4. 在 `vite.config.ts` 中为 `react`/`react-dom`、`radix-ui`/`@base-ui` 配置独立的 vendor 分包，提高跨部署的缓存命中率。
  5. `@mlc-ai/web-llm`（约 5.9 MB 的 `lib-*.js`）目前已在点击分析后才加载，**保持不变**，只需确认它没有被其他路径提前引入。
- **验收**：`main` JS gzip ≤ 110 KB（当前 179 KB）；默认首页不加载任何图表库以外视图的代码。

### Task P2.3 列表与图表渲染
- **步骤**：
  1. 论文库目前按 30 条一批"加载更多"。保留这一交互，但对卡片使用 `content-visibility: auto` 和 `contain-intrinsic-size`，降低长列表的布局成本。
  2. 所有对全量 `papers` 的派生计算（`modalities`、`organs`、`methods`、来源列表等）合并为一次遍历，并移到 P1.5 的 Worker 中随数据一起返回。
  3. 图表组件用 `React.memo` 包裹，依赖稳定化（`useMemo` 生成的数据数组），避免切换筛选时整页重绘。
  4. 检查所有 `useEffect` 定时器和事件监听在组件卸载时都已清理。
- **验收**：在 4× CPU 节流下切换方向筛选，交互到下一帧（INP）< 200 ms，结果写入 PR 描述。

### Task P2.4 视图状态写入 URL
- **问题**：当前主视图和筛选只存在 React state 中，无法分享链接，浏览器后退键会直接离开页面。
- **步骤**：
  1. 新建 `lib/url-state.ts`：把 `view`、方向、日期窗口、来源、搜索词与图表钻取标签序列化到 `location.hash`（例如 `#/papers/library?track=segmentation&days=90`）。不使用 history 路由，以兼容 GitHub Pages。
  2. 视图切换时 `pushState`，筛选变化时 `replaceState`；监听 `popstate` 恢复状态。
  3. 钻取（drill）只在 URL 中记录标签和来源视图，不写入完整 ID 列表；页面刷新后若数据中无法复原，回退到对应的总览页。
  4. 中英文页面的 hash 结构相同，语言切换链接保留 hash。
- **验收**：复制任一视图的地址在新标签页打开，能恢复到同一视图与筛选；后退键能回到上一个视图。

---

## 阶段 P3：界面整洁度

> 原则：不增删主入口，不改变信息内容；目标是减少视觉噪音、统一组件与间距、让首屏一眼能看到重点。

### Task P3.1 代码格式化（单独提交，不改逻辑）
- **步骤**：
  1. 加入 Prettier（`printWidth: 110`），配置 `.prettierrc` 与 `.prettierignore`（忽略 `data/`、`dist/`、`vendor/`）。
  2. 对 `lib/`、`components/`、`scripts/`、`styles/` 一次性格式化，**单独提交**，提交信息注明 "formatting only"。
  3. 增加 `npm run format` 和 `npm run format:check`，CI 中运行 `format:check`。
- **验收**：格式化提交中 `npm test` 与构建结果完全不变（构建产物哈希可以变化，但测试数和通过数不变）。

### Task P3.2 拆分 `monitor-workspace.tsx`（约 40 KB）
- **步骤**：拆为以下模块，行为不变：
  - `hooks/use-paper-snapshot.ts`：论文加载、刷新、轮询、错误状态。
  - `hooks/use-signals.ts`：signals 按需加载。
  - `hooks/use-personal-data.ts`：收藏、笔记、名单与 storage 事件。
  - `components/paper-filters.tsx`：筛选面板（含高级筛选）。
  - `components/paper-detail-sheet.tsx`：论文详情抽屉。
  - `components/app-sidebar.tsx`：侧边栏与品牌区。
- **验收**：每个文件 ≤ 400 行（格式化后）；现有测试全部通过。

### Task P3.3 统一设计令牌，合并手写 CSS
- **步骤**：
  1. 在 `styles/tokens.css` 定义唯一的一套令牌：颜色（沿用 `globals.css` 中现有的 `--primary: #087d6a` 等取值）、间距（4/8/12/16/24/32）、圆角（6/10/14）、字号阶梯（12/13/14/16/20/24/30）、阴影两级。
  2. 把 17 个 CSS 文件中的硬编码颜色、间距、字号替换为令牌（用脚本统计替换前后硬编码值的数量，写入 PR 描述）。
  3. 合并重复的选择器与规则：`living.css` 与 `living-analysis.css`、`foresight.css` 与 `foresight-shell.css`、三个 dashboard 的 CSS 共用一份 `dashboard-common.css`。
  4. 把只属于懒加载视图的 CSS 跟随对应组件导入，不再全部在 `main.tsx` 中导入。
  5. 增加深色模式：在 `tokens.css` 中用 `@media (prefers-color-scheme: dark)` 提供暗色令牌值（只改令牌，不改组件）。
- **验收**：`main` CSS 原始大小 ≤ 120 KB（当前 264 KB）；中英文页面在 375 px、768 px、1280 px、1920 px 四个宽度下截图无错位（截图附在 PR）。

### Task P3.4 统一三个数据源总览的页面骨架
- **背景**：论文、GitHub、新闻三个总览已经共享"汇总条 → 日期控件 → 指标卡 → 折线图 → 构成"的结构，但各自实现。
- **步骤**：
  1. 抽出 `components/dashboard-shell.tsx`：标题区（标题 + 一句说明 + 数据截至时间）、汇总条、筛选条、指标卡网格（固定 4 列，移动端 2 列）、图表区、"查看资源库"入口。
  2. 三个 dashboard 改用该骨架，内容和指标保持不变。
  3. 指标卡样式统一：大数字 + 标签 + 可选的对比值；去掉卡片内重复的说明文字，改为悬停提示（`tooltip`）。
- **验收**：三个总览在同一宽度下的标题、筛选条、卡片的位置和尺寸一致。

### Task P3.5 降低提示信息的视觉噪音
- **步骤**：
  1. 盘点页面顶部的所有 `notice`（来源告警、存储错误、采集说明等），按严重程度分为三级：`error`（数据加载失败，保留横幅）、`warning`（部分来源失败，改为状态栏中的黄色徽标 + 点击展开）、`info`（方法说明，改为"了解数据口径"折叠区或悬停提示）。
  2. 同一时刻首屏最多显示一条横幅。
  3. 局限性说明的内容**一字不删**，只改变展示位置。
- **验收**：在数据正常的情况下，首屏不出现任何横幅。

### Task P3.6 统一空状态、加载状态和错误状态
- **步骤**：新建 `components/state-views.tsx`，提供 `<LoadingState>`（骨架屏）、`<EmptyState>`（说明 + 建议操作，比如"放宽日期范围"）、`<ErrorState>`（说明 + 重试按钮）。所有视图改用这三个组件。
- **验收**：在各视图中断网、清空筛选结果时，展示一致。

### Task P3.7 可访问性与移动端检查
- **步骤**：
  1. 用 `@axe-core/cli` 或 Playwright + axe 对中英文首页、论文库、开源洞察、PI 页面各跑一次，修复所有 `serious` 与 `critical` 问题。
  2. 检查移动端（375 px）侧边栏抽屉、筛选面板、论文详情抽屉可正常打开和关闭，按钮可点击区域 ≥ 40 px。
- **验收**：axe 无 `serious`／`critical` 问题。

---

## 阶段 P4：内部分析算法优化

> 每个任务都必须：(1) 在 P0.2 的评测集上报告前后指标；(2) 只新增字段或调整默认展示，不删除记录；(3) 更新 `ANALYSIS.md`；(4) 涉及分类结果变化时更新 `INTEREST_TAXONOMY_VERSION` 之外的**独立版本号**（新增 `SCOPE_CLASSIFIER_VERSION`），以便采集器识别需要重新分类的记录。

### Task P4.1 研究范围分层：core／adjacent／out
- **问题**：`relevant()` 只要求出现影像词汇（或解剖词加 "image/segment" 等词），导致大量纯临床研究进入库中，偏离"医学影像**分析**"的定位。
- **步骤**：
  1. 在 `lib/classify.ts` 中新增 `scopeOf(title, abstract): { scope: "core" | "adjacent" | "out"; reasons: string[] }`：
     - **计算方法信号**（任一命中即可）：`deep learning|neural network|convolutional|transformer|machine learning|artificial intelligence|\bAI\b|algorithm|automat(?:ed|ic)|computer.aided|radiomic|foundation model|segment anything|self.supervis|diffusion model|network architecture|(?:proposed|novel) (?:method|framework|model|pipeline)|software|open.source|benchmark|dataset`，以及现有 `methods` 规则的全部命中。
     - **纯临床信号**：`randomi[sz]ed|placebo|phase (?:i|ii|iii|1|2|3)\b|double.blind|case report|case series|dose|pharmacokinetic|questionnaire|dietary|cohort study`（不带计算方法信号时生效）。
     - `core`：`relevant()` 为真 **且** 有计算方法信号。
     - `adjacent`：`relevant()` 为真，没有计算方法信号，也没有纯临床信号，或明确是诊断准确性研究（`diagnostic accuracy|sensitivity and specificity|inter.?reader|interobserver`）。
     - `out`：`relevant()` 为真，但命中纯临床信号且没有计算方法信号。
     - 规则要支持现有的否定语境排除（沿用 `humanSignals` 中的否定窗口写法）。
  2. `Paper` 类型增加 `scope` 与 `scopeReasons` 字段（可选，旧数据缺失时在加载时实时计算）。
  3. 采集器对**全部**已存记录重新计算 `scope`（不删除记录）。
  4. 界面：论文洞察的总览、阅读线索、PI 目录和 AI 证据抽样**默认只用 `core`**；筛选栏新增"研究范围"选择（`仅方法研究`／`含影像临床研究`／`全部记录`）。总览上显示一行小字："当前显示方法研究 X 篇，另有影像临床研究 Y 篇、其他 Z 篇未计入"，点击可切换。
  5. 评测集上调参，**目标**：`core` 的 precision ≥ 0.90、recall ≥ 0.85；`out` 被误判为 `core` 的比例 ≤ 3%。
- **验收**：`eval/report.md` 中记录前后指标；filgotinib 那类药物试验被判为 `out`；中英文界面均可切换范围。

### Task P4.2 任务标签精度：拆分"诊断"
- **问题**：`diagnosis` 正则以 `\bdiagnos` 开头，几乎匹配所有临床论文，占全库 51%，统计意义被稀释。
- **步骤**：
  1. `tasks.diagnosis` 改为要求以下之一：
     - 检测或分类动作与病变对象同时出现（保留现有的 `(?:lesion|nodule|...) (?:detect|classif)` 等组合）；
     - `computer.aided (?:detect|diagnos)|automated (?:detect|diagnos|classif)|(?:AI|deep learning|model).{0,40}(?:diagnos|detect|classif|screen)`；
     - `diagnostic accuracy|screening (?:program|performance)`（这类归入 `adjacent` 也合理）。
  2. 单独出现的 `diagnosis`、`diagnosed with`、`differential diagnosis` 不再触发。
  3. 用评测集对比 `diagnosis` 的 precision 和 recall，并检查其他 9 个方向是否受影响。
- **验收**：`diagnosis` precision 提升至 ≥ 0.85，recall 下降不超过 5 个百分点；README 中说明标签口径变化，旧口径与新口径之间的数量变化在总览中加注版本切换日期。

### Task P4.3 日期规范化
- **步骤**：
  1. `lib/parse.ts` 的 `parseEpmc`：读取 `firstPublicationDate`、`electronicPublicationDate`、`firstIndexDate`（若存在），`publishedAt` 取其中**不晚于采集当天的最早有效日期**；原始值都保存在 `provenance` 中。
  2. 若所有日期都晚于采集当天，`publishedAt` 仍使用原值，但设置 `dateAnomaly: "future"`，总览统计和 AI 证据窗口都排除这类记录，资源库中显示"日期待核实"标签。
  3. 已存的 43 条未来日期记录在下次采集时按新规则修正。
- **验收**：快照中 `publishedAt` 晚于采集时间的记录全部带有 `dateAnomaly` 标记；新增测试覆盖三种日期组合。

### Task P4.4 作品级去重（不合并记录，只做分组）
- **问题**：168 组标题完全相同的记录未被识别为同一作品，其中 27 组为预印本与正式发表版本。
- **步骤**：
  1. 在 `lib/foresight.ts` 的 `groupWorks`（AI 证据、团队统计都依赖它）中，增加**保守的**标题匹配：标准化标题（小写、去标点、去空白）完全相同，**且**满足以下之一时归为同一作品：第一作者标准化姓氏相同；或者作者集合的 Jaccard 相似度 ≥ 0.5。
  2. 记录本身**不合并**，仍分别保存来源与版本；只在统计和抽样时按作品计数，并在论文详情中显示"可能的其他版本"链接。
  3. 总览指标卡增加"去重后作品数"（与"记录数"并列显示）。
  4. 新增测试：预印本与正式版标题相同、作者相同 → 同组；标题相同但作者完全不同（例如通用标题的社论）→ 不同组。
- **验收**：当前快照中可识别出的重复作品组在报告中列出；没有误合并（人工抽查 20 组，结果写入 PR 描述）。

### Task P4.5 AI 证据检索：让问题真正参与选样
- **问题**：自定义研究问题模式下，`prepareAiEvidence` 完全不使用问题文本，模型只能看到随机抽出的 6–80 篇，与问题大多无关。
- **步骤**：
  1. 新建 `lib/retrieval.ts`，实现纯前端的 BM25：
     - 文档为标题（权重 ×2）加摘要；英文做小写、去停用词与简单的词干处理（去 `s`/`es`/`ing`/`ed`）。
     - **中英查询扩展**：建立 `lib/query-expansion.json`，覆盖 10 个方向、`classify.ts` 中的模态、器官与方法标签的中英对照与常见同义词（例如"分割 → segmentation, delineation, contouring"，"病理 → histopathology, whole slide, WSI"）。中文问题先按词典匹配扩展为英文词，再检索。
  2. 修改 `prepareAiEvidence`／`prepareCombinedAiEvidence`：
     - `interest` 模式与带问题的 `team` 模式：先对日期窗口内的作品计算 BM25 分数，取得分大于 0 的前 `max(limit × 4, 40)` 篇作为候选池，再在候选池中执行现有的时间 × 来源分层轮转抽样（排序依据由哈希改为 BM25 分数）。
     - 候选池为空时，返回空证据并提示"库中没有与该问题匹配的证据"，**不再用随机样本代替**。
     - 证据元数据增加 `retrieval: { method: "bm25", candidates, expandedTerms }`，在界面中展示"按问题检索到 N 篇候选，抽取 M 篇"及扩展后的检索词。
  3. `landscape` 模式改为**多样性抽样**：在时间 × 来源分层内，用 MMR（最大边际相关性）按 `tracks`、`methods`、`modalities` 标签的 Jaccard 距离挑选，避免样本集中在同一子方向。
  4. 保持确定性：相同输入必须得到相同样本（测试中断言）。
  5. 测试：构造 50 篇论文，其中 5 篇关于"超声甲状腺结节分割"；问题为"甲状腺超声分割的最新方法"时，样本必须包含这 5 篇。
- **验收**：新增测试通过；在 PR 描述中给出 3 个示例问题在优化前后选中证据的对比。

### Task P4.6 本地小模型的输入预算
- **步骤**：
  1. 在 `lib/ai-models.ts` 中为每个本地模型定义上下文预算（tokens 估算：英文按 4 字符/token，中文按 1.5 字符/token）。
  2. `abstractExcerpt` 按预算自适应：优先保留摘要中的方法句与结果句（复用 `lib/analysis.ts` 的句子切分与 `signalRules`），而不是简单截取开头。
  3. 选用 Qwen3-0.6B 时，"快速预览"的样本数降为 4，并在界面上说明原因。
- **验收**：提示词长度不超过所选模型的预算（新增单测）；批处理次数不增加。

### Task P4.7 PI／团队目录：资深作者权重与身份提示
- **问题**：目录按论文数排序，不区分作者位置，学生和合作者与 PI 混在一起；同一个人的"ORCID 条目"和"仅姓名条目"会被拆成两条。
- **步骤**：
  1. `buildTeamDirectory` 为每个条目额外统计：`lastAuthorCount`（作为最后作者的作品数）、`firstAuthorCount`、`works`（按 P4.4 去重后的作品数），并计算 `seniorShare = lastAuthorCount / works`。
  2. 默认排序改为：`lastAuthorCount` 倒序 → `works` 倒序 → 现有规则；界面提供"按资深作者排序／按作品数排序"切换。
  3. 条目中显示"最后作者 X 篇 · 共 Y 项作品"。
  4. **身份提示（不自动合并）**：若"仅姓名条目"与某 ORCID 条目的标准化全名相同，且共享至少一个机构字符串或两位以上共同作者，在两条上都显示"可能是同一人"的提示和对方链接。遵守现有"不跨身份猜测"的原则，不自动合并计数。
  5. 只统计 `scope === "core"` 的论文（跟随 P4.1 的范围切换）。
- **验收**：新增单测覆盖资深作者计数与身份提示；`ANALYSIS.md` 说明作者位置的局限（不同领域作者排序惯例不同）。

### Task P4.8 GitHub 仓库质量分层
- **问题**：88% 的仓库 star 为个位数，27,189 个为 0，但 87% 被标记为 `direct` 相关，总览与资源库被低信号仓库淹没。
- **步骤**：
  1. 新建 `lib/github-quality.ts`，计算 `maturity: "established" | "active" | "early"`：
     - `established`：stars ≥ 50，或 forks ≥ 10，或关联到库中论文（`relatedUrls` 中有 DOI/arXiv）且 stars ≥ 10；
     - `active`：近 180 天有 push，且（有 license，或 README 摘要 ≥ 200 字符，或 stars ≥ 5）；
     - 其余为 `early`；`archived` 的仓库最高只能是 `active`。
  2. 开源洞察总览默认统计 `established + active`，提供"包含早期仓库"开关；所有记录仍可在资源库中搜索到。
  3. 审核 `signal-relevance.ts` 的 `direct` 判定：从 `direct` 中分层随机抽取 200 个仓库导出 CSV，Codex 给出临时标注（标准：是否确实是医学影像相关的代码或数据工具），**【需人工确认】** 后据此收紧 `directEvidence` 规则，目标 `direct` 的 precision ≥ 0.9。
  4. 分层阈值写入 `SIGNALS.md`，并说明 star 数不代表科学质量。
- **验收**：总览默认口径下的仓库数与分层分布写入 PR 描述；测试覆盖分层边界。

### Task P4.9 新闻近重复聚类
- **步骤**：
  1. 新建 `lib/news-cluster.ts`：对新闻标题做标准化（小写、去发布方后缀如 " - Reuters"），计算 3-gram shingles 的 Jaccard 相似度，相似度 ≥ 0.6 且发布时间相差 ≤ 7 天的归为同一事件。
  2. 前沿动态的列表默认按事件展示（显示代表标题、来源数、最早时间），可展开查看各家报道。
  3. 指标卡增加"去重后事件数"。
- **验收**：单测覆盖同一事件的不同标题写法；README 中说明"多家报道同一事件"的口径。

### Task P4.10 趋势统计的口径校正
- **步骤**：
  1. 在论文、GitHub、新闻的折线图上，用竖线标注**采集口径变化日期**（方向从 2 个扩展到 10 个的时间、`SCOPE_CLASSIFIER_VERSION` 变更时间、新增数据源的时间），数据来自 manifest 中的 `interestTaxonomyVersion`、`sourceTaxonomyVersions` 和运行记录。
  2. 方向分布除绝对数量外，增加"占同期同来源总量的比例"视图，降低采集量波动的影响。
  3. 窗口对比（例如近 30 天对比前 30 天）的比例变化显示 Wilson 95% 置信区间；样本量 < 30 时显示"样本不足"，不显示涨跌箭头。
- **验收**：单测覆盖 Wilson 区间计算与"样本不足"判定；`ANALYSIS.md` 更新分母说明。

---

## 阶段 P5：CI 与质量保障

### Task P5.1 工作流补充检查
- **步骤**：
  1. 在同步工作流中，`npm test` 之后加入 `npm run format:check`、`npm run measure`（预算检查）以及 P1.7 的体积检查。
  2. 新增 PR 工作流 `.github/workflows/research-monitor-ci.yml`：对涉及 `tools/research-monitor/**` 的 PR 运行测试、构建、预算检查与评测脚本，并把 `eval/report.md` 的摘要作为评论或 job summary 输出。
- **验收**：故意让某个资源超过预算的测试分支会让 CI 失败。

### Task P5.2 端到端冒烟测试
- **步骤**：用 Playwright 写 5 个冒烟用例（中英文各跑一次）：首页加载并显示指标卡；切换五个主入口；论文库搜索与打开详情；从图表钻取进入资源库再返回；URL hash 恢复视图（P2.4）。使用 `vite preview` 加本地快照，不访问外网。
- **验收**：`npm run e2e` 在 CI 中通过。

---

## 6. 兼容端点的废弃（最后执行，【需人工确认】）
- v3 论文格式与 signals v2 上线**至少 30 天**后，若前端访问日志或问题反馈中没有依赖旧端点的情况，再由维护者决定是否停止生成 `data/papers.json` 的 v1 分片与 `data/research-signals.json`。
- 停止前在 README 中提前公告，并保留文件中的说明字段指向新端点。

---

## 7. 推荐执行顺序与预期收益

| 顺序 | 任务 | 预期收益 |
|---|---|---|
| 1 | P0.1、P0.2 | 建立可量化的基线与评测集 |
| 2 | P1.1 → P1.3 → P1.6 | 每小时更新从"全部重下"变为"1–3 个分片"；仓库增长显著放缓 |
| 3 | P1.4 | 默认首页不再加载 48.6 MB 的 signals，首屏数据传输预计从约 20 MB 降到约 6 MB 以下（gzip） |
| 4 | P1.2、P1.5 | 再降约 30% 数据量；主线程不再被解析阻塞 |
| 5 | P1.7 | 防止 Pages 1 GB 上限导致发布失败 |
| 6 | P3.1 → P3.2 → P2.1 → P2.2 → P2.3 | 代码可维护；JS 与 CSS 体积下降 |
| 7 | P2.4、P3.3 → P3.7 | 可分享链接；界面统一、提示精简、深色模式 |
| 8 | P4.1 → P4.2 → P4.3 → P4.4 | 分析口径对齐"医学影像分析"，统计更可信 |
| 9 | P4.5 → P4.6 | AI 自定义问题真正基于相关证据 |
| 10 | P4.7 → P4.10 | PI 目录、开源与新闻的信噪比提升，趋势解读更稳健 |
| 11 | P5.1、P5.2 | 防止后续退化 |
| 12 | 第 6 节 | 视情况清理旧端点 |

## 8. 每个任务的 PR 描述模板

```
## Task <编号> <标题>
### 改了什么
### 为什么（对应计划中的问题）
### 指标对比（前 → 后）
- 体积 / 请求数 / 长任务 / 评测指标
### 兼容性
- 旧数据、旧端点、个人数据、中英文页面是否受影响
### 验证
- [ ] npm test
- [ ] npm run build（含预算检查）
- [ ] 中英文页面手动检查
- [ ] 文档已更新
### 需人工确认的事项（如有）
```
