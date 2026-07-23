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

export {
  InMemoryTokenBucketStore,
  RedisTokenBucketStore,
  validateRateLimitPolicy,
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimitStore,
  type RedisEvalClient,
} from "./rate-limit.js";

export {
  createGatewayTraceContext,
  parseTraceparent,
  type GatewayTraceContext,
  type ParsedTraceparent,
  type TraceIdGenerator,
} from "./trace.js";

export {
  NOOP_GATEWAY_TELEMETRY,
  createOpenTelemetryGatewayTelemetry,
  type GatewayOutcome,
  type GatewayRequestObservation,
  type GatewayTelemetry,
  type GatewayTelemetryContext,
  type GatewayTelemetryResult,
  type OpenTelemetryAttributeValue,
  type OpenTelemetryAttributes,
  type OpenTelemetryCounterLike,
  type OpenTelemetryGatewayOptions,
  type OpenTelemetryHistogramLike,
  type OpenTelemetrySpanLike,
  type OpenTelemetryTracerLike,
} from "./telemetry.js";

export {
  createTenantGateway,
  type CreateTenantGatewayOptions,
  type GatewayTenant,
  type TenantGateway,
  type TenantResolver,
} from "./gateway.js";
