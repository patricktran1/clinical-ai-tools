import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenTelemetryGatewayTelemetry,
  type OpenTelemetryAttributes,
  type OpenTelemetrySpanLike,
} from "../dist/index.js";

test("records gateway spans, metrics, tenant attributes, and failures once", () => {
  const attributes: Record<string, string | number | boolean> = {};
  const statuses: Array<{ readonly code: number; readonly message?: string }> = [];
  const exceptions: unknown[] = [];
  let ended = 0;
  let spanName = "";
  let startAttributes: OpenTelemetryAttributes = {};
  const counterCalls: Array<{ value: number; attributes: OpenTelemetryAttributes }> = [];
  const histogramCalls: Array<{ value: number; attributes: OpenTelemetryAttributes }> = [];

  const span: OpenTelemetrySpanLike = {
    setAttribute(name, value) {
      attributes[name] = value;
    },
    setStatus(status) {
      statuses.push(status);
    },
    recordException(error) {
      exceptions.push(error);
    },
    end() {
      ended += 1;
    },
  };

  const telemetry = createOpenTelemetryGatewayTelemetry({
    tracer: {
      startSpan(name, options) {
        spanName = name;
        startAttributes = options.attributes;
        return span;
      },
    },
    requestCounter: {
      add(value, metricAttributes) {
        counterCalls.push({ value, attributes: metricAttributes });
      },
    },
    durationHistogram: {
      record(value, metricAttributes) {
        histogramCalls.push({ value, attributes: metricAttributes });
      },
    },
  });

  const observation = telemetry.start({
    requestId: "request-1",
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    method: "POST",
    route: "POST /evidence",
  });
  observation.setTenant("tenant-a");
  const error = new Error("upstream unavailable");
  observation.end({
    statusCode: 502,
    outcome: "upstream-error",
    durationMs: 37,
    tenantId: "tenant-a",
    error,
  });
  observation.end({
    statusCode: 200,
    outcome: "forwarded",
    durationMs: 1,
  });

  assert.equal(spanName, "clinical_evidence.gateway.request");
  assert.equal(startAttributes["server.request.id"], "request-1");
  assert.equal(attributes["tenant.id"], "tenant-a");
  assert.equal(attributes["http.response.status_code"], 502);
  assert.equal(attributes["gateway.outcome"], "upstream-error");
  assert.deepEqual(statuses, [{ code: 2, message: "upstream-error" }]);
  assert.deepEqual(exceptions, [error]);
  assert.equal(ended, 1);
  assert.equal(counterCalls.length, 1);
  assert.equal(counterCalls[0]?.attributes["tenant.id"], "tenant-a");
  assert.deepEqual(histogramCalls.map((call) => call.value), [37]);
});

test("marks successful forwarded requests as healthy", () => {
  const statuses: Array<{ readonly code: number; readonly message?: string }> = [];
  const telemetry = createOpenTelemetryGatewayTelemetry({
    tracer: {
      startSpan() {
        return {
          setAttribute() {},
          setStatus(status) {
            statuses.push(status);
          },
          recordException() {},
          end() {},
        };
      },
    },
  });

  telemetry.start({
    requestId: "request-2",
    traceId: "3".repeat(32),
    spanId: "4".repeat(16),
    method: "GET",
    route: "GET /health",
  }).end({
    statusCode: 200,
    outcome: "forwarded",
    durationMs: 4,
  });

  assert.deepEqual(statuses, [{ code: 1 }]);
});
