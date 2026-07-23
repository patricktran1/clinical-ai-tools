import assert from "node:assert/strict";
import test from "node:test";
import {
  createGatewayTraceContext,
  parseTraceparent,
  type TraceIdGenerator,
} from "../dist/index.js";

const incoming = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";

test("parses valid W3C traceparent values", () => {
  assert.deepEqual(parseTraceparent(incoming), {
    traceId: "0123456789abcdef0123456789abcdef",
    parentSpanId: "0123456789abcdef",
    traceFlags: "01",
  });
});

test("rejects malformed and all-zero trace identifiers", () => {
  assert.equal(parseTraceparent(null), null);
  assert.equal(parseTraceparent("garbage"), null);
  assert.equal(
    parseTraceparent("00-00000000000000000000000000000000-0123456789abcdef-01"),
    null,
  );
  assert.equal(
    parseTraceparent("00-0123456789abcdef0123456789abcdef-0000000000000000-01"),
    null,
  );
});

test("creates a child span while preserving trace ID and flags", () => {
  const generator: TraceIdGenerator = {
    nextTraceId() {
      throw new Error("A new trace ID should not be generated for a valid parent.");
    },
    nextSpanId() {
      return "fedcba9876543210";
    },
  };

  assert.deepEqual(createGatewayTraceContext(incoming, generator), {
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "fedcba9876543210",
    traceFlags: "01",
    traceparent: "00-0123456789abcdef0123456789abcdef-fedcba9876543210-01",
    parentSpanId: "0123456789abcdef",
  });
});

test("creates a new sampled trace when no valid parent exists", () => {
  const generator: TraceIdGenerator = {
    nextTraceId: () => "11111111111111111111111111111111",
    nextSpanId: () => "2222222222222222",
  };

  assert.deepEqual(createGatewayTraceContext("invalid", generator), {
    traceId: "11111111111111111111111111111111",
    spanId: "2222222222222222",
    traceFlags: "01",
    traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
  });
});

test("rejects invalid generated identifiers", () => {
  assert.throws(
    () => createGatewayTraceContext(null, {
      nextTraceId: () => "0".repeat(32),
      nextSpanId: () => "2".repeat(16),
    }),
    /Trace ID/i,
  );
  assert.throws(
    () => createGatewayTraceContext(null, {
      nextTraceId: () => "1".repeat(32),
      nextSpanId: () => "not-a-span-id",
    }),
    /Span ID/i,
  );
});
