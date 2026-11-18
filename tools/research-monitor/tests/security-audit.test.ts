import assert from "node:assert/strict";
import test from "node:test";
import { classifyAuditReport, PICOMATCH_PATCH_ADVISORY } from "../scripts/security/audit-report.mjs";

// Captured npm audit v2 report from the actual Vite 8.1.6 project on 2026-11-18.
// Keep this fixture self-contained: CI must never depend on a local /tmp report.
const captured = {
  auditReportVersion: 2,
  vulnerabilities: {
    "@vitejs/plugin-react": {
      name: "@vitejs/plugin-react",
      severity: "high",
      isDirect: true,
      via: ["vite"],
      effects: [],
      range: ">=6.0.0-beta.0",
      nodes: ["node_modules/@vitejs/plugin-react"],
      fixAvailable: {
        name: "@vitejs/plugin-react",
        version: "5.2.0",
        isSemVerMajor: true,
      },
    },
    fdir: {
      name: "fdir",
      severity: "high",
      isDirect: false,
      via: ["picomatch"],
      effects: ["tinyglobby"],
      range: ">=5.2.1",
      nodes: ["node_modules/fdir"],
      fixAvailable: {
        name: "vite",
        version: "6.2.7",
        isSemVerMajor: true,
      },
    },
    picomatch: {
      name: "picomatch",
      severity: "high",
      isDirect: false,
      via: [
        {
          source: 1247710,
          name: "picomatch",
          dependency: "picomatch",
          title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
          url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
          severity: "high",
          cwe: ["CWE-1333"],
          cvss: {
            score: 7.5,
            vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
          },
          range: "<=4.0.7",
        },
      ],
      effects: ["fdir", "tinyglobby", "vite"],
      range: "*",
      nodes: ["node_modules/picomatch"],
      fixAvailable: {
        name: "vite",
        version: "6.2.7",
        isSemVerMajor: true,
      },
    },
    tinyglobby: {
      name: "tinyglobby",
      severity: "high",
      isDirect: false,
      via: ["fdir", "picomatch"],
      effects: ["vite"],
      range: "*",
      nodes: ["node_modules/tinyglobby"],
      fixAvailable: {
        name: "vite",
        version: "6.2.7",
        isSemVerMajor: true,
      },
    },
    vite: {
      name: "vite",
      severity: "high",
      isDirect: true,
      via: ["picomatch", "tinyglobby"],
      effects: ["@vitejs/plugin-react"],
      range: ">=6.3.0-beta.0",
      nodes: ["node_modules/vite"],
      fixAvailable: {
        name: "vite",
        version: "6.2.7",
        isSemVerMajor: true,
      },
    },
  },
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 5,
      critical: 0,
      total: 5,
    },
    dependencies: {
      prod: 89,
      dev: 158,
      optional: 113,
      peer: 0,
      peerOptional: 0,
      total: 246,
    },
  },
};
const proof = () => new Set(["node_modules/picomatch"]);
const fresh = (): any => structuredClone(captured);
const levels = ["info", "low", "moderate", "high", "critical"];
function recount(report: any) {
  const counts: Record<string, number> = Object.fromEntries(levels.map((level) => [level, 0]));
  for (const item of Object.values(report.vulnerabilities) as any[]) counts[item.severity]++;
  counts.total = Object.keys(report.vulnerabilities).length;
  report.metadata.vulnerabilities = counts;
  return report;
}
function additional(
  name: string,
  severity = "high",
  url = "https://github.com/advisories/GHSA-68fv-2mgg-jv7q",
) {
  return {
    name,
    severity,
    isDirect: false,
    range: "*",
    effects: [],
    nodes: [`node_modules/${name}`],
    fixAvailable: false,
    via: [
      { source: 1241209, name, dependency: name, title: "Independent advisory", url, severity, range: "*" },
    ],
  };
}

test("the actual five-package report is allowed only through the verified picomatch advisory and remains intact", () => {
  const report = fresh(),
    before = structuredClone(report);
  const result = classifyAuditReport(report, proof());
  assert.equal(result.ok, true);
  assert.equal(result.threshold, "high");
  assert.equal(result.rawCounts?.high, 5);
  assert.equal(result.allowedPatched.length, 5);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.belowThreshold, []);
  assert.match(result.note, /original audit report remains unchanged and still reports/);
  for (const item of result.allowedPatched) {
    assert.equal(item.advisory, PICOMATCH_PATCH_ADVISORY);
    assert.deepEqual(item.verifiedPatchNodes, ["node_modules/picomatch"]);
  }
  assert.deepEqual(report, before);
});

