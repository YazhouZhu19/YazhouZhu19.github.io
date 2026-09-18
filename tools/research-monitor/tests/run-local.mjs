import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({ entryPoints: [root + "lib/local-api.ts"], outfile: root + ".test-build/local-api.mjs", bundle: true, platform: "node", format: "esm", define: { "import.meta.env.BASE_URL": JSON.stringify("/research-monitor/") } });
const result = spawnSync(process.execPath, ["--test", root + "tests/local-api.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
