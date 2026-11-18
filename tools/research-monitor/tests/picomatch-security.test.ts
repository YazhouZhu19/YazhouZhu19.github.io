import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { applyPatch, manifest, projectRoot, verifyPatch } from "../scripts/security/picomatch-patch.mjs";
import { checkRegressions } from "../scripts/security/regressions.mjs";

const require = createRequire(import.meta.url);
const installed = path.dirname(require.resolve("picomatch/package.json"));
const changes = JSON.parse(
  readFileSync(new URL("../security/picomatch/changes.json", import.meta.url), "utf8"),
);

function fixture(t: TestContext, pristine = false) {
  const root = mkdtempSync(path.join(tmpdir(), "oevryn-picomatch-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dependency = path.join(root, "node_modules/picomatch");
  mkdirSync(path.dirname(dependency));
  cpSync(installed, dependency, { recursive: true });
  writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      packages: { "node_modules/picomatch": { version: manifest.version, integrity: manifest.integrity } },
    }),
  );
  if (pristine) {
    let source = readFileSync(path.join(dependency, "lib/parse.js"), "utf8");
    for (const { before, after } of [...changes].reverse()) source = source.replace(after, () => before);
    assert.equal(createHash("sha256").update(source).digest("hex"), manifest.files["lib/parse.js"]);
    writeFileSync(path.join(dependency, "lib/parse.js"), source);
  }
  return { root, dependency };
}

test("all installed picomatch instances pass pinned-file checks and bounded regressions", () => {
  const nodes = verifyPatch();
  assert.ok(checkRegressions(projectRoot, nodes) >= 69);
});

test("the original vulnerable parser times out; applying the patch makes the same corpus bounded", (t) => {
  const { root, dependency } = fixture(t, true);
  assert.throws(() => verifyPatch(root), /Unpatched dependency/);
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    require(process.argv[1])('+(*a)')('a'.repeat(128) + 'c');
  `,
      dependency,
    ],
    { timeout: 1000 },
  );
  assert.equal((result.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
  applyPatch(root);
  assert.ok(checkRegressions(root) >= 69);
  const once = readFileSync(path.join(dependency, "lib/parse.js"));
  applyPatch(root);
  assert.deepEqual(readFileSync(path.join(dependency, "lib/parse.js")), once);
});

test("unknown parser or companion-file contents cannot be patched or waived", (t) => {
  for (const file of ["lib/parse.js", "lib/picomatch.js", "package.json"]) {
    const { root, dependency } = fixture(t);
    writeFileSync(path.join(dependency, file), "tampered");
    assert.throws(() => applyPatch(root), /Unexpected picomatch content/);
    assert.throws(() => verifyPatch(root), /Unexpected picomatch content/);
  }
});

test("missing, extraneous, linked, or upgraded dependency instances fail closed", (t) => {
  const missing = fixture(t);
  rmSync(missing.dependency, { recursive: true });
  assert.throws(() => verifyPatch(missing.root), /instances differ/);
  const extra = fixture(t);
  const nested = path.join(extra.root, "node_modules/example/node_modules/picomatch");
  mkdirSync(path.dirname(nested), { recursive: true });
  cpSync(installed, nested, { recursive: true });
  assert.throws(() => verifyPatch(extra.root), /instances differ/);
  const linked = fixture(t);
  rmSync(linked.dependency, { recursive: true });
  symlinkSync(installed, linked.dependency, "dir");
  assert.throws(() => applyPatch(linked.root), /Unexpected dependency link/);
  const newer = fixture(t);
  writeFileSync(
    path.join(newer.root, "package-lock.json"),
    JSON.stringify({
      packages: { "node_modules/picomatch": { version: "4.0.8", integrity: manifest.integrity } },
    }),
  );
  assert.throws(() => verifyPatch(newer.root), /Unsupported picomatch lock entry/);
});

test("linked lib directories and packages cannot hide or modify an external dependency", (t) => {
  const external = fixture(t, true);
  const linkedLib = fixture(t);
  const original = readFileSync(path.join(external.dependency, "lib/parse.js"));
  rmSync(path.join(linkedLib.dependency, "lib"), { recursive: true });
  symlinkSync(path.join(external.dependency, "lib"), path.join(linkedLib.dependency, "lib"), "dir");
  assert.throws(() => applyPatch(linkedLib.root), /escapes its package/);
  assert.deepEqual(readFileSync(path.join(external.dependency, "lib/parse.js")), original);
  const linkedParent = fixture(t);
  symlinkSync(
    path.join(external.root, "node_modules"),
    path.join(linkedParent.root, "node_modules/example"),
    "dir",
  );
  assert.throws(() => verifyPatch(linkedParent.root), /Unexpected dependency link/);
});

test("every locked nested copy must be patched, and shared node_modules is never modified", (t) => {
  const { root, dependency } = fixture(t, true);
  const nestedName = "node_modules/example/node_modules/picomatch";
  const nested = path.join(root, nestedName);
  mkdirSync(path.dirname(nested), { recursive: true });
  cpSync(dependency, nested, { recursive: true });
  writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/picomatch": { version: manifest.version, integrity: manifest.integrity },
        [nestedName]: { version: manifest.version, integrity: manifest.integrity },
      },
    }),
  );
  assert.equal(applyPatch(root).size, 2);
  const shared = mkdtempSync(path.join(tmpdir(), "oevryn-shared-test-"));
  t.after(() => rmSync(shared, { recursive: true, force: true }));
  symlinkSync(path.join(root, "node_modules"), path.join(shared, "node_modules"), "dir");
  assert.throws(() => applyPatch(shared), /shared node_modules symlink/);
});
