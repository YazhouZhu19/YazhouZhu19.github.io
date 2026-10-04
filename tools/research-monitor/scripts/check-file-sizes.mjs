import { execFileSync } from "node:child_process";
const limit = 100 * 1024 * 1024;
const entries = execFileSync("git", ["ls-files", "--stage", "-z"], { maxBuffer: 16 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
const objects = entries.map(entry => {
  const tab = entry.indexOf("\t");
  return { sha: entry.slice(0, tab).split(" ")[1], path: entry.slice(tab + 1) };
});
const sizes = execFileSync("git", ["cat-file", "--batch-check=%(objectsize)"], {
  input: objects.map(object => object.sha).join("\n") + "\n",
  maxBuffer: 16 * 1024 * 1024,
}).toString().trim().split("\n");
const oversized = objects.filter((_, index) => Number(sizes[index]) > limit);
if (oversized.length) {
  for (const object of oversized) console.error(`::error::File exceeds GitHub's 100 MiB limit: ${object.path}. Split the file before committing.`);
  process.exitCode = 1;
} else console.log(`Verified ${objects.length} staged files are within GitHub's 100 MiB limit`);
