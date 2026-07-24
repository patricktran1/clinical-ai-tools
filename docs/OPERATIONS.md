# Gateway operations

This document turns the gateway's architectural claims into executable checks and an explicit deployment runbook.

## Local operational gate

```bash
npm install
npm run test:operations
```

The command builds the distributable package and runs two independent programs against `dist/`, not source-only imports.

## Multi-tenant isolation load harness

```bash
npm run test:load
```

`scripts/load-gateway.mjs` creates twelve tenants, each with an independent 25-token bucket, and submits forty concurrent requests per tenant.

The harness fails unless:

- exactly 25 requests per tenant reach that tenant's upstream
- the remaining 15 requests per tenant receive `429`
- no tenant consumes another tenant's capacity
- every forwarded request carries the resolver-derived `x-tenant-id`
- the total upstream call count equals the sum of the isolated tenant capacities

The command emits a JSON report with status counts, per-tenant upstream calls, elapsed time, and latency percentiles. Latencies are diagnostic evidence rather than a universal performance threshold because CI runners vary.

## Fail-closed fault matrix

```bash
npm run test:fault
```

`scripts/fault-gateway.mjs` executes the following dependency and boundary failures:

| Failure | Expected response |
|---|---|
| Missing API key | `401 unauthorized` |
| Tenant directory unavailable | `503 tenant_resolver_unavailable` |
| Rate-limit store unavailable | `503 rate_limit_unavailable` |
| Request body exceeds limit | `413 payload_too_large` |
| Upstream network failure | `502 upstream_unavailable` |
| Upstream deadline exceeded | `504 upstream_timeout` |
| Tenant token bucket exhausted | `429 rate_limited` |

Every failure must retain a safe request ID and W3C trace context. The matrix exits non-zero if a status or error contract drifts.

## CI evidence

Every pull request produces retained artifacts containing:

- Node test coverage output
- the multi-tenant load report
- the fault-matrix report
- the high-severity dependency audit

These artifacts are review evidence. They are not production SLO measurements.

## Suggested production objectives

Deployments should set their own objectives from observed traffic. A reasonable starting review set is:

- authentication and tenant resolution failures are counted separately
- throttled requests are visible by tenant and route without exposing API keys
- upstream timeout rate is monitored independently from upstream error rate
- p95 gateway overhead is measured without upstream processing time where possible
- rate-limit and tenant-directory dependency health is included in readiness
- alerts preserve request and trace IDs but never request bodies or credentials

These are operational targets, not performance claims made by this repository.

## Incident sequence

1. Use `x-request-id` or `traceparent` to locate the request.
2. Identify the terminal gateway outcome in telemetry.
3. Distinguish tenant-directory, rate-limit-store, timeout, and upstream failures.
4. Confirm that the request failed closed and did not bypass tenant isolation.
5. Reproduce the class locally with `npm run test:fault`.
6. Add a deterministic regression before changing the failure contract.

## Deployment boundaries

The package does not provide secret storage, user authorization, PHI redaction, network isolation, Redis provisioning, or an OpenTelemetry backend. Those remain deployment responsibilities.
