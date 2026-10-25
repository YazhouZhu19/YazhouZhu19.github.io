import { LayoutDashboard, GitBranch, Newspaper, Focus, Users, Bookmark, Database } from "lucide-react";
export const nav = [
  { id: "dashboard", label: "论文洞察", en: "Paper insights", icon: LayoutDashboard },
  { id: "github", label: "开源洞察", en: "Open-source insights", icon: GitBranch },
  { id: "news", label: "前沿动态", en: "Frontier updates", icon: Newspaper },
  { id: "foresight", label: "方向研判", en: "Research outlook", icon: Focus },
  { id: "teams", label: "PI / 团队", en: "PI / Teams", icon: Users },
];
export const auxiliaryNav = [
  { id: "saved", label: "我的收藏", en: "Saved papers", icon: Bookmark },
  { id: "sources", label: "数据与同步", en: "Data & sync", icon: Database },
];
