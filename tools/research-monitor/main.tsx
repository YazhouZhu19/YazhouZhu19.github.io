import { createRoot } from "react-dom/client";
import MonitorWorkspace from "./components/monitor-workspace";
import { LocaleProvider } from "./components/locale-provider";
import "./styles/globals.css";

const locale = document.documentElement.lang === "en" ? "en" : "zh";
createRoot(document.getElementById("root")!).render(
  <LocaleProvider locale={locale}><MonitorWorkspace /></LocaleProvider>,
);
