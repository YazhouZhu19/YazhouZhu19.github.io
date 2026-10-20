"use client";
import { EmptyState } from "./state-views";

import { DashboardShell, DashboardMetric, type DashboardSlots } from "./dashboard-shell";
import "@/styles/dashboard-common.css";

import { ArrowUpRight, Box, Database, Layers3, Newspaper, Radio, Users, Wrench } from "lucide-react";
import { newsDashboardDate, type NewsDashboardModel } from "@/lib/news-dashboard";
import { safeSignalUrl } from "@/lib/research-signals";
import type { SignalDashboardBucket } from "@/lib/signal-dashboard";
import type { SignalDashboardDrill } from "./signal-dashboard";
import { SourceDashboardBars, SourceDashboardRing, SourceDashboardTimeline } from "./source-dashboard-charts";
import { Button } from "./ui/button";
import { useI18n } from "./locale-provider";
import "@/styles/news-dashboard.css";
import { WindowComparisonReadout } from "./trend-annotations";
import type { CollectionChangeMarker, WindowComparison } from "@/lib/trend-statistics";

type Props = DashboardSlots & {
  model: NewsDashboardModel;
  onDrill: (drill: SignalDashboardDrill) => void;
  onBrowse: () => void;
  originalsCount?: number;
  eventCount?: number;
  changeMarkers?: CollectionChangeMarker[];
  windowComparison?: WindowComparison | null;
  directionDenominator?: number;
};
type SummaryProps = Pick<Props, "model" | "onDrill"> & {
  sourceCheckedAt?: string | null;
  summaryOnly?: boolean;
};

export function NewsDashboardSummary({ model, onDrill, sourceCheckedAt, summaryOnly = false }: SummaryProps) {
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
  const sourceCheckedLabel =
    sourceCheckedAt && Number.isFinite(Date.parse(sourceCheckedAt))
      ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(sourceCheckedAt))
      : t("未知", "unknown");
  return (
    <div className="news-dashboard-summary source-dashboard-summary">
      <div className="dash-global-strip">
        <button
          type="button"
          onClick={() =>
            open(model.global.total, t("全部公开消息库内记录", "All public news library records"))
          }
        >
          <Database size={15} />
          {t("库内", "In library")} <b>{count(model.global.total.count)}</b> {t("条消息", "news records")}
          <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          disabled={!model.nowValid || !model.referenceDateValid}
          onClick={() =>
            open(
              model.global.today,
              summaryOnly
                ? t(
                    "快照当日入库消息 · 不含最早采集批次",
                    "News added on snapshot day · excluding earliest batch",
                  )
                : t("今日入库消息 · 不含最早采集批次", "News added today · excluding earliest batch"),
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
              t("消息最早采集批次 · 推定基线", "Earliest news collection batch · inferred baseline"),
            )
          }
          title={t(
            "按现存消息最早的首次发现时间推定，不代表完整初始建库。",
            "Inferred from the earliest first-seen timestamp in retained news, not a complete initial-import history.",
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
          `新闻来源最近检查 ${sourceCheckedLabel}（北京时间）。`,
          `News sources last checked ${sourceCheckedLabel} (Beijing time). `,
        )}
        {t(
          "以上为全库统计；今日入库按首次发现时间计算，可能包含历史报道，不等于今日新发布。最早批次作为推定采集基线展示。",
          "Global library counts. Added today uses first-seen time and can include historical reports; it does not mean published today. The earliest batch is an inferred collection baseline.",
        )}
        {model.snapshotStale && (
          <span>
            {t(
              ` 新闻观测截至 ${model.snapshotDay ?? "未知"}，今日数量仅代表已收录消息。`,
              ` News observations run through ${model.snapshotDay ?? "unknown"}; today's count reflects only news already collected.`,
            )}
          </span>
        )}
        {model.snapshotInFuture && (
          <span>
            {t(
              " 新闻观测时间晚于当前时间，时间标注待核实；统计仅计入当前时间之前的记录。",
              " The news observation timestamp is ahead of the current time and needs verification; counts include only earlier records.",
            )}
          </span>
        )}
      </p>
    </div>
  );
}

