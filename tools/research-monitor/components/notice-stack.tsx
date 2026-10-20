import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useI18n } from "./locale-provider";
import "@/styles/notice-stack.css";

export type WorkspaceNotice = {
  id: string;
  severity: "error" | "warning" | "info";
  content: ReactNode;
  action?: ReactNode;
};

/** Keeps complete messages and actions while limiting the stack to one error banner. */
export function NoticeStack({ notices }: { notices: WorkspaceNotice[] }) {
  const { locale } = useI18n();
  const errors = notices.filter((notice) => notice.severity === "error");
  const warnings = notices.filter((notice) => notice.severity === "warning");
  const information = notices.filter((notice) => notice.severity === "info");
  if (!notices.length) return null;
  const rows = (items: WorkspaceNotice[]) =>
    items.map((notice) => (
      <div className="notice-stack-row" key={notice.id}>
        <div>{notice.content}</div>
        {notice.action && <div className="notice-stack-action">{notice.action}</div>}
      </div>
    ));
  return (
    <div className="notice-stack">
      {errors.length > 0 && (
        <div className="notice error notice-stack-error" role="alert">
          {rows(errors)}
        </div>
      )}
      {(warnings.length > 0 || information.length > 0) && (
        <div className="notice-stack-status">
          {warnings.length > 0 && (
            <details className="notice-stack-warning">
              <summary>
                <AlertTriangle size={14} aria-hidden="true" />
                {locale === "en" ? "Source notices" : "来源提示"}
                <span>{warnings.length}</span>
              </summary>
              <div className="notice-stack-details">{rows(warnings)}</div>
            </details>
          )}
          {information.length > 0 && (
            <details className="notice-stack-info">
              <summary>
                <Info size={14} aria-hidden="true" />
                {locale === "en" ? "About this data" : "了解数据口径"}
              </summary>
              <div className="notice-stack-details">{rows(information)}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
