import { createRoot } from "react-dom/client";
import MonitorWorkspace from "./components/monitor-workspace";
import { LocaleProvider } from "./components/locale-provider";
import "./styles/globals.css";
import "./styles/analysis.css";
import "./styles/paper-analysis.css";
import "./styles/living.css";
import "./styles/living-analysis.css";
import "./styles/typography.css";

const locale = document.documentElement.lang === "en" ? "en" : "zh";
createRoot(document.getElementById("root")!).render(
  <LocaleProvider locale={locale}><MonitorWorkspace /></LocaleProvider>,
);
