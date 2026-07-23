import {
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimitStore,
  validateRateLimitPolicy,
} from "./rate-limit.js";
import {
  createGatewayTraceContext,
  type TraceIdGenerator,
} from "./trace.js";
import {
  NOOP_GATEWAY_TELEMETRY,
  type GatewayOutcome,
  type GatewayTelemetry,
} from "./telemetry.js";

export interface GatewayTenant {
  readonly id: string;
  readonly upstreamBaseUrl: string;
  readonly rateLimit: RateLimitPolicy;
  readonly upstreamHeaders?: Readonly<Record<string, string>>;
}

export type TenantResolver = (
  apiKey: string,
  request: Request,
) => GatewayTenant | null | Promise<GatewayTenant | null>;

export interface CreateTenantGatewayOptions {
  readonly resolveTenant: TenantResolver;
  readonly rateLimitStore: RateLimitStore;
  readonly fetchImpl?: typeof fetch;
  readonly telemetry?: GatewayTelemetry;
  readonly apiKeyHeader?: string;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
  readonly requestIdFactory?: () => string;
  readonly traceIdGenerator?: TraceIdGenerator;
  readonly routeKey?: (request: Request) => string;
}

export type TenantGateway = (request: Request) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const SAFE_IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const SPOOFABLE_FORWARDING_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-request-id",
  "x-tenant-id",
  "traceparent",
]);

function validatePositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}

function normalizeHeaderName(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /[^!#$%&'*+.^_`|~0-9a-z-]/.test(normalized)) {
    throw new Error(`${label} is not a valid HTTP header name.`);
  }
  return normalized;
}

function safeIdentifier(value: string | null, fallback: () => string): string {
  const candidate = value?.trim();
  if (candidate && SAFE_IDENTIFIER.test(candidate)) return candidate;
  const generated = fallback().trim();
  if (!SAFE_IDENTIFIER.test(generated)) {
    throw new Error("Generated request ID is not a safe identifier.");
  }
  return generated;
}

function validateTenant(tenant: GatewayTenant, apiKeyHeader: string): void {
  if (!SAFE_IDENTIFIER.test(tenant.id)) {
    throw new Error("Tenant ID must be a safe identifier between 1 and 128 characters.");
  }
  const upstream = new URL(tenant.upstreamBaseUrl);
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("Tenant upstream must use HTTP or HTTPS.");
  }
  validateRateLimitPolicy(tenant.rateLimit);

  for (const name of Object.keys(tenant.upstreamHeaders ?? {})) {
    const normalized = normalizeHeaderName(name, "Tenant upstream header");
    if (
      normalized === apiKeyHeader ||
      normalized === "host" ||
      normalized === "content-length" ||
      HOP_BY_HOP_HEADERS.has(normalized) ||
      SPOOFABLE_FORWARDING_HEADERS.has(normalized)
    ) {
      throw new Error(`Tenant upstream header is reserved: ${normalized}`);
    }
  }
}

function defaultRouteKey(request: Request): string {
  const url = new URL(request.url);
  return `${request.method.toUpperCase()} ${url.pathname}`;
}

function upstreamUrl(baseUrl: string, requestUrl: string): URL {
  const base = new URL(baseUrl);
  const source = new URL(requestUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const sourcePath = source.pathname.replace(/^\/+/, "");
  base.pathname = `${basePath}/${sourcePath}` || "/";
  base.search = source.search;
  base.hash = "";
  return base;
}

function copyUpstreamHeaders(
  request: Request,
  tenant: GatewayTenant,
  apiKeyHeader: string,
  requestId: string,
  traceparent: string,
): Headers {
  const headers = new Headers();

  request.headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (
      normalized === apiKeyHeader ||
      normalized === "host" ||
      normalized === "content-length" ||
      HOP_BY_HOP_HEADERS.has(normalized) ||
      SPOOFABLE_FORWARDING_HEADERS.has(normalized)
    ) {
      return;
    }
    headers.set(name, value);
  });

  for (const [name, value] of Object.entries(tenant.upstreamHeaders ?? {})) {
    headers.set(name, value);
  }

  const source = new URL(request.url);
  headers.set("x-tenant-id", tenant.id);
  headers.set("x-request-id", requestId);
  headers.set("traceparent", traceparent);
  headers.set("x-forwarded-host", source.host);
  headers.set("x-forwarded-proto", source.protocol.replace(":", ""));
  return headers;
}

function responseHeaders(
  requestId: string,
  traceparent: string,
  decision?: RateLimitDecision,
  nowMs?: number,
): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    traceparent,
  });

  if (decision && nowMs !== undefined) {
    headers.set("ratelimit-limit", String(decision.limit));
    headers.set("ratelimit-remaining", String(decision.remaining));
    headers.set(
      "ratelimit-reset",
      String(Math.max(0, Math.ceil((decision.resetAtMs - nowMs) / 1000))),
    );
  }

  return headers;
}

function copyDownstreamHeaders(
  upstream: Response,
  requestId: string,
  traceparent: string,
  decision: RateLimitDecision,
  nowMs: number,
): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(normalized) ||
      normalized === "set-cookie" ||
      normalized === "x-request-id" ||
      normalized === "traceparent" ||
      normalized.startsWith("ratelimit-")
    ) {
      return;
    }
    headers.set(name, value);
  });

  headers.set("x-request-id", requestId);
  headers.set("traceparent", traceparent);
  headers.set("ratelimit-limit", String(decision.limit));
  headers.set("ratelimit-remaining", String(decision.remaining));
  headers.set(
    "ratelimit-reset",
    String(Math.max(0, Math.ceil((decision.resetAtMs - nowMs) / 1000))),
  );
  return headers;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Headers,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers,
  });
}

