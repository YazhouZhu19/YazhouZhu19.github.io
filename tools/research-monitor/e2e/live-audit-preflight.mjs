import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
const cwd = process.cwd();
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const [major, minor] = process.versions.node.split(".").map(Number);
assert(major > 22 || (major === 22 && minor >= 13), "Node >=22.13 is required");
const manifest = JSON.parse(
  await readFile("e2e/live-audit-codehashes.json", "utf8"),
);
assert.equal(manifest.schemaVersion, 1);
for (const file of manifest.files) {
  const target = resolve(file.path);
  assert(
    target.startsWith(cwd + sep),
    "Code hash path leaves monitor workspace",
  );
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    sha256(await readFile(target)),
    file.sha256,
    `Reviewed file changed: ${file.path}`,
  );
}
const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const installedPlaywright = require("@playwright/test/package.json").version;
assert.equal(
  installedPlaywright,
  lock.packages["node_modules/@playwright/test"].version,
  "Playwright differs from lock",
);
await access(require("@playwright/test").chromium.executablePath());
const web = process.env.OEVRYN_WEB_REVISION,
  data = process.env.OEVRYN_DATA_REVISION;
assert.match(
  web ?? "",
  /^[a-f0-9]{40}$/,
  "A final full WEB source revision is required",
);
assert.match(
  data ?? "",
  /^[a-f0-9]{40}$/,
  "A final full DATA source revision is required",
);
const expected = JSON.parse(process.env.OEVRYN_EXPECTED_DATA_JSON ?? "null");
assert(
  expected && typeof expected === "object" && !Array.isArray(expected),
  "Exact expected deployment JSON is required",
);
assert.equal(expected.schemaVersion, 2);
assert.equal(
  expected.sourceRevision,
  data,
  "Expected deployment must use the dispatched DATA source revision",
);
assert.match(expected.runId, /^\d+$/);
for (const key of ["paperCount", "signalCount"])
  assert(
    Number.isSafeInteger(expected[key]) && expected[key] >= 0,
    `Invalid ${key}`,
  );
for (const key of ["collectedAt", "signalsGeneratedAt"])
  assert(
    typeof expected[key] === "string" &&
      Number.isFinite(Date.parse(expected[key])),
    `Invalid ${key}`,
  );
for (const key of [
  "compactPapersSha256",
  "paperOverviewSha256",
  "signalsManifestSha256",
  "analysisSnapshotSha256",
  "analysisManifestSha256",
  "analysisSnapshotV2Sha256",
  "analysisManifestV2Sha256",
  "analysisContentSha256",
])
  assert.match(expected[key], /^[a-f0-9]{64}$/, `Invalid ${key}`);
const output = process.env.OEVRYN_AUDIT_DIR;
assert(output, "OEVRYN_AUDIT_DIR is required");
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "expected-data-deployment.json"),
  JSON.stringify(expected, null, 2) + "\n",
  { flag: "wx" },
);
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  node: process.version,
  playwright: installedPlaywright,
  checkedFiles: manifest.files.length,
  auditScriptSha256: sha256(await readFile("e2e/live-release-audit.ts")),
  codeManifestSha256: sha256(await readFile("e2e/live-audit-codehashes.json")),
  expectedWeb: web,
  expectedData: data,
  expectedDeploymentSha256: sha256(Buffer.from(JSON.stringify(expected))),
  networkRequested: false,
};
await writeFile(
  join(output, "environment-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
