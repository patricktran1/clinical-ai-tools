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
  findUnsafeCertainty,
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
