import { TASK_CLASSIFIER_VERSION } from "@/lib/classify";
import { DashboardChoice } from "./dashboard-choice";
import { useI18n } from "./locale-provider";
import type { paperScopeCounts } from "@/lib/paper-scope";
import "@/styles/paper-scope.css";
export function PaperScopeControl({
  value,
  counts,
  onChange,
}: {
  value?: string;
  counts: ReturnType<typeof paperScopeCounts>;
  onChange: (scope: string) => void;
}) {
  const { tr, locale } = useI18n();
  const selection = value ?? "core";
  return (
    <section className="paper-scope-control" aria-label={tr("论文研究范围")}>
      <DashboardChoice
        label="论文研究范围"
        value={selection}
        onChange={onChange}
        options={[
          ["core", "仅方法研究"],
          ["adjacent", "含影像临床研究"],
          ["all", "全部记录"],
        ]}
      />
      <p>
        {selection === "core"
          ? tr("当前显示方法研究 {0} 篇，另有影像临床研究 {1} 篇、其他 {2} 篇未计入。", [
              counts.core,
              counts.adjacent,
              counts.out,
            ])
          : tr("方法研究 {0} 篇 · 影像临床研究 {1} 篇 · 其他 {2} 篇", [
              counts.core,
              counts.adjacent,
              counts.out,
            ])}
        {selection !== "all" && (
          <button type="button" onClick={() => onChange("all")}>
            {tr("显示全部记录")}
          </button>
        )}
      </p>
      <details className="scope-version-note">
        <summary>{locale === "en" ? "Scope and label definitions" : "研究范围与标签口径"}</summary>
        <small>{tr("范围由标题与摘要自动判断，仍有误判；切换全部记录可复核。")}</small>
        <small>
          {tr("诊断标签自 {0} 起要求检测、分类或准确性证据；跨口径数量不直接比较。", [
            TASK_CLASSIFIER_VERSION.slice(0, 10),
          ])}
        </small>
      </details>
    </section>
  );
}
