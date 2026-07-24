import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve("bin/clinical-evidence-check.mjs"), ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function withFixtures(
  card: unknown,
  source: string,
  callback: (cardPath: string, sourcePath: string) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(path.join(tmpdir(), "clinical-evidence-cli-"));
  try {
    const cardPath = path.join(workspace, "card.json");
    const sourcePath = path.join(workspace, "source.txt");
    await Promise.all([
      writeFile(cardPath, JSON.stringify(card), "utf8"),
      writeFile(sourcePath, source, "utf8"),
    ]);
    await callback(cardPath, sourcePath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const groundedQuote = "The synthetic endpoint was reported in the abstract.";

function validCard() {
  return {
    correctAnswer: groundedQuote,
    limitations: "Only the abstract was processed; full-text review remains required.",
    assertedText: ["The result may inform review of the synthetic population."],
    evidenceMap: [
      {
        claim: groundedQuote,
        sourceQuote: groundedQuote,
        supportType: "direct",
      },
    ],
  };
}

test("CLI returns zero and machine-readable success for a grounded card", async () => {
  await withFixtures(validCard(), groundedQuote, async (cardPath, sourcePath) => {
    const result = await runCli([
      "--card",
      cardPath,
      "--source",
      sourcePath,
      "--policy",
      "literature-review",
      "--pretty",
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout) as {
      passed: boolean;
      policy: string;
      checks: Record<string, boolean>;
      issues: unknown[];
    };
    assert.equal(output.passed, true);
    assert.equal(output.policy, "literature-review");
    assert.deepEqual(output.issues, []);
    assert.deepEqual(output.checks, {
      exactQuotes: true,
      correctAnswerMapped: true,
      languageSafe: true,
      sourceBoundaryExplicit: true,
    });
  });
});

test("CLI returns one and a stable issue code for a fabricated quotation", async () => {
  const card = validCard();
  card.evidenceMap[0] = {
    ...card.evidenceMap[0],
    sourceQuote: "This sentence is not present in the supplied source.",
  };

  await withFixtures(card, groundedQuote, async (cardPath, sourcePath) => {
    const result = await runCli(["--card", cardPath, "--source", sourcePath]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout) as {
      passed: boolean;
      issues: Array<{ code: string }>;
    };
    assert.equal(output.passed, false);
    assert.ok(output.issues.some((issue) => issue.code === "fabricated-source-quote"));
  });
});

test("CLI returns one when the selected policy detects unsupported certainty", async () => {
  const card = validCard();
  card.assertedText = ["This evidence proves that the intervention always works."];

  await withFixtures(card, groundedQuote, async (cardPath, sourcePath) => {
    const result = await runCli([
      "--card",
      cardPath,
      "--source",
      sourcePath,
      "--policy",
      "literature-review",
    ]);

    assert.equal(result.code, 1);
    const output = JSON.parse(result.stdout) as {
      passed: boolean;
      issues: Array<{ code: string }>;
      unsafeMatches: unknown[];
    };
    assert.equal(output.passed, false);
    assert.ok(output.issues.some((issue) => issue.code === "unsafe-certainty"));
    assert.ok(output.unsafeMatches.length > 0);
  });
});

test("CLI returns two for malformed input shape without echoing card content", async () => {
  const secretMarker = "do-not-echo-this-marker";
  await withFixtures(
    {
      correctAnswer: secretMarker,
      limitations: "abstract only",
      evidenceMap: "not-an-array",
    },
    groundedQuote,
    async (cardPath, sourcePath) => {
      const result = await runCli(["--card", cardPath, "--source", sourcePath]);

      assert.equal(result.code, 2);
      assert.match(result.stderr, /evidenceMap must be an array/i);
      assert.doesNotMatch(result.stderr, new RegExp(secretMarker));
      assert.equal(result.stdout, "");
    },
  );
});

test("CLI exposes help and package version without fixture files", async () => {
  const help = await runCli(["--help"]);
  const version = await runCli(["--version"]);

  assert.equal(help.code, 0);
  assert.match(help.stdout, /Validate a bounded evidence-card JSON file/i);
  assert.match(help.stdout, /Exit codes:/i);
  assert.equal(help.stderr, "");

  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(version.stderr, "");
});
