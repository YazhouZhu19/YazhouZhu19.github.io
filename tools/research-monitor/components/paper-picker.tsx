import { useI18n } from "./locale-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export function PaperPicker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const { tr } = useI18n();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="filter-select" aria-label={tr(label)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, t]) => (
          <SelectItem key={v} value={v}>
            {tr(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
