import assert from "node:assert/strict";
import test from "node:test";
import {
  findUnsafeCertainty,
  validateEvidenceCard,
  type EvidenceCard,
} from "../dist/index.js";

const quote =
  "At week 16, 62% of participants achieved the primary endpoint compared with 31% receiving placebo.";
const source = `BACKGROUND: Evidence remains limited. RESULTS: ${quote} CONCLUSIONS: Additional follow-up is needed.`;

function validCard(): EvidenceCard {
  return {
    correctAnswer: quote,
    limitations:
      "Only the PubMed abstract was processed; full-text methods and safety data require physician review.",
    assertedText: [
      "The reported endpoint may inform review of the studied population and comparator.",
    ],
    evidenceMap: [
      {
        claim: quote,
        sourceQuote: quote,
        supportType: "direct",
      },
    ],
  };
}

test("passes a grounded, bounded evidence card", () => {
  const result = validateEvidenceCard(validCard(), source);

  assert.equal(result.passed, true);
  assert.equal(result.exactQuotes, true);
  assert.equal(result.correctAnswerMapped, true);
  assert.equal(result.languageSafe, true);
  assert.equal(result.sourceBoundaryExplicit, true);
  assert.deepEqual(result.issues, []);
});

test("rejects a fabricated source quote", () => {
  const card = validCard();
  card.evidenceMap[0] = {
    ...card.evidenceMap[0],
    sourceQuote: "This sentence is absent from the source.",
  };

  const result = validateEvidenceCard(card, source);
  assert.equal(result.passed, false);
  assert.equal(result.exactQuotes, false);
  assert.ok(result.issues.some((issue) => issue.code === "fabricated-source-quote"));
});

test("rejects an unmapped correct answer", () => {
  const card = validCard();
  card.correctAnswer = "A different answer than the grounded claim.";

  const result = validateEvidenceCard(card, source);
  assert.equal(result.correctAnswerMapped, false);
  assert.ok(result.issues.some((issue) => issue.code === "correct-answer-unmapped"));
});

test("rejects unsupported certainty", () => {
  const card = validCard();
  card.assertedText = ["This result proves the treatment cures all patients."];

  const result = validateEvidenceCard(card, source);
  assert.equal(result.languageSafe, false);
  assert.ok(result.unsafeMatches.length >= 2);
  assert.ok(result.issues.some((issue) => issue.code === "unsafe-certainty"));
});

test("rejects a missing source-boundary disclosure", () => {
  const card = validCard();
  card.limitations = "Additional review is recommended.";

  const result = validateEvidenceCard(card, source);
  assert.equal(result.sourceBoundaryExplicit, false);
  assert.ok(result.issues.some((issue) => issue.code === "source-boundary-missing"));
});

test("detects high-certainty language independently", () => {
  const matches = findUnsafeCertainty([
    "This practice-changing result should immediately replace existing care.",
  ]);

  assert.deepEqual(
    matches.map((match) => match.phrase),
    ["replace existing care", "practice-changing"],
  );
});
