import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "../dist/index.js";

const tenantCount = 12;
const requestsPerTenant = 40;
const capacityPerTenant = 25;
const upstreamCallsByTenant = new Map();
const latenciesMs = [];

const gateway = createTenantGateway({
  resolveTenant(apiKey) {
    const match = /^tenant-key-(\d+)$/.exec(apiKey);
    if (!match) return null;
    const tenantNumber = Number(match[1]);
    if (!Number.isInteger(tenantNumber) || tenantNumber < 1 || tenantNumber > tenantCount) {
      return null;
    }
    return {
      id: `tenant-${tenantNumber}`,
      upstreamBaseUrl: `https://tenant-${tenantNumber}.internal.example/v1`,
      rateLimit: {
        capacity: capacityPerTenant,
        refillTokens: capacityPerTenant,
        refillIntervalMs: 60_000,
      },
    };
  },
  rateLimitStore: new InMemoryTokenBucketStore(),
  timeoutMs: 1_000,
  fetchImpl: async (_input, init) => {
    const tenantId = new Headers(init?.headers).get("x-tenant-id");
    assert.ok(tenantId, "forwarded requests must carry a resolved tenant ID");
    upstreamCallsByTenant.set(
      tenantId,
      (upstreamCallsByTenant.get(tenantId) ?? 0) + 1,
    );
    return new Response(JSON.stringify({ tenantId, grounded: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});

const startedAt = performance.now();
const responses = await Promise.all(
  Array.from({ length: tenantCount }, (_, tenantIndex) =>
    Array.from({ length: requestsPerTenant }, async (_, requestIndex) => {
      const requestStartedAt = performance.now();
      const response = await gateway(
        new Request(
          `https://gateway.example/evidence?tenant=${tenantIndex + 1}&request=${requestIndex + 1}`,
          {
            headers: { "x-api-key": `tenant-key-${tenantIndex + 1}` },
          },
        ),
      );
      latenciesMs.push(performance.now() - requestStartedAt);
      return response;
    }),
  ).flat(),
);
const elapsedMs = performance.now() - startedAt;

const statusCounts = responses.reduce((counts, response) => {
  counts[response.status] = (counts[response.status] ?? 0) + 1;
  return counts;
}, {});
const expectedForwarded = tenantCount * capacityPerTenant;
const expectedRateLimited = tenantCount * (requestsPerTenant - capacityPerTenant);

assert.equal(statusCounts[200], expectedForwarded);
assert.equal(statusCounts[429], expectedRateLimited);
assert.equal(
  [...upstreamCallsByTenant.values()].reduce((sum, count) => sum + count, 0),
  expectedForwarded,
);
for (let tenantNumber = 1; tenantNumber <= tenantCount; tenantNumber += 1) {
  assert.equal(
    upstreamCallsByTenant.get(`tenant-${tenantNumber}`),
    capacityPerTenant,
    `tenant-${tenantNumber} must receive an isolated token bucket`,
  );
}

const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
const percentile = (value) => {
  const index = Math.min(
    sortedLatencies.length - 1,
    Math.max(0, Math.ceil((value / 100) * sortedLatencies.length) - 1),
  );
  return Number(sortedLatencies[index].toFixed(3));
};

const report = {
  scenario: "multi-tenant-token-bucket-isolation",
  tenantCount,
  requestsPerTenant,
  totalRequests: responses.length,
  capacityPerTenant,
  expectedForwarded,
  expectedRateLimited,
  statusCounts,
  upstreamCallsByTenant: Object.fromEntries(
    [...upstreamCallsByTenant.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ),
  elapsedMs: Number(elapsedMs.toFixed(3)),
  latencyMs: {
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    max: Number(sortedLatencies.at(-1).toFixed(3)),
  },
};

console.log(JSON.stringify(report, null, 2));
