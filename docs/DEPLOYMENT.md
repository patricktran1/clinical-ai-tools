# Gateway service deployment

The repository includes a production-shaped Node 22 service around the dependency-free gateway library. It is a deployable reference boundary, not a claim that one container configuration fits every clinical environment.

## Runtime contract

The service exposes:

- `GET /healthz` for process liveness
- `GET /readyz` for traffic readiness
- every other path through the authenticated multi-tenant gateway
- JSON startup, draining, and shutdown events
- explicit drain behavior before the HTTP listener closes

During drain, `/healthz` remains available, `/readyz` returns `503`, and new proxied traffic returns the stable `service_draining` error.

## Required configuration

`TENANT_DIRECTORY_JSON` is required. It is an object keyed by API key:

```json
{
  "replace-with-secret-key": {
    "id": "tenant-a",
    "upstreamBaseUrl": "https://evidence-a.internal.example/v1",
    "rateLimit": {
      "capacity": 60,
      "refillTokens": 60,
      "refillIntervalMs": 60000
    }
  }
}
```

The reference parser rejects malformed JSON, empty tenant directories, incomplete tenant entries, and non-HTTPS upstreams. `ALLOW_HTTP_UPSTREAMS=1` exists only for local fixtures and must not be used to weaken production transport security.

Do not place a real tenant directory in source control, container layers, screenshots, or CI logs. Production deployments should load it through a secret manager or replace the environment-backed directory with a deployment-specific trusted resolver.

## Optional configuration

| Variable | Default | Meaning |
|---|---:|---|
| `HOST` | `0.0.0.0` | Listener host |
| `PORT` | `4000` | Listener port; `0` is accepted for tests |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Per-request upstream deadline |
| `MAX_BODY_BYTES` | `256000` | Maximum request body size |
| `SHUTDOWN_GRACE_MS` | `5000` | Time before remaining sockets are force-closed |

All numeric values are validated before the listener starts.

## Container

Build:

```bash
docker build -t clinical-evidence-gateway .
```

Run with a secret-backed tenant directory:

```bash
docker run --rm \
  -p 4000:4000 \
  -e TENANT_DIRECTORY_JSON="$TENANT_DIRECTORY_JSON" \
  clinical-evidence-gateway
```

The image:

- uses a separate TypeScript build stage
- copies only the compiled package, service, package metadata, and license into runtime
- runs as the unprivileged `node` user
- includes a liveness health check
- contains no default API keys or upstream credentials

CI builds the image, verifies its configured user is `node`, starts the container, polls liveness and readiness, and confirms unauthenticated proxied traffic fails with `401`.

## Distributed rate limiting

The reference service uses `InMemoryTokenBucketStore`, which is process-local. Multi-replica deployments must supply a shared limiter such as `RedisTokenBucketStore` through deployment-specific composition. The library keeps the Redis interface minimal so the production stack can choose its own client, TLS, authentication, topology, and secret management.

Do not operate multiple replicas with process-local rate limiting while describing the limit as tenant-global.

## Observability

The gateway supports an OpenTelemetry-shaped telemetry adapter without importing a runtime SDK. A deployment should wire its tracer, request counter, outcome counter, and duration histogram when constructing the service.

Safe correlation attributes include request ID, trace ID, tenant ID after trusted resolution, method, route, status, outcome, and duration. API keys, request bodies, patient data, source text, and tenant secrets must not be recorded.

## OpenAPI

[`openapi/gateway.openapi.json`](../openapi/gateway.openapi.json) documents:

- liveness and readiness
- API-key authentication
- deterministic gateway-generated error envelopes
- `401`, `413`, `429`, `502`, `503`, and `504` behavior
- request, trace, rate-limit, and retry headers

`npm run test:openapi` protects the required operations, status codes, schemas, and headers from accidental drift.

## Supply-chain evidence

Every CI run retains:

- dependency-audit JSON
- native coverage output
- tenant-isolation load report
- fail-closed fault matrix
- reference and production-shaped service reports
- OpenAPI contract report
- container image metadata
- CycloneDX SBOM

Tagged npm releases separately rerun validation and publish with npm provenance after the protected release environment authorizes the operation.

## Boundaries

This service does not provide:

- end-user authorization
- PHI detection or redaction
- network segmentation
- TLS termination
- secret provisioning
- distributed rate limiting by default
- clinical governance or physician approval
- production SLOs merely because CI load checks pass

Those controls remain deployment responsibilities. The service should fail closed when required dependencies or trusted configuration are unavailable.
