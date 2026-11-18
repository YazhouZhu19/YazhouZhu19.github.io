import { spawnSync } from "node:child_process";
import { classifyAuditReport } from "./audit-report.mjs";
import { projectRoot, verifyPatch } from "./picomatch-patch.mjs";
import { checkRegressions } from "./regressions.mjs";

try {
  const nodes = verifyPatch();
  const assertions = checkRegressions(projectRoot, nodes);
  const npmCli = process.env.npm_execpath;
  const result = spawnSync(
    npmCli ? process.execPath : "npm",
    [...(npmCli ? [npmCli] : []), "audit", "--json", "--audit-level=high"],
    { cwd: projectRoot, encoding: "utf8", timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit could not complete: ${result.error?.message || result.stderr}`);
  }
  const report = classifyAuditReport(JSON.parse(result.stdout), nodes);
  console.log(JSON.stringify({ ...report, regressionAssertions: assertions }, null, 2));
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Security verification failed: ${error.message}`);
  process.exitCode = 1;
}
