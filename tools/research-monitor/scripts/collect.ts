import { resolve } from "node:path";
import { collectAll } from "../lib/collect";
import { parseMonitorData } from "../lib/record";
import { readSnapshotFile, writeSnapshotFile } from "./snapshot-files";

function argumentsFor(argv:string[]) {
  let input = "data/papers.json", output = "data/papers.json";
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      console.log("Usage: tsx scripts/collect.ts [--input data/papers.json] [--output data/papers.json]");
      process.exit(0);
    }
    if (!["--input","--output"].includes(flag) || !argv[index+1] || argv[index+1].startsWith("--")) throw new Error(`未知参数或缺少参数值：${flag}`);
    if (flag === "--input") input = argv[++index]; else output = argv[++index];
  }
  return {input:resolve(input),output:resolve(output)};
}

async function main() {
  const {input,output} = argumentsFor(process.argv.slice(2));
  // Missing/invalid input is fatal. Never silently replace the public library with an empty one.
  const previous = parseMonitorData(await readSnapshotFile(input));
  const {data,allFailed,outcomes} = await collectAll(previous);
  await writeSnapshotFile(output,data);
  for (const {run} of outcomes) {
    const stored = data.runs.find(candidate => candidate.id === run.id)!;
    console.log(JSON.stringify({source:stored.source,status:stored.status,received:stored.received,kept:stored.kept,added:stored.added,updated:stored.updated,error:stored.error ?? null}));
  }
  console.log(`Saved ${data.totalStored} papers to ${output}; status=${data.status}`);
  if (allFailed) process.exitCode = 1;
}

main().catch(error => {console.error(error instanceof Error ? error.message : String(error));process.exitCode = 1;});
