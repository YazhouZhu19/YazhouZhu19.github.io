import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TRACKS } from "../lib/classify";
import type { Paper } from "../lib/types";
import { readSnapshotFile } from "./snapshot-files";

export const EVAL_SEED = "oevryn-relevance-2026-10-21-v1";
export const EVAL_COLUMNS = [
  "id",
  "title",
  "abstract_excerpt",
  "current_tracks",
  "current_tasks",
  "label_scope",
  "label_tracks",
  "notes",
] as const;
export type ScopeLabel = "core" | "adjacent" | "out";
export type EvalRow = Record<(typeof EVAL_COLUMNS)[number], string>;
export type EvalEvidence = Pick<
  Paper,
  "id" | "title" | "abstract" | "tracks" | "tasks" | "source" | "publishedAt"
>;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Multi-label records are assigned once, rather than entering several strata. */
export function stratumFor(paper: EvalEvidence, seed = EVAL_SEED) {
  const tracks = [...new Set(paper.tracks)].filter((track) => track in TRACKS).sort();
  const track = tracks.length
    ? tracks[parseInt(hash(`${seed}:track:${paper.id}`).slice(0, 8), 16) % tracks.length]
    : "unassigned";
  const date = Date.parse(paper.publishedAt);
  const calendarDate = Date.parse(`${paper.publishedAt.slice(0, 10)}T00:00:00.000Z`);
  const month =
    /^\d{4}-(0[1-9]|1[0-2])/.test(paper.publishedAt) &&
    Number.isFinite(date) &&
    Number.isFinite(calendarDate) &&
    new Date(calendarDate).toISOString().slice(0, 10) === paper.publishedAt.slice(0, 10)
      ? paper.publishedAt.slice(0, 7)
      : "undated";
  return JSON.stringify([paper.source || "unknown", track, month]);
}

/** Seeded random priorities and round-robin strata prevent common directions dominating the audit. */
export function stratifiedSample(papers: EvalEvidence[], size = 400, seed = EVAL_SEED) {
  if (!Number.isSafeInteger(size) || size < 1 || size > papers.length)
    throw new Error("Sample size must be between 1 and the population size.");
  if (new Set(papers.map((paper) => paper.id)).size !== papers.length)
    throw new Error("Duplicate paper IDs in evaluation population.");
  const strata = new Map<string, EvalEvidence[]>();
  for (const paper of papers) {
    const key = stratumFor(paper, seed);
    strata.set(key, [...(strata.get(key) ?? []), paper]);
  }
  const keys = [...strata.keys()].sort((a, b) =>
    hash(`${seed}:stratum:${a}`).localeCompare(hash(`${seed}:stratum:${b}`)),
  );
  for (const [key, rows] of strata) {
    rows.sort(
      (a, b) =>
        hash(`${seed}:paper:${a.id}`).localeCompare(hash(`${seed}:paper:${b.id}`)) ||
        a.id.localeCompare(b.id),
    );
    strata.set(key, rows);
  }
  const sample: EvalEvidence[] = [];
  for (let round = 0; sample.length < size; round++) {
    for (const key of keys) {
      const paper = strata.get(key)![round];
      if (paper) sample.push(paper);
      if (sample.length === size) break;
    }
  }
  return sample;
}

export function encodeCsv(rows: EvalRow[], status = "provisional labels, pending maintainer review") {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return `# ${status}\n${EVAL_COLUMNS.join(",")}\n${rows.map((row) => EVAL_COLUMNS.map((key) => escape(row[key])).join(",")).join("\n")}\n`;
}

