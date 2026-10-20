import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseResearchSignalsData,
  SIGNALS_MAX_BYTES,
  type ResearchSignalsData,
} from "../lib/research-signals";

async function read(path: string) {
  const bytes = await readFile(path);
  if (bytes.length > SIGNALS_MAX_BYTES) throw new Error("Signal snapshot exceeds publication limit");
  return parseResearchSignalsData(JSON.parse(bytes.toString("utf8")));
}

export function validateSignalCollection(
  before: ResearchSignalsData,
  after: ResearchSignalsData,
  startedAt: string,
  exitCode: "0" | "1",
): void {
  const started = Date.parse(startedAt);
  if (
    !Number.isFinite(started) ||
    Date.parse(after.generatedAt) < started ||
    after.generatedAt === before.generatedAt
  )
    throw new Error("Signal collector did not write a fresh, validated snapshot");
  const afterIds = new Set(after.records.map((record) => record.id));
  if (before.records.some((record) => !afterIds.has(record.id)))
    throw new Error("Signal collection removed stored records");
  if (
    !after.sources.some((source) => source.kind === "github") ||
    !after.sources.some((source) => source.kind === "news")
  )
    throw new Error("Signal source status is incomplete");
  const attempted = after.sources.filter(
    (source) =>
      source.checkedAt !== null &&
      Date.parse(source.checkedAt) >= started &&
      source.checkedAt !== before.sources.find((previous) => previous.id === source.id)?.checkedAt,
  );
  if (attempted.some((source) => Date.parse(source.checkedAt!) > Date.parse(after.generatedAt)))
    throw new Error("Source check occurs after the collection snapshot");
  if (exitCode === "0" && attempted.length > 0 && attempted.every((source) => source.status === "error"))
    throw new Error("Signal collector reported success despite every attempted source failing");
  for (const source of after.sources.filter((source) => source.status === "error")) {
    const previous = before.sources.find((item) => item.id === source.id);
    if (source.lastSuccessAt !== (previous?.lastSuccessAt ?? null))
      throw new Error("Failed signal collection changed last successful source time");
  }
  if (exitCode === "1") {
    if (!attempted.length || attempted.some((source) => source.status !== "error" || !source.error))
      throw new Error("Failed signal collection did not record fresh errors for every attempted source");
    assert.deepEqual(
      [...after.records].sort((a, b) => a.id.localeCompare(b.id)),
      [...before.records].sort((a, b) => a.id.localeCompare(b.id)),
      "All-source failure must preserve complete signal records",
    );
  }
}

async function main(): Promise<void> {
  const [beforePath, afterPath, startedAt, exitCode] = process.argv.slice(2);
  if (!beforePath || !afterPath || !startedAt || (exitCode !== "0" && exitCode !== "1"))
    throw new Error("Expected before, after, start timestamp and collector exit code");
  const [before, after] = await Promise.all([read(beforePath), read(afterPath)]);
  validateSignalCollection(before, after, startedAt, exitCode);
  if (exitCode === "1")
    console.log(
      "::warning::All attempted signal sources failed. Publishing the fresh errors and retaining the previous records.",
    );
  console.log(`Validated signal snapshot: ${after.records.length} records; collector exit ${exitCode}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
