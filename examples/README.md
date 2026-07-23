# Integration examples

These examples use only the public package API. They are written as copyable TypeScript rather than application-specific framework code.

## Evidence-card validation

[`evidence-card.ts`](evidence-card.ts) demonstrates:

- exact quote grounding
- claim-to-source mapping
- literature-review certainty screening
- an explicit abstract-only source boundary
- deterministic failure handling

## Fetch API gateway

[`fetch-gateway.ts`](fetch-gateway.ts) demonstrates:

- API-key-to-tenant resolution
- per-tenant rate limiting
- upstream timeout and body-size configuration
- a framework-neutral `POST(request: Request)` route handler

The in-memory limiter is appropriate for a local or single-process example. Distributed deployments should adapt their Redis client through `RedisTokenBucketStore` as documented in [`docs/GATEWAY.md`](../docs/GATEWAY.md).

## Safety

All text and identifiers are synthetic. Do not place credentials, patient data, private educational records, or proprietary full-text source material in examples or fixtures.

Passing these deterministic controls does not establish clinical sufficiency, educational efficacy, or authorization to publish or treat.
