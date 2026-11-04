import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { checkPublicationSize } from "./publication-retention";

// Only public site roots; source archives and build dependencies never enter Pages.
const root = resolve("../..");
const target = resolve(".site-publication");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of [
  ".nojekyll",
  "index.html",
  "stylesheet.css",
  "images",
  "data",
  "clinician-in-the-loop",
  "research-monitor",
])
  await cp(join(root, name), join(target, name), { recursive: true });
// Existing data URLs remain an unchanged, dated transition snapshot.
const monitor = join(target, "research-monitor");
for (const item of await readdir(monitor))
  if (item !== "data") await rm(join(monitor, item), { recursive: true, force: true });
for (const item of await readdir("dist"))
  if (item !== "data" && item !== ".vite")
    await cp(join("dist", item), join(monitor, item), { recursive: true });
const deployment = JSON.parse(await readFile(join(monitor, "deployment.json"), "utf8"));
deployment.dataBaseUrl = process.env.VITE_MONITOR_DATA_BASE_URL;
deployment.role = "web";
deployment.legacyDataStatus = "Frozen transition snapshot; current data is published separately";
await writeFile(join(monitor, "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
console.log(await checkPublicationSize(target, 950_000_000));
