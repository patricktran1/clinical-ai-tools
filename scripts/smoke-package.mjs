import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const workspace = await mkdtemp(path.join(tmpdir(), "clinical-evidence-consumer-"));
const artifacts = path.join(workspace, "artifacts");
const consumer = path.join(workspace, "consumer");

async function run(command, args, cwd) {
  const result = await execFileAsync(command, args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

try {
  await mkdir(artifacts, { recursive: true });
  await mkdir(consumer, { recursive: true });

  const packed = await run(
    "npm",
    ["pack", "--json", "--pack-destination", artifacts],
    root,
  );
  const packResult = JSON.parse(packed.stdout);
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error("npm pack did not return exactly one package artifact.");
  }

  const metadata = packResult[0];
  const filename = metadata.filename;
  const files = new Set((metadata.files ?? []).map((entry) => entry.path));
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack did not report an artifact filename.");
  }

  for (const requiredPath of [
    "bin/clinical-evidence-check.mjs",
    "dist/index.js",
    "dist/index.d.ts",
    "README.md",
    "LICENSE",
    "package.json",
  ]) {
    if (!files.has(requiredPath)) {
      throw new Error(`Packed package is missing required file: ${requiredPath}`);
    }
  }

  for (const entry of files) {
    if (entry.startsWith("src/") || entry.startsWith("test/")) {
      throw new Error(`Packed package leaked repository-only source: ${entry}`);
    }
  }

  const tarball = path.join(artifacts, filename);
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({
      name: "clinical-evidence-consumer-smoke",
      private: true,
      type: "module",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(consumer, "smoke.mjs"),
    `import assert from "node:assert/strict";
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
  normalizeJournalName,
  validateEvidenceCard,
} from "@patricktran1/clinical-evidence-guardrails";

assert.equal(normalizeJournalName("The British Journal of Dermatology"), "british journal of dermatology");

const sourceQuote = "The synthetic endpoint was reported in the abstract.";
const validation = validateEvidenceCard({
  correctAnswer: sourceQuote,
  evidenceMap: [{ claim: sourceQuote, sourceQuote, supportType: "direct" }],
  limitations: "Only the abstract was processed; full-text review remains required.",
}, sourceQuote);
assert.equal(validation.passed, true);

const gateway = createTenantGateway({
  resolveTenant: (apiKey) => apiKey === "consumer-key" ? {
    id: "consumer-demo",
    upstreamBaseUrl: "https://evidence.internal.example/v1",
    rateLimit: { capacity: 2, refillTokens: 2, refillIntervalMs: 60_000 },
  } : null,
  rateLimitStore: new InMemoryTokenBucketStore(),
  requestIdFactory: () => "consumer-smoke",
  traceIdGenerator: {
    nextTraceId: () => "1".repeat(32),
    nextSpanId: () => "2".repeat(16),
  },
  fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://evidence.internal.example/v1/cards");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(headers.get("x-tenant-id"), "consumer-demo");
    return Response.json({ ok: true });
  },
});

const response = await gateway(new Request("https://gateway.example/cards", {
  headers: { "x-api-key": "consumer-key" },
}));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { ok: true });
console.log("Packed package API consumer smoke test passed.");
`,
    "utf8",
  );

  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    consumer,
  );
  await run(process.execPath, ["smoke.mjs"], consumer);

  const installedPackagePath = path.join(
    consumer,
    "node_modules",
    "@patricktran1",
    "clinical-evidence-guardrails",
  );
  const installedPackage = JSON.parse(
    await readFile(path.join(installedPackagePath, "package.json"), "utf8"),
  );
  if (installedPackage.name !== "@patricktran1/clinical-evidence-guardrails") {
    throw new Error("The installed package identity did not match the public package name.");
  }
  if (installedPackage.bin?.["clinical-evidence-check"] !== "bin/clinical-evidence-check.mjs") {
    throw new Error("The installed package did not expose clinical-evidence-check.");
  }

  const sourceQuote = "The synthetic endpoint was reported in the abstract.";
  const cardPath = path.join(consumer, "card.json");
  const sourcePath = path.join(consumer, "source.txt");
  await Promise.all([
    writeFile(cardPath, JSON.stringify({
      correctAnswer: sourceQuote,
      limitations: "Only the abstract was processed; full-text review remains required.",
      evidenceMap: [{
        claim: sourceQuote,
        sourceQuote,
        supportType: "direct",
      }],
    }), "utf8"),
    writeFile(sourcePath, sourceQuote, "utf8"),
  ]);

  const installedCli = path.join(
    consumer,
    "node_modules",
    ".bin",
    "clinical-evidence-check",
  );
  const cliResult = await run(
    process.execPath,
    [installedCli, "--card", cardPath, "--source", sourcePath, "--pretty"],
    consumer,
  );
  const cliOutput = JSON.parse(cliResult.stdout);
  if (cliOutput.passed !== true || cliOutput.tool !== "clinical-evidence-check") {
    throw new Error("The installed CLI did not validate the grounded consumer fixture.");
  }

  console.log(`Verified packed artifact ${filename}, public API imports, and installed CLI in a clean consumer project.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
