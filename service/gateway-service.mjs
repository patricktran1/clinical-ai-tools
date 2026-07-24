import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "../dist/index.js";

const DEFAULT_PORT = 4000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 256_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;

function positiveInteger(value, label, fallback) {
  const candidate = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return candidate;
}

function nonNegativeInteger(value, label, fallback) {
  const candidate = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return candidate;
}

function parseBoolean(value) {
  return value === "1" || value === "true";
}

function parseTenantDirectory(raw, allowHttpUpstreams) {
  if (!raw?.trim()) {
    throw new Error("TENANT_DIRECTORY_JSON is required.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TENANT_DIRECTORY_JSON must contain valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TENANT_DIRECTORY_JSON must be an object keyed by API key.");
  }

  const tenants = new Map();
  for (const [apiKey, value] of Object.entries(parsed)) {
    if (!apiKey.trim()) throw new Error("Tenant API keys must not be empty.");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Tenant configuration for ${apiKey} must be an object.`);
    }

    const id = typeof value.id === "string" ? value.id.trim() : "";
    const upstreamBaseUrl = typeof value.upstreamBaseUrl === "string"
      ? value.upstreamBaseUrl.trim()
      : "";
    if (!id) throw new Error(`Tenant ${apiKey} requires an id.`);
    if (!upstreamBaseUrl) {
      throw new Error(`Tenant ${apiKey} requires an upstreamBaseUrl.`);
    }

    const upstream = new URL(upstreamBaseUrl);
    if (upstream.protocol !== "https:" && !(allowHttpUpstreams && upstream.protocol === "http:")) {
      throw new Error(`Tenant ${id} upstream must use HTTPS.`);
    }

    const rateLimit = value.rateLimit ?? {};
    tenants.set(apiKey, {
      id,
      upstreamBaseUrl: upstream.toString(),
      rateLimit: {
        capacity: positiveInteger(rateLimit.capacity, `${id} rateLimit.capacity`, 60),
        refillTokens: positiveInteger(rateLimit.refillTokens, `${id} rateLimit.refillTokens`, 60),
        refillIntervalMs: positiveInteger(
          rateLimit.refillIntervalMs,
          `${id} rateLimit.refillIntervalMs`,
          60_000,
        ),
      },
      ...(value.upstreamHeaders && typeof value.upstreamHeaders === "object"
        ? { upstreamHeaders: value.upstreamHeaders }
        : {}),
    });
  }

  if (tenants.size === 0) throw new Error("At least one tenant must be configured.");
  return tenants;
}

export function loadServiceConfig(env = process.env) {
  const allowHttpUpstreams = parseBoolean(env.ALLOW_HTTP_UPSTREAMS);
  return Object.freeze({
    host: env.HOST?.trim() || DEFAULT_HOST,
    port: nonNegativeInteger(env.PORT, "PORT", DEFAULT_PORT),
    timeoutMs: positiveInteger(env.UPSTREAM_TIMEOUT_MS, "UPSTREAM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxBodyBytes: nonNegativeInteger(env.MAX_BODY_BYTES, "MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES),
    shutdownGraceMs: positiveInteger(
      env.SHUTDOWN_GRACE_MS,
      "SHUTDOWN_GRACE_MS",
      DEFAULT_SHUTDOWN_GRACE_MS,
    ),
    tenants: parseTenantDirectory(env.TENANT_DIRECTORY_JSON, allowHttpUpstreams),
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

  const controller = new AbortController();
  request.once("aborted", () => controller.abort(new Error("Client aborted request.")));
  const init = { method, headers, signal: controller.signal };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(`http://127.0.0.1:${port}${request.url ?? "/"}`, init);
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

function json(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Gateway service did not expose a TCP address."));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server, graceMs) {
  return new Promise((resolve, reject) => {
    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
    }, graceMs);
    forceTimer.unref?.();
    server.close((error) => {
      clearTimeout(forceTimer);
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createGatewayService(config, options = {}) {
  const rateLimitStore = options.rateLimitStore ?? new InMemoryTokenBucketStore();
  const gateway = createTenantGateway({
    resolveTenant: (apiKey) => config.tenants.get(apiKey) ?? null,
    rateLimitStore,
    timeoutMs: config.timeoutMs,
    maxBodyBytes: config.maxBodyBytes,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
  });

  let ready = false;
  let port = config.port;
  let closing;

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && pathname === "/readyz") {
      json(response, ready ? 200 : 503, { status: ready ? "ready" : "draining" });
      return;
    }
    if (!ready) {
      json(response, 503, { error: { code: "service_draining", message: "Gateway is not accepting traffic." } });
      return;
    }

    try {
      const gatewayResponse = await gateway(incomingRequest(request, port));
      await sendResponse(response, gatewayResponse);
    } catch (error) {
      json(response, 500, {
        error: { code: "gateway_bridge_failure", message: "The HTTP bridge failed." },
      });
      options.logger?.error?.({ event: "gateway_bridge_failure", error });
    }
  });

  return {
    server,
    get ready() {
      return ready;
    },
    get url() {
      return `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${port}`;
    },
    async start() {
      port = await listen(server, config.port, config.host);
      ready = true;
      return this.url;
    },
    beginDrain() {
      ready = false;
    },
    async close() {
      if (closing) return closing;
      ready = false;
      closing = closeServer(server, config.shutdownGraceMs);
      return closing;
    },
  };
}

async function main() {
  const config = loadServiceConfig();
  const service = createGatewayService(config, { logger: console });
  const url = await service.start();
  console.log(JSON.stringify({ event: "gateway_started", url, tenants: config.tenants.size }));

  const shutdown = async (signal) => {
    console.log(JSON.stringify({ event: "gateway_draining", signal }));
    service.beginDrain();
    await service.close();
    console.log(JSON.stringify({ event: "gateway_stopped", signal }));
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
