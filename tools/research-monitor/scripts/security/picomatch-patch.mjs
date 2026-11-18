import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const patchRoot = new URL("../../security/picomatch/", import.meta.url);
export const manifest = JSON.parse(readFileSync(new URL("manifest.json", patchRoot), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function inventory(root) {
  const modules = path.join(root, "node_modules");
  if (lstatSync(modules).isSymbolicLink()) throw new Error("Refusing a shared node_modules symlink");
  const found = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected dependency link: ${location}`);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        visit(location);
        continue;
      }
      if (entry.name === "picomatch") {
        if (!entry.isDirectory()) throw new Error(`Unexpected picomatch link: ${location}`);
        found.push(path.relative(root, location).split(path.sep).join("/"));
      }
      if (entry.isDirectory()) {
        const children = path.join(location, "node_modules");
        try {
          const info = lstatSync(children);
          if (info.isSymbolicLink()) throw new Error(`Shared dependency tree: ${children}`);
          if (info.isDirectory()) visit(children);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
  visit(modules);
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const expected = Object.entries(lock.packages).filter(([name]) =>
    /(^|\/)node_modules\/picomatch$/.test(name),
  );
  if (!expected.length) throw new Error("No locked picomatch: review and retire the local patch");
  if (JSON.stringify(found.sort()) !== JSON.stringify(expected.map(([name]) => name).sort())) {
    throw new Error("Installed and locked picomatch instances differ");
  }
  for (const [name, entry] of expected) {
    if (entry.version !== manifest.version || entry.integrity !== manifest.integrity || entry.link) {
      throw new Error(`Unsupported picomatch lock entry: ${name}; review the local patch`);
    }
    const location = path.join(root, name);
    if (realpathSync(location) !== path.join(realpathSync(root), name)) {
      throw new Error(`Dependency escapes the project: ${name}`);
    }
    for (const [file, original] of Object.entries(manifest.files)) {
      const absolute = path.join(location, file);
      if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Dependency file is a link: ${file}`);
      if (realpathSync(absolute) !== path.join(realpathSync(root), name, file)) {
        throw new Error(`Dependency file escapes its package: ${name}/${file}`);
      }
      const hash = digest(readFileSync(absolute));
      const allowed = file === "lib/parse.js" ? [original, manifest.patchedSha256] : [original];
      if (!allowed.includes(hash)) throw new Error(`Unexpected picomatch content: ${name}/${file}`);
    }
  }
  return found;
}

export function verifyPatch(root = projectRoot) {
  const nodes = inventory(root);
  for (const node of nodes) {
    if (digest(readFileSync(path.join(root, node, "lib/parse.js"))) !== manifest.patchedSha256) {
      throw new Error(`Unpatched dependency: ${node}; run npm ci with install scripts enabled`);
    }
  }
  return new Set(nodes);
}

export function applyPatch(root = projectRoot) {
  const patch = readFileSync(new URL("changes.json", patchRoot));
  if (digest(patch) !== manifest.changesSha256) throw new Error("Local patch checksum mismatch");
  const changes = JSON.parse(patch.toString());
  const nodes = inventory(root);
  const updates = [];
  for (const node of nodes) {
    const target = path.join(root, node, "lib/parse.js");
    let source = readFileSync(target, "utf8");
    if (digest(source) === manifest.patchedSha256) continue;
    for (const { before, after } of changes) {
      if (source.split(before).length !== 2) throw new Error("Patch context is not unique");
      source = source.replace(before, () => after);
    }
    if (digest(source) !== manifest.patchedSha256) throw new Error("Patched output checksum mismatch");
    updates.push([target, source]);
  }
  for (const [target, source] of updates) writeFileSync(target, source);
  return verifyPatch(root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const nodes = process.argv.includes("--apply") ? applyPatch() : verifyPatch();
    console.log(`Verified local picomatch security patch in ${nodes.size} locked instance(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
