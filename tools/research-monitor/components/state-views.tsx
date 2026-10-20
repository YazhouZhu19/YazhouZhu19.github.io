import type { ReactNode } from "react";
import { CircleAlert, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { useI18n } from "./locale-provider";
import "@/styles/state-views.css";

type StateProps = {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};
const classes = (kind: string, compact = false, className = "") =>
  `view-state view-state-${kind}${compact ? " view-state-compact" : ""} ${className}`;

export function LoadingState({ title, description, compact, className }: StateProps) {
  const { locale } = useI18n();
  return (
    <section
      className={classes("loading", compact, className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="view-state-title">{title ?? (locale === "en" ? "Loading content…" : "正在加载内容…")}</p>
      {description && <div className="view-state-description">{description}</div>}
      <div className="view-state-skeleton" aria-hidden="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </section>
  );
}

export function EmptyState({ title, description, action, compact, className }: StateProps) {
  const { locale } = useI18n();
  return (
    <section className={classes("empty", compact, className)} role="status">
      <Search size={24} aria-hidden="true" />
      <h3 className="view-state-title">
        {title ?? (locale === "en" ? "No matching records" : "没有符合条件的记录")}
      </h3>
      {description && <div className="view-state-description">{description}</div>}
      {action && <div className="view-state-actions">{action}</div>}
    </section>
  );
}

/** Local errors stay beside their action; the workspace owns the single global alert banner. */
export function ErrorState({
  title,
  description,
  action,
  compact,
  className,
  onRetry,
  retryLabel,
  retryDisabled = false,
}: StateProps & {
  onRetry?: () => void;
  retryLabel?: ReactNode;
  retryDisabled?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <section className={classes("error", compact, className)} role="status" aria-live="polite">
      <CircleAlert size={24} aria-hidden="true" />
      <h3 className="view-state-title">
        {title ?? (locale === "en" ? "Unable to load this content" : "暂时无法读取内容")}
      </h3>
      {description && <div className="view-state-description">{description}</div>}
      {(onRetry || action) && (
        <div className="view-state-actions">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} disabled={retryDisabled}>
              {retryLabel ?? (locale === "en" ? "Retry" : "重试")}
            </Button>
          )}
          {action}
        </div>
      )}
    </section>
  );
}
