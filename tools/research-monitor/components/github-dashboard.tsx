"use client";

import {
  Activity,
  ArrowUpRight,
  Database,
  FileCheck2,
  GitBranch,
  Layers3,
  PackageCheck,
  Radio,
} from "lucide-react";
import { githubDashboardDate, type GitHubDashboardModel } from "@/lib/github-dashboard";
import type { SignalDashboardBucket } from "@/lib/signal-dashboard";
import type { SignalDashboardDrill } from "./signal-dashboard";
import { Button } from "./ui/button";
import { SourceDashboardBars, SourceDashboardTimeline, SourceDashboardRing } from "./source-dashboard-charts";
import { useI18n } from "./locale-provider";
import { GitHubPopularity } from "./github-popularity";
import "@/styles/spatial-charts.css";
import "@/styles/github-dashboard.css";

type DashboardProps = {
  model: GitHubDashboardModel;
  onDrill: (drill: SignalDashboardDrill) => void;
  onBrowse: () => void;
  onRankedBrowse: (metric: "stars" | "forks") => void;
};
type SummaryProps = Pick<DashboardProps, "model" | "onDrill"> & { summaryOnly?: boolean };
const STATE_COLORS = ["var(--chart-4)", "var(--chart-1)", "var(--chart-2)", "var(--living-line)"];

export function GitHubDashboardSummary({ model, onDrill, summaryOnly = false }: SummaryProps) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const open = (bucket: SignalDashboardBucket, label: string) => onDrill({ label, ids: bucket.recordIds });
  const clock = model.now
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(model.now))
    : "—";
  return (
    <div className="github-dashboard-summary source-dashboard-summary">
      <div className="dash-global-strip">
        <button
          type="button"
          onClick={() => open(model.global.total, t("GitHub 全部库内记录", "All GitHub library records"))}
        >
          <Database size={15} />
          {t("库内", "In library")} <b>{count(model.global.total.count)}</b> {t("条记录", "records")}
          <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          disabled={!model.nowValid || !model.referenceDateValid}
          onClick={() =>
            open(
              model.global.today,
              summaryOnly
                ? t("快照当日入库 · 不含最早采集批次", "Added on snapshot day · excluding earliest batch")
                : t("今日入库 · 不含最早采集批次", "Added today · excluding earliest batch"),
            )
          }
        >
          <Radio size={15} />
          {summaryOnly ? t("快照当日入库", "Added on snapshot day") : t("今日入库", "Added today")}{" "}
          <b>{model.nowValid && model.referenceDateValid ? count(model.global.today.count) : "—"}</b>
          <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          onClick={() =>
            open(
              model.global.initial,
              t("最早采集批次 · 推定基线", "Earliest collection batch · inferred baseline"),
            )
          }
          title={t(
            "按现存记录最早的首次发现时间推定，不代表完整初始建库。",
            "Inferred from the earliest first-seen timestamp in retained records; not a complete initial-import history.",
          )}
        >
          <Layers3 size={14} />
          {t("最早采集批次", "Earliest batch")} <b>{count(model.global.initial.count)}</b>
          <ArrowUpRight size={13} />
        </button>
        <span className="dash-clock">
          <time dateTime={model.now ?? undefined}>{clock}</time> {t("北京时间", "Beijing time")}
        </span>
      </div>
      <p className="source-summary-note">
        {t(
          "以上为全库统计；今日入库按首次发现时间计算，不等于项目今日创建或发布。最早采集批次单列为推定基线。",
          "Global library counts. Added today uses first-seen time, not repository creation or release. The earliest collection batch is shown separately as an inferred baseline.",
        )}
        {model.snapshotStale && (
          <span>
            {t(
              ` 快照日期为 ${model.snapshotDay ?? "未知"}，今日数量仅代表已收录记录。`,
              ` The snapshot is dated ${model.snapshotDay ?? "unknown"}; today's count reflects only records already collected.`,
            )}
          </span>
        )}
        {model.snapshotInFuture && (
          <span>
            {t(
              " 快照时间晚于当前时间，时间标注待核实；统计仅计入当前时间之前的记录。",
              " The snapshot timestamp is ahead of the current time and needs verification; counts include only earlier records.",
            )}
          </span>
        )}
      </p>
    </div>
  );
}

