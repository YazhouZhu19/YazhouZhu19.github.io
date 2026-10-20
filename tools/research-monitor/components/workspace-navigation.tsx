import { useI18n } from "./locale-provider";
import { Button } from "@/components/ui/button";
import { ChartNoAxesCombined, LayoutDashboard, Layers3 } from "lucide-react";
import type { DashboardDrill } from "@/lib/dashboard";
type Props = {
  view: string;
  setView: (view: string) => void;
  paperCount: number | null;
  dashboardDrill: DashboardDrill | null;
  setDashboardDrill: (drill: DashboardDrill | null) => void;
  drillOrigin: string;
  reset: () => void;
};
export function WorkspaceNavigation({
  view,
  setView,
  paperCount,
  dashboardDrill,
  setDashboardDrill,
  drillOrigin,
  reset,
}: Props) {
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const paperDashboardView = view === "dashboard" || view === "feed" || view === "analysis";
  return (
    <>
      {paperDashboardView && (
        <nav className="dashboard-section-tabs" aria-label={ui("论文洞察视图", "Paper insights views")}>
          <button type="button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>
            <LayoutDashboard size={16} />
            {ui("统计总览", "Overview")}
          </button>
          <button
            type="button"
            aria-pressed={view === "feed"}
            onClick={() => {
              setDashboardDrill(null);
              setView("feed");
            }}
          >
            <Layers3 size={16} />
            {ui("论文库", "Paper library")}
            <span>{paperCount !== null ? paperCount.toLocaleString() : "—"}</span>
          </button>
          <button type="button" aria-pressed={view === "analysis"} onClick={() => setView("analysis")}>
            <ChartNoAxesCombined size={16} />
            {ui("阅读线索", "Reading leads")}
          </button>
        </nav>
      )}
      {view === "feed" && dashboardDrill && (
        <div className="dash-drill-banner">
          <div>
            <strong>{dashboardDrill.label}</strong>
            <span>
              {dashboardDrill.ids.length}
              {tr(" 条范围记录 · 下方筛选可继续缩小范围")}
            </span>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDashboardDrill(null);
              setView(drillOrigin);
            }}
          >
            {drillOrigin === "dashboard"
              ? ui("返回统计总览", "Back to overview")
              : drillOrigin === "analysis"
                ? ui("返回初步分析", "Back to analysis")
                : drillOrigin === "feed"
                  ? ui("返回论文库", "Back to library")
                  : drillOrigin === "teams"
                    ? ui("返回 PI / 团队", "Back to PI / Teams")
                    : drillOrigin === "github"
                      ? ui("返回开源洞察", "Back to open-source insights")
                      : drillOrigin === "news"
                        ? ui("返回前沿动态", "Back to frontier updates")
                        : ui("返回方向研判", "Back to outlook")}
          </Button>
          <Button variant="ghost" onClick={reset}>
            {tr("清除钻取")}
          </Button>
        </div>
      )}
      {view === "analysis" && (
        <Button variant="ghost" onClick={() => setView("dashboard")}>
          {ui("返回统计总览", "Back to overview")}
        </Button>
      )}
    </>
  );
}
