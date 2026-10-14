import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parseResearchSignalsData, SIGNALS_MAX_BYTES } from "../lib/research-signals";

async function read(path: string) {
  const bytes = await readFile(path);
  if (bytes.length > SIGNALS_MAX_BYTES) throw new Error("Signal snapshot exceeds publication limit");
  return parseResearchSignalsData(JSON.parse(bytes.toString("utf8")));
}

const [beforePath, afterPath, startedAt, exitCode] = process.argv.slice(2);
if (!beforePath || !afterPath || !startedAt || !["0", "1"].includes(exitCode)) throw new Error("Expected before, after, start timestamp and collector exit code");
const [before, after] = await Promise.all([read(beforePath), read(afterPath)]);
const started = Date.parse(startedAt);
if (!Number.isFinite(started) || Date.parse(after.generatedAt) < started || after.generatedAt === before.generatedAt) throw new Error("Signal collector did not write a fresh, validated snapshot");
const afterIds = new Set(after.records.map(record => record.id));
if (before.records.some(record => !afterIds.has(record.id))) throw new Error("Signal collection removed stored records");
if (!after.sources.some(source => source.kind === "github") || !after.sources.some(source => source.kind === "news")) throw new Error("Signal source status is incomplete");
if (exitCode === "0" && after.sources.every(source => source.status === "error")) throw new Error("Signal collector reported success despite every source failing");
for (const source of after.sources.filter(source => source.status === "error")) {
  const previous = before.sources.find(item => item.id === source.id);
  if (source.lastSuccessAt !== (previous?.lastSuccessAt ?? null)) throw new Error("Failed signal collection changed last successful source time");
}
if (exitCode === "1") {
  if (after.sources.some(source => source.status !== "error" || !source.error || Date.parse(source.checkedAt) < started)) throw new Error("Failed signal collection did not record fresh errors for every source");
  assert.deepEqual([...after.records].sort((a, b) => a.id.localeCompare(b.id)), [...before.records].sort((a, b) => a.id.localeCompare(b.id)), "All-source failure must preserve complete signal records");
  console.log("::warning::All signal sources failed. Publishing the fresh errors and retaining the previous records.");
}
console.log(`Validated signal snapshot: ${after.records.length} records; collector exit ${exitCode}`);
