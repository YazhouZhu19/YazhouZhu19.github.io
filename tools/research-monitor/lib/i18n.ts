import english from "./en.json";
import analysisEnglish from "./analysis-en.json";
export type Locale = "zh" | "en";
const messages: Record<string, string> = { ...english, ...analysisEnglish };
export function translate(locale: Locale, key: string, values: unknown[] = []): string {
  const template = locale === "en" ? messages[key] ?? (messages[key.trim()] ? key.replace(key.trim(), messages[key.trim()]) : key) : key;
  return template.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ""));
}
export function localePath(locale: Locale) { return locale === "en" ? "/research-monitor/en/" : "/research-monitor/"; }
