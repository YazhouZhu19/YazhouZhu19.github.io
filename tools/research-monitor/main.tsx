import { createRoot } from "react-dom/client";
import MonitorWorkspace from "./components/monitor-workspace";
import { LocaleProvider } from "./components/locale-provider";
import { AppErrorBoundary } from "./components/app-error-boundary";
import "./styles/globals.css";
import "./styles/typography.css";
import "./styles/accessibility.css";

const locale = document.documentElement.lang === "en" ? "en" : "zh";
createRoot(document.getElementById("root")!).render(
  <LocaleProvider locale={locale}>
    <AppErrorBoundary>
      <MonitorWorkspace />
    </AppErrorBoundary>
  </LocaleProvider>,
);
