import { useI18n } from "./locale-provider";
import { ArrowUpRight, Database, Focus } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { nav, auxiliaryNav } from "@/lib/workspace-navigation";
import { fmtTime } from "@/lib/workspace-format";
import type { MonitorData } from "@/lib/types";
import type { ResearchSignalsData } from "@/lib/research-signals";
function NavButton(props: React.ComponentProps<typeof SidebarMenuButton>) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        setOpenMobile(false);
      }}
    />
  );
}

type Props = {
  view: string;
  setView: (view: string) => void;
  savedCount: number;
  data: MonitorData | null;
  signals: ResearchSignalsData | null;
  sourceRecordCount: number;
};
export function AppSidebar({ view, setView, savedCount, data, signals, sourceRecordCount }: Props) {
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const signalsView = view === "github" || view === "news";
  const paperDashboardView = view === "dashboard" || view === "feed" || view === "analysis";
  return (
    <Sidebar>
      <SidebarHeader className="brand">
        <div className="brand-symbol">
          <Focus size={25} />
        </div>
        <div className="brand-copy">
          <strong>OEVRYN Engine</strong>
          <span>
            {ui("汇聚研究证据，", "Research Intelligence for")}
            <br />
            {ui("洞察医学影像前沿", "Medical Image Analysis")}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{tr("研究工作台")}</SidebarGroupLabel>
          <SidebarMenu className="workspace-main-nav">
            {nav.map((n) => (
              <SidebarMenuItem key={n.id}>
                <NavButton
                  isActive={view === n.id || (n.id === "dashboard" && paperDashboardView)}
                  size="lg"
                  onClick={() => setView(n.id)}
                >
                  <n.icon />
                  <span>{ui(n.label, n.en)}</span>
                </NavButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {auxiliaryNav.map((n) => (
            <SidebarMenuItem key={n.id}>
              <NavButton isActive={view === n.id} onClick={() => setView(n.id)}>
                <n.icon />
                <span>{ui(n.label, n.en)}</span>
                {n.id === "saved" && savedCount > 0 && <span className="nav-count">{savedCount}</span>}
              </NavButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <div className="sidebar-note">
          <Database size={15} />
          <span>
            {signalsView
              ? signals
                ? ui(
                    `${sourceRecordCount.toLocaleString()} ${view === "github" ? "个项目" : "条消息"}`,
                    `${sourceRecordCount.toLocaleString()} ${view === "github" ? "repositories" : "announcements"}`,
                  )
                : ui("读取来源数据", "Loading source data")
              : data
                ? ui(
                    `${data.papers.length.toLocaleString()} 条论文记录`,
                    `${data.papers.length.toLocaleString()} paper records`,
                  )
                : tr("读取论文库")}
            <br />
            <small>
              {tr("最后更新 ")}
              {tr(fmtTime(signalsView ? signals?.generatedAt : data?.collectedAt))}
            </small>
          </span>
        </div>
        <a className="homepage-link" href="https://yazhouzhu19.github.io/" target="_blank" rel="noreferrer">
          {tr("Yazhou Zhu · 个人主页 ")}
          <ArrowUpRight size={13} />
        </a>
      </SidebarFooter>
    </Sidebar>
  );
}
