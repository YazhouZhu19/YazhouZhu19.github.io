import { resolve } from "node:path";
import { compactSignalArchive, readSignalArchive, writeSignalArchiveFile } from "./signal-archive";

const [command, input, destination] = process.argv.slice(2);
if (
  !input ||
  !["check", "migrate", "copy", "compact"].includes(command) ||
  (command === "copy" && !destination)
)
  throw new Error(
    "Usage: tsx scripts/signal-archive-cli.ts <check|migrate|copy|compact> <source.json> [destination.json|previous.json]",
  );
const file = resolve(input);
const { data, bytes, format } = await readSignalArchive(file);
if (command === "migrate" || command === "copy") {
  const output = command === "copy" ? resolve(destination) : file;
  if (command === "copy" && output === file) throw new Error("Copy destination must differ from source");
  const manifest = await writeSignalArchiveFile(output, data);
  console.log(`Preserved ${manifest.totalRecords} signals in ${manifest.shards.length} verified shards`);
} else if (command === "compact") {
  await compactSignalArchive(file, destination ? resolve(destination) : undefined);
  console.log(
    `Compacted generated shards while retaining ${data.records.length} signals and the preceding generation`,
  );
} else console.log(`Verified ${data.records.length} signals, ${bytes} bytes (${format})`);
