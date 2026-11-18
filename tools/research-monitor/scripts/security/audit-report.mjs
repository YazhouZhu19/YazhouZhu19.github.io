export const PICOMATCH_PATCH_ADVISORY = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";

/** @typedef {"info" | "low" | "moderate" | "high" | "critical"} AuditSeverity */
/** @typedef {Record<AuditSeverity | "total", number>} AuditCounts */
/** @typedef {{name: string, severity: AuditSeverity, nodes: string[]}} AuditFinding */
/**
 * @typedef {AuditFinding & {
 *   advisory: string,
 *   verifiedPatchNodes: string[],
 *   reason: string
 * }} PatchedFinding
 */
/**
 * @typedef {{
 *   name: string | null,
 *   severity: AuditSeverity | null,
 *   nodes: string[],
 *   reason: string
 * }} BlockingFinding
 */
/**
 * @typedef {{
 *   ok: boolean,
 *   threshold: "high",
 *   rawCounts: AuditCounts | null,
 *   allowedPatched: PatchedFinding[],
 *   belowThreshold: AuditFinding[],
 *   blocking: BlockingFinding[],
 *   note: string
 * }} AuditClassification
 */

const severities = ["info", "low", "moderate", "high", "critical"];
const rank = (severity) => severities.indexOf(severity);
const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const text = (value) => typeof value === "string" && value.length > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const packageName = (value) =>
  typeof value === "string" && /^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

function nodePackage(path) {
  if (!text(path) || path.includes("\\")) return null;
  const parts = path.split("/");
  let name = null;
  for (let i = 0; i < parts.length; ) {
    if (parts[i++] !== "node_modules" || i >= parts.length) return null;
    name = parts[i++];
    if (name.startsWith("@")) {
      if (i >= parts.length) return null;
      name += "/" + parts[i++];
    }
    if (!packageName(name)) return null;
  }
  return name;
}

function validateReport(report, patchedNodes) {
  requireValue(patchedNodes instanceof Set, "Verified patch nodes must be a Set of installed paths");
  for (const path of patchedNodes)
    requireValue(nodePackage(path) === "picomatch", "Verified patch node is not a picomatch package path");
  requireValue(
    object(report) && !Object.hasOwn(report, "error"),
    "npm audit failed or returned an invalid report",
  );
  requireValue(report.auditReportVersion === 2, "Unsupported npm audit report version");
  requireValue(object(report.vulnerabilities), "Missing npm audit vulnerability inventory");
  requireValue(object(report.metadata), "Missing npm audit metadata");
  const counts = report.metadata.vulnerabilities;
  requireValue(object(counts), "Missing npm audit vulnerability counts");
  requireValue(
    Object.keys(counts).sort().join(",") === [...severities, "total"].sort().join(",") &&
      Object.values(counts).every(integer),
    "Unknown or invalid npm audit severity metadata",
  );
  const dependencies = report.metadata.dependencies;
  requireValue(
    object(dependencies) &&
      ["prod", "dev", "optional", "peer", "peerOptional", "total"].every((key) => integer(dependencies[key])),
    "Missing or invalid npm audit dependency metadata",
  );
  const computed = Object.fromEntries(severities.map((severity) => [severity, 0]));
  const paths = new Set();
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    requireValue(
      packageName(name) && object(item) && item.name === name,
      "Mismatched npm audit package identity",
    );
    requireValue(rank(item.severity) >= 0, `Unknown severity for ${name}`);
    requireValue(
      typeof item.isDirect === "boolean" && text(item.range),
      `Incomplete package metadata for ${name}`,
    );
    requireValue(
      Array.isArray(item.nodes) && item.nodes.length > 0 && new Set(item.nodes).size === item.nodes.length,
      `Missing or duplicate installed nodes for ${name}`,
    );
    for (const path of item.nodes) {
      requireValue(
        nodePackage(path) === name && !paths.has(path),
        `Invalid installed node identity for ${name}`,
      );
      paths.add(path);
    }
    requireValue(
      Array.isArray(item.effects) && item.effects.every(packageName),
      `Invalid dependency effects for ${name}`,
    );
    requireValue(Array.isArray(item.via) && item.via.length > 0, `Missing advisory chain for ${name}`);
    for (const via of item.via) {
      if (typeof via === "string") {
        requireValue(
          packageName(via) && Object.hasOwn(report.vulnerabilities, via),
          `Broken advisory chain: ${name} -> ${via}`,
        );
        continue;
      }
      requireValue(
        object(via) &&
          via.name === name &&
          via.dependency === name &&
          integer(via.source) &&
          via.source > 0 &&
          text(via.title) &&
          text(via.url) &&
          text(via.range) &&
          rank(via.severity) >= 0,
        `Unknown or mismatched direct advisory metadata for ${name}`,
      );
      let url;
      try {
        url = new URL(via.url);
      } catch {
        throw new Error(`Invalid advisory URL for ${name}`);
      }
      requireValue(
        url.protocol === "https:" && !url.username && !url.password,
        `Invalid advisory URL for ${name}`,
      );
    }
    computed[item.severity]++;
  }
  requireValue(
    severities.every((severity) => counts[severity] === computed[severity]) &&
      counts.total === Object.keys(report.vulnerabilities).length &&
      counts.total === severities.reduce((sum, severity) => sum + counts[severity], 0),
    "npm audit metadata counts do not match the vulnerability inventory",
  );
  requireValue(
    dependencies.total >= paths.size,
    "npm audit dependency metadata omits reported installed nodes",
  );
  return counts;
}

