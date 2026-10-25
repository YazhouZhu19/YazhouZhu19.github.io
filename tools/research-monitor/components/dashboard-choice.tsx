"use client";

import { useI18n } from "./locale-provider";

/** Shared selection control for dashboard filters and chart date selectors. */
export function DashboardChoice({
  id,
  label,
  value,
  onChange,
  options,
  describedBy,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  describedBy?: string;
}) {
  const { tr } = useI18n();
  return (
    <select
      id={id}
      data-slot="select-trigger"
      aria-label={tr(label)}
      aria-describedby={describedBy}
      title={tr(options.find(([key]) => key === value)?.[1] ?? value)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 max-w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {options.map(([key, name]) => (
        <option key={key} value={key}>
          {tr(name)}
        </option>
      ))}
    </select>
  );
}
