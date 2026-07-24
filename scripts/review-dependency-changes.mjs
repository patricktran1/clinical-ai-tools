import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPORT_PATH = process.argv[2] ?? "dependency-review/local-review.json";
const HEAD_LOCK_PATH = "package-lock.json";
const AUDIT_PATH = "dependency-review/npm-audit.json";
const OFFICIAL_VULNERABILITIES_PATH = "dependency-review/vulnerable-changes.json";
const OFFICIAL_LICENSES_PATH = "dependency-review/invalid-license-changes.json";
const OFFICIAL_OUTCOME_PATH = "dependency-review/outcome.txt";

const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
]);

function readJson(path, fallback = null) {
  try {
    const content = readFileSync(path, "utf8").trim();
    return content ? JSON.parse(content) : fallback;
  } catch {
    return fallback;
  }
}

function readBaseLock() {
  try {
    return JSON.parse(
      execFileSync("git", ["show", "origin/main:package-lock.json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

function packageNameFromPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : path;
}

function packageMap(lock) {
  const packages = lock?.packages ?? {};
  return new Map(
    Object.entries(packages)
      .filter(([path]) => path !== "")
      .map(([path, value]) => [path, { path, name: packageNameFromPath(path), ...value }]),
  );
}

function hasEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

const headLock = readJson(HEAD_LOCK_PATH);
if (!headLock) throw new Error("package-lock.json is required for dependency review.");

const baseLock = readBaseLock();
const basePackages = packageMap(baseLock);
const headPackages = packageMap(headLock);
const changes = [];

for (const [path, current] of headPackages) {
  const previous = basePackages.get(path);
  if (!previous) {
    changes.push({ kind: "added", ...current });
  } else if (previous.version !== current.version || previous.integrity !== current.integrity) {
    changes.push({
      kind: "changed",
      ...current,
      previousVersion: previous.version ?? null,
      previousIntegrity: previous.integrity ?? null,
    });
  }
}

for (const [path, previous] of basePackages) {
  if (!headPackages.has(path)) changes.push({ kind: "removed", ...previous });
}

const violations = [];
for (const change of changes.filter((item) => item.kind !== "removed")) {
  const license = typeof change.license === "string" ? change.license : null;
  if (!license || !ALLOWED_LICENSES.has(license)) {
    violations.push({
      code: "dependency_license_not_allowed",
      package: change.name,
      version: change.version ?? null,
      license,
    });
  }

  if (typeof change.resolved !== "string" || !change.resolved.startsWith("https://registry.npmjs.org/")) {
    violations.push({
      code: "dependency_untrusted_resolution",
      package: change.name,
      version: change.version ?? null,
      resolved: change.resolved ?? null,
    });
  }

  if (typeof change.integrity !== "string" || !change.integrity.startsWith("sha512-")) {
    violations.push({
      code: "dependency_integrity_not_sha512",
      package: change.name,
      version: change.version ?? null,
      integrity: change.integrity ?? null,
    });
  }
}

const audit = readJson(AUDIT_PATH, {});
const auditCounts = audit?.metadata?.vulnerabilities ?? {};
for (const severity of ["moderate", "high", "critical"]) {
  const count = Number(auditCounts[severity] ?? 0);
  if (count > 0) violations.push({ code: "npm_audit_vulnerability", severity, count });
}

const officialVulnerabilities = readJson(OFFICIAL_VULNERABILITIES_PATH, []);
const officialInvalidLicenses = readJson(OFFICIAL_LICENSES_PATH, []);
if (hasEntries(officialVulnerabilities)) {
  violations.push({ code: "official_dependency_review_vulnerability", detail: officialVulnerabilities });
}
if (hasEntries(officialInvalidLicenses)) {
  violations.push({ code: "official_dependency_review_license", detail: officialInvalidLicenses });
}

const officialOutcome = readFileSync(OFFICIAL_OUTCOME_PATH, "utf8").trim() || "unknown";
const report = {
  schemaVersion: 1,
  baseLockfilePresent: Boolean(baseLock),
  officialActionOutcome: officialOutcome,
  officialFallbackUsed:
    officialOutcome !== "success" &&
    !hasEntries(officialVulnerabilities) &&
    !hasEntries(officialInvalidLicenses),
  policy: {
    minimumIntegrity: "sha512",
    allowedRegistry: "https://registry.npmjs.org/",
    allowedLicenses: [...ALLOWED_LICENSES].sort(),
    auditThreshold: "moderate",
  },
  changes: changes.map((change) => ({
    kind: change.kind,
    name: change.name,
    version: change.version ?? null,
    previousVersion: change.previousVersion ?? null,
    license: change.license ?? null,
    dev: Boolean(change.dev),
    optional: Boolean(change.optional),
    resolved: change.resolved ?? null,
    integrity: change.integrity ?? null,
  })),
  auditCounts,
  violations,
  passed: violations.length === 0,
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (violations.length > 0) process.exit(1);
