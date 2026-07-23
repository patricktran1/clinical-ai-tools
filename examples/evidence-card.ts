import {
  LITERATURE_REVIEW_CERTAINTY_POLICY,
  validateEvidenceCard,
} from "@patricktran1/clinical-evidence-guardrails";

const sourceQuote =
  "At week 16, the synthetic study reported a higher response rate in the intervention group.";

const result = validateEvidenceCard(
  {
    correctAnswer: sourceQuote,
    evidenceMap: [
      {
        claim: sourceQuote,
        sourceQuote,
        supportType: "direct",
      },
    ],
    assertedText: [
      "The reported result may inform review of the studied population and comparator.",
    ],
    limitations:
      "Only the abstract was processed; full-text methods and safety review remain required.",
  },
  `RESULTS: ${sourceQuote}`,
  { certaintyPolicy: LITERATURE_REVIEW_CERTAINTY_POLICY },
);

if (!result.passed) {
  console.error(result.issues);
  process.exitCode = 1;
} else {
  console.log("The deterministic evidence checks passed.");
}
