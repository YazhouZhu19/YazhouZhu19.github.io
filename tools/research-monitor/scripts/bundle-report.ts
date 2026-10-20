import { relative } from "node:path";
import type { Plugin } from "vite";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** Uses bundler-provided rendered modules, without adding a runtime dependency. */
export function bundleReport(): Plugin {
  return {
    name: "research-monitor-bundle-report",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((chunk) => chunk.type === "chunk")
        .map((chunk) => ({
          file: chunk.fileName,
          bytes: Buffer.byteLength(chunk.code),
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.entries(chunk.modules)
            .map(([id, module]) => ({
              id: id.startsWith("\0") ? id.slice(1) : relative(process.cwd(), id).replaceAll("\\", "/"),
              renderedCodeBytes: module.code === null ? null : Buffer.byteLength(module.code),
              renderedLength: module.renderedLength,
            }))
            .sort(
              (a, b) => (b.renderedCodeBytes ?? b.renderedLength) - (a.renderedCodeBytes ?? a.renderedLength),
            ),
        }))
        .sort((a, b) => b.bytes - a.bytes);
      const report = {
        note: "Chunk bytes are final uncompressed output. Module figures are bundler rendered-code contributions; they do not sum to separately gzipped transport bytes.",
        chunks,
      };
      this.emitFile({
        type: "asset",
        fileName: "bundle-report.json",
        source: JSON.stringify(report, null, 2) + "\n",
      });
      this.emitFile({
        type: "asset",
        fileName: "stats.html",
        source: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OEVRYN bundle report</title>
<style>body{font:14px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#142d2a}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-variant-numeric:tabular-nums}code{overflow-wrap:anywhere}details{margin:24px 0}summary{cursor:pointer;font-weight:600}</style>
<h1>OEVRYN bundle report</h1><p>${escape(report.note)}</p><p>Expand a chunk to inspect its module contributions, largest first. <a href="./bundle-report.json">Complete JSON</a></p>
${chunks.map((chunk) => `<details${chunk.file.includes("/main-") ? " open" : ""}><summary>${escape(chunk.file)} · ${chunk.bytes.toLocaleString("en-US")} bytes · ${chunk.modules.length} modules</summary><table><thead><tr><th>Module</th><th>Rendered contribution</th></tr></thead><tbody>${chunk.modules.map((module) => `<tr><td><code>${escape(module.id)}</code></td><td>${(module.renderedCodeBytes ?? module.renderedLength).toLocaleString("en-US")}${module.renderedCodeBytes === null ? " chars" : " B"}</td></tr>`).join("")}</tbody></table></details>`).join("")}</html>`,
      });
    },
  };
}
