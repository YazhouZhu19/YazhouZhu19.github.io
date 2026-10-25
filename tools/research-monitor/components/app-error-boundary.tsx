import { Component, type ReactNode } from "react";
import { useI18n } from "./locale-provider";
import { ErrorState } from "./state-views";

function AppRecovery() {
  const { locale } = useI18n();
  const en = locale === "en";
  return (
    <main>
      <ErrorState
        title={en ? "This page could not be loaded" : "页面加载遇到问题"}
        description={
          en
            ? "A site update or interrupted connection may have prevented content from loading. Reload to try again. The current page link and saved personal data remain; unsaved form input may be lost."
            : "站点更新或网络中断可能导致内容加载失败。刷新后重试：当前页面链接与已保存的个人数据将保留，未保存的表单输入可能丢失。"
        }
        retryLabel={en ? "Reload page" : "刷新页面"}
        onRetry={() => window.location.reload()}
      />
    </main>
  );
}

/** Keep a rejected lazy import from unmounting the only visible recovery action. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <AppRecovery /> : this.props.children;
  }
}
