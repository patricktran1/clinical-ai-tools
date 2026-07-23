import {
  findUnsafeCertainty,
  type CertaintyPolicy,
  type UnsafeCertaintyMatch,
} from "./language.js";
import { claimsMatch, quoteAppearsInSource } from "./text.js";

export interface EvidenceMapEntry {
  claim: string;
  sourceQuote: string;
  supportType?: "direct" | "contextual";
}

export interface EvidenceCard {
  correctAnswer: string;
  evidenceMap: readonly EvidenceMapEntry[];
  limitations: string;
  assertedText?: readonly string[];
}

export type GuardrailIssueCode =
  | "missing-evidence-map"
  | "fabricated-source-quote"
  | "correct-answer-unmapped"
  | "unsafe-certainty"
  | "source-boundary-missing";

export interface GuardrailIssue {
  code: GuardrailIssueCode;
  message: string;
}

export interface EvidenceGuardrailResult {
  passed: boolean;
  exactQuotes: boolean;
  correctAnswerMapped: boolean;
  languageSafe: boolean;
  sourceBoundaryExplicit: boolean;
  unsafeMatches: readonly UnsafeCertaintyMatch[];
  issues: readonly GuardrailIssue[];
}

export interface ValidateEvidenceCardOptions {
  sourceBoundaryPattern?: RegExp;
  certaintyPolicy?: CertaintyPolicy;
}

/**
 * Validate a bounded evidence card against its source text.
 *
 * The function is deliberately deterministic. It does not decide whether the
 * evidence is clinically sufficient and it never authorizes publication.
 */
export function validateEvidenceCard(
  card: EvidenceCard,
  source: string,
  options: ValidateEvidenceCardOptions = {},
): EvidenceGuardrailResult {
  const boundaryPattern = options.sourceBoundaryPattern ?? /\babstract\b/i;
  const issues: GuardrailIssue[] = [];

  const hasEvidenceMap = card.evidenceMap.length > 0;
  const exactQuotes =
    hasEvidenceMap &&
    card.evidenceMap.every((entry) => quoteAppearsInSource(source, entry.sourceQuote));

  const correctAnswerMapped = card.evidenceMap.some(
    (entry) =>
      claimsMatch(entry.claim, card.correctAnswer) &&
      quoteAppearsInSource(source, entry.sourceQuote),
  );

  const assertedText = [
    card.correctAnswer,
    ...card.evidenceMap.map((entry) => entry.claim),
    ...(card.assertedText ?? []),
  ];
  const unsafeMatches = findUnsafeCertainty(assertedText, options.certaintyPolicy);
  const languageSafe = unsafeMatches.length === 0;

  boundaryPattern.lastIndex = 0;
  const sourceBoundaryExplicit = boundaryPattern.test(card.limitations);
  boundaryPattern.lastIndex = 0;

  if (!hasEvidenceMap) {
    issues.push({
      code: "missing-evidence-map",
      message: "At least one claim-to-source mapping is required.",
    });
  } else if (!exactQuotes) {
    issues.push({
      code: "fabricated-source-quote",
      message: "Every source quote must appear in the supplied source text.",
    });
  }

  if (!correctAnswerMapped) {
    issues.push({
      code: "correct-answer-unmapped",
      message: "The correct answer must be represented by a grounded claim.",
    });
  }

  if (!languageSafe) {
    issues.push({
      code: "unsafe-certainty",
      message: `Unsupported certainty detected by ${unsafeMatches[0]?.policy ?? "configured"} policy: ${unsafeMatches
        .map((match) => match.rule)
        .join(", ")}.`,
    });
  }

  if (!sourceBoundaryExplicit) {
    issues.push({
      code: "source-boundary-missing",
      message: "Limitations must explicitly identify the processed source boundary.",
    });
  }

  return {
    passed:
      hasEvidenceMap &&
      exactQuotes &&
      correctAnswerMapped &&
      languageSafe &&
      sourceBoundaryExplicit,
    exactQuotes,
    correctAnswerMapped,
    languageSafe,
    sourceBoundaryExplicit,
    unsafeMatches,
    issues,
  };
}
