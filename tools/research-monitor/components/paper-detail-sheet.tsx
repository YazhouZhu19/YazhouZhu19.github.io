import { useI18n } from "./locale-provider";
import { Button } from "@/components/ui/button";
import { lazy, Suspense, type ReactNode } from "react";
import { ArrowUpRight, Check, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TRACKS, TASKS } from "@/lib/classify";
import { fmtDate, fmtTime } from "@/lib/workspace-format";
import { PaperPicker } from "./paper-picker";
import type { PersonalDataState } from "@/hooks/use-personal-data";
const PaperPreliminaryAnalysis = lazy(() =>
  import("./paper-analysis").then((module) => ({ default: module.PaperPreliminaryAnalysis })),
);

type Props = Pick<
  PersonalDataState,
  "selected" | "setSelected" | "note" | "setNote" | "stage" | "setStage" | "saving" | "savePaper"
> & {
  storageAvailable: boolean;
  authenticated: boolean;
  accountControl: ReactNode;
};
export function PaperDetailSheet({
  selected,
  setSelected,
  note,
  setNote,
  stage,
  setStage,
  saving,
  savePaper,
  storageAvailable,
  authenticated,
  accountControl,
}: Props) {
  const { tr } = useI18n();
  return (
    <Sheet
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) setSelected(null);
      }}
    >
      <SheetContent className="paper-detail">
        <SheetHeader>
          <SheetTitle>{tr("论文详情")}</SheetTitle>
          <SheetDescription>{tr("查看原始证据、版本与阅读笔记。")}</SheetDescription>
        </SheetHeader>
        {selected && (
          <div className="detail-body">
            <div className="paper-meta">
              <Badge
                variant="secondary"
                className={selected.status === "preprint" ? "status-preprint" : "status-published"}
              >
                {selected.status === "preprint"
                  ? tr("预印本")
                  : selected.status === "published"
                    ? tr("正式发表")
                    : tr("状态未确认")}
              </Badge>
              <span>{selected.sources.join(" · ")}</span>
            </div>
            <h2>{selected.title}</h2>
            <p className="detail-authors">{selected.authors.map((a) => a.name).join(" · ")}</p>
            <Button asChild variant="outline">
              <a href={selected.url} target="_blank" rel="noreferrer">
                {tr("查看原始论文")}
                <ArrowUpRight size={16} />
              </a>
            </Button>
            <dl className="detail-dates">
              <div>
                <dt>{selected.source === "medRxiv" ? tr("该版本发布日期") : tr("来源发表 / 提交日期")}</dt>
                <dd>{tr(fmtDate(selected.publishedAt))}</dd>
              </div>
              <div>
                <dt>{tr("平台首次发现")}</dt>
                <dd>{fmtTime(selected.firstSeenAt)}</dd>
              </div>
              {selected.updatedAt && (
                <div>
                  <dt>{tr("来源更新时间")}</dt>
                  <dd>{fmtDate(selected.updatedAt)}</dd>
                </div>
              )}
              {selected.venue && (
                <div>
                  <dt>{tr("期刊 / 发表信息")}</dt>
                  <dd>{selected.venue}</dd>
                </div>
              )}
              {selected.doi && (
                <div>
                  <dt>{selected.source === "arXiv" ? tr("关联 DOI") : "DOI"}</dt>
                  <dd>{selected.doi}</dd>
                </div>
              )}
            </dl>
            {selected.relatedDoi && (
              <p className="related-publication">
                {tr("来源提供了正式发表关联：")}
                <a href={`https://doi.org/${selected.relatedDoi}`} target="_blank" rel="noreferrer">
                  {selected.relatedDoi}
                  <ArrowUpRight size={14} />
                </a>
              </p>
            )}
            <Suspense fallback={<Skeleton className="my-6 h-28 w-full rounded-xl" />}>
              <PaperPreliminaryAnalysis paper={selected} />
            </Suspense>
            <h3>{tr("原始摘要")}</h3>
            <p className="full-abstract">{selected.abstract || tr("来源未提供摘要。")}</p>
            <h3>{tr("自动分类")}</h3>
            <div className="tag-row">
              {[
                ...new Set([
                  ...selected.tracks.map((t) => TRACKS[t]),
                  ...selected.tasks.map((t) => TASKS[t]),
                  ...selected.modalities,
                  ...selected.organs,
                  ...selected.methods,
                ]),
              ]
                .filter(Boolean)
                .map((t) => (
                  <span className="tag" key={t}>
                    {tr(t)}
                  </span>
                ))}
            </div>
            <p className="detail-hint">{tr("基于标题与摘要规则匹配；标签不构成研究质量或临床效果判断。")}</p>
            <h3>{tr("人参与线索")}</h3>
            {selected.evidence.length ? (
              selected.evidence.map((e, i) => (
                <div className="evidence" key={i}>
                  <strong>{tr(e.label)}</strong>
                  <blockquote>…{e.excerpt}…</blockquote>
                </div>
              ))
            ) : (
              <p className="detail-hint">{tr("摘要中未检出明确线索，不能据此认定研究没有人参与。")}</p>
            )}
            {selected.humanSignals.includes("simulated") && (
              <div className="notice">{tr("检出模拟交互表述，不能将模拟点击视为真实医生使用证据。")}</div>
            )}
            <h3>{tr("作者机构")}</h3>
            {selected.affiliations.length ? (
              <ul className="affiliation-list">
                {selected.affiliations.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="detail-hint">{tr("来源未提供机构，未推断当前任职。")}</p>
            )}
            <p className="detail-hint">{tr("机构为论文署名信息；medRxiv 通常仅提供通讯作者机构。")}</p>
            {authenticated ? (
              <>
                <h3>{tr("我的阅读笔记")}</h3>
                <PaperPicker
                  label={tr("阅读状态")}
                  value={stage}
                  onChange={setStage}
                  options={["待读", "已读", "选题候选", "暂不相关"].map((x) => [x, x])}
                />
                <Textarea
                  className="note-input"
                  aria-label={tr("阅读笔记")}
                  placeholder={tr("与我们课题的关系、可复现之处、值得验证的问题\u2026")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button onClick={() => void savePaper(selected, true)} disabled={saving || !storageAvailable}>
                  {saving ? <RefreshCw className="animate-spin" /> : <Check />}
                  {tr("保存笔记与收藏")}
                </Button>
              </>
            ) : (
              <div className="public-note-login">
                <p>{tr("登录后可保存个人收藏与阅读笔记。")}</p>
                {accountControl}
              </div>
            )}
            <h3>{tr("记录来源")}</h3>
            {selected.provenance.slice(-3).map((p, i) => (
              <p key={i} className="detail-hint">
                {tr("源记录 ")}
                {p.sourceRecordId ?? tr("未提供")}
                {tr(" \u00B7 采集于 ")}
                {fmtTime(p.collectedAt)}
              </p>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