/**
 * Classify the unmodified npm v2 audit report at npm's high threshold.
 * patchedNodes is proof supplied by a separate installed-file hash verifier;
 * this module never applies a patch or assumes that an advisory has disappeared.
 * @param {unknown} report Unmodified output of npm audit --json.
 * @param {unknown} patchedNodes A Set of independently verified installed paths.
 * @returns {AuditClassification}
 */
export function classifyAuditReport(report, patchedNodes) {
  /** @type {AuditClassification} */
  const result = {
    ok: false,
    threshold: "high",
    rawCounts: null,
    allowedPatched: [],
    belowThreshold: [],
    blocking: [],
    note: "npm's original audit report remains unchanged and still reports the locally patched advisory; only independently verified installed patch nodes can satisfy this exception.",
  };
  try {
    result.rawCounts = { ...validateReport(report, patchedNodes) };
    const inventory = report.vulnerabilities;
    const resolved = new Map();
    const visiting = new Set();
    function resolve(name) {
      if (resolved.has(name)) return resolved.get(name);
      requireValue(!visiting.has(name), `Cyclic advisory chain involving ${name}`);
      visiting.add(name);
      const item = inventory[name];
      let onlyVerifiedPatch = true;
      let highestSeverity = 0;
      const verifiedNodes = new Set();
      for (const via of item.via) {
        if (typeof via === "string") {
          const child = resolve(via);
          onlyVerifiedPatch &&= child.onlyVerifiedPatch;
          highestSeverity = Math.max(highestSeverity, rank(inventory[via].severity));
          for (const path of child.verifiedNodes) verifiedNodes.add(path);
        } else {
          const verified =
            name === "picomatch" &&
            via.name === "picomatch" &&
            via.dependency === "picomatch" &&
            via.url === PICOMATCH_PATCH_ADVISORY &&
            via.source === 1247710 &&
            via.range === "<=4.0.7" &&
            via.severity === "high" &&
            item.nodes.every((path) => patchedNodes.has(path));
          onlyVerifiedPatch &&= verified;
          highestSeverity = Math.max(highestSeverity, rank(via.severity));
          if (verified) for (const path of item.nodes) verifiedNodes.add(path);
        }
      }
      requireValue(
        rank(item.severity) >= highestSeverity,
        `Package severity understates its advisory chain: ${name}`,
      );
      visiting.delete(name);
      const value = { onlyVerifiedPatch, verifiedNodes: [...verifiedNodes].sort() };
      resolved.set(name, value);
      return value;
    }
    // Validate every chain, including below-threshold entries, before granting
    // any exception. Malformed graphs must not produce partial approvals.
    for (const name of Object.keys(inventory)) resolve(name);
    for (const [name, item] of Object.entries(inventory)) {
      const entry = { name, severity: item.severity, nodes: [...item.nodes] };
      if (rank(item.severity) < rank("high")) result.belowThreshold.push(entry);
      else if (item.severity === "high" && resolved.get(name).onlyVerifiedPatch) {
        result.allowedPatched.push({
          ...entry,
          advisory: PICOMATCH_PATCH_ADVISORY,
          verifiedPatchNodes: resolved.get(name).verifiedNodes,
          reason: "Every advisory chain terminates exclusively at the verified local picomatch patch",
        });
      } else
        result.blocking.push({
          ...entry,
          reason: "Unmitigated high/critical advisory or an unverified patch node",
        });
    }
    result.ok = result.blocking.length === 0;
  } catch (error) {
    result.allowedPatched = [];
    result.belowThreshold = [];
    result.blocking = [
      {
        name: null,
        severity: null,
        nodes: [],
        reason: error instanceof Error ? error.message : "Invalid npm audit report",
      },
    ];
  }
  return result;
}
