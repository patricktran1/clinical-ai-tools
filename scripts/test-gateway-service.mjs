import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createGatewayService,
  loadServiceConfig,
} from "../service/gateway-service.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test upstream did not expose a TCP address."));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const upstream = createServer((request, response) => {
  const payload = JSON.stringify({
    tenantId: request.headers["x-tenant-id"] ?? null,
    requestId: request.headers["x-request-id"] ?? null,
    path: request.url,
  });
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
});
const upstreamPort = await listen(upstream);

const config = loadServiceConfig({
  HOST: "127.0.0.1",
  PORT: "0",
  ALLOW_HTTP_UPSTREAMS: "1",
  UPSTREAM_TIMEOUT_MS: "1000",
  MAX_BODY_BYTES: "1000",
  SHUTDOWN_GRACE_MS: "1000",
  TENANT_DIRECTORY_JSON: JSON.stringify({
    "key-a": {
      id: "tenant-a",
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      rateLimit: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 },
    },
    "key-b": {
      id: "tenant-b",
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      rateLimit: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 },
    },
  }),
});

const service = createGatewayService(config);
const url = await service.start();

try {
  const health = await fetch(`${url}/healthz`);
  const ready = await fetch(`${url}/readyz`);
  const a1 = await fetch(`${url}/cards`, { headers: { "x-api-key": "key-a" } });
  const a2 = await fetch(`${url}/cards`, { headers: { "x-api-key": "key-a" } });
  const b1 = await fetch(`${url}/cards`, { headers: { "x-api-key": "key-b" } });
  const unknown = await fetch(`${url}/cards`, { headers: { "x-api-key": "unknown" } });

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready" });
  assert.equal(a1.status, 200);
  assert.equal(a2.status, 429);
  assert.equal(b1.status, 200);
  assert.equal(unknown.status, 401);
  assert.equal((await a1.json()).tenantId, "tenant-a");
  assert.equal((await b1.json()).tenantId, "tenant-b");

  service.beginDrain();
  const draining = await fetch(`${url}/readyz`);
  const blockedDuringDrain = await fetch(`${url}/cards`, { headers: { "x-api-key": "key-b" } });
  assert.equal(draining.status, 503);
  assert.deepEqual(await draining.json(), { status: "draining" });
  assert.equal(blockedDuringDrain.status, 503);
  assert.equal((await blockedDuringDrain.json()).error.code, "service_draining");

  assert.throws(
    () => loadServiceConfig({ TENANT_DIRECTORY_JSON: "not-json" }),
    /valid JSON/i,
  );
  assert.throws(
    () => loadServiceConfig({
      TENANT_DIRECTORY_JSON: JSON.stringify({
        key: { id: "tenant", upstreamBaseUrl: "http://insecure.example" },
      }),
    }),
    /HTTPS/i,
  );
  assert.throws(
    () => loadServiceConfig({ TENANT_DIRECTORY_JSON: "{}" }),
    /At least one tenant/i,
  );

  console.log(JSON.stringify({
    scenario: "production-shaped-gateway-service",
    health: 200,
    ready: 200,
    tenantA: [200, 429],
    tenantB: [200],
    unknownTenant: 401,
    drainingReadiness: 503,
    drainingTraffic: 503,
    configFailsClosed: true,
    gracefulDrain: true,
  }, null, 2));
} finally {
  await service.close();
  await close(upstream);
}
