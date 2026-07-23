import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
  type GatewayOutcome,
  type GatewayTelemetry,
  type GatewayTenant,
  type RateLimitStore,
  type TraceIdGenerator,
} from "../dist/index.js";

const traceIds: TraceIdGenerator = {
  nextTraceId: () => "1".repeat(32),
  nextSpanId: () => "2".repeat(16),
};

function tenant(id: string): GatewayTenant {
  return {
    id,
    upstreamBaseUrl: `https://${id}.internal.example/v1`,
    rateLimit: {
      capacity: 1,
      refillTokens: 1,
      refillIntervalMs: 60_000,
    },
    upstreamHeaders: {
      "x-gateway-version": "test",
    },
  };
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    resolveTenant: (apiKey: string) => apiKey === "key-a" ? tenant("tenant-a") : apiKey === "key-b" ? tenant("tenant-b") : null,
    rateLimitStore: new InMemoryTokenBucketStore(),
    fetchImpl: async () => new Response("ok", { status: 200 }),
    now: () => 1_000,
    requestIdFactory: () => "generated-request",
    traceIdGenerator: traceIds,
    ...overrides,
  };
}

async function errorCode(response: Response): Promise<string> {
  const payload = await response.json() as { error: { code: string } };
  return payload.error.code;
}

test("rejects missing and unknown API keys without calling upstream", async () => {
  let fetchCalls = 0;
  const gateway = createTenantGateway(baseOptions({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    },
  }));

  const missing = await gateway(new Request("https://gateway.example/cards"));
  const unknown = await gateway(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "unknown" },
  }));

  assert.equal(missing.status, 401);
  assert.equal(await errorCode(missing), "unauthorized");
  assert.equal(unknown.status, 401);
  assert.equal(await errorCode(unknown), "unauthorized");
  assert.equal(fetchCalls, 0);
});

test("isolates tenant limits, strips credentials, and propagates trace context", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const gateway = createTenantGateway(baseOptions({
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ grounded: true }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "should-not-cross-the-gateway=true",
          connection: "close",
        },
      });
    },
  }));
  const incomingTrace = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01";

  const firstTenantA = await gateway(new Request("https://gateway.example/cards?journal=bjd", {
    method: "POST",
    headers: {
      "x-api-key": "key-a",
      "x-tenant-id": "spoofed-tenant",
      "x-request-id": "client-request",
      traceparent: incomingTrace,
      "content-type": "application/json",
    },
    body: JSON.stringify({ claim: "bounded" }),
  }));
  const blockedTenantA = await gateway(new Request("https://gateway.example/cards", {
    method: "POST",
    headers: { "x-api-key": "key-a" },
  }));
  const firstTenantB = await gateway(new Request("https://gateway.example/cards", {
    method: "POST",
    headers: { "x-api-key": "key-b" },
  }));

  assert.equal(firstTenantA.status, 201);
  assert.equal(firstTenantA.headers.get("x-request-id"), "client-request");
  assert.equal(
    firstTenantA.headers.get("traceparent"),
    "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-2222222222222222-01",
  );
  assert.equal(firstTenantA.headers.get("ratelimit-limit"), "1");
  assert.equal(firstTenantA.headers.get("ratelimit-remaining"), "0");
  assert.equal(firstTenantA.headers.get("set-cookie"), null);

  assert.equal(blockedTenantA.status, 429);
  assert.equal(await errorCode(blockedTenantA), "rate_limited");
  assert.equal(blockedTenantA.headers.get("retry-after"), "60");
  assert.equal(firstTenantB.status, 201);
  assert.equal(calls.length, 2);

  const firstCall = calls[0];
  assert.equal(firstCall?.url, "https://tenant-a.internal.example/v1/cards?journal=bjd");
  const forwardedHeaders = new Headers(firstCall?.init.headers);
  assert.equal(forwardedHeaders.get("x-api-key"), null);
  assert.equal(forwardedHeaders.get("x-tenant-id"), "tenant-a");
  assert.equal(forwardedHeaders.get("x-request-id"), "client-request");
  assert.equal(forwardedHeaders.get("x-gateway-version"), "test");
  assert.equal(
    forwardedHeaders.get("traceparent"),
    "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-2222222222222222-01",
  );
});

test("rejects oversized bodies before forwarding", async () => {
  let fetchCalls = 0;
  const gateway = createTenantGateway(baseOptions({
    maxBodyBytes: 4,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    },
  }));

  const response = await gateway(new Request("https://gateway.example/evidence", {
    method: "POST",
    headers: { "x-api-key": "key-a" },
    body: "12345",
  }));

  assert.equal(response.status, 413);
  assert.equal(await errorCode(response), "payload_too_large");
  assert.equal(fetchCalls, 0);
});

test("fails closed when tenant resolution or rate limiting is unavailable", async () => {
  const resolverFailure = createTenantGateway(baseOptions({
    resolveTenant: async () => {
      throw new Error("directory unavailable");
    },
  }));
  const failingStore: RateLimitStore = {
    async consume() {
      throw new Error("redis unavailable");
    },
  };
  const limiterFailure = createTenantGateway(baseOptions({
    rateLimitStore: failingStore,
  }));

  const resolverResponse = await resolverFailure(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));
  const limiterResponse = await limiterFailure(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));

  assert.equal(resolverResponse.status, 503);
  assert.equal(await errorCode(resolverResponse), "tenant_resolver_unavailable");
  assert.equal(limiterResponse.status, 503);
  assert.equal(await errorCode(limiterResponse), "rate_limit_unavailable");
});

test("returns deterministic timeout and upstream failure responses", async () => {
  const timeoutGateway = createTenantGateway(baseOptions({
    timeoutMs: 5,
    fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  }));
  const failureGateway = createTenantGateway(baseOptions({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  }));

  const timedOut = await timeoutGateway(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));
  const failed = await failureGateway(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));

  assert.equal(timedOut.status, 504);
  assert.equal(await errorCode(timedOut), "upstream_timeout");
  assert.equal(failed.status, 502);
  assert.equal(await errorCode(failed), "upstream_unavailable");
});

test("emits one telemetry outcome per request", async () => {
  const outcomes: GatewayOutcome[] = [];
  const tenants: string[] = [];
  const telemetry: GatewayTelemetry = {
    start() {
      return {
        setTenant(tenantId) {
          tenants.push(tenantId);
        },
        end(result) {
          outcomes.push(result.outcome);
        },
      };
    },
  };
  const gateway = createTenantGateway(baseOptions({ telemetry }));

  await gateway(new Request("https://gateway.example/cards"));
  await gateway(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));
  await gateway(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));

  assert.deepEqual(outcomes, ["unauthorized", "forwarded", "rate-limited"]);
  assert.deepEqual(tenants, ["tenant-a", "tenant-a"]);
});

test("rejects reserved tenant headers and unsafe gateway configuration", async () => {
  assert.throws(
    () => createTenantGateway(baseOptions({ timeoutMs: 0 })),
    /timeoutMs/i,
  );
  assert.throws(
    () => createTenantGateway(baseOptions({ maxBodyBytes: -1 })),
    /maxBodyBytes/i,
  );

  const gateway = createTenantGateway(baseOptions({
    resolveTenant: () => ({
      ...tenant("tenant-a"),
      upstreamHeaders: { "x-tenant-id": "spoof" },
    }),
  }));
  const response = await gateway(new Request("https://gateway.example/cards", {
    headers: { "x-api-key": "key-a" },
  }));

  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "tenant_resolver_unavailable");
});
