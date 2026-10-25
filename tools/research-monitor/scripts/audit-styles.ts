import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Counts = {
  colors: number;
  spacing: number;
  fontSizes: number;
  radii: number;
  shadows: number;
};

const empty = (): Counts => ({ colors: 0, spacing: 0, fontSizes: 0, radii: 0, shadows: 0 });
const directory = resolve(process.argv[2] || "styles");
const files: Record<string, Counts> = {};
const totals = empty();

for (const name of (await readdir(directory)).filter((name) => name.endsWith(".css")).sort()) {
  if (name === "tokens.css") continue;
  const css = (await readFile(resolve(directory, name), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const counts = empty();
  // Count literal occurrences in declarations, not media-query breakpoints or selectors.
  // Custom-property definitions belong to the palette/scale and are reported separately.
  for (const match of css.matchAll(/(?:^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const [, property, value] = match;
    if (property.startsWith("--")) continue;
    counts.colors += (value.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || []).length;
    const lengths = (value.match(/(?<![\w.-])-?\d*\.?\d+(?:px|rem)\b/g) || []).length;
    if (/^(?:padding|margin|gap|row-gap|column-gap)(?:-|$)/.test(property)) counts.spacing += lengths;
    if (property === "font" || property === "font-size") counts.fontSizes += lengths;
    if (/radius$/.test(property)) counts.radii += lengths;
    if (property === "box-shadow" && value !== "none" && !/^var\(/.test(value)) counts.shadows += 1;
  }
  files[name] = counts;
  for (const key of Object.keys(totals) as (keyof Counts)[]) totals[key] += counts[key];
}
console.log(
  JSON.stringify(
    {
      directory,
      method: "literal occurrences in declarations; excludes tokens.css, custom properties and media queries",
      files,
      totals,
    },
    null,
    2,
  ),
);
