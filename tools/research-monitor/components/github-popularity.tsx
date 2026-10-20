"use client";

import { ArrowUpRight, GitFork, Star } from "lucide-react";
import type { GitHubDashboardModel } from "@/lib/github-dashboard";
import type { SignalDashboardDrill } from "./signal-dashboard";
import { Button } from "./ui/button";
import { useI18n } from "./locale-provider";

type Metric = "stars" | "forks";
type Props = {
  model: GitHubDashboardModel;
  onDrill: (drill: SignalDashboardDrill) => void;
  onRankedBrowse: (metric: Metric) => void;
};

export function GitHubPopularity({ model, onDrill, onRankedBrowse }: Props) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const count = (value: number) =>
    value.toLocaleString(locale === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: 1 });
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const { popularity } = model;
  const observedRange =
    popularity.observedFrom && popularity.observedTo
      ? date(popularity.observedFrom) === date(popularity.observedTo)
        ? date(popularity.observedTo)
        : `${date(popularity.observedFrom)} — ${date(popularity.observedTo)}`
      : null;
  const metrics = [
    { key: "stars" as const, name: "Star", label: t("Star 收藏总数", "Total stars"), icon: Star },
    { key: "forks" as const, name: "Fork", label: t("Fork 派生总数", "Total forks"), icon: GitFork },
  ];

  return (
    <section
      className="github-popularity"
      aria-label={t("Star 与 Fork 统计及排行", "Star and fork statistics and rankings")}
    >
      <div className="github-popularity-heading">
        <h2>{t("开源关注与衍生", "Stars and forks")}</h2>
        <span>
          {t("当前筛选范围", "Current filters")} · {count(model.scoped.total)} {t("个仓库", "repositories")}
        </span>
      </div>
      <div className="github-popularity-metrics">
        {metrics.map(({ key, label, name, icon: Icon }) => {
          const metric = popularity[key];
          return (
            <button
              type="button"
              className={`dash-metric github-popularity-metric github-popularity-${key}`}
              key={key}
              disabled={!metric.count}
              onClick={() => onRankedBrowse(key)}
              aria-label={`${label} ${metric.count ? count(metric.total) : "—"} · ${t("查看全部排名", "View full ranking")}`}
            >
              <span className="dash-metric-label">
                <Icon size={17} />
                {label}
                <ArrowUpRight size={15} />
              </span>
              <strong>{metric.count ? count(metric.total) : "—"}</strong>
              <span className="github-popularity-card-detail">
                <span>
                  {t("每仓库中位数", "Median per repository")}{" "}
                  <b>{metric.median === null ? "—" : count(metric.median)}</b>
                </span>
                <span>
                  {metric.count
                    ? t(
                        `${count(metric.count)} 个仓库的累计 ${name}`,
                        `Cumulative ${name.toLowerCase()} across ${count(metric.count)} repositories`,
                      )
                    : t("当前范围暂无仓库", "No repositories in this scope")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="github-popularity-note">
        {t(
          "数值为各仓库最近采集的累计快照，不是所选时段的增量；Star 合计不代表去重用户数。",
          "Counts are each repository’s latest collected cumulative snapshot, not gains during the selected period. Total stars are not unique users.",
        )}
        {observedRange && (
          <span>
            {t(" 数值采集日期：", " Counts collected: ")}
            {observedRange}
            {t("（北京时间）。", " (Beijing time).")}
          </span>
        )}
        {popularity.observedCount < model.scoped.total && (
          <span>
            {t(" 部分仓库缺少有效的采集日期。", " Some repositories have no valid observation date.")}
          </span>
        )}
      </p>
      <div className="github-ranking-grid">
        {metrics.map(({ key, name, icon: Icon }) => {
          const metric = popularity[key];
          const top = metric.ranked.slice(0, 10);
          const max = top[0]?.value ?? 0;
          return (
            <section
              key={key}
              className={`dash-panel github-ranking github-ranking-${key}`}
              aria-label={`${name} ${t("排行", "ranking")}`}
            >
              <div className="dash-panel-heading">
                <div>
                  <h3>
                    <Icon size={16} />
                    {name} {t("排行", "ranking")}
                  </h3>
                  <p>
                    {t("按累计数降序 · 前 10 个仓库", "Descending cumulative counts · top 10 repositories")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!metric.count}
                  onClick={() => onRankedBrowse(key)}
                >
                  {t("全部排名", "Full ranking")}
                  <ArrowUpRight size={13} />
                </Button>
              </div>
              {!metric.count ? (
                <div className="github-ranking-empty">
                  {t(
                    "当前范围暂无仓库，可调整时间或方向筛选。",
                    "No repositories in this scope. Adjust the time window or area.",
                  )}
                </div>
              ) : !metric.hasVariation ? (
                <div className="github-ranking-empty">
                  {t(
                    `当前 ${count(metric.count)} 个仓库均为 ${count(max)} ${name}，暂无排名差异。`,
                    `All ${count(metric.count)} repositories have ${count(max)} ${name.toLowerCase()}; there is no ranking difference.`,
                  )}
                </div>
              ) : (
                <ol className="github-ranking-list">
                  {top.map(({ record, rank, value }) => (
                    <li key={record.id} value={rank}>
                      <button
                        type="button"
                        className="github-ranking-row"
                        onClick={() =>
                          onDrill({ label: `${name} #${rank} · ${record.fullName}`, ids: [record.id] })
                        }
                        aria-label={`${name} ${t("第", "rank ")} ${rank}${t("名", "")} · ${record.fullName} · ${count(value)} ${name} · ${t("查看项目", "View repository")}`}
                      >
                        <span className="github-ranking-position" aria-hidden="true">
                          {String(rank).padStart(2, "0")}
                        </span>
                        <span className="github-ranking-project">
                          <strong>{record.fullName}</strong>
                          <span>
                            {record.relevance?.level === "direct"
                              ? t("高相关", "Directly relevant")
                              : t("待复核", "Needs review")}
                          </span>
                          <span className="github-ranking-track" aria-hidden="true">
                            <span style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
                          </span>
                        </span>
                        <span className="github-ranking-value">
                          <b>{count(value)}</b>
                          <small>{name}</small>
                        </span>
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {metric.hasVariation && (
                <p className="github-ranking-scale">
                  {t(
                    `条长从 0 至 ${count(max)} ${name}；同值并列，名称排序。`,
                    `Bars run from 0 to ${count(max)} ${name.toLowerCase()}; ties share a rank and are ordered by name.`,
                  )}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
