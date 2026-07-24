import assert from "node:assert/strict";
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "../dist/index.js";

const baseTenant = {
  id: "tenant-a",
  upstreamBaseUrl: "https://tenant-a.internal.example/v1",
  rateLimit: {
    capacity: 1,
    refillTokens: 1,
    refillIntervalMs: 60_000,
  },
};

async function responseCode(response) {
  const payload = await response.json();
  return payload.error?.code ?? null;
}

async function executeCase(name, gateway, request) {
  const response = await gateway(request);
  return {
    name,
    status: response.status,
    code: response.headers.get("content-type")?.includes("application/json")
      ? await responseCode(response)
      : null,
    requestIdPresent: Boolean(response.headers.get("x-request-id")),
    traceparentPresent: Boolean(response.headers.get("traceparent")),
  };
}

function request({ apiKey = "key-a", body, method = body === undefined ? "GET" : "POST" } = {}) {
  return new Request("https://gateway.example/evidence", {
    method,
    headers: apiKey ? { "x-api-key": apiKey } : {},
    ...(body === undefined ? {} : { body }),
  });
}

const results = [];

results.push(await executeCase(
  "missing-api-key",
  createTenantGateway({
    resolveTenant: () => baseTenant,
    rateLimitStore: new InMemoryTokenBucketStore(),
    fetchImpl: async () => new Response("unexpected"),
  }),
  request({ apiKey: "" }),
));

results.push(await executeCase(
  "tenant-directory-outage",
  createTenantGateway({
    resolveTenant: async () => {
      throw new Error("directory unavailable");
    },
    rateLimitStore: new InMemoryTokenBucketStore(),
    fetchImpl: async () => new Response("unexpected"),
  }),
  request(),
));

results.push(await executeCase(
  "rate-limit-store-outage",
  createTenantGateway({
    resolveTenant: () => baseTenant,
    rateLimitStore: {
      async consume() {
        throw new Error("redis unavailable");
      },
    },
    fetchImpl: async () => new Response("unexpected"),
  }),
  request(),
));

results.push(await executeCase(
  "payload-overflow",
  createTenantGateway({
    resolveTenant: () => baseTenant,
    rateLimitStore: new InMemoryTokenBucketStore(),
    maxBodyBytes: 4,
    fetchImpl: async () => new Response("unexpected"),
  }),
  request({ body: "12345" }),
));

results.push(await executeCase(
  "upstream-network-failure",
  createTenantGateway({
    resolveTenant: () => baseTenant,
    rateLimitStore: new InMemoryTokenBucketStore(),
    fetchImpl: async () => {
      throw new Error("network unavailable");
    },
  }),
  request(),
));

results.push(await executeCase(
  "upstream-timeout",
  createTenantGateway({
    resolveTenant: () => baseTenant,
    rateLimitStore: new InMemoryTokenBucketStore(),
    timeoutMs: 5,
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted by timeout")),
        { once: true },
      );
    }),
  }),
  request(),
));

const limiter = new InMemoryTokenBucketStore();
const limitedGateway = createTenantGateway({
  resolveTenant: () => baseTenant,
  rateLimitStore: limiter,
  fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
});
await limitedGateway(request());
results.push(await executeCase("rate-limit-exhausted", limitedGateway, request()));

const expected = {
  "missing-api-key": [401, "unauthorized"],
  "tenant-directory-outage": [503, "tenant_resolver_unavailable"],
  "rate-limit-store-outage": [503, "rate_limit_unavailable"],
  "payload-overflow": [413, "payload_too_large"],
  "upstream-network-failure": [502, "upstream_unavailable"],
  "upstream-timeout": [504, "upstream_timeout"],
  "rate-limit-exhausted": [429, "rate_limited"],
};

for (const result of results) {
  assert.deepEqual(
    [result.status, result.code],
    expected[result.name],
    `${result.name} must retain its deterministic failure contract`,
  );
  assert.equal(result.requestIdPresent, true, `${result.name} must return a request ID`);
  assert.equal(result.traceparentPresent, true, `${result.name} must return trace context`);
}

console.log(JSON.stringify({
  scenario: "gateway-fault-matrix",
  failClosed: true,
  cases: results,
}, null, 2));
