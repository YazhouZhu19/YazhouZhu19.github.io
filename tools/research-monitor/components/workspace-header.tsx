import { useI18n } from "./locale-provider";
import { Button } from "@/components/ui/button";
import { useMemo, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { nav, auxiliaryNav } from "@/lib/workspace-navigation";
import { fmtTime } from "@/lib/workspace-format";
import { collectionNotice } from "@/lib/collection-notice";
import type { usePaperSnapshot } from "@/hooks/use-paper-snapshot";
import type { ResearchSignalsData } from "@/lib/research-signals";
export function WorkspaceTopbar({ view, accountControl }: { view: string; accountControl: ReactNode }) {
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const current = [...nav, ...auxiliaryNav].find((n) => n.id === view) ?? nav[0];
  return (
    <header className="topbar">
      <div className="topbar-label">
        <SidebarTrigger />
        <strong>{ui(current.label, current.en)}</strong>
      </div>
      <div className="account-controls">
        <nav className="language-switch" aria-label={locale === "en" ? "Language" : "界面语言"}>
          <a
            href="/research-monitor/"
            hrefLang="zh-CN"
            lang="zh-CN"
            aria-current={locale === "zh" ? "page" : undefined}
          >
            中文
          </a>
          <a
            href="/research-monitor/en/"
            hrefLang="en"
            lang="en"
            aria-current={locale === "en" ? "page" : undefined}
          >
            EN
          </a>
        </nav>
        {accountControl}
      </div>
    </header>
  );
}
type Props = Pick<
  ReturnType<typeof usePaperSnapshot>,
  "data" | "loading" | "error" | "refreshing" | "checkResult" | "load"
> & {
  view: string;
  setView: (view: string) => void;
  signals: ResearchSignalsData | null;
  signalsLoading: boolean;
  signalsError: boolean;
  signalsCheckedAt: string | null;
  loadSignals: () => unknown;
};
export function WorkspaceHeader({
  data,
  loading,
  error,
  refreshing,
  checkResult,
  load,
  view,
  setView,
  signals,
  signalsLoading,
  signalsError,
  signalsCheckedAt,
  loadSignals,
}: Props) {
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const signalsView = view === "github" || view === "news";
  const paperDashboardView = view === "dashboard" || view === "feed" || view === "analysis";
  const sourceNotice = useMemo(() => collectionNotice(data), [data]);
  return (
    <>
      <div className="page-heading compact-page-heading">
        <div>
          <p className="eyebrow">RESEARCH INTELLIGENCE</p>
          <h1>
            {paperDashboardView
              ? ui("论文洞察", "Paper insights")
              : view === "foresight"
                ? ui("下一步，值得研究什么？", "What is worth researching next?")
                : view === "teams"
                  ? ui("理解积累，研判下一步", "Follow the work. Consider what comes next.")
                  : view === "github"
                    ? ui("开源洞察", "Open-source insights")
                    : view === "news"
                      ? ui("前沿动态", "Frontier updates")
                      : view === "saved"
                        ? tr("从阅读到下一个课题")
                        : tr("让每一条记录有据可查")}
          </h1>
          <p>
            {paperDashboardView
              ? ui(
                  "从论文规模、研究方向与时间分布，到完整论文、原始摘要和阅读笔记。",
                  "Explore paper counts, research areas and dates, then inspect the full library, original abstracts and reading notes.",
                )
              : view === "foresight"
                ? ui(
                    "从持续出现的研究线索中，形成可检验的技术、数据与应用判断。",
                    "Turn recurring research signals into testable hypotheses about methods, data and applications.",
                  )
                : view === "teams"
                  ? ui(
                      "围绕你确认的 PI 与成员名单，观察研究主线与可能走向。",
                      "Explore trajectories and possible next steps for researchers and teams you identify.",
                    )
                  : view === "github"
                    ? ui(
                        "追踪 GitHub 开源项目的研究方向、维护动态与复现线索，进入项目库核对具体实现。",
                        "Track research directions, maintenance and reproducibility clues across GitHub projects, then inspect their implementations.",
                      )
                    : view === "news"
                      ? ui(
                          "追踪医学影像模型与研究进展，观察主题、发布节奏与来源，追溯原始发布。",
                          "Follow medical imaging models and research developments, explore topics and publication patterns, and trace original announcements.",
                        )
                      : view === "saved"
                        ? tr("记录阅读判断、相关问题和下一步验证。")
                        : tr("查看数据覆盖、检索范围与同步结果。")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (signalsView) void loadSignals();
            else {
              void load(true);
            }
          }}
          disabled={signalsView ? signalsLoading : loading || refreshing}
          aria-busy={signalsView ? signalsLoading : refreshing}
        >
          <RefreshCw
            size={15}
            className={(signalsView ? signalsLoading : refreshing) ? "animate-spin" : undefined}
          />
          {tr((signalsView ? signalsLoading : refreshing) ? "正在检查…" : "检查最新数据")}
        </Button>
      </div>
      <div className="compact-freshness">
        <span>
          {ui("数据截至 ", "Data updated ")}
          {signalsView
            ? signals
              ? fmtTime(signals.generatedAt)
              : tr("尚未载入")
            : data
              ? fmtTime(data.collectedAt)
              : tr("尚未载入")}
        </span>
        {!signalsView && (
          <button onClick={() => setView("sources")}>
            {ui("覆盖与同步状态", "Coverage & sync")}
            <ArrowUpRight size={12} />
          </button>
        )}
        <div role="status" aria-live="polite">
          {signalsView
            ? signalsLoading
              ? ui("正在读取已发布快照…", "Checking the published snapshot…")
              : signalsError
                ? ui("读取失败，已保留已有数据。", "The check failed; any existing data is retained.")
                : signalsCheckedAt
                  ? ui(
                      "已检查发布快照；采集时间见下方来源状态。",
                      "Published snapshot checked; source collection times are listed below.",
                    )
                  : ""
            : refreshing
              ? tr("正在读取最新已发布数据…")
              : checkResult &&
                tr(
                  checkResult.kind === "same"
                    ? "当前已是最新发布的数据。"
                    : checkResult.kind === "updated"
                      ? "已加载新版数据，新增 {0} 条记录。"
                      : checkResult.kind === "loaded"
                        ? "已加载最新发布的数据。"
                        : "检查失败，已保留当前数据。",
                  [checkResult.added ?? 0],
                )}
        </div>
      </div>
      {error && !signalsView && (
        <div className="notice error" role="alert">
          {tr(error)}
          <Button variant="ghost" onClick={() => void load(true)} disabled={refreshing}>
            {tr("重新读取")}
          </Button>
        </div>
      )}
      {data?.personalStorageError && (
        <div className="notice error" role="alert">
          {tr(data.personalStorageError)}
        </div>
      )}
      {!signalsView && sourceNotice && (
        <div
          className={`notice ${sourceNotice.severity}`}
          role={sourceNotice.severity === "error" ? "alert" : "status"}
        >
          <span>
            {sourceNotice.severity === "error"
              ? ui(
                  "本次数据更新未能完成，正在展示已保存的论文。详情请查看同步日志。",
                  "This update could not be completed. Saved papers remain available. See the sync log for details.",
                )
              : sourceNotice.sources.length
                ? ui(
                    `部分来源更新不完整（${sourceNotice.sources.join("、")}），成功采集及历史论文仍可正常浏览。`,
                    `Some source updates are incomplete (${sourceNotice.sources.join(", ")}). Successfully collected and saved papers remain available.`,
                  )
                : ui(
                    "部分数据更新未完成，已保存的论文仍可正常浏览。详情请查看同步日志。",
                    "Some updates are incomplete. Saved papers remain available. See the sync log for details.",
                  )}
          </span>
          <Button variant="ghost" onClick={() => setView("sources")}>
            {tr("查看同步日志")}
            <ArrowUpRight size={14} />
          </Button>
        </div>
      )}
      {!signalsView && data?.totalStored && data.totalStored > data.papers.length ? (
        <div className="notice">
          {tr("库内共 ")}
          {data.totalStored}
          {tr(" 条记录，当前展示最新 ")}
          {data.papers.length}
          {tr(" 条；筛选与图表基于当前展示范围。")}
        </div>
      ) : null}
    </>
  );
}
