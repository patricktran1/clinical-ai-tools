export type GatewayOutcome =
  | "forwarded"
  | "unauthorized"
  | "payload-too-large"
  | "rate-limited"
  | "dependency-unavailable"
  | "timeout"
  | "upstream-error";

export interface GatewayTelemetryContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly method: string;
  readonly route: string;
}

export interface GatewayTelemetryResult {
  readonly statusCode: number;
  readonly outcome: GatewayOutcome;
  readonly durationMs: number;
  readonly tenantId?: string;
  readonly error?: unknown;
}

export interface GatewayRequestObservation {
  setTenant(tenantId: string): void;
  end(result: GatewayTelemetryResult): void;
}

export interface GatewayTelemetry {
  start(context: GatewayTelemetryContext): GatewayRequestObservation;
}

const NOOP_OBSERVATION: GatewayRequestObservation = {
  setTenant: () => undefined,
  end: () => undefined,
};

export const NOOP_GATEWAY_TELEMETRY: GatewayTelemetry = {
  start: () => NOOP_OBSERVATION,
};

export type OpenTelemetryAttributeValue = string | number | boolean;
export type OpenTelemetryAttributes = Readonly<Record<string, OpenTelemetryAttributeValue>>;

export interface OpenTelemetrySpanLike {
  setAttribute(name: string, value: OpenTelemetryAttributeValue): void;
  setStatus(status: { readonly code: number; readonly message?: string }): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface OpenTelemetryTracerLike {
  startSpan(
    name: string,
    options: { readonly attributes: OpenTelemetryAttributes },
  ): OpenTelemetrySpanLike;
}

export interface OpenTelemetryCounterLike {
  add(value: number, attributes: OpenTelemetryAttributes): void;
}

export interface OpenTelemetryHistogramLike {
  record(value: number, attributes: OpenTelemetryAttributes): void;
}

export interface OpenTelemetryGatewayOptions {
  readonly tracer: OpenTelemetryTracerLike;
  readonly requestCounter?: OpenTelemetryCounterLike;
  readonly durationHistogram?: OpenTelemetryHistogramLike;
}

/**
 * Adapter for OpenTelemetry SDK tracers and metrics instruments. The package
 * remains dependency-free; callers supply their configured SDK objects.
 */
export function createOpenTelemetryGatewayTelemetry(
  options: OpenTelemetryGatewayOptions,
): GatewayTelemetry {
  return {
    start(context) {
      const span = options.tracer.startSpan(
        "clinical_evidence.gateway.request",
        {
          attributes: {
            "http.request.method": context.method,
            "http.route": context.route,
            "server.request.id": context.requestId,
            "trace.id": context.traceId,
            "span.id": context.spanId,
          },
        },
      );
      let tenantId: string | undefined;
      let ended = false;

      return {
        setTenant(value) {
          tenantId = value;
          span.setAttribute("tenant.id", value);
        },
        end(result) {
          if (ended) return;
          ended = true;

          span.setAttribute("http.response.status_code", result.statusCode);
          span.setAttribute("gateway.outcome", result.outcome);
          span.setAttribute("gateway.duration_ms", result.durationMs);
          if (result.tenantId && result.tenantId !== tenantId) {
            tenantId = result.tenantId;
            span.setAttribute("tenant.id", result.tenantId);
          }
          if (result.error !== undefined) span.recordException(result.error);

          const failed = result.statusCode >= 500 || result.error !== undefined;
          span.setStatus(
            failed
              ? { code: 2, message: result.outcome }
              : { code: 1 },
          );

          const metricAttributes: Record<string, OpenTelemetryAttributeValue> = {
            "http.request.method": context.method,
            "http.route": context.route,
            "http.response.status_code": result.statusCode,
            "gateway.outcome": result.outcome,
          };
          if (tenantId) metricAttributes["tenant.id"] = tenantId;

          options.requestCounter?.add(1, metricAttributes);
          options.durationHistogram?.record(result.durationMs, metricAttributes);
          span.end();
        },
      };
    },
  };
}
