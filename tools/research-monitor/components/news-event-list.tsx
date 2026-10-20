"use client";
import { useState, type ReactNode } from "react";
import type { NewsEvent } from "@/lib/news-cluster";
import type { NewsSignal } from "@/lib/research-signals";
import { safeSignalUrl } from "@/lib/research-signals";
import { beijingDay } from "@/lib/dashboard";
import { useI18n } from "./locale-provider";
import "@/styles/news-events.css";

export function NewsEventList({
  events,
  renderRecord,
}: {
  events: readonly NewsEvent[];
  renderRecord: (record: NewsSignal) => ReactNode;
}) {
  return (
    <div className="news-events">
      {events.map((event) => (
        <NewsEventCard key={event.id} event={event} renderRecord={renderRecord} />
      ))}
    </div>
  );
}
function NewsEventCard({
  event,
  renderRecord,
}: {
  event: NewsEvent;
  renderRecord: (record: NewsSignal) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const url = event.representative.originalUrl || event.representative.url;
  const date = beijingDay(event.firstPublishedAt ?? "");
  return (
    <section className="signal-card news-event-card">
      <div className="signal-card-meta">
        <span>{t("事件线索", "Event lead")}</span>
        <span>
          {t(
            `${event.sourceCount} 个发布者 · ${event.members.length} 篇报道`,
            `${event.sourceCount} publishers · ${event.members.length} reports`,
          )}
        </span>
        <span>
          {date
            ? t(`最早发布 ${date}（北京时间）`, `First published ${date} (Beijing time)`)
            : t("发布日期未知", "Publication date unknown")}
        </span>
      </div>
      <h3>
        {safeSignalUrl(url) ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {event.title}
          </a>
        ) : (
          event.title
        )}
      </h3>
      <p className="news-event-publishers">{event.publishers.join(" · ")}</p>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          {t(`查看 ${event.members.length} 篇原始报道`, `Inspect ${event.members.length} original reports`)}
        </summary>
        {open && <div className="news-event-reports">{event.members.map(renderRecord)}</div>}
      </details>
    </section>
  );
}
