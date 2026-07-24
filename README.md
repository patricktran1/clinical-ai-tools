# Clinical Evidence Guardrails

[![CI](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/ci.yml)
[![CodeQL](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/codeql.yml/badge.svg)](https://github.com/patricktran1/clinical-ai-tools/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Deterministic TypeScript guardrails and operational gateway infrastructure for source-grounded clinical evidence workflows.**

Clinical Evidence Guardrails is a dependency-free library for teams building evidence summarization, clinical education, literature triage, human-reviewed AI workflows, and bounded evidence APIs. It provides reusable controls that remain outside the model:

- explicitly curated source matching
- exact source-quote verification
- claim-to-evidence mapping
- configurable unsupported-certainty policies
- source-boundary disclosure checks
- a zero-dependency CLI for CI and file-based validation
- multi-tenant API isolation and token-bucket rate limiting
- atomic Redis throttling
- W3C trace propagation and OpenTelemetry-compatible observability
- executable multi-tenant load and fail-closed fault harnesses
- packed-package consumer validation and provenance-enabled releases

The library does not determine clinical truth, recommend treatment, or authorize publication. It helps applications fail closed when generated evidence artifacts are ungrounded, overstated, or crossing an unprotected service boundary.

## Why this exists

LLMs can produce useful drafts while still inventing quotations, widening a source allowlist, overstating certainty, or presenting an abstract-only review as though full text were processed. Evidence services can also leak credentials, mix tenant limits, accept spoofed forwarding headers, or silently bypass controls when dependencies fail. Those are system-design problems, not prompt-writing problems.

This package makes high-value evidence and service-boundary controls deterministic, inspectable, testable, and operationally exercisable.

## Install

```bash
npm install @patricktran1/clinical-evidence-guardrails
```

The package is prepared for its first provenance-enabled npm publication. Until then, clone the repository and run the examples locally.

## Evidence guardrails quick start

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

## Evidence validation CLI

The installed package exposes `clinical-evidence-check`, a zero-runtime-dependency command for validating a card JSON file against source text in CI or local workflows.

`card.json`:

```json
{
  "correctAnswer": "The synthetic endpoint was reported in the abstract.",
  "limitations": "Only the abstract was processed; full-text review remains required.",
  "assertedText": [
    "The result may inform review of the synthetic population."
  ],
  "evidenceMap": [
    {
      "claim": "The synthetic endpoint was reported in the abstract.",
      "sourceQuote": "The synthetic endpoint was reported in the abstract.",
      "supportType": "direct"
    }
  ]
}
```

Run:

```bash
clinical-evidence-check \
  --card card.json \
  --source abstract.txt \
  --policy literature-review \
  --pretty
```

Exit codes are designed for automation:

| Exit | Meaning |
|---:|---|
| `0` | deterministic guardrails passed |
| `1` | deterministic guardrails rejected the card |
| `2` | usage, file, JSON, or input-shape error |

The JSON output includes the selected policy, individual check states, stable issue codes, and unsafe-language matches. It does not echo source text or card content. Passing still does not establish clinical sufficiency or publication authorization.

Repository development can invoke the same command with:

```bash
npm run cli -- --card card.json --source abstract.txt --pretty
```

## Evidence API

### `createCuratedJournalMatcher(journals)`

Builds a deterministic matcher from canonical journal names and explicit aliases. Normalization handles casing, punctuation, ampersands, whitespace, and a leading `The`. Abbreviations still require explicit aliases, and alias collisions throw during construction.

### `quoteAppearsInSource(source, quote)`

Confirms that a non-empty source quote appears in the supplied source after Unicode and whitespace normalization. It does not use semantic similarity.

### `createCertaintyPolicy(name, rules)`

Builds a named policy from explicit regex rules. Policy names and rule labels must be non-empty. Duplicate labels are rejected case-insensitively. Stateful `g` and `y` regex flags are removed so repeated validation calls remain deterministic.

Built-in policies:

- `DEFAULT_CERTAINTY_POLICY`
- `LITERATURE_REVIEW_CERTAINTY_POLICY`
- `CLINICAL_EDUCATION_CERTAINTY_POLICY`

The presets are intentionally small and inspectable. They are deterministic screening examples, not comprehensive language-safety standards.

### `findUnsafeCertainty(texts, policy?)`

Returns every matching rule in deterministic policy order. Overlapping rules are all returned rather than silently choosing one. The function does not infer meaning or use a model.

### `validateEvidenceCard(card, source, options?)`

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

`RedisTokenBucketStore` performs read, refill, consume, persist, and expiry in one atomic Lua evaluation. It accepts a minimal `RedisEvalClient` adapter so callers can use their existing Redis SDK without adding a runtime dependency to this package.

`InMemoryTokenBucketStore` is intended for development, tests, and single-process deployments. It is not a distributed limiter.

### Observability

`createOpenTelemetryGatewayTelemetry()` accepts OpenTelemetry-shaped tracer, counter, and histogram objects without importing an SDK. Each request records exactly one terminal outcome, including authentication failures, throttling, dependency outages, timeouts, upstream failures, and successful forwarding.

API keys and request bodies are not recorded as attributes.

See [`docs/GATEWAY.md`](docs/GATEWAY.md) for architecture and threat boundaries and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for executable load, fault, artifact, and incident-response checks.

## Operational proof

### Multi-tenant isolation load harness

```bash
npm run test:load
```

The harness submits 480 concurrent requests across twelve tenants. It fails unless each tenant receives its own 25-request allowance, excess requests are throttled, and no tenant consumes another tenant's bucket.

### Fail-closed fault matrix

```bash
npm run test:fault
```

The matrix exercises authentication failure, tenant-directory outage, rate-limit-store outage, payload overflow, upstream failure, upstream timeout, and exhausted capacity. Every case must retain deterministic status, error code, request ID, and trace context.

### Complete operational gate

```bash
npm run test:operations
```

CI retains the load report, fault report, dependency audit, and coverage output as reviewable artifacts. Performance numbers are diagnostics from the runner, not production SLO claims.

## Package and release integrity

The package smoke test builds and packs the tarball, installs it in a clean temporary consumer project, imports through the public package name, and executes the installed `clinical-evidence-check` binary against a grounded fixture.

```bash
npm run test:package
```

Tags matching `v*.*.*` trigger a workflow that verifies the tag against `package.json`, reruns the full gate, and publishes with npm provenance after the protected npm environment and token authorize the release.

## Design principles

- **Fail closed.** Missing evidence, unavailable tenant resolution, and unavailable rate limiting block progress.
- **Keep models bounded.** Deterministic code retains veto authority.
- **Make source scope visible.** Abstract-only processing must be disclosed.
- **Prefer explicit allowlists.** Normalization never silently broadens eligibility.
- **Isolate tenants explicitly.** Tenant identity comes from the resolver, never caller-supplied forwarding headers.
- **Make decisions auditable.** Rejections record policy, rule, request, trace, tenant, and outcome metadata without credentials or bodies.
- **Separate validation from authorization.** Passing guardrails or traversing the gateway does not equal physician approval or publication.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run check
npm test
npm run test:coverage
npm run test:cli
npm run test:package
npm run test:operations
npm run validate
```

## Repository map

```text
bin/clinical-evidence-check.mjs  file-based validation CLI
src/journal.ts                   curated-source normalization and matching
src/text.ts                      exact-quote and claim comparison helpers
src/language.ts                  certainty policies and language screening
src/evidence.ts                  evidence-card validation
src/rate-limit.ts                process-local and atomic Redis token buckets
src/trace.ts                     W3C trace context validation and propagation
src/telemetry.ts                 dependency-free OpenTelemetry interfaces
src/gateway.ts                   multi-tenant Fetch API gateway
src/index.ts                     public package exports
scripts/smoke-package.mjs        packed-package API and CLI validation
scripts/load-gateway.mjs         multi-tenant isolation load harness
scripts/fault-gateway.mjs        deterministic fail-closed fault matrix
docs/GATEWAY.md                  architecture and threat boundaries
docs/OPERATIONS.md               operations, artifacts, and incident sequence
docs/CONTRIBUTOR_SPRINT.md       three external-contribution tracks
GOVERNANCE.md                    review and release authority
test/                            deterministic and adversarial suites
```

## Contributing

Focused contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), read the [`external contributor sprint`](docs/CONTRIBUTOR_SPRINT.md), and claim an issue labeled `good first issue` or `help wanted`.

The collaboration target is three merged pull requests from three distinct external contributors. Maintainer-authored changes and automated accounts do not count.

## Safety and scope

This is research and developer infrastructure. It is not a medical device, diagnostic system, clinical recommendation engine, or substitute for clinician judgment. Do not use it to make autonomous patient-care or publication decisions.

Regex policies are incomplete by design. A phrase that is not flagged may still be unsupported, misleading, or unsafe. Gateway controls do not provide secret management, user authorization, PHI redaction, network isolation, or clinical governance. Human review and deployment-specific security controls remain required.

See [`SECURITY.md`](SECURITY.md) for responsible disclosure.

## License

MIT © Patrick Tran
