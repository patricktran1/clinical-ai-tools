import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const document = JSON.parse(
  await readFile(new URL("../openapi/gateway.openapi.json", import.meta.url), "utf8"),
);

assert.equal(document.openapi, "3.1.0");
assert.equal(document.info.title, "Clinical Evidence Gateway");
assert.ok(document.paths["/healthz"]?.get?.responses?.["200"]);
assert.ok(document.paths["/readyz"]?.get?.responses?.["200"]);
assert.ok(document.paths["/readyz"]?.get?.responses?.["503"]);

const proxy = document.paths["/{path}"];
assert.ok(proxy?.get);
assert.ok(proxy?.post);
assert.deepEqual(proxy.get.security, [{ ApiKey: [] }]);
assert.deepEqual(proxy.post.security, [{ ApiKey: [] }]);

for (const status of ["401", "429", "502", "503", "504"]) {
  assert.ok(proxy.get.responses[status], `GET contract missing ${status}`);
  assert.ok(proxy.post.responses[status], `POST contract missing ${status}`);
}
assert.ok(proxy.post.responses["413"], "POST contract missing 413");

const rateLimited = document.components.responses.RateLimited;
for (const header of [
  "x-request-id",
  "traceparent",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "retry-after",
]) {
  assert.ok(rateLimited.headers[header], `Rate-limit response missing ${header}`);
}

const errorSchema = document.components.schemas.ErrorEnvelope;
assert.deepEqual(errorSchema.required, ["error"]);
assert.deepEqual(errorSchema.properties.error.required, ["code", "message"]);
assert.equal(document.components.securitySchemes.ApiKey.name, "x-api-key");

console.log(JSON.stringify({
  scenario: "gateway-openapi-contract",
  openapi: document.openapi,
  healthAndReadiness: true,
  authenticatedProxy: true,
  deterministicFailureStatuses: [401, 413, 429, 502, 503, 504],
  correlationHeaders: true,
  rateLimitHeaders: true,
}, null, 2));
