# Integration examples

These examples use only the public package API and synthetic data.

## Evidence-card validation

[`evidence-card.ts`](evidence-card.ts) demonstrates:

- exact quote grounding
- claim-to-source mapping
- literature-review certainty screening
- an explicit abstract-only source boundary
- deterministic failure handling

## Fetch API route handler

[`fetch-gateway.ts`](fetch-gateway.ts) demonstrates:

- API-key-to-tenant resolution
- per-tenant rate limiting
- upstream timeout and body-size configuration
- a framework-neutral `POST(request: Request)` route handler

## Runnable Node 22 gateway

[`node-gateway.mjs`](node-gateway.mjs) is a dependency-free reference service that bridges Node's HTTP server API to the package's Fetch API gateway.

It starts:

- a gateway HTTP server
- a synthetic upstream evidence service
- two API-key-resolved tenants
- independent tenant-and-route token buckets
- bounded bodies, upstream deadlines, request IDs, and trace propagation through the package gateway

Run the deterministic self-test:

```bash
npm run test:service
```

The self-test proves:

1. tenant A's first request is forwarded
2. tenant A's second request is throttled
3. tenant B's first request is still forwarded
4. forwarded responses identify the resolver-derived tenant
5. the Node HTTP-to-Fetch bridge preserves the gateway contract

Run the service interactively:

```bash
npm run example:gateway
```

Then call it with either synthetic key:

```bash
curl -i -H 'x-api-key: demo-key-a' http://127.0.0.1:4000/evidence
curl -i -H 'x-api-key: demo-key-b' http://127.0.0.1:4000/evidence
```

The in-memory limiter and built-in tenant directory are demonstration fixtures. Distributed deployments should adapt their Redis client through `RedisTokenBucketStore` as documented in [`docs/GATEWAY.md`](../docs/GATEWAY.md), and must supply secret management, authorization, network isolation, and deployment-specific telemetry.

## Safety

All text and identifiers are synthetic. Do not place credentials, patient data, private educational records, or proprietary full-text source material in examples or fixtures.

Passing these deterministic controls does not establish clinical sufficiency, educational efficacy, or authorization to publish or treat.
