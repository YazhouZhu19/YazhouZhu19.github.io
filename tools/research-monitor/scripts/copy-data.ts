import { copyFile, mkdir, readdir } from "node:fs/promises";
import { readSnapshotFile } from "./snapshot-files";
import { monitorDataSchema } from "../lib/local-api";

// Verify the complete source snapshot before publishing any data.
monitorDataSchema.parse(await readSnapshotFile("data/papers.json"));
await mkdir("dist/data/papers", { recursive: true });
try {
  // Includes one retained generation so a cached manifest remains loadable.
  for (const name of await readdir("data/papers")) {
    if (/^[a-f0-9]{64}\.json$/.test(name)) await copyFile(`data/papers/${name}`, `dist/data/papers/${name}`);
  }
} catch (error: any) { if (error.code !== "ENOENT") throw error; }
await copyFile("data/papers.json", "dist/data/papers.json");
await readSnapshotFile("dist/data/papers.json");