export function NewsDashboard({
  model,
  onDrill,
  onBrowse,
  originalsCount,
  eventCount,
  changeMarkers,
  windowComparison,
  directionDenominator,
  summary,
  filters,
}: Props) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const count = (value: number) => value.toLocaleString(locale === "en" ? "en-US" : "zh-CN");
  const label = (bucket: SignalDashboardBucket) => t(bucket.labelZh, bucket.labelEn);
  const open = (bucket: SignalDashboardBucket, override?: string) =>
    onDrill({ label: override ?? label(bucket), ids: bucket.recordIds });
  const available = model.nowValid && model.referenceDateValid && model.rangeValid;
  const discovery = model.filters.clock === "discovery";
  const monthly = model.seriesGranularity === "month";
  const timelineTitle = discovery
    ? t("消息入库日期分布", "News by date added")
    : t("消息发布日期分布", "News by publication date");
  const metricHints: Record<string, string> = {
    total: t("按消息记录去重 · 与当前筛选一致", "Unique news records · current filters"),
    publishers: t("按名称归并 · 未合并机构别名", "Grouped by name · organization aliases not merged"),
    model: t("标题含模型线索 · 按消息数统计", "Model clues in titles · counts of news records"),
    tooling: t("按标题关键词归类 · 按消息数统计", "Classified by title keywords · counts of news records"),
  };
  const icons = [Newspaper, Users, Box, Wrench];
  const latest = model.rows
    .map((record) => ({ record, date: newsDashboardDate(record, model.filters.clock) }))
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
  const exclusions = [
    model.excluded.initial,
    model.excluded.missing,
    model.excluded.future,
    model.excluded.unavailable,
  ].filter((bucket) => bucket.count > 0);
  const originals = model.rows.filter((record) => safeSignalUrl(record.originalUrl));

  return (
    <DashboardShell
      className="news-research-dashboard"
      title={t("公开进展概览", "Public progress overview")}
      description={t(
        "观察模型发布、技术进展与公开消息来源。",
        "Explore model releases, technical progress and public sources.",
      )}
      asOf={model.asOf}
      summary={summary}
      filters={filters}
      scope={
        <div className="dash-scope">
          <span>
            {model.start ?? "—"} — {model.end ?? "—"} ·{" "}
            {discovery
              ? t("平台首次入库", "First added to platform")
              : t("消息发布日期", "News publication date")}{" "}
            · {t("北京时间", "Beijing time")}
          </span>
          <span>{t("数字与图表均可点击查看消息", "Click counts and charts to inspect news")}</span>
        </div>
      }
      metrics={model.scoped.metrics.map((metric, index) => (
        <DashboardMetric
          key={metric.id}
          accent={index === 0}
          icon={icons[index]}
          label={label(metric)}
          value={available ? count(metric.count) : "—"}
          hint={metricHints[metric.id]}
          comparison={
            metric.id === "total" && eventCount !== undefined
              ? t(`去重后 ${count(eventCount)} 个事件`, `${count(eventCount)} clustered events`)
              : undefined
          }
          disabled={!available || !metric.count}
          onClick={() => open(metric)}
        />
      ))}
      libraryLabel={t("查看新闻库", "Browse news library")}
      onBrowse={onBrowse}
    >
      <div className="dash-main-grid news-main-grid">
        <section className="dash-panel news-trajectory">
          <div className="dash-panel-heading">
            <div>
              <h2>{timelineTitle}</h2>
              <p>
                {discovery
                  ? t("每条消息按首次发现时间计数一次", "Each news record counted once by first-seen time")
                  : t(
                      "每条消息按来源标注的发布日期计数一次",
                      "Each news record counted once by its source publication date",
                    )}
                {monthly
                  ? t(" · 长时间范围按月汇总", " · long windows aggregate by month")
                  : t(" · 按日汇总", " · daily counts")}
              </p>
            </div>
            <span className="dash-unit">{t("单位：条", "Unit: records")}</span>
          </div>
          {model.rangeValid && model.series.length ? (
            <SourceDashboardTimeline
              kind="news"
              rows={model.series}
              title={timelineTitle}
              onDrill={onDrill}
              monthly={monthly}
              markers={changeMarkers}
            />
          ) : (
            <EmptyState
              compact
              title={<>{t("当前范围暂无可展示的日期记录", "No date records to display in this range")}</>}
              description={
                <>
                  {t(
                    "调整统计时间，或检查新闻观测时间。",
                    "Adjust the time window or check the news observation time.",
                  )}
                </>
              }
            />
          )}
          {discovery && model.excluded.initial.count > 0 && (
            <p className="dash-note news-baseline-note">
              {t(
                "最早采集批次已从入库曲线单列：",
                "The earliest collection batch is separate from this additions chart: ",
              )}
              <button type="button" onClick={() => open(model.excluded.initial)}>
                {count(model.excluded.initial.count)} {t("条消息", "news records")}
                <ArrowUpRight size={12} />
              </button>
              {t(
                "。该批次按现存记录推定，不是完整建库历史。",
                ". This inferred batch is not a complete import history.",
              )}
            </p>
          )}
          <p className="dash-note">
            {discovery ? (
              <>
                {t(
                  "入库可能包含历史报道回填，不代表新闻或模型新发布。",
                  "Additions can include historical backfills, not newly published news or models.",
                )}
                {model.initialDay &&
                  t(
                    `现有首次发现记录始于 ${model.initialDay}；此前的入库历史未知。`,
                    ` Retained first-seen history begins ${model.initialDay}; earlier additions are unknown.`,
                  )}
              </>
            ) : (
              t(
                "消息数反映当前样本中的报道量；转载可能描述同一工作，不能作为独立模型或科研成果的数量。",
                "Counts describe reports in this sample; multiple reports can cover one work, so they are not counts of independent models or research contributions.",
              )
            )}
            {monthly
              ? t(
                  " 首末月份可能只包含所选窗口及已收录时段的部分日期。",
                  " The first and last months may cover only part of the selected and observed period.",
                )
              : t(
                  " 今日尚未结束，采集范围也会影响各日数量。",
                  " Today is incomplete, and collection coverage affects daily counts.",
                )}
          </p>
        </section>
        <section className="dash-panel news-types">
          <div className="dash-panel-heading">
            <div>
              <h2>{t("消息类型", "News types")}</h2>
              <p>
                {t(
                  "按标题关键词归类 · 每条消息只计入一类",
                  "Title-keyword labels · one type per news record",
                )}
              </p>
            </div>
          </div>
          <SourceDashboardRing
            buckets={model.scoped.newsTypes}
            title={t("消息类型", "News type")}
            totalLabel={t("当前范围消息", "News records in scope")}
            onDrill={onDrill}
          />
          <p className="dash-note">
            {t(
              "模型相关、工具与平台依据标题线索；其余归入研究进展。类型标注不代表新模型发布或独立效果验证。",
              "Model-related and tooling labels follow title clues; other records fall under research progress. Labels do not establish new model releases or independent validation.",
            )}
          </p>
        </section>
      </div>

      <section className="dash-panel dash-interests news-directions">
        <div className="dash-panel-heading">
          <div>
            <h2>{t("当前范围的研究方向", "Research areas in scope")}</h2>
            <p>
              {t(
                "同一消息可命中多个方向，不能将各方向数量相加为总量。",
                "News can match several areas; category counts cannot be added to obtain a total.",
              )}
            </p>
          </div>
          <span className="dash-unit">{t("点击查看消息", "Click for news")}</span>
        </div>
        <SourceDashboardBars
          kind="news"
          buckets={model.scoped.categories}
          title={t("研究方向", "Research area")}
          onDrill={onDrill}
          denominator={directionDenominator ?? model.scoped.total}
        />
        <WindowComparisonReadout
          comparison={windowComparison}
          label={(id) => {
            const category = model.scoped.categories.find((row) => row.id === id);
            return category ? label(category) : id;
          }}
        />
        <p className="dash-note">
          {t(
            "分类沿用公开检索线索，描述库内报道结构；数量不代表全领域研究热度或技术成熟度。",
            "Categories follow discovery clues and describe this news sample, not field-wide research popularity or technical maturity.",
          )}
        </p>
      </section>

      <div className="dash-bottom-grid news-bottom-grid">
        <section className="dash-panel">
          <div className="dash-panel-heading">
            <div>
              <h2>{t("发布者分布", "Publisher distribution")}</h2>
              <p>
                {t(
                  "前 8 个名称与其他、未注明 · 按消息数统计",
                  "Top 8 names, other, and unknown · counts of news records",
                )}
              </p>
            </div>
          </div>
          <SourceDashboardBars
            kind="news"
            profile="publisher"
            buckets={model.scoped.publishers}
            title={t("发布者", "Publisher")}
            onDrill={onDrill}
          />
          <p className="dash-note">
            {t(
              "发布者可能是机构、媒体或企业；仅按名称归并，别名未合并，报道数量不代表独立研究产出。",
              "Publishers can be institutions, media, or companies. Names are grouped without alias resolution; report counts are not independent research output.",
            )}
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-heading">
            <div>
              <h2>
                {discovery
                  ? t("当前范围的近期入库消息", "Recently added news in scope")
                  : t("当前范围的近期发布消息", "Recently published news in scope")}
              </h2>
              <p>
                {discovery
                  ? t(
                      "按首次发现时间排序 · 点击定位消息卡片",
                      "Sorted by first-seen time · click for the news card",
                    )
                  : t(
                      "按来源发布日期排序 · 点击定位消息卡片",
                      "Sorted by publication date · click for the news card",
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
                onClick={() => onDrill({ label: record.title, ids: [record.id] })}
              >
                <span className="dash-recent-meta">
                  {beijingStamp(date)}
                  <span>
                    {record.relevance?.level === "direct"
                      ? t("高相关", "Directly relevant")
                      : t("待复核", "Needs review")}
                  </span>
                </span>
                <strong>{record.title}</strong>
                <span className="news-recent-description">
                  {record.summary || t("来源未提供消息摘要。", "No summary was supplied by the source.")}
                </span>
                <span className="dash-recent-source">
                  {t("发布者：", "Publisher: ")}
                  {record.publisher}
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
            {!latest.length && (
              <p className="dash-note">{t("当前范围暂无消息。", "No news in this scope.")}</p>
            )}
          </div>
        </section>
      </div>

      {exclusions.length > 0 && (
        <details className="news-excluded">
          <summary>{t("查看本次统计单列的记录", "Inspect records outside the statistics")}</summary>
          <p>
            {t(
              "以下消息仍保留在库中；采集基线、缺失或异常日期与时间范围分开处理。",
              "These news records remain in the library; collection baselines, missing, and unverified dates are handled separately from the time window.",
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
          `当前范围 ${count(originalsCount ?? originals.length)} 条消息已收录原文链接。`,
          `${count(originalsCount ?? originals.length)} news records in this scope have collected original-article links.`,
        )}
        {t(
          "检索摘要不是原文，发布声明不等于独立验证。消息通过 Google 新闻检索与发布者订阅源采集，原始发布者保留在消息卡片；各采集入口的更新时间见下方状态。",
          " Search snippets are not full articles, and announcements are not independent validation. News is collected through Google News searches and publisher feeds; cards retain original publishers. Collection timestamps are listed in the source status below.",
        )}
      </p>
    </DashboardShell>
  );
}
