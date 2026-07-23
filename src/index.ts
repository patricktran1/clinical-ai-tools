export {
  createCuratedJournalMatcher,
  normalizeJournalName,
  type CuratedJournal,
  type JournalMatch,
} from "./journal.js";

export {
  claimsMatch,
  normalizeWhitespace,
  quoteAppearsInSource,
} from "./text.js";

export {
  CLINICAL_EDUCATION_CERTAINTY_POLICY,
  DEFAULT_CERTAINTY_POLICY,
  LITERATURE_REVIEW_CERTAINTY_POLICY,
  createCertaintyPolicy,
  findUnsafeCertainty,
  type CertaintyPolicy,
  type CertaintyRule,
  type UnsafeCertaintyMatch,
} from "./language.js";

export {
  validateEvidenceCard,
  type EvidenceCard,
  type EvidenceGuardrailResult,
  type EvidenceMapEntry,
  type GuardrailIssue,
  type GuardrailIssueCode,
  type ValidateEvidenceCardOptions,
} from "./evidence.js";