test("every reported picomatch installation needs independent verification", () => {
  const report = fresh();
  assert.equal(classifyAuditReport(report, new Set()).ok, false);
  report.vulnerabilities.picomatch.nodes.push("node_modules/other/node_modules/picomatch");
  assert.equal(classifyAuditReport(report, proof()).ok, false);
  const all = proof();
  all.add("node_modules/other/node_modules/picomatch");
  assert.equal(classifyAuditReport(report, all).ok, true);
});

test("an unknown advisory on picomatch is never hidden by its verified package hash", () => {
  const report = fresh();
  report.vulnerabilities.picomatch.via[0].url = "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz";
  const result = classifyAuditReport(report, proof());
  assert.equal(result.ok, false);
  assert.equal(result.allowedPatched.length, 0);
  assert.equal(result.blocking.length, 5);
});

test("a changed advisory source ID requires review even when the GHSA URL is unchanged", () => {
  const report = fresh();
  report.vulnerabilities.picomatch.via[0].source = 1247711;
  const result = classifyAuditReport(report, proof());
  assert.equal(result.ok, false);
  assert.deepEqual(result.allowedPatched, []);
  assert.equal(result.blocking.length, 5);
});

test("a changed affected range requires review even when the advisory identity is unchanged", () => {
  for (const range of ["<=4.0.8", "*", "<4.0.8"]) {
    const report = fresh();
    report.vulnerabilities.picomatch.via[0].range = range;
    const result = classifyAuditReport(report, proof());
    assert.equal(result.ok, false);
    assert.deepEqual(result.allowedPatched, []);
    assert.equal(result.blocking.length, 5);
  }
});

test("an additional advisory on the same package blocks every affected ancestor", () => {
  const report = fresh();
  report.vulnerabilities.picomatch.via.push(additional("picomatch").via[0]);
  const result = classifyAuditReport(report, proof());
  assert.equal(result.ok, false);
  assert.equal(result.allowedPatched.length, 0);
  assert.equal(result.blocking.length, 5);
});

test("the exact GHSA URL on another package does not qualify for the picomatch exception", () => {
  const report = fresh();
  report.vulnerabilities.other = additional("other", "high", PICOMATCH_PATCH_ADVISORY);
  Object.assign(report.vulnerabilities.other.via[0], { source: 1247710, range: "<=4.0.7" });
  const result = classifyAuditReport(recount(report), proof());
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.blocking.map((item) => item.name),
    ["other"],
  );
  assert.equal(result.allowedPatched.length, 5);
  const unrelatedProof = proof();
  unrelatedProof.add("node_modules/other");
  assert.equal(classifyAuditReport(report, unrelatedProof).ok, false);
});

test("an unrelated high or critical advisory still fails the gate", () => {
  for (const severity of ["high", "critical"]) {
    const report = fresh();
    report.vulnerabilities["source-map-js"] = additional("source-map-js", severity);
    const result = classifyAuditReport(recount(report), proof());
    assert.equal(result.ok, false);
    assert.equal(result.allowedPatched.length, 5);
    assert.deepEqual(
      result.blocking.map((item) => item.name),
      ["source-map-js"],
    );
  }
});

test("an unresolved branch cannot be hidden behind an approved sibling branch", () => {
  const report = fresh();
  report.vulnerabilities["source-map-js"] = additional("source-map-js");
  report.vulnerabilities.vite.via.push("source-map-js");
  const result = classifyAuditReport(recount(report), proof());
  assert.equal(result.ok, false);
  assert.deepEqual(
    new Set(result.blocking.map((item) => item.name)),
    new Set(["@vitejs/plugin-react", "vite", "source-map-js"]),
  );
  assert.deepEqual(
    new Set(result.allowedPatched.map((item) => item.name)),
    new Set(["picomatch", "tinyglobby", "fdir"]),
  );
});

test("independent low and moderate findings remain reported without changing the high threshold", () => {
  const report = fresh();
  report.vulnerabilities.low = additional("low", "low");
  report.vulnerabilities.moderate = additional("moderate", "moderate");
  const result = classifyAuditReport(recount(report), proof());
  assert.equal(result.ok, true);
  assert.equal(result.allowedPatched.length, 5);
  assert.deepEqual(new Set(result.belowThreshold.map((item) => item.name)), new Set(["low", "moderate"]));
  assert.equal(result.rawCounts?.total, 7);
});

