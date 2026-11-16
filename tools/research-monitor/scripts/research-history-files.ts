import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const HISTORY_FILES = ["spinal-cord-evidence.json", "fetal-mri-evidence.json", "qsm-evidence.json"];

/** Explicit source list: adding a scoped candidate requires an intentional taxonomy update. */
export async function readHistoryPacks() {
  const files = await Promise.all(
    HISTORY_FILES.map(async (file) => {
      const text = await readFile(`data/research-history/${file}`, "utf8");
      return {
        file,
        sha256: createHash("sha256").update(text).digest("hex"),
        pack: JSON.parse(text) as unknown,
      };
    }),
  );
  return { packs: files.map((f) => f.pack), fingerprints: files.map(({ pack: _pack, ...f }) => f) };
}
