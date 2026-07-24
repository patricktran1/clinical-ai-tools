#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CLINICAL_EDUCATION_CERTAINTY_POLICY,
  DEFAULT_CERTAINTY_POLICY,
  LITERATURE_REVIEW_CERTAINTY_POLICY,
  validateEvidenceCard,
} from "../dist/index.js";

const POLICY_BY_NAME = new Map([
  ["default", DEFAULT_CERTAINTY_POLICY],
  ["literature-review", LITERATURE_REVIEW_CERTAINTY_POLICY],
  ["clinical-education", CLINICAL_EDUCATION_CERTAINTY_POLICY],
]);

class CliInputError extends Error {}

function usage() {
  return `clinical-evidence-check

Validate a bounded evidence-card JSON file against source text.

Usage:
  clinical-evidence-check --card <card.json> --source <source.txt> [options]

Options:
  --policy <name>   default | literature-review | clinical-education
  --pretty          Pretty-print JSON output
  --help            Show this help
  --version         Show package version

Exit codes:
  0  deterministic guardrails passed
  1  deterministic guardrails rejected the card
  2  usage, file, JSON, or input-shape error

Passing this command does not establish clinical sufficiency or authorize publication.`;
}

function parseArgs(argv) {
  const options = {
    cardPath: "",
    sourcePath: "",
    policyName: "default",
    pretty: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--card") {
      options.cardPath = argv[++index] ?? "";
    } else if (argument === "--source") {
      options.sourcePath = argv[++index] ?? "";
    } else if (argument === "--policy") {
      options.policyName = argv[++index] ?? "";
    } else if (argument === "--pretty") {
      options.pretty = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--version" || argument === "-v") {
      options.version = true;
    } else {
      throw new CliInputError(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliInputError(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalStringArray(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new CliInputError(`${label} must be an array of strings when provided.`);
  }
  return value;
}

function parseEvidenceCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliInputError("Card JSON must contain an object.");
  }

  const candidate = value;
  if (!Array.isArray(candidate.evidenceMap)) {
    throw new CliInputError("card.evidenceMap must be an array.");
  }

  const evidenceMap = candidate.evidenceMap.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CliInputError(`card.evidenceMap[${index}] must be an object.`);
    }
    const supportType = entry.supportType;
    if (supportType !== undefined && supportType !== "direct" && supportType !== "contextual") {
      throw new CliInputError(
        `card.evidenceMap[${index}].supportType must be direct or contextual when provided.`,
      );
    }
    return {
      claim: requiredString(entry.claim, `card.evidenceMap[${index}].claim`),
      sourceQuote: requiredString(
        entry.sourceQuote,
        `card.evidenceMap[${index}].sourceQuote`,
      ),
      ...(supportType === undefined ? {} : { supportType }),
    };
  });

  const assertedText = optionalStringArray(candidate.assertedText, "card.assertedText");
  return {
    correctAnswer: requiredString(candidate.correctAnswer, "card.correctAnswer"),
    limitations: requiredString(candidate.limitations, "card.limitations"),
    evidenceMap,
    ...(assertedText === undefined ? {} : { assertedText }),
  };
}

async function packageVersion() {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  return String(packageJson.version ?? "unknown");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.version) {
    console.log(await packageVersion());
    return 0;
  }
  if (!options.cardPath || !options.sourcePath) {
    throw new CliInputError("Both --card and --source are required.");
  }

  const policy = POLICY_BY_NAME.get(options.policyName);
  if (!policy) {
    throw new CliInputError(
      `Unknown policy: ${options.policyName}. Choose default, literature-review, or clinical-education.`,
    );
  }

  const cardPath = path.resolve(options.cardPath);
  const sourcePath = path.resolve(options.sourcePath);
  let rawCard;
  let source;
  try {
    [rawCard, source] = await Promise.all([
      readFile(cardPath, "utf8"),
      readFile(sourcePath, "utf8"),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown file error";
    throw new CliInputError(`Could not read the supplied files: ${message}`);
  }

  let parsedCard;
  try {
    parsedCard = JSON.parse(rawCard);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new CliInputError(`Card file is not valid JSON: ${message}`);
  }

  const card = parseEvidenceCard(parsedCard);
  const result = validateEvidenceCard(card, source, { certaintyPolicy: policy });
  const output = {
    tool: "clinical-evidence-check",
    schemaVersion: 1,
    policy: policy.name,
    passed: result.passed,
    checks: {
      exactQuotes: result.exactQuotes,
      correctAnswerMapped: result.correctAnswerMapped,
      languageSafe: result.languageSafe,
      sourceBoundaryExplicit: result.sourceBoundaryExplicit,
    },
    issues: result.issues,
    unsafeMatches: result.unsafeMatches,
    scope: "Deterministic validation only; clinical sufficiency and publication authorization remain separate.",
  };

  console.log(JSON.stringify(output, null, options.pretty ? 2 : 0));
  return result.passed ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown CLI error.";
  console.error(`clinical-evidence-check: ${message}`);
  if (error instanceof CliInputError) console.error("Run with --help for usage.");
  process.exitCode = 2;
}
