import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "../dist/index.js";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP address."));
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

function incomingRequest(request, port) {
  const method = request.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  return new Request(
    `http://127.0.0.1:${port}${request.url ?? "/"}`,
    init,
  );
}

async function sendResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  nodeResponse.statusMessage = response.statusText;
  response.headers.forEach((value, name) => nodeResponse.setHeader(name, value));

  if (!response.body) {
    nodeResponse.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(nodeResponse);
}

async function startServices({ gatewayPort = 0, upstreamPort = 0 } = {}) {
  const upstream = createServer((request, response) => {
    const payload = JSON.stringify({
      ok: true,
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
  const resolvedUpstreamPort = await listen(upstream, upstreamPort);

  const tenants = new Map([
    ["demo-key-a", {
      id: "tenant-a",
      upstreamBaseUrl: `http://127.0.0.1:${resolvedUpstreamPort}/v1`,
      rateLimit: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 },
    }],
    ["demo-key-b", {
      id: "tenant-b",
      upstreamBaseUrl: `http://127.0.0.1:${resolvedUpstreamPort}/v1`,
      rateLimit: { capacity: 1, refillTokens: 1, refillIntervalMs: 60_000 },
    }],
  ]);

  const gateway = createTenantGateway({
    resolveTenant: (apiKey) => tenants.get(apiKey) ?? null,
    rateLimitStore: new InMemoryTokenBucketStore(),
    timeoutMs: 2_000,
    maxBodyBytes: 64_000,
  });

  let resolvedGatewayPort;
  const gatewayServer = createServer(async (request, response) => {
    try {
      const gatewayResponse = await gateway(incomingRequest(request, resolvedGatewayPort));
      await sendResponse(response, gatewayResponse);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "gateway_bridge_failure" }));
      console.error(error);
    }
  });
  resolvedGatewayPort = await listen(gatewayServer, gatewayPort);

  return {
    gatewayServer,
    upstream,
    gatewayUrl: `http://127.0.0.1:${resolvedGatewayPort}`,
    upstreamUrl: `http://127.0.0.1:${resolvedUpstreamPort}`,
  };
}

async function selfTest() {
  const services = await startServices();
  try {
    const tenantAFirst = await fetch(`${services.gatewayUrl}/evidence`, {
      headers: { "x-api-key": "demo-key-a" },
    });
    const tenantASecond = await fetch(`${services.gatewayUrl}/evidence`, {
      headers: { "x-api-key": "demo-key-a" },
    });
    const tenantBFirst = await fetch(`${services.gatewayUrl}/evidence`, {
      headers: { "x-api-key": "demo-key-b" },
    });

    assert.equal(tenantAFirst.status, 200);
    assert.equal(tenantASecond.status, 429);
    assert.equal(tenantBFirst.status, 200);
    assert.equal((await tenantAFirst.json()).tenantId, "tenant-a");
    assert.equal((await tenantBFirst.json()).tenantId, "tenant-b");
    assert.equal(tenantASecond.headers.get("ratelimit-remaining"), "0");

    console.log(JSON.stringify({
      scenario: "node-gateway-reference-service",
      gatewayUrl: services.gatewayUrl,
      tenantA: [200, 429],
      tenantB: [200],
      crossTenantIsolation: true,
      httpFetchBridge: true,
    }, null, 2));
  } finally {
    await Promise.all([
      close(services.gatewayServer),
      close(services.upstream),
    ]);
  }
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const services = await startServices({
    gatewayPort: Number(process.env.PORT ?? 4000),
    upstreamPort: Number(process.env.UPSTREAM_PORT ?? 4010),
  });
  console.log(`Gateway listening at ${services.gatewayUrl}`);
  console.log(`Mock upstream listening at ${services.upstreamUrl}`);
  console.log("Use x-api-key: demo-key-a or demo-key-b");

  const shutdown = async () => {
    await Promise.all([
      close(services.gatewayServer),
      close(services.upstream),
    ]);
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
