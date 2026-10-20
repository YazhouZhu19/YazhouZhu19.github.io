"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={tr(label)} aria-describedby={describedBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, name]) => (
          <SelectItem key={key} value={key}>
            {tr(name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
