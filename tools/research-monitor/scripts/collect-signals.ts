import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectResearchSignals } from "../lib/collect-signals";
import { emptyResearchSignalsData, parseResearchSignalsData, SIGNALS_MAX_BYTES } from "../lib/research-signals";

async function main() {
  let input = "data/research-signals.json", output = input, days = 365, force = false, init = false, githubOnly = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force") { force = true; continue; }
    if (args[i] === "--github-only") { githubOnly = true; continue; }
    if (args[i] === "--init") { init = true; continue; }
    if (args[i] === "--help") { console.log("Usage: tsx scripts/collect-signals.ts [--input file] [--output file] [--news-days 1..730] [--force] [--init] [--github-only]"); return; }
    if (!["--input", "--output", "--news-days"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown or missing argument");
    const key = args[i], value = args[++i];
    if (key === "--input") input = value; else if (key === "--output") output = value; else days = Number(value);
  }
  input = resolve(input); output = resolve(output);
  let previous;
  try {
    if ((await stat(input)).size > SIGNALS_MAX_BYTES) throw new Error("Signals input exceeds 4 MiB");
    previous = parseResearchSignalsData(JSON.parse(await readFile(input, "utf8")));
  } catch (error: any) {
    if (error.code === "ENOENT" && init) previous = emptyResearchSignalsData();
    else throw new Error("Signals input missing or invalid; existing snapshot unchanged (first initialization requires --init)");
  }
  const { data, allFailed } = await collectResearchSignals(previous, { newsDays: days, force, githubOnly, githubToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  const content = JSON.stringify(data, null, 2) + "\n";
  if (Buffer.byteLength(content) > SIGNALS_MAX_BYTES) throw new Error("Signals output exceeds 4 MiB; existing snapshot unchanged");
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, output); } finally { await rm(temporary, { force: true }); }
  for (const source of data.sources) console.log(JSON.stringify({ source: source.name, status: source.status, checkedAt: source.checkedAt, received: source.received, retained: source.retained, error: source.error }));
  console.log(`Saved ${data.records.length} public research signals`);
  if (allFailed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Signals collection failed"); process.exitCode = 1; });
