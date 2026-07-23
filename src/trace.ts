export interface ParsedTraceparent {
  readonly traceId: string;
  readonly parentSpanId: string;
  readonly traceFlags: string;
}

export interface GatewayTraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: string;
  readonly traceparent: string;
  readonly parentSpanId?: string;
}

export interface TraceIdGenerator {
  nextTraceId(): string;
  nextSpanId(): string;
}

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_TRACE_ID_GENERATOR: TraceIdGenerator = {
  nextTraceId: () => randomHex(16),
  nextSpanId: () => randomHex(8),
};

function validateGeneratedId(value: string, length: number, label: string): string {
  const normalized = value.toLowerCase();
  const zeroValue = "0".repeat(length);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(normalized) || normalized === zeroValue) {
    throw new Error(`${label} must be ${length} non-zero hexadecimal characters.`);
  }
  return normalized;
}

export function parseTraceparent(value: string | null | undefined): ParsedTraceparent | null {
  if (!value) return null;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) return null;

  const traceId = match[1]?.toLowerCase();
  const parentSpanId = match[2]?.toLowerCase();
  const traceFlags = match[3]?.toLowerCase();
  if (!traceId || !parentSpanId || !traceFlags) return null;
  if (traceId === ZERO_TRACE_ID || parentSpanId === ZERO_SPAN_ID) return null;

  return { traceId, parentSpanId, traceFlags };
}

/**
 * Create a child W3C trace context. Valid incoming trace IDs and flags are
 * preserved while every gateway request receives a fresh span ID.
 */
export function createGatewayTraceContext(
  incomingTraceparent?: string | null,
  idGenerator: TraceIdGenerator = DEFAULT_TRACE_ID_GENERATOR,
): GatewayTraceContext {
  const incoming = parseTraceparent(incomingTraceparent);
  const traceId = incoming?.traceId ?? validateGeneratedId(
    idGenerator.nextTraceId(),
    32,
    "Trace ID",
  );
  const spanId = validateGeneratedId(idGenerator.nextSpanId(), 16, "Span ID");
  const traceFlags = incoming?.traceFlags ?? "01";
  const base = {
    traceId,
    spanId,
    traceFlags,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  };

  return incoming
    ? { ...base, parentSpanId: incoming.parentSpanId }
    : base;
}
