import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { monitorDataSchema } from "../lib/local-api";
import { readSnapshotFile, writeSnapshotFile } from "./snapshot-files";

const [command, input, output] = process.argv.slice(2);
if (!input || !["export", "migrate", "check"].includes(command) || (command === "export" && !output)) {
  throw new Error("Usage: tsx scripts/snapshot-cli.ts <check|migrate|export> <data/papers.json> [export.json]");
}
const file = resolve(input);
const data = await readSnapshotFile(file);
monitorDataSchema.parse(data);
if (command === "export") {
  if (resolve(output) === file) throw new Error("Export destination must differ from the snapshot manifest");
  await writeFile(resolve(output), JSON.stringify(data) + "\n");
} else if (command === "migrate") {
  const manifest = await writeSnapshotFile(file, data);
  console.log(`Preserved ${manifest.totalStored} papers in ${manifest.shards.length} shards`);
} else {
  console.log(`Verified ${data.papers.length} papers and all referenced shards`);
}