/** Quoted commas/newlines are accepted; malformed and duplicate rows fail closed. */
export function parseEvalCsv(text: string): { rows: EvalRow[]; comments: string[] } {
  const comments: string[] = [];
  let input = text.replace(/^\uFEFF/, "");
  while (input.startsWith("#")) {
    const end = input.indexOf("\n");
    comments.push((end === -1 ? input : input.slice(0, end)).trim());
    input = end === -1 ? "" : input.slice(end + 1);
  }
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (char === "\n" || (char === "\r" && input[index + 1] === "\n")) {
      if (char === "\r") index++;
      row.push(field);
      if (row.some((value) => value.length)) records.push(row);
      row = [];
      field = "";
      closed = false;
    } else {
      if (closed || char === '"') throw new Error("Malformed quoted CSV field.");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (field.length || row.length) {
    row.push(field);
    records.push(row);
  }
  const header = records.shift();
  if (header?.join(",") !== EVAL_COLUMNS.join(",")) throw new Error("Unexpected evaluation CSV columns.");
  const rows = records.map((values) => {
    if (values.length !== EVAL_COLUMNS.length) throw new Error("Unexpected evaluation CSV column count.");
    return Object.fromEntries(EVAL_COLUMNS.map((key, index) => [key, values[index]])) as EvalRow;
  });
  if (rows.some((row) => !row.id) || new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Missing or duplicate evaluation ID.");
  return { rows, comments };
}

export function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--"))
    throw new Error(`Missing ${name} value.`);
  return process.argv[index + 1];
}

async function main() {
  const input = resolve(argument("--input", "data/papers.json"));
  const output = resolve(argument("--output", "eval/relevance-sample.csv"));
  const seed = argument("--seed", EVAL_SEED);
  const size = Number(argument("--size", "400"));
  const snapshot = await readSnapshotFile(input);
  const population = snapshot.papers as Paper[];
  const selected = stratifiedSample(population, size, seed);
  const annotationFile = argument("--annotations", "");
  const annotations: Record<string, { scope: ScopeLabel; tracks: string[]; notes: string }> = annotationFile
    ? JSON.parse(await readFile(resolve(annotationFile), "utf8"))
    : {};
  const rows = selected.map((paper) => {
    const annotation = annotations[paper.id];
    if (
      annotation &&
      (!["core", "adjacent", "out"].includes(annotation.scope) ||
        annotation.tracks.some((track) => !(track in TRACKS)) ||
        !annotation.notes)
    ) {
      throw new Error(`Invalid annotation for ${paper.id}.`);
    }
    return {
      id: paper.id,
      title: paper.title,
      abstract_excerpt: [...paper.abstract].slice(0, 600).join(""),
      current_tracks: paper.tracks.join(";"),
      current_tasks: paper.tasks.join(";"),
      label_scope: annotation?.scope ?? "",
      label_tracks: annotation?.tracks.join(";") ?? "",
      notes: annotation?.notes ?? "",
    };
  });
  if (Object.keys(annotations).some((id) => !selected.some((paper) => paper.id === id)))
    throw new Error("Annotation IDs do not match this sample.");
  const evidence = selected.map(({ id, title, abstract, tracks, tasks, source, publishedAt }) => ({
    id,
    title,
    abstract,
    tracks,
    tasks,
    source,
    publishedAt,
  }));
  const countStrata = (papers: EvalEvidence[]) => {
    const counts: Record<string, number> = {};
    for (const paper of papers) {
      const key = stratumFor(paper, seed);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encodeCsv(rows));
  await writeFile(
    resolve(dirname(output), "relevance-evidence.json"),
    JSON.stringify(
      {
        status: "provisional labels, pending maintainer review",
        seed,
        size,
        population: population.length,
        snapshotCollectedAt: snapshot.collectedAt,
        snapshotSha256: hash(JSON.stringify(population)),
        evidenceSha256: hash(JSON.stringify(evidence)),
        excerptCharacters: 600,
        strata: { population: countStrata(population), sample: countStrata(selected) },
        papers: evidence,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Exported ${rows.length} unique papers (${Object.keys(annotations).length} provisional annotations), seed ${seed}.`,
  );
  console.log(`Sample: ${output}\nEvidence: ${resolve(dirname(output), "relevance-evidence.json")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