async function boundedBody(
  request: Request,
  maxBodyBytes: number,
): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBodyBytes) {
      throw new RangeError("Request body exceeds the configured limit.");
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > maxBodyBytes) {
    throw new RangeError("Request body exceeds the configured limit.");
  }
  return body;
}

/**
 * Build a Fetch API compatible multi-tenant gateway for bounded clinical
 * evidence services. Authentication, rate limiting, trace propagation, and
 * error behavior remain deterministic; the gateway does not make clinical
 * decisions or authorize publication.
 */
export function createTenantGateway(
  options: CreateTenantGatewayOptions,
): TenantGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const telemetry = options.telemetry ?? NOOP_GATEWAY_TELEMETRY;
  const apiKeyHeader = normalizeHeaderName(
    options.apiKeyHeader ?? "x-api-key",
    "API key header",
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = options.now ?? Date.now;
  const requestIdFactory = options.requestIdFactory ?? (() => crypto.randomUUID());
  const routeKey = options.routeKey ?? defaultRouteKey;

  validatePositiveNumber(timeoutMs, "Gateway timeoutMs");
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new Error("Gateway maxBodyBytes must be a non-negative integer.");
  }

  return async (request) => {
    const startedAtMs = now();
    if (!Number.isFinite(startedAtMs)) throw new Error("Gateway clock returned a non-finite value.");

    const requestId = safeIdentifier(
      request.headers.get("x-request-id"),
      requestIdFactory,
    );
    const trace = createGatewayTraceContext(
      request.headers.get("traceparent"),
      options.traceIdGenerator,
    );
    const route = routeKey(request).trim() || defaultRouteKey(request);
    const observation = telemetry.start({
      requestId,
      traceId: trace.traceId,
      spanId: trace.spanId,
      method: request.method.toUpperCase(),
      route,
    });
    let tenantId: string | undefined;
    let observationEnded = false;

    const finish = (
      statusCode: number,
      outcome: GatewayOutcome,
      error?: unknown,
    ): void => {
      if (observationEnded) return;
      observationEnded = true;
      const completedAtMs = now();
      const result = {
        statusCode,
        outcome,
        durationMs: Math.max(0, completedAtMs - startedAtMs),
        ...(tenantId ? { tenantId } : {}),
        ...(error !== undefined ? { error } : {}),
      };
      observation.end(result);
    };

    const baseHeaders = () => responseHeaders(requestId, trace.traceparent);
    const apiKey = request.headers.get(apiKeyHeader)?.trim();
    if (!apiKey) {
      finish(401, "unauthorized");
      return errorResponse(
        401,
        "unauthorized",
        "A valid API key is required.",
        baseHeaders(),
      );
    }

    let tenant: GatewayTenant | null;
    try {
      tenant = await options.resolveTenant(apiKey, request);
      if (tenant) validateTenant(tenant, apiKeyHeader);
    } catch (error) {
      finish(503, "dependency-unavailable", error);
      return errorResponse(
        503,
        "tenant_resolver_unavailable",
        "Tenant resolution is temporarily unavailable.",
        baseHeaders(),
      );
    }

    if (!tenant) {
      finish(401, "unauthorized");
      return errorResponse(
        401,
        "unauthorized",
        "A valid API key is required.",
        baseHeaders(),
      );
    }

    tenantId = tenant.id;
    observation.setTenant(tenant.id);
    const rateLimitNowMs = now();
    let decision: RateLimitDecision;
    try {
      decision = await options.rateLimitStore.consume(
        `${tenant.id}:${route}`,
        tenant.rateLimit,
        rateLimitNowMs,
      );
    } catch (error) {
      finish(503, "dependency-unavailable", error);
      return errorResponse(
        503,
        "rate_limit_unavailable",
        "Rate limiting is temporarily unavailable.",
        baseHeaders(),
      );
    }

    const limitedHeaders = responseHeaders(
      requestId,
      trace.traceparent,
      decision,
      rateLimitNowMs,
    );
    if (!decision.allowed) {
      limitedHeaders.set(
        "retry-after",
        String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
      );
      finish(429, "rate-limited");
      return errorResponse(
        429,
        "rate_limited",
        "The tenant rate limit has been exceeded.",
        limitedHeaders,
      );
    }

    let body: ArrayBuffer | undefined;
    try {
      body = await boundedBody(request, maxBodyBytes);
    } catch (error) {
      if (error instanceof RangeError) {
        finish(413, "payload-too-large");
        return errorResponse(
          413,
          "payload_too_large",
          "The request body exceeds the configured limit.",
          limitedHeaders,
        );
      }
      finish(502, "upstream-error", error);
      return errorResponse(
        502,
        "request_read_failed",
        "The request body could not be read.",
        limitedHeaders,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortFromCaller = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const init: RequestInit = {
        method: request.method,
        headers: copyUpstreamHeaders(
          request,
          tenant,
          apiKeyHeader,
          requestId,
          trace.traceparent,
        ),
        redirect: "manual",
        signal: controller.signal,
      };
      if (body !== undefined) init.body = body;

      const upstream = await fetchImpl(upstreamUrl(tenant.upstreamBaseUrl, request.url), init);
      finish(upstream.status, "forwarded");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: copyDownstreamHeaders(
          upstream,
          requestId,
          trace.traceparent,
          decision,
          rateLimitNowMs,
        ),
      });
    } catch (error) {
      if (timedOut) {
        finish(504, "timeout", error);
        return errorResponse(
          504,
          "upstream_timeout",
          "The upstream evidence service timed out.",
          limitedHeaders,
        );
      }
      finish(502, "upstream-error", error);
      return errorResponse(
        502,
        "upstream_unavailable",
        "The upstream evidence service is unavailable.",
        limitedHeaders,
      );
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromCaller);
    }
  };
}
