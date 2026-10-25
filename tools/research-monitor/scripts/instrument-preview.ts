import { readFile, writeFile } from "node:fs/promises";

// Run after a production build for local QA only. The next build removes this page.
const html = await readFile("dist/index.html", "utf8");
const probe = await readFile("scripts/performance-probe.js", "utf8");
if (probe.includes("</script")) throw new Error("Probe contains an unsafe script terminator");
await writeFile("dist/__performance.html", html.replace("<head>", `<head><script>${probe}</script>`));
console.log("Local QA page: /research-monitor/__performance.html (never part of the build command)");
