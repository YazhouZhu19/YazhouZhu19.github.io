import { useId, type ReactNode } from "react";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { useI18n } from "./locale-provider";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import "@/styles/dashboard-shell.css";

export type DashboardSlots = {
  summary?: ReactNode;
  filters?: ReactNode;
};

type ShellProps = DashboardSlots & {
  title: string;
  description: string;
  asOf?: string | null;
  scope?: ReactNode;
  beforeMetrics?: ReactNode;
  metrics: ReactNode;
  children: ReactNode;
  className?: string;
  libraryLabel: string;
  onBrowse: () => void;
};

export function DashboardShell({
  title,
  description,
  asOf,
  summary,
  filters,
  scope,
  beforeMetrics,
  metrics,
  children,
  className = "",
  libraryLabel,
  onBrowse,
}: ShellProps) {
  const { locale } = useI18n();
  const titleId = useId();
  const validDate = asOf && Number.isFinite(Date.parse(asOf)) ? asOf : null;
  const stamp = validDate
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(validDate))
    : locale === "en"
      ? "Unknown snapshot date"
      : "快照日期未知";
  return (
    <section className={`research-dashboard dashboard-shell ${className}`} aria-labelledby={titleId}>
      <header className="dashboard-shell-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="dashboard-shell-date">
          {locale === "en" ? "Data as of " : "数据截至 "}
          {validDate ? <time dateTime={validDate}>{stamp}</time> : stamp}
          {validDate && (locale === "en" ? " · Beijing time" : " · 北京时间")}
        </span>
      </header>
      {summary}
      {filters}
      {scope}
      {beforeMetrics}
      <div className="dash-metrics dashboard-shell-metrics">{metrics}</div>
      <div className="dashboard-shell-charts">{children}</div>
      <div className="dashboard-shell-library">
        <Button variant="outline" onClick={onBrowse}>
          {libraryLabel}
          <ArrowUpRight size={15} />
        </Button>
      </div>
    </section>
  );
}

export function DashboardMetric({
  label,
  value,
  hint,
  icon: Icon,
  accent,
  comparison,
  disabled = false,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  accent?: boolean;
  comparison?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`dash-metric dashboard-shell-metric${accent ? " dash-metric-primary" : ""}`}
            aria-label={`${label}: ${value}. ${hint}`}
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
          >
            <span className="dash-metric-label">
              <Icon size={17} aria-hidden="true" />
              {label}
              <ArrowUpRight size={15} aria-hidden="true" />
            </span>
            <strong>{value}</strong>
            {comparison != null && <span className="dashboard-metric-comparison">{comparison}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent className="dashboard-metric-tooltip" sideOffset={6}>
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
