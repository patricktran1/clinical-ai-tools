# Multi-tenant evidence gateway

The gateway module provides a Fetch API compatible boundary for clinical evidence services. It is designed for systems that need explicit tenant isolation, deterministic throttling, trace propagation, and observable failure behavior before a request reaches an evidence-processing API.

It does not evaluate clinical truth, recommend care, authorize publication, or convert an upstream service into a medical device.

## Request sequence

```text
client request
  │
  ├─ validate or generate request + trace identifiers
  ├─ require API key
  ├─ resolve API key to an explicit tenant configuration
  ├─ validate tenant ID, upstream URL, headers, and rate policy
  ├─ consume tenant + route token bucket
  ├─ reject oversized request bodies
  ├─ strip credentials and spoofable forwarding headers
  ├─ add authoritative tenant, request, and trace headers
  ├─ proxy with an abortable timeout
  ├─ sanitize the upstream response
  └─ close telemetry exactly once
```

The rate-limit key is `${tenantId}:${route}`. Requests from one tenant cannot consume another tenant's bucket when the resolver supplies distinct tenant IDs.

## Basic gateway

```ts
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "@patricktran1/clinical-evidence-guardrails";

const tenants = new Map([
  [
    "development-key",
    {
      id: "dermatology-demo",
      upstreamBaseUrl: "https://evidence.internal.example/v1",
      rateLimit: {
        capacity: 60,
        refillTokens: 60,
        refillIntervalMs: 60_000,
      },
      upstreamHeaders: {
        "x-service-version": "2026-07",
      },
    },
  ],
]);

const gateway = createTenantGateway({
  resolveTenant: (apiKey) => tenants.get(apiKey) ?? null,
  rateLimitStore: new InMemoryTokenBucketStore(),
  timeoutMs: 10_000,
  maxBodyBytes: 256_000,
});

export async function POST(request: Request): Promise<Response> {
  return gateway(request);
}
```

The in-memory store is appropriate for tests, local development, and a single process. It is not a distributed rate limiter.

## Redis deployment

`RedisTokenBucketStore` uses one Lua evaluation to read, refill, consume, persist, and expire a bucket atomically. The package does not depend on a Redis client. Adapt the client already used by the application:

```ts
import {
  RedisTokenBucketStore,
  createTenantGateway,
  type RedisEvalClient,
} from "@patricktran1/clinical-evidence-guardrails";

const adapter: RedisEvalClient = {
  async eval(script, keys, arguments_) {
    return redis.eval(script, {
      keys: [...keys],
      arguments: [...arguments_],
    });
  },
};

const gateway = createTenantGateway({
  resolveTenant,
  rateLimitStore: new RedisTokenBucketStore(adapter, "evidence-gateway"),
});
```

A Redis error produces a deterministic `503 rate_limit_unavailable` response. The gateway does not silently bypass throttling.

## OpenTelemetry integration

The telemetry adapter accepts OpenTelemetry-shaped tracer and metric instruments without taking an SDK dependency:

```ts
import {
  createOpenTelemetryGatewayTelemetry,
  createTenantGateway,
} from "@patricktran1/clinical-evidence-guardrails";

const telemetry = createOpenTelemetryGatewayTelemetry({
  tracer,
  requestCounter,
  durationHistogram,
});

const gateway = createTenantGateway({
  resolveTenant,
  rateLimitStore,
  telemetry,
});
```

Each request produces one terminal outcome:

- `forwarded`
- `unauthorized`
- `payload-too-large`
- `rate-limited`
- `dependency-unavailable`
- `timeout`
- `upstream-error`

The adapter records the tenant only after successful resolution. API keys and request bodies are never added as attributes.

## Trace propagation

A valid W3C `traceparent` header retains its trace ID and flags while the gateway creates a fresh child span ID. Invalid or all-zero identifiers are discarded and replaced. The authoritative gateway `traceparent` is sent upstream and returned downstream.

Custom ID generators are injectable for deterministic tests. Production defaults use Web Crypto.

## Header boundary

The gateway removes the caller's:

- API-key header
- `Host` and `Content-Length`
- hop-by-hop headers
- `Forwarded` and `X-Forwarded-*`
- `X-Tenant-ID`
- `X-Request-ID` when its value is unsafe
- `traceparent` before replacing it with the validated gateway value

The gateway then sets authoritative tenant, request, trace, host, and protocol headers. Tenant-supplied upstream headers cannot override reserved names.

Downstream responses remove hop-by-hop headers and `Set-Cookie`, then receive authoritative request, trace, and rate-limit metadata.

## Deterministic errors

Errors use a stable JSON envelope:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "The tenant rate limit has been exceeded."
  }
}
```

Authentication failures intentionally use the same message for missing and unknown keys. Resolver and rate-store failures return `503` rather than bypassing controls. Upstream timeouts return `504`; other upstream failures return `502`.

## Threat model and limits

The module addresses:

- cross-tenant rate-limit contamination
- API-key forwarding to upstream services
- spoofed tenant and forwarding headers
- unbounded buffered request bodies
- missing timeouts
- non-atomic distributed token consumption
- invalid trace context
- accidental cookie propagation from upstream services
- telemetry paths that close more than once

The module does not provide:

- API-key storage, rotation, hashing, or revocation
- user authentication or authorization within a tenant
- network-layer isolation, TLS termination, or service-mesh policy
- distributed denial-of-service protection at the edge
- response-body size enforcement
- PHI redaction or data-loss prevention
- autonomous clinical validation

Applications remain responsible for secret management, network controls, audit retention, privacy review, clinical governance, and deployment-specific load testing.
