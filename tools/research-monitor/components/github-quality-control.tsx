import { useI18n } from "./locale-provider";
import type { GitHubMaturity } from "@/lib/github-quality";
import "@/styles/github-quality.css";
export function GitHubQualityControl({
  counts,
  includeEarly,
  library,
  onChange,
}: {
  counts: Record<GitHubMaturity, number>;
  includeEarly: boolean;
  library: boolean;
  onChange: (value: boolean) => void;
}) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  return (
    <div className="github-quality-control">
      <p>
        {t(
          `库内成熟度：已有积累 ${counts.established.toLocaleString()} · 近期活跃 ${counts.active.toLocaleString()} · 早期 ${counts.early.toLocaleString()}`,
          `Library maturity: ${counts.established.toLocaleString()} established · ${counts.active.toLocaleString()} active · ${counts.early.toLocaleString()} early`,
        )}
      </p>
      {library ? (
        <p>
          {t(
            "资源库保留全部成熟度层级，可搜索早期仓库。",
            "The library searches all maturity levels, including early repositories.",
          )}
        </p>
      ) : (
        <label>
          <input
            type="checkbox"
            checked={includeEarly}
            onChange={(event) => onChange(event.target.checked)}
          />
          {t("包含早期仓库", "Include early repositories")}
        </label>
      )}
      <details>
        <summary>{t("成熟度口径", "Maturity definitions")}</summary>
        <p>
          {t(
            "已有积累：Stars ≥ 50、Forks ≥ 10，或有 DOI/arXiv 链接且 Stars ≥ 10。近期活跃：180 天内有推送，且有许可证、至少 200 字符 README 摘录或 Stars ≥ 5。其他归为早期；已归档仓库最高归为近期活跃。按快照时间计算，元数据缺失不等于项目无价值；Stars 与分层均不代表科学质量或临床有效性。",
            "Established: at least 50 stars, 10 forks, or a DOI/arXiv link and 10 stars. Active: a push within 180 days plus an identified license, a README excerpt of at least 200 characters, or 5 stars. Other repositories are early; archived repositories are capped at active. Classification uses the snapshot date. Missing metadata does not establish lack of value; neither stars nor maturity establishes scientific quality or clinical validity.",
          )}
        </p>
      </details>
    </div>
  );
}
