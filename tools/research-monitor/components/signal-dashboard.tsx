"use client";
import "@/styles/dashboard-common.css";

import { useMemo } from "react";
import {
  ArrowUpRight,
  Activity,
  CalendarDays,
  Database,
  FileCheck2,
  Globe2,
  Newspaper,
  PackageCheck,
  Users,
} from "lucide-react";
import { buildSignalDashboard, type SignalDashboardBucket } from "@/lib/signal-dashboard";
import type { ResearchSignal } from "@/lib/research-signals";
import { useI18n } from "./locale-provider";
import "@/styles/signal-dashboard.css";

export type SignalDashboardDrill = { label: string; ids: string[] };
type Props = {
  records: ResearchSignal[];
  kind: "github" | "news";
  asOf: string;
  onDrill: (drill: SignalDashboardDrill) => void;
  onBrowse: () => void;
};

export function SignalDashboard({ records, kind, asOf, onDrill, onBrowse }: Props) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const model = useMemo(() => buildSignalDashboard(records, kind, asOf), [records, kind, asOf]);
  const format = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const label = (bucket: SignalDashboardBucket) => t(bucket.labelZh, bucket.labelEn);
  const open = (bucket: SignalDashboardBucket, prefix?: string) =>
    onDrill({ label: prefix ? `${prefix} · ${label(bucket)}` : label(bucket), ids: bucket.recordIds });
  const metricNotes: Record<string, string> =
    kind === "github"
      ? {
          total: t("当前筛选范围 · 按仓库去重", "Current filters · unique repositories"),
          recent90: t("以快照为基准 · 按最近推送日期", "Relative to snapshot · latest push date"),
          licensed: t("已识别代码许可 · 仍需核对具体条款", "Identified code license · check terms"),
          released: t(
            "已采集 Release 链接 · 不等于已复现",
            "Collected release link · not a reproduction check",
          ),
        }
      : {
          total: t("当前筛选范围 · 按新闻记录去重", "Current filters · unique news records"),
          publishers: t("按发布者名称去重 · 未合并机构别名", "Unique publisher names · aliases not merged"),
          recent30: t("以快照为基准 · 按来源发布日期", "Relative to snapshot · source publication date"),
          original: t("已有原文链接 · 正文内容仍待核验", "Original link available · article not verified"),
        };
  const metricIcons =
    kind === "github"
      ? [Database, Activity, FileCheck2, PackageCheck]
      : [Newspaper, Users, CalendarDays, Globe2];
  function Bars({
    rows,
    title,
    compact = false,
  }: {
    rows: SignalDashboardBucket[];
    title: string;
    compact?: boolean;
  }) {
    const max = Math.max(1, ...rows.map((row) => row.count));
    return (
      <div className={`signal-dash-bars${compact ? " signal-dash-bars-compact" : ""}`} aria-label={title}>
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            className="signal-dash-bar"
            disabled={!row.count}
            onClick={() => open(row, title)}
            aria-label={`${label(row)}: ${format(row.count)} · ${t("查看记录", "View records")}`}
          >
            <span className="signal-dash-bar-label">{label(row)}</span>
            <span className="signal-dash-bar-track" aria-hidden="true">
              <span style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <strong>{format(row.count)}</strong>
            <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
    );
  }
  function Panel({
    title,
    subtitle,
    children,
    className = "",
  }: {
    title: string;
    subtitle: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <section className={`signal-dash-panel ${className}`}>
        <div className="signal-dash-panel-heading">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <span>{t("点击查看记录", "Click for records")}</span>
        </div>
        {children}
      </section>
    );
  }
  const timelineTitle =
    kind === "github"
      ? t("最近活动的月份分布", "Latest activity by month")
      : t("公开消息的发布日期分布", "Announcements by publication month");
  const timelineMax = Math.max(1, ...model.timeline.months.map((row) => row.count));
  const timelineRange = model.timeline.months.length
    ? `${model.timeline.months[0].id} — ${model.timeline.months.at(-1)!.id}`
    : "";
  const maintenanceTitle = t("维护状态", "Maintenance status");
  const typeTitle = t("消息类型", "Announcement types");
  const smallBuckets = kind === "github" ? model.maintenance : model.newsTypes;

  return (
    <div className="signal-dashboard">
      <div className="signal-dash-scope">
        <span>
          {t("指标和图表均采用上方筛选范围", "Metrics and charts share the filters above")} ·{" "}
          {t("快照", "Snapshot")}{" "}
          {model.referenceDateValid ? `${asOf.slice(0, 10)} UTC` : t("日期不可用", "date unavailable")}
        </span>
        <button type="button" onClick={onBrowse}>
          {kind === "github"
            ? t("浏览项目库", "Browse repositories")
            : t("浏览新闻库", "Browse announcements")}
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="signal-dash-metrics">
        {model.metrics.map((metric, index) => {
          const Icon = metricIcons[index];
          const unavailable =
            !model.referenceDateValid &&
            (metric.id === "recent90" || metric.id === "recent30" || metric.id === "released");
          return (
            <button
              key={metric.id}
              type="button"
              className={`signal-dash-metric${index === 0 ? " signal-dash-metric-primary" : ""}`}
              disabled={unavailable || !metric.recordIds.length}
              onClick={() => open(metric)}
            >
              <span className="signal-dash-metric-label">
                <Icon size={17} />
                {label(metric)}
                <ArrowUpRight size={14} />
              </span>
              <strong>{unavailable ? "—" : format(metric.count)}</strong>
              <span>
                {unavailable ? t("快照日期不可用", "Snapshot date unavailable") : metricNotes[metric.id]}
              </span>
            </button>
          );
        })}
      </div>

      {!records.length ? (
        <div className="signals-empty">
          <Database size={24} />
          <h3>{t("当前范围暂无记录", "No records in this scope")}</h3>
          <p>
            {t(
              "调整关键词、方向、相关性或日期范围，即可查看统计。",
              "Adjust the keywords, area, relevance, or dates to see statistics.",
            )}
          </p>
        </div>
      ) : (
        <>
          <Panel
            title={t("研究方向分布", "Research areas")}
            subtitle={t(
              "按宽泛方向归类；同一记录可属于多类，各方向数量不能相加为总量。",
              "Broad research areas overlap; category counts cannot be added to obtain a total.",
            )}
            className="signal-dash-areas"
          >
            <Bars rows={model.categories} title={t("研究方向", "Research area")} />
            <p className="signal-dash-note">
              {t(
                "分类沿用检索线索，展示当前库内样本的结构，不代表全领域热度。",
                "Categories follow discovery clues and describe this library sample, not field-wide popularity.",
              )}
            </p>
          </Panel>
          <div className="signal-dash-main-grid">
            <Panel
              title={timelineTitle}
              subtitle={
                kind === "github"
                  ? t(
                      "最近 12 个月 · 每个仓库仅按一次最新活动归月 · UTC",
                      "Last 12 months · each repository assigned once by latest activity · UTC",
                    )
                  : t(
                      "最近 12 个月 · 按来源发布日期归月 · UTC",
                      "Last 12 months · source publication dates · UTC",
                    )
              }
            >
              {model.referenceDateValid && (
                <p className="signal-dash-timeline-range">
                  {timelineRange} · {t("当月未结束", "Current month incomplete")}
                </p>
              )}
              {model.referenceDateValid ? (
                <div className="signal-dash-timeline" aria-label={timelineTitle}>
                  {model.timeline.months.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      disabled={!row.count}
                      onClick={() => open(row, timelineTitle)}
                      aria-label={`${label(row)}: ${format(row.count)} · ${t("查看记录", "View records")}`}
                    >
                      <strong>{format(row.count)}</strong>
                      <span className="signal-dash-column-space" aria-hidden="true">
                        <span style={{ height: `${(row.count / timelineMax) * 100}%` }} />
                      </span>
                      <span className="signal-dash-month" title={label(row)}>
                        {row.id.slice(5)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="signal-dash-note">
                  {t(
                    "快照日期不可用，暂无法确定时间窗口。",
                    "The snapshot date is unavailable, so the time window cannot be determined.",
                  )}
                </p>
              )}
              <div className="signal-dash-date-remainders">
                {[model.timeline.older, model.timeline.missing, model.timeline.future]
                  .filter((row) => row.count > 0)
                  .map((row) => (
                    <button type="button" key={row.id} onClick={() => open(row, timelineTitle)}>
                      {label(row)} <strong>{format(row.count)}</strong>
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
              </div>
              <p className="signal-dash-note">
                {kind === "github"
                  ? t(
                      "最新活动取推送、Release 或创建日期中的最新值；这是当前快照的日期分布，不能还原历史提交次数或增长趋势。",
                      "Latest activity is the latest push, release, or creation date. This snapshot does not reconstruct historical commit counts or growth.",
                    )
                  : t(
                      "按新闻记录计数，转载可能描述同一工作；当月尚未结束，采集范围也会影响各月数量。",
                      "Counts are news records; multiple reports may describe one work. The current month is incomplete, and collection coverage affects counts.",
                    )}
              </p>
            </Panel>
            <Panel
              title={kind === "github" ? maintenanceTitle : typeTitle}
              subtitle={
                kind === "github"
                  ? t(
                      "优先区分归档状态，再按最近推送日期分组。",
                      "Archived status first, then groups by latest push date.",
                    )
                  : t(
                      "依据标题中的关键词归类，每条消息只归入一类。",
                      "Rule-based labels from title keywords; each item has one type.",
                    )
              }
            >
              <div className="signal-dash-state-list">
                {smallBuckets.map((row, index) => (
                  <button
                    type="button"
                    key={row.id}
                    disabled={!row.count}
                    onClick={() => open(row, kind === "github" ? maintenanceTitle : typeTitle)}
                  >
                    <i className={`signal-dash-state-${index}`} aria-hidden="true" />
                    <span>{label(row)}</span>
                    <strong>{format(row.count)}</strong>
                    <small>{model.total ? `${Math.round((row.count / model.total) * 100)}%` : "0%"}</small>
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
              <p className="signal-dash-note">
                {kind === "github"
                  ? t(
                      "超过 90 天无推送不等于弃用；维护状态不代表代码质量或临床可用性。",
                      "No push within 90 days does not imply abandonment. Maintenance status does not establish code quality or clinical usability.",
                    )
                  : t(
                      "消息类型不是效果验证；模型发布、研究报道与工具更新都需要回到原始证据核对。",
                      "Announcement types do not validate performance; model releases, research reports, and tools require original evidence.",
                    )}
              </p>
            </Panel>
          </div>
          <Panel
            title={
              kind === "github"
                ? t("主要编程语言", "Primary programming languages")
                : t("发布者分布", "Publishers")
            }
            subtitle={
              kind === "github"
                ? t(
                    "按 GitHub 的主要语言字段，每个仓库只计入一组；前 6 种语言与其他语言单列。",
                    "GitHub primary-language metadata assigns one group per repository; top 6 languages, others, and unknowns are shown.",
                  )
                : t(
                    "按发布者名称汇总，展示前 8 个与其他发布者；同名计为一组。",
                    "Grouped by publisher name, showing the top 8 and others; identical names form one group.",
                  )
            }
            className="signal-dash-secondary"
          >
            <Bars
              compact
              rows={kind === "github" ? model.languages : model.publishers}
              title={kind === "github" ? t("主要语言", "Primary language") : t("发布者", "Publisher")}
            />
            <p className="signal-dash-note">
              {kind === "github"
                ? t(
                    "语言分布反映仓库元数据，不代表模型框架、技术效果或应用场景。",
                    "Languages reflect repository metadata, not model frameworks, technical performance, or applications.",
                  )
                : t(
                    "发布者可能是机构、媒体或企业；报道数量不代表独立研究成果数量。",
                    "Publishers can be institutions, media, or companies; report counts are not counts of independent research contributions.",
                  )}
            </p>
          </Panel>
        </>
      )}
      <p className="signal-dash-footnote">
        {kind === "github"
          ? t(
              "统计基于已采集的公开仓库样本。Stars、推送和 Release 信息均不代表科研质量；许可证需回原仓库核对。",
              "Statistics cover the collected public repository sample. Stars, pushes, and releases do not establish research quality; check licenses at the source.",
            )
          : t(
              "统计基于已采集的公开消息。Google 新闻是发现渠道，原始发布者保留在新闻卡片；检索摘要不等于原文或独立验证。",
              "Statistics cover collected public announcements. Google News is a discovery channel; each card retains its publisher. Snippets are not full articles or independent validation.",
            )}
      </p>
    </div>
  );
}
