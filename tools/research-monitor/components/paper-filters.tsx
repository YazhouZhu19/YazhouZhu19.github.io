import { useI18n } from "./locale-provider";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TRACKS, TASKS, HUMAN_LABELS } from "@/lib/classify";
import { PaperPicker } from "./paper-picker";
import type { PaperLibraryState } from "@/hooks/use-paper-library";
export function PaperFilters({ library }: { library: PaperLibraryState }) {
  const { locale, tr } = useI18n();
  const ui = (zh: string, en: string) => (locale === "en" ? en : zh);
  const {
    search,
    setSearch,
    track,
    chooseTrack,
    period,
    setPeriod,
    advanced,
    setAdvanced,
    task,
    modality,
    organ,
    method,
    source,
    status,
    human,
    setTask,
    setModality,
    setOrgan,
    setMethod,
    setSource,
    setStatus,
    setHuman,
    modalities,
    organs,
    methods,
    sources,
    reset,
  } = library;
  return (
    <div className="filter-panel library-filters">
      <div className="library-primary-filters">
        <div className="search-box">
          <Search size={18} />
          <Input
            aria-label={tr("搜索论文")}
            placeholder={tr("搜索论文、方法、作者、疾病或 DOI…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <PaperPicker
          label={tr("感兴趣方向筛选")}
          value={track}
          onChange={chooseTrack}
          options={[["all", "全部感兴趣方向"], ...Object.entries(TRACKS)]}
        />
        <PaperPicker
          label={tr("记录日期范围")}
          value={period}
          onChange={setPeriod}
          options={[
            ["all", "全部记录日期"],
            ["30", "近 30 天"],
            ["90", "近 90 天"],
            ["365", "近一年"],
          ]}
        />
        <Button
          variant="outline"
          aria-expanded={advanced}
          aria-controls="advanced-paper-filters"
          onClick={() => setAdvanced((v) => !v)}
        >
          <SlidersHorizontal size={15} />
          {ui("高级筛选", "More filters")}
          {[task, modality, organ, method, source, status, human].filter((v) => v !== "all").length > 0 && (
            <span className="filter-active-count">
              {[task, modality, organ, method, source, status, human].filter((v) => v !== "all").length}
            </span>
          )}
        </Button>
      </div>
      {advanced && (
        <div className="filter-row" id="advanced-paper-filters">
          <PaperPicker
            label={tr("研究任务")}
            value={task}
            onChange={setTask}
            options={[["all", "全部研究任务"], ...Object.entries(TASKS)]}
          />
          <PaperPicker
            label={tr("影像模态")}
            value={modality}
            onChange={setModality}
            options={[["all", "全部模态"], ...modalities.map((x) => [x, x] as [string, string])]}
          />
          <PaperPicker
            label={tr("器官或疾病")}
            value={organ}
            onChange={setOrgan}
            options={[["all", "全部器官 / 疾病"], ...organs.map((x) => [x, x] as [string, string])]}
          />
          <PaperPicker
            label={tr("研究方法")}
            value={method}
            onChange={setMethod}
            options={[["all", "全部研究方法"], ...methods.map((x) => [x, x] as [string, string])]}
          />
          <PaperPicker
            label={tr("数据来源")}
            value={source}
            onChange={setSource}
            options={[["all", "全部来源"], ...sources.map((x) => [x, x] as [string, string])]}
          />
          <PaperPicker
            label={tr("发表状态")}
            value={status}
            onChange={setStatus}
            options={[
              ["all", "全部发表状态"],
              ["preprint", "预印本"],
              ["published", "正式发表"],
            ]}
          />
          <PaperPicker
            label={tr("人参与线索")}
            value={human}
            onChange={setHuman}
            options={[["all", "全部线索"], ...Object.entries(HUMAN_LABELS)]}
          />
          <Button variant="ghost" size="sm" onClick={reset}>
            {tr("重置")}
          </Button>
        </div>
      )}
    </div>
  );
}