test("critical escalation of the approved advisory or its affected package requires new review", () => {
  const report = fresh();
  report.vulnerabilities.picomatch.severity = "critical";
  const result = classifyAuditReport(recount(report), proof());
  assert.equal(result.ok, false);
  const direct = fresh();
  direct.vulnerabilities.picomatch.via[0].severity = "critical";
  assert.equal(classifyAuditReport(direct, proof()).ok, false);
});

test("broken links and cyclic advisory graphs fail closed without partial approvals", () => {
  const broken = fresh();
  broken.vulnerabilities.vite.via.push("absent-package");
  const cycle = fresh();
  cycle.vulnerabilities.picomatch.via = ["vite"];
  for (const report of [broken, cycle]) {
    const result = classifyAuditReport(report, proof());
    assert.equal(result.ok, false);
    assert.deepEqual(result.allowedPatched, []);
    assert.match(result.blocking[0].reason, /Broken|Cyclic/);
  }
});

test("even a below-threshold cycle is invalid audit evidence", () => {
  const report = fresh();
  report.vulnerabilities.loop = { ...additional("loop", "low"), via: ["loop"] };
  const result = classifyAuditReport(recount(report), proof());
  assert.equal(result.ok, false);
  assert.match(result.blocking[0].reason, /Cyclic/);
});

test("metadata cannot conceal missing findings or understate advisory severity", () => {
  const wrongCount = fresh();
  wrongCount.metadata.vulnerabilities.high = 0;
  const missingCount = fresh();
  delete missingCount.metadata.vulnerabilities.high;
  const unknownCount = fresh();
  unknownCount.metadata.vulnerabilities.unknown = 1;
  const understated = fresh();
  understated.vulnerabilities.picomatch.severity = "low";
  recount(understated);
  const emptyDependencies = fresh();
  emptyDependencies.metadata.dependencies.total = 0;
  for (const report of [wrongCount, missingCount, unknownCount, understated, emptyDependencies]) {
    const result = classifyAuditReport(report, proof());
    assert.equal(result.ok, false);
    assert.deepEqual(result.allowedPatched, []);
  }
});

test("malformed, unavailable, or unsupported audit reports fail closed", () => {
  const mutations: ((report: any) => void)[] = [
    (report) => {
      report.auditReportVersion = 3;
    },
    (report) => {
      report.error = { code: "EAI_AGAIN", message: "Registry unavailable" };
    },
    (report) => {
      delete report.metadata;
    },
    (report) => {
      delete report.metadata.dependencies;
    },
    (report) => {
      report.vulnerabilities.picomatch.severity = "unknown";
    },
    (report) => {
      report.vulnerabilities.picomatch.nodes = [];
    },
    (report) => {
      report.vulnerabilities.picomatch.nodes = ["node_modules/../picomatch"];
    },
    (report) => {
      report.vulnerabilities.picomatch.nodes = ["node_modules/other"];
    },
    (report) => {
      report.vulnerabilities.picomatch.via = [];
    },
    (report) => {
      report.vulnerabilities.picomatch.via[0].name = "other";
    },
    (report) => {
      report.vulnerabilities.picomatch.via[0].dependency = "other";
    },
    (report) => {
      report.vulnerabilities.picomatch.via[0].source = "1247710";
    },
    (report) => {
      report.vulnerabilities.picomatch.via[0].url = "not-a-url";
    },
  ];
  for (const mutation of mutations) {
    const report = fresh();
    mutation(report);
    const result = classifyAuditReport(report, proof());
    assert.equal(result.ok, false);
    assert.equal(result.blocking.length > 0, true);
    assert.deepEqual(result.allowedPatched, []);
  }
  for (const report of [null, [], {}, { error: { code: "ENOLOCK" } }])
    assert.equal(classifyAuditReport(report, proof()).ok, false);
});

test("clean complete audit reports pass without requiring an exception", () => {
  const report = fresh();
  report.vulnerabilities = {};
  recount(report);
  const result = classifyAuditReport(report, new Set());
  assert.equal(result.ok, true);
  assert.deepEqual(result.allowedPatched, []);
  assert.equal(result.rawCounts?.total, 0);
  assert.equal(classifyAuditReport(report, undefined).ok, false);
});
