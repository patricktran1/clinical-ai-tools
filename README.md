# Clinical Evidence Guardrails

[![CI](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/ci.yml)
[![CodeQL](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/codeql.yml/badge.svg)](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Deterministic TypeScript guardrails and gateway infrastructure for source-grounded clinical evidence workflows.**

Clinical Evidence Guardrails is a dependency-free library for teams building evidence summarization, clinical education, literature triage, human-reviewed AI workflows, and bounded evidence APIs. It provides reusable controls that remain outside the model:

- explicitly curated source matching
- exact source-quote verification
- claim-to-evidence mapping
- configurable unsupported-certainty policies
- source-boundary disclosure checks
- multi-tenant API isolation and rate limiting
- W3C trace propagation and OpenTelemetry-compatible observability

The library does not determine clinical truth, recommend treatment, or authorize publication. It helps applications fail closed when generated evidence artifacts are ungrounded, overstated, or crossing an unprotected service boundary.

## Why this exists

LLMs can produce useful drafts while still inventing quotations, widening a source allowlist, overstating certainty, or presenting an abstract-only review as though full text were processed. Evidence services can also leak credentials, mix tenant limits, accept spoofed forwarding headers, or silently bypass controls when dependencies fail. Those are system-design problems, not prompt-writing problems.

This package makes several high-value checks and service-boundary controls deterministic, inspectable, and testable.

## Install

```bash
npm install @patricktran1/clinical-evidence-guardrails
```

The package is currently source-ready and prepared for its first npm publication. Until then, clone the repository and run the examples locally.

## Quick start

```ts
import {
  LITERATURE_REVIEW_CERTAINTY_POLICY,
  createCuratedJournalMatcher,
  validateEvidenceCard,
} from "@patricktran1/clinical-evidence-guardrails";

const matchJournal = createCuratedJournalMatcher([
  {
    canonical: "British Journal of Dermatology",
    aliases: ["Br J Dermatol", "The British journal of dermatology"],
  },
]);

const journal = matchJournal("Br J Dermatol");
// { canonical: "British Journal of Dermatology", matchedAlias: "Br J Dermatol" }

const sourceQuote =
  "At week 16, 62% of participants achieved the primary endpoint compared with 31% receiving placebo.";

const result = validateEvidenceCard(
  {
    correctAnswer: sourceQuote,
    limitations:
      "Only the PubMed abstract was processed; full-text review remains required.",
    assertedText: [
      "The reported endpoint may inform review of the studied population.",
    ],
    evidenceMap: [
      {
        claim: sourceQuote,
        sourceQuote,
        supportType: "direct",
      },
    ],
  },
  `RESULTS: ${sourceQuote}`,
  { certaintyPolicy: LITERATURE_REVIEW_CERTAINTY_POLICY },
);

if (!result.passed) {
  console.error(result.issues);
  console.error(result.unsafeMatches);
}
```

## Evidence API

### `createCuratedJournalMatcher(journals)`

Builds a deterministic matcher from canonical journal names and explicit aliases. Normalization handles casing, punctuation, ampersands, whitespace, and a leading `The`. Abbreviations still require explicit aliases, and alias collisions throw during construction.

### `quoteAppearsInSource(source, quote)`

Confirms that a non-empty source quote appears in the supplied source after Unicode and whitespace normalization. It does not use semantic similarity.

### `createCertaintyPolicy(name, rules)`

Builds a named policy from explicit regex rules:

```ts
const policy = createCertaintyPolicy("patient-education", [
  { label: "guaranteed outcome", pattern: /\bguaranteed outcome\b/i },
  { label: "no side effects", pattern: /\bno side effects\b/i },
]);
```

Policy names and rule labels must be non-empty. Duplicate labels are rejected case-insensitively. Stateful `g` and `y` regex flags are removed when the policy is created so repeated validation calls produce the same result.

An empty policy is allowed for record-only workflows, but it disables certainty screening. Applications should make that choice explicit and document the compensating review process.

### Built-in certainty policies

- `DEFAULT_CERTAINTY_POLICY` preserves the original conservative screening behavior.
- `LITERATURE_REVIEW_CERTAINTY_POLICY` additionally flags causal, definitive, and conclusive overclaims.
- `CLINICAL_EDUCATION_CERTAINTY_POLICY` additionally flags universal safety and directive treatment language.

The presets are intentionally small and inspectable. They are examples of deterministic screening, not comprehensive language-safety standards.

### `findUnsafeCertainty(texts, policy?)`

Returns every matching rule in deterministic policy order. Each result includes:

```ts
{
  phrase: string; // backward-compatible alias for rule
  rule: string;
  policy: string;
  text: string;
}
```

Overlapping rules are all returned rather than silently choosing one. The function does not infer meaning or use a model.

### `validateEvidenceCard(card, source, options?)`

Supported options:

```ts
{
  sourceBoundaryPattern?: RegExp;
  certaintyPolicy?: CertaintyPolicy;
}
```

The result contains:

```ts
{
  passed: boolean;
  exactQuotes: boolean;
  correctAnswerMapped: boolean;
  languageSafe: boolean;
  sourceBoundaryExplicit: boolean;
  unsafeMatches: UnsafeCertaintyMatch[];
  issues: GuardrailIssue[];
}
```

A card passes only when:

1. at least one evidence mapping exists
2. every quoted excerpt appears in the source
3. the correct answer is represented by a grounded claim
4. asserted language avoids the selected certainty policy
5. limitations explicitly disclose the processed source boundary

Passing means only that these deterministic checks succeeded. It does not establish clinical sufficiency, factual completeness, or authorization to publish.

## Multi-tenant evidence gateway

`createTenantGateway()` provides a Fetch API compatible boundary for evidence services:

```ts
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "@patricktran1/clinical-evidence-guardrails";

const gateway = createTenantGateway({
  resolveTenant: async (apiKey) => tenantDirectory.get(apiKey) ?? null,
  rateLimitStore: new InMemoryTokenBucketStore(),
  timeoutMs: 10_000,
  maxBodyBytes: 256_000,
});

export async function POST(request: Request): Promise<Response> {
  return gateway(request);
}
```

The gateway:

- resolves API keys to explicit tenant configurations
- isolates token buckets by tenant and route
- strips credentials, spoofable forwarding headers, and hop-by-hop headers
- enforces bounded request bodies and abortable upstream timeouts
- propagates validated W3C `traceparent` context
- returns stable JSON errors and standard rate-limit metadata
- fails closed when tenant resolution or throttling is unavailable

### Distributed rate limiting

`RedisTokenBucketStore` performs read, refill, consume, persist, and expiry in one atomic Lua evaluation. It accepts a minimal `RedisEvalClient` adapter so the package remains dependency-free and callers can use their existing Redis SDK.

`InMemoryTokenBucketStore` is intended for development, tests, and single-process deployments. It is not a distributed limiter.

### Observability

`createOpenTelemetryGatewayTelemetry()` accepts OpenTelemetry-shaped tracer, counter, and histogram objects without importing an SDK. Each request records exactly one terminal outcome, including authentication failures, throttling, dependency outages, timeouts, upstream failures, and successful forwarding.

API keys and request bodies are not recorded as attributes.

See [`docs/GATEWAY.md`](docs/GATEWAY.md) for the request sequence, Redis and OpenTelemetry adapters, deterministic error model, header boundary, and threat-model limits.

## Design principles

- **Fail closed.** Missing evidence, unavailable tenant resolution, and unavailable rate limiting block progress.
- **Keep models bounded.** Deterministic code retains veto authority.
- **Make source scope visible.** Abstract-only processing must be disclosed.
- **Prefer explicit allowlists.** Normalization never silently broadens eligibility.
- **Isolate tenants explicitly.** Tenant identity comes from the resolver, never caller-supplied forwarding headers.
- **Make policy decisions auditable.** Certainty rejections record their policy, rule, and source text; gateway requests retain request, trace, tenant, and outcome metadata.
- **Separate validation from authorization.** Passing guardrails or traversing the gateway does not equal physician approval or publication.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm test
npm run test:coverage
npm run check
npm run build
```

`npm run validate` runs the complete local gate.

## Repository map

```text
src/journal.ts      curated-source normalization and matching
src/text.ts         exact-quote and claim comparison helpers
src/language.ts     certainty policies and unsupported-language screening
src/evidence.ts     evidence-card validation
src/rate-limit.ts   process-local and atomic Redis token buckets
src/trace.ts        W3C trace context validation and propagation
src/telemetry.ts    dependency-free OpenTelemetry adapter interfaces
src/gateway.ts      multi-tenant Fetch API gateway
src/index.ts        public package exports
docs/GATEWAY.md     deployment architecture and threat boundaries
test/               deterministic and adversarial regression suites
```

## Contributing

Focused contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and an issue labeled `good first issue` or `help wanted`.

High-value contribution areas include:

- additional clinical-language policies with fixtures
- source-format normalization edge cases
- configurable boundary disclosures
- property-based tests
- Redis client adapter examples
- gateway load and fault-injection fixtures
- examples for literature-review and clinical-education workflows

## Safety and scope

This is research and developer infrastructure. It is not a medical device, diagnostic system, clinical recommendation engine, or substitute for clinician judgment. Do not use it to make autonomous patient-care or publication decisions.

Regex policies are incomplete by design. A phrase that is not flagged may still be unsupported, misleading, or unsafe. Gateway controls do not provide secret management, user authorization, PHI redaction, network isolation, or clinical governance. Human review and deployment-specific security controls remain required.

See [`SECURITY.md`](SECURITY.md) for responsible disclosure.

## License

MIT © Patrick Tran
