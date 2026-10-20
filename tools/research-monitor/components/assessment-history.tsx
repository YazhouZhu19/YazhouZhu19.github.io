import "@/styles/foresight.css";
import { useEffect, useState } from "react";
import { Download, History } from "lucide-react";
import type { ForesightResult } from "@/lib/foresight-types";
import {
  ASSESSMENT_HISTORY_KEY,
  assessmentChanges,
  emptyAssessmentHistory,
  readAssessmentHistory,
  recordAssessment,
  reviewAssessment,
  serializeAssessmentHistory,
  type AssessmentHistory as HistoryData,
  type AssessmentRevision,
} from "@/lib/assessment-history";
import { useI18n } from "./locale-provider";

export function AssessmentHistory({ result }: { result: ForesightResult }) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [history, setHistory] = useState<HistoryData>(emptyAssessmentHistory);
  const [error, setError] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [verdict, setVerdict] = useState<AssessmentRevision["review"]>("pending");
  useEffect(() => {
    try {
      const saved = readAssessmentHistory(window.localStorage.getItem(ASSESSMENT_HISTORY_KEY));
      const next = recordAssessment(saved, result, new Date().toISOString());
      if (next !== saved)
        window.localStorage.setItem(ASSESSMENT_HISTORY_KEY, serializeAssessmentHistory(next));
      setHistory(next);
      setError(false);
      setReviewing(null);
    } catch {
      setError(true);
      setHistory(emptyAssessmentHistory());
    }
  }, [result.key, result.fingerprint]);
  const revisions = history.contexts[result.key] ?? [];
  const exportHistory = () => {
    try {
      const saved = readAssessmentHistory(window.localStorage.getItem(ASSESSMENT_HISTORY_KEY));
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "research-assessment-history.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(true);
    }
  };
  const saveReview = () => {
    if (!reviewing) return;
    try {
      const saved = readAssessmentHistory(window.localStorage.getItem(ASSESSMENT_HISTORY_KEY));
      const next = reviewAssessment(saved, result.key, reviewing, verdict, note);
      window.localStorage.setItem(ASSESSMENT_HISTORY_KEY, serializeAssessmentHistory(next));
      setHistory(next);
      setReviewing(null);
    } catch {
      setError(true);
    }
  };
  const label = (review: AssessmentRevision["review"]) =>
    ({
      pending: t("待核验", "Awaiting review"),
      supported: t("人工复核：得到支持", "Reviewed: supported"),
      "not-supported": t("人工复核：未获支持", "Reviewed: not supported"),
      unclear: t("人工复核：尚不明确", "Reviewed: inconclusive"),
    })[review];
  return (
    <details className="assessment-history">
      <summary>
        <History size={16} />
        {t("判断如何变化", "How assessments change")}
        <span>
          {revisions.length
            ? t(`${revisions.length} 个本机版本`, `${revisions.length} local versions`)
            : t("从首次查看开始记录", "Recorded from your first visit")}
        </span>
      </summary>
      <p className="assessment-history-note">
        {t(
          "仅记录本浏览器实际查看过的版本，最多保留每个范围 12 版、40 个范围。新论文、时间窗口或元数据修订都可能改变判断；退出候选不等于预测被证伪。历史与人工复核仅存本机，单独导出后可留存。",
          "Records versions actually viewed in this browser: up to 12 per scope and 40 scopes. New papers, rolling windows or metadata corrections can change an assessment; removal is not disproof. History and manual reviews stay on this device and can be exported separately.",
        )}
      </p>
      {error ? (
        <p role="status">
          {t(
            "本机研判历史暂时不可用；已有内容未被覆盖，当前研判仍可阅读。",
            "Local assessment history is unavailable. Existing content was not overwritten; current assessments remain readable.",
          )}
        </p>
      ) : (
        <>
          {revisions.length > 0 && (
            <button className="assessment-history-export" onClick={exportHistory}>
              <Download size={14} />
              {t("导出研判历史", "Export assessment history")}
            </button>
          )}
          <ol>
            {revisions.map((revision, index) => {
              const changes = assessmentChanges(revision, revisions[index + 1]);
              return (
                <li key={revision.id}>
                  <div className="assessment-history-heading">
                    <time dateTime={revision.recordedAt}>
                      {new Date(revision.recordedAt).toLocaleString(locale === "en" ? "en-GB" : "zh-CN", {
                        timeZone: "Asia/Shanghai",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <strong>
                      {changes.initial
                        ? t("首次记录", "First record")
                        : t(
                            `新增 ${changes.added} · 修订 ${changes.changed} · 退出候选 ${changes.removed}`,
                            `New ${changes.added} · Revised ${changes.changed} · Removed ${changes.removed}`,
                          )}
                    </strong>
                  </div>
                  <p>
                    {t("依据截至 ", "Evidence as of ")}
                    {revision.asOf} · {label(revision.review)}
                    {changes.stronger > 0 &&
                      t(` · ${changes.stronger} 条证据增强`, ` · ${changes.stronger} strengthened`)}
                    {changes.weaker > 0 &&
                      t(` · ${changes.weaker} 条证据减弱`, ` · ${changes.weaker} weakened`)}
                  </p>
                  <details>
                    <summary>{t("查看当时判断", "View that assessment")}</summary>
                    {revision.cards.map((card) => (
                      <div className="assessment-history-prior" key={card.id}>
                        <strong>{card.title[locale]}</strong>
                        <p>{card.forecast[locale]}</p>
                        <small>
                          {t(`${card.evidenceCount} 篇支持记录`, `${card.evidenceCount} supporting records`)}
                        </small>
                      </div>
                    ))}
                    {!revision.cards.length && (
                      <p>
                        {t(
                          "当次没有满足证据条件的候选判断。",
                          "No hypotheses met the evidence threshold at that time.",
                        )}
                      </p>
                    )}
                  </details>
                  {revision.note && <blockquote>{revision.note}</blockquote>}
                  <button
                    onClick={() => {
                      setReviewing(revision.id);
                      setNote(revision.note);
                      setVerdict(revision.review);
                    }}
                  >
                    {t("记录人工复核", "Record a manual review")}
                  </button>
                  {reviewing === revision.id && (
                    <div className="assessment-review-form">
                      <label>
                        {t("复核结论", "Review outcome")}
                        <select
                          value={verdict}
                          onChange={(e) => setVerdict(e.target.value as AssessmentRevision["review"])}
                        >
                          {(["pending", "supported", "not-supported", "unclear"] as const).map((v) => (
                            <option key={v} value={v}>
                              {label(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t("依据或后续论文", "Evidence or follow-up papers")}
                        <textarea
                          value={note}
                          maxLength={2000}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={t(
                            "记录支持或反驳原判断的证据；不会自动计作预测准确率。",
                            "Record evidence supporting or challenging this assessment; this does not calculate prediction accuracy.",
                          )}
                        />
                      </label>
                      <div>
                        <button onClick={saveReview}>{t("保存复核", "Save review")}</button>
                        <button onClick={() => setReviewing(null)}>{t("取消", "Cancel")}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!revisions.length && (
            <p>
              {t(
                "证据满足条件后开始记录，尚无历史预测。",
                "Recording begins when a hypothesis meets the evidence threshold. No earlier predictions are available.",
              )}
            </p>
          )}
        </>
      )}
    </details>
  );
}
