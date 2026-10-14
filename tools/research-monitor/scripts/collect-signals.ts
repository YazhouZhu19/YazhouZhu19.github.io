import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectResearchSignals } from "../lib/collect-signals";
import { emptyResearchSignalsData, parseResearchSignalsData, SIGNALS_MAX_BYTES } from "../lib/research-signals";
import { readSnapshotFile } from "./snapshot-files";

async function main() {
  let input = "data/research-signals.json", output = input, days = 365, force = false, init = false, githubOnly = false, newsOnly = false, deep = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force") { force = true; continue; }
    if (args[i] === "--github-only") { githubOnly = true; continue; }
    if (args[i] === "--news-only") { newsOnly = true; continue; }
    if (args[i] === "--deep") { deep = true; continue; }
    if (args[i] === "--init") { init = true; continue; }
    if (args[i] === "--help") { console.log("Usage: tsx scripts/collect-signals.ts [--input file] [--output file] [--news-days 1..730] [--force] [--init] [--github-only|--news-only] [--deep]"); return; }
    if (!["--input", "--output", "--news-days"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown or missing argument");
    const key = args[i], value = args[++i];
    if (key === "--input") input = value; else if (key === "--output") output = value; else days = Number(value);
  }
  if (githubOnly && newsOnly) throw new Error("Choose only one source-only option");
  input = resolve(input); output = resolve(output);
  let previous;
  try {
    if ((await stat(input)).size > SIGNALS_MAX_BYTES) throw new Error("Signals input exceeds the safe size limit");
    previous = parseResearchSignalsData(JSON.parse(await readFile(input, "utf8")));
  } catch (error: any) {
    if (error.code === "ENOENT" && init) previous = emptyResearchSignalsData();
    else throw new Error("Signals input missing or invalid; existing snapshot unchanged (first initialization requires --init)");
  }
  // Exact public links in the saved paper archive recover projects missed by keywords.
  // An absent optional paper file does not prevent independent signal collection.
  let paperUrls: string[] = [];
  if (!newsOnly) {
    try {
      const papers = await readSnapshotFile(resolve("data/papers.json"));
      const corpus = papers.papers.map((paper: { url?: string | null; abstract?: string | null; originalAbstract?: string | null }) => `${paper.url ?? ""} ${paper.abstract ?? ""} ${paper.originalAbstract ?? ""}`).join("\n");
      paperUrls = [...new Set([...corpus.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi)].map(match => match[0].replace(/[.,;]+$/, "")))];
    } catch { console.log("Paper-link discovery unavailable; keyword discovery remains enabled"); }
  }
  const relatedUrls = previous.records.flatMap(record => record.relatedUrls).filter(url => /^https:\/\/github\.com\//i.test(url));
  const { data, allFailed } = await collectResearchSignals(previous, { newsDays: days, force, githubOnly, newsOnly, discoveryMode: deep ? "backfill" : "incremental", repositoryUrls: [...new Set([...paperUrls, ...relatedUrls])], githubToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  const content = JSON.stringify(data) + "\n";
  if (Buffer.byteLength(content) > SIGNALS_MAX_BYTES) throw new Error("Signals output exceeds the safe size limit; existing snapshot unchanged");
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, output); } finally { await rm(temporary, { force: true }); }
  for (const source of data.sources) console.log(JSON.stringify({ source: source.name, status: source.status, checkedAt: source.checkedAt, received: source.received, retained: source.retained, error: source.error }));
  console.log(`Saved ${data.records.length} public research signals`);
  if (allFailed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Signals collection failed"); process.exitCode = 1; });
