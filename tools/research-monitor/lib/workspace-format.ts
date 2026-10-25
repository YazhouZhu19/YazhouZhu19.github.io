export function fmtDate(value?: string | null) {
  if (!value) return "未提供";
  return value.slice(0, 10);
}
export function fmtTime(value?: string | null) {
  if (!value) return "尚未同步";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
