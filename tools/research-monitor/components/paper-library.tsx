import { LoadingState, ErrorState, EmptyState } from "./state-views";
import "@/styles/paper-library.css";
import "@/styles/render-containment.css";
import { useI18n } from "./locale-provider";
import { Button } from "@/components/ui/button";
import { Download, ChevronRight, Bookmark, BookmarkCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TRACKS, TASKS, HUMAN_LABELS } from "@/lib/classify";
import { fmtDate } from "@/lib/workspace-format";
import { PaperPicker } from "./paper-picker";
import type { PaperLibraryState } from "@/hooks/use-paper-library";
import type { PersonalDataState } from "@/hooks/use-personal-data";
type Props = {
  view: string;
  library: PaperLibraryState;
  storageAvailable: boolean;
  personal: Pick<
    PersonalDataState,
    "saving" | "savedIds" | "collectionById" | "openPaper" | "savePaper" | "removePaper"
  >;
  onExport: () => void;
};
export function PaperLibrary({ view, library, personal, storageAvailable, onExport: exportCsv }: Props) {
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const {
    track,
    sort,
    setSort,
    filtered,
    searchReady,
    searchFailed,
    setSearchAttempt,
    reset,
    limit,
    setLimit,
  } = library;
  const { saving, savedIds, collectionById, openPaper, savePaper, removePaper } = personal;
  return (
    <section className="paper-section">
      <div className="section-heading">
        <div>
          <h2>
            {view === "saved"
              ? tr("我的选题库")
              : track === "all"
                ? ui("全部论文", "All papers")
                : tr(TRACKS[track])}{" "}
            <span>
              {filtered.length}
              {tr(" 条")}
            </span>
          </h2>
          <p className="section-caption">{tr("按 DOI / 来源标识去重 \u00B7 自动标签待复核")}</p>
        </div>
        <div className="list-tools">
          <PaperPicker
            label={tr("排序")}
            value={sort}
            onChange={setSort}
            options={[
              ["newest", "来源日期 ↓"],
              ["oldest", "来源日期 ↑"],
              ["discovered", "发现时间 ↓"],
            ]}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("导出当前筛选记录")}
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            <Download size={16} />
          </Button>
        </div>
      </div>
      {!searchReady ? (
        <LoadingState title={<>{ui("正在检索论文…", "Searching papers…")}</>} />
      ) : searchFailed ? (
        <ErrorState
          description={<>{ui("搜索暂时不可用，请重试。", "Search is unavailable. Please try again.")}</>}
          action={
            <>
              <Button variant="outline" onClick={() => setSearchAttempt((value) => value + 1)}>
                {ui("重试", "Retry")}
              </Button>
            </>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={<>{view === "saved" ? tr("还没有符合条件的收藏") : tr("没有符合条件的记录")}</>}
          description={
            <>
              {view === "saved"
                ? tr("在论文详情里收藏论文、添加阅读笔记。")
                : tr("尝试移除部分筛选，或同步最新论文。")}
            </>
          }
          action={
            <>
              <Button className="mt-4" variant="outline" onClick={reset}>
                {tr("清除筛选")}
              </Button>
            </>
          }
        />
      ) : (
        filtered.slice(0, limit).map((p) => (
          <article key={p.id} className="paper-row">
            <div className="paper-main">
              <div className="paper-meta">
                <Badge
                  className={p.status === "preprint" ? "status-preprint" : "status-published"}
                  variant="secondary"
                >
                  {p.status === "preprint"
                    ? tr("预印本")
                    : p.status === "published"
                      ? tr("正式发表")
                      : tr("状态未确认")}
                </Badge>
                <span>{p.sources.join(" · ")}</span>
                <span>
                  {tr(fmtDate(p.publishedAt))}
                  {p.source === "medRxiv" ? tr(" \u00B7 版本日期") : ""}
                </span>
                {p.dateAnomaly === "future" && (
                  <Badge variant="outline">{ui("日期待核实", "Date pending verification")}</Badge>
                )}
                {p.version && <span>v{p.version}</span>}
                {p.publishedAt > new Date().toISOString().slice(0, 10) && (
                  <span>{tr("来源标注未来日期")}</span>
                )}
              </div>
              <button className="paper-title" onClick={() => openPaper(p)}>
                {p.title}
                <ChevronRight size={17} />
              </button>
              <div className="paper-authors">
                {p.authors
                  .slice(0, 4)
                  .map((a) => a.name)
                  .join(" · ")}
                {p.authors.length > 4 ? tr(" 等 {0} 位作者", [p.authors.length]) : ""}
              </div>
              <p className="abstract-preview">{p.abstract || tr("来源未提供摘要")}</p>
              <div className="tag-row">
                {p.tasks.slice(0, 2).map((t) => (
                  <span className="tag task-tag" key={t}>
                    {tr(TASKS[t])}
                  </span>
                ))}
                {p.modalities.slice(0, 2).map((t) => (
                  <span className="tag" key={t}>
                    {tr(t)}
                  </span>
                ))}
                {p.humanSignals
                  .filter((t) => t !== "annotation" && t !== "simulated")
                  .slice(0, 1)
                  .map((t) => (
                    <span className="tag human-tag" key={t}>
                      {tr(HUMAN_LABELS[t])}
                    </span>
                  ))}
                {view === "saved" && (
                  <span className="tag saved-tag">{tr(collectionById.get(p.id)?.stage ?? "")}</span>
                )}
              </div>
              {view === "saved" && collectionById.get(p.id)?.note && (
                <p className="saved-note">{collectionById.get(p.id)?.note}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={savedIds.has(p.id) ? tr("取消收藏：{0}", [p.title]) : tr("收藏：{0}", [p.title])}
              onClick={() => (savedIds.has(p.id) ? void removePaper(p) : void savePaper(p))}
              disabled={saving || !storageAvailable}
            >
              {savedIds.has(p.id) ? <BookmarkCheck className="saved-icon" /> : <Bookmark />}
            </Button>
          </article>
        ))
      )}
      {filtered.length > limit && (
        <div className="load-more">
          <Button variant="outline" onClick={() => setLimit((l) => l + 30)}>
            {tr("再显示 30 条 \u00B7 剩余 ")}
            {filtered.length - limit}
            {tr(" 条")}
          </Button>
        </div>
      )}
    </section>
  );
}
