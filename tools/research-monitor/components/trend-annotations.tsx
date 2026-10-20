"use client";
import { useI18n } from "./locale-provider";
import { markersInBuckets, type CollectionChangeMarker, type WindowComparison } from "@/lib/trend-statistics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export function CollectionMarkerLines({
  markers = [],
  dates,
  x,
  top,
  bottom,
}: {
  markers?: CollectionChangeMarker[];
  dates: string[];
  x: (index: number) => number;
  top: number;
  bottom: number;
}) {
  const { locale } = useI18n();
  const grouped = new Map<number, ReturnType<typeof markersInBuckets>>();
  for (const marker of markersInBuckets(markers, dates)) {
    const row = grouped.get(marker.index) ?? [];
    row.push(marker);
    grouped.set(marker.index, row);
  }
  return (
    <>
      {[...grouped].map(([index, rows]) => (
        <g key={index} pointerEvents="none">
          <path
            d={`M${x(index)},${top}V${bottom}`}
            stroke="var(--muted-foreground)"
            strokeWidth="1.2"
            strokeDasharray="2 3"
          />
          <circle cx={x(index)} cy={top} r="3" fill="var(--muted-foreground)" />
          <title>
            {rows
              .map((row) => `${row.day}: ${locale === "en" ? row.labelEn : row.labelZh} (${row.evidence})`)
              .join("; ")}
          </title>
        </g>
      ))}
    </>
  );
}

export function CollectionMarkerLegend({
  markers = [],
  dates,
}: {
  markers?: CollectionChangeMarker[];
  dates: string[];
}) {
  const { locale } = useI18n();
  const visible = markersInBuckets(markers, dates);
  if (!visible.length) return null;
  return (
    <details className="dash-series-detail collection-marker-notes">
      <summary>
        {locale === "en"
          ? "Dotted lines: collection / classification rule versions"
          : "竖虚线：采集／分类口径版本日期"}
      </summary>
      <ul>
        {visible.map((marker) => (
          <li key={marker.id}>
            <time>{marker.day}</time> · {locale === "en" ? marker.labelEn : marker.labelZh}
            <small> · {marker.evidence}</small>
          </li>
        ))}
      </ul>
      <p>
        {locale === "en"
          ? "Version dates describe collection or classification rules. Recent source-check timestamps do not establish when a source was first added; unavailable history is not inferred."
          : "版本日期对应采集或分类规则。近期检查时间不能证明来源的接入日期；缺失的历史不作推断。"}
      </p>
    </details>
  );
}

export function WindowComparisonReadout({
  comparison,
  label,
}: {
  comparison?: WindowComparison | null;
  label: (id: string) => string;
}) {
  const { locale } = useI18n();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  if (!comparison) return null;
  const percent = (value: number | undefined) => (value === undefined ? "—" : `${(value * 100).toFixed(1)}%`);
  const point = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}`;
  return (
    <details className="dash-series-detail">
      <summary>{t("相邻窗口占比对比 · 95% 区间", "Adjacent-window shares · 95% intervals")}</summary>
      <p>
        {comparison.from}–{comparison.to} (n={comparison.currentTotal}) · {t("前窗", "previous")}{" "}
        {comparison.previousFrom}–{comparison.previousTo} (n={comparison.previousTotal})
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("方向", "Direction")}</TableHead>
            <TableHead>{t("当前占比", "Current share")}</TableHead>
            <TableHead>{t("前窗占比", "Previous share")}</TableHead>
            <TableHead>{t("差值与 95% 区间（百分点）", "Difference and 95% interval (pp)")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparison.categories.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{label(row.id)}</TableCell>
              <TableCell>
                {percent(row.current?.estimate)}
                {row.current && (
                  <small>
                    {" "}
                    [{percent(row.current.lower)}, {percent(row.current.upper)}]
                  </small>
                )}
              </TableCell>
              <TableCell>
                {percent(row.previous?.estimate)}
                {row.previous && (
                  <small>
                    {" "}
                    [{percent(row.previous.lower)}, {percent(row.previous.upper)}]
                  </small>
                )}
              </TableCell>
              <TableCell>
                {row.sufficient && row.delta !== null && row.interval
                  ? `${point(row.delta)} [${point(row.interval.lower)}, ${point(row.interval.upper)}]`
                  : t("样本不足（任一窗 n < 30）", "Insufficient sample (either n < 30)")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p>
        {t(
          "分母为同期、同来源筛选内的全部记录；多标签占比不可相加。单窗为 Wilson 95% 区间，差值使用两窗 Wilson 区间推导。库内记录不是随机样本，区间不涵盖漏收、规则变更与来源偏差。",
          "Denominators are all records in the same time/source scope; overlapping labels do not sum to 100%. Single-window intervals use Wilson; difference intervals combine the two Wilson estimates. Archive coverage is not a random sample; intervals exclude retrieval, rule and source bias.",
        )}
      </p>
    </details>
  );
}