export function GitHubDashboard({ model, onDrill, onBrowse, onRankedBrowse }: DashboardProps) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const label = (bucket: SignalDashboardBucket) => t(bucket.labelZh, bucket.labelEn);
  const open = (bucket: SignalDashboardBucket, override?: string) =>
    onDrill({ label: override ?? label(bucket), ids: bucket.recordIds });
  const creation = model.filters.clock === "creation";
  const monthly = model.seriesGranularity === "month";
  const timelineTitle = creation
    ? t("最初发布时间分布", "Initial repository publication dates")
    : t("最近活动日期分布", "Latest activity by date");
  const metricHints: Record<string, string> = {
    total: t("按仓库去重 · 与当前筛选一致", "Unique repositories · current filters"),
    recent90: t("快照前 90 天内有推送 · 北京时间", "Push within 90 days of snapshot · Beijing time"),
    licensed: t("仓库元数据已注明代码许可", "Code license identified in repository metadata"),
    released: t("已采集有效 Release 链接与日期", "Collected release link and date"),
  };
  const icons = [GitBranch, Activity, FileCheck2, PackageCheck];
  const datedRows = model.rows.map((record) => ({
    record,
    date: githubDashboardDate(record, model.filters.clock),
  }));
  const latest = datedRows
    .sort(
      (left, right) =>
        (Date.parse(right.date ?? "") || 0) - (Date.parse(left.date ?? "") || 0) ||
        left.record.id.localeCompare(right.record.id),
    )
    .slice(0, 4);
  const beijingStamp = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
          timeZone: "Asia/Shanghai",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(value))
      : t("日期未知", "Date unknown");
  const exclusions = [model.excluded.missing, model.excluded.future, model.excluded.unavailable].filter(
    (bucket) => bucket.count > 0,
  );

  return (
    <div className="research-dashboard github-research-dashboard">
      <div className="dash-scope">
        <span>
          {model.start ?? "—"} — {model.end ?? "—"} ·{" "}
          {creation
            ? t("仓库最初发布时间", "Initial repository publication")
            : t("仓库最近活动", "Latest repository activity")}{" "}
          · {t("北京时间", "Beijing time")}
        </span>
        <span>{t("数字与图表均可点击查看项目", "Click counts and charts to inspect repositories")}</span>
      </div>
      <div className="dash-metrics">
        {model.scoped.metrics.map((metric, index) => {
          const Icon = icons[index];
          const unavailable = !model.referenceDateValid && ["recent90", "released"].includes(metric.id);
          return (
            <button
              type="button"
              key={metric.id}
              className={`dash-metric${index === 0 ? " dash-metric-primary" : ""}`}
              disabled={unavailable || !metric.count}
              onClick={() => open(metric)}
            >
              <span className="dash-metric-label">
                <Icon size={17} />
                {label(metric)}
                <ArrowUpRight size={15} />
              </span>
              <strong>{unavailable ? "—" : count(metric.count)}</strong>
              <span className="dash-metric-hint">
                {unavailable ? t("快照日期不可用", "Snapshot date unavailable") : metricHints[metric.id]}
              </span>
            </button>
          );
        })}
      </div>

      <GitHubPopularity model={model} onDrill={onDrill} onRankedBrowse={onRankedBrowse} />

      <div className="dash-main-grid github-main-grid">
        <section className="dash-panel github-trajectory">
          <div className="dash-panel-heading">
            <div>
              <h2>{timelineTitle}</h2>
              <p>
                {creation
                  ? t("每个仓库按创建时间计数一次", "Each repository counted once by its creation date")
                  : t(
                      "每个仓库按最新活动日期计数一次",
                      "Each repository counted once by its latest activity date",
                    )}
                {monthly
                  ? t(" · 长时间范围按月汇总", " · long windows aggregate by month")
                  : t(" · 按日汇总", " · daily counts")}
              </p>
            </div>
            <span className="dash-unit">{t("单位：个", "Unit: repos")}</span>
          </div>
          {model.rangeValid && model.series.length ? (
            <SourceDashboardTimeline
              kind="github"
              rows={model.series}
              title={timelineTitle}
              onDrill={onDrill}
              monthly={monthly}
            />
          ) : (
            <div className="dash-chart-empty">
              <Radio size={28} />
              <strong>{t("当前范围暂无可展示的日期记录", "No date records to display in this range")}</strong>
              <span>
                {t("调整统计时间，或检查快照日期。", "Adjust the time window or check the snapshot date.")}
              </span>
            </div>
          )}
          <p className="dash-note">
            {creation
              ? t(
                  "最初发布时间采用 GitHub 仓库创建时间，不代表首次 Release 或从私有转公开的时间；缺失日期不作推断。",
                  "Initial publication uses GitHub repository creation time, not the first release or the date a private repository became public. Missing dates are not inferred.",
                )
              : t(
                  "活动取推送、Release 或创建日期的最新值。这是当前快照分布，不能还原历史提交频次。",
                  "Activity is the latest push, release, or creation date. This snapshot cannot reconstruct historical commit frequency.",
                )}
            {monthly &&
              t(
                " 首末月份可能只包含所选窗口及已收录时段的部分日期。",
                " The first and last months may cover only part of the selected and observed period.",
              )}
          </p>
        </section>
        <section className="dash-panel github-maintenance">
          <div className="dash-panel-heading">
            <div>
              <h2>{t("维护状态", "Maintenance status")}</h2>
              <p>{t("优先区分归档，再按最近推送分组", "Archived status first, then latest push date")}</p>
            </div>
          </div>
          <SourceDashboardRing
            buckets={model.scoped.maintenance}
            title={t("维护状态", "Maintenance")}
            totalLabel={t("当前范围项目", "Repositories in scope")}
            onDrill={onDrill}
            colors={STATE_COLORS}
          />
          <p className="dash-note">
            {t(
              "较早推送不等于停止维护；该状态不代表代码质量或临床可用性。",
              "An older push does not imply abandonment; status does not establish code quality or clinical usability.",
            )}
          </p>
        </section>
      </div>

      <section className="dash-panel dash-interests github-directions">
        <div className="dash-panel-heading">
          <div>
            <h2>{t("当前范围的研究方向", "Research areas in scope")}</h2>
            <p>
              {t(
                "同一项目可命中多个方向，不能将各方向数量相加为总量。",
                "Projects can match several areas; category counts cannot be added to obtain a total.",
              )}
            </p>
          </div>
          <span className="dash-unit">{t("点击查看项目", "Click for repositories")}</span>
        </div>
        <SourceDashboardBars
          kind="github"
          buckets={model.scoped.categories}
          title={t("研究方向", "Research area")}
          onDrill={onDrill}
        />
        <p className="dash-note">
          {t(
            "分类沿用公开检索线索，展示库内样本结构，不代表领域热度或经过人工验证的任务分类。",
            "Categories follow discovery clues and describe this sample, not field popularity or manually validated tasks.",
          )}
        </p>
      </section>

      <div className="dash-bottom-grid github-bottom-grid">
        <section className="dash-panel">
          <div className="dash-panel-heading">
            <div>
              <h2>{t("主要编程语言", "Primary languages")}</h2>
              <p>
                {t(
                  "每仓库一个主要语言 · 前 6 种与其他、未注明",
                  "One primary language per repository · top 6, other, and unknown",
                )}
              </p>
            </div>
          </div>
          <SourceDashboardBars
            kind="github"
            profile="language"
            buckets={model.scoped.languages}
            title={t("主要语言", "Primary language")}
            onDrill={onDrill}
          />
          <p className="dash-note">
            {t(
              "依据 GitHub 主要语言元数据，不等于模型框架或方法分类。",
              "GitHub language metadata is not a model-framework or method classification.",
            )}
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-heading">
            <div>
              <h2>
                {creation
                  ? t("当前范围的近期创建项目", "Recently created in this scope")
                  : t("当前范围的近期活动项目", "Recently active in this scope")}
              </h2>
              <p>
                {creation
                  ? t(
                      "按仓库创建时间排序 · 点击定位项目卡片",
                      "Sorted by repository creation time · click for its card",
                    )
                  : t(
                      "按仓库最近活动排序 · 点击定位项目卡片",
                      "Sorted by latest repository activity · click for its card",
                    )}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onBrowse}>
              {t("查看全部", "View all")}
              <ArrowUpRight size={14} />
            </Button>
          </div>
          <div className="dash-recent-list">
            {latest.map(({ record, date }) => (
              <button
                type="button"
                key={record.id}
                onClick={() => onDrill({ label: record.fullName, ids: [record.id] })}
              >
                <span className="dash-recent-meta">
                  {beijingStamp(date)}
                  <span>
                    {record.relevance?.level === "direct"
                      ? t("高相关", "Directly relevant")
                      : t("待复核", "Needs review")}
                  </span>
                </span>
                <strong>{record.fullName}</strong>
                <span className="github-recent-description">
                  {record.summary || t("来源未提供项目简介。", "No description was supplied by the source.")}
                </span>
                <span className="dash-recent-source">
                  {t("所有者：", "Owner: ")}
                  {record.publisher}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
            {!latest.length && (
              <p className="dash-note">{t("当前范围暂无项目。", "No repositories in this scope.")}</p>
            )}
          </div>
        </section>
      </div>

      {exclusions.length > 0 && (
        <details className="github-excluded">
          <summary>{t("查看本次统计单列的记录", "Inspect records outside the statistics")}</summary>
          <p>
            {t(
              "以下记录仍保留在库中；缺失或异常日期与时间范围分开处理。",
              "These records remain in the library; missing and unverified dates are handled separately from the time window.",
            )}
          </p>
          <div>
            {exclusions.map((bucket) => (
              <button type="button" key={bucket.id} onClick={() => open(bucket)}>
                {label(bucket)} <b>{count(bucket.count)}</b>
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        </details>
      )}
      <p className="dash-footnote">
        {t(
          "统计基于已采集的公开仓库，不代表全网覆盖。Stars、推送、Release 与许可字段均不能直接证明科研质量、可复现性或临床有效性。",
          "Statistics cover collected public repositories, not the whole web. Stars, pushes, releases, and license fields do not establish research quality, reproducibility, or clinical validity.",
        )}
      </p>
    </div>
  );
}
