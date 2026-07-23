import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTokenBucketStore,
  RedisTokenBucketStore,
  validateRateLimitPolicy,
  type RateLimitPolicy,
  type RedisEvalClient,
} from "../dist/index.js";

const policy: RateLimitPolicy = {
  capacity: 2,
  refillTokens: 2,
  refillIntervalMs: 1_000,
};

test("isolates token buckets by tenant key and refills deterministically", async () => {
  const store = new InMemoryTokenBucketStore();

  assert.deepEqual(await store.consume("tenant-a:GET /cards", policy, 0), {
    allowed: true,
    limit: 2,
    remaining: 1,
    retryAfterMs: 0,
    resetAtMs: 500,
  });
  assert.equal((await store.consume("tenant-a:GET /cards", policy, 0)).remaining, 0);

  const blocked = await store.consume("tenant-a:GET /cards", policy, 0);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 500);

  const otherTenant = await store.consume("tenant-b:GET /cards", policy, 0);
  assert.equal(otherTenant.allowed, true);
  assert.equal(otherTenant.remaining, 1);

  const refilled = await store.consume("tenant-a:GET /cards", policy, 500);
  assert.equal(refilled.allowed, true);
  assert.equal(refilled.remaining, 0);
});

test("does not mint tokens when the clock moves backward", async () => {
  const store = new InMemoryTokenBucketStore();
  await store.consume("tenant", { ...policy, capacity: 1 }, 1_000);

  const blocked = await store.consume("tenant", { ...policy, capacity: 1 }, 500);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});

test("clears process-local buckets explicitly", async () => {
  const store = new InMemoryTokenBucketStore();
  await store.consume("tenant", { ...policy, capacity: 1 }, 0);
  assert.equal((await store.consume("tenant", { ...policy, capacity: 1 }, 0)).allowed, false);

  store.clear();
  assert.equal((await store.consume("tenant", { ...policy, capacity: 1 }, 0)).allowed, true);
});

test("rejects unsafe policies and keys", async () => {
  assert.throws(
    () => validateRateLimitPolicy({ ...policy, capacity: 0 }),
    /capacity/i,
  );
  assert.throws(
    () => validateRateLimitPolicy({ ...policy, refillTokens: Number.NaN }),
    /refillTokens/i,
  );
  assert.throws(
    () => validateRateLimitPolicy({ ...policy, refillIntervalMs: -1 }),
    /refillIntervalMs/i,
  );

  const store = new InMemoryTokenBucketStore();
  await assert.rejects(() => store.consume(" ", policy, 0), /key/i);
  await assert.rejects(() => store.consume("tenant", policy, Number.NaN), /nowMs/i);
});

test("uses one atomic Redis script and parses its decision", async () => {
  const calls: Array<{
    script: string;
    keys: readonly string[];
    arguments_: readonly string[];
  }> = [];
  const client: RedisEvalClient = {
    async eval(script, keys, arguments_) {
      calls.push({ script, keys, arguments_ });
      return [1, "4", 0, "2500"];
    },
  };
  const store = new RedisTokenBucketStore(client, "gateway");
  const decision = await store.consume(
    "tenant-a:POST /evidence",
    { capacity: 5, refillTokens: 1, refillIntervalMs: 1_000 },
    2_000,
  );

  assert.deepEqual(decision, {
    allowed: true,
    limit: 5,
    remaining: 4,
    retryAfterMs: 0,
    resetAtMs: 2_500,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.keys, ["gateway:tenant-a:POST /evidence"]);
  assert.deepEqual(calls[0]?.arguments_.slice(0, 4), ["5", "1", "1000", "2000"]);
  assert.match(calls[0]?.script ?? "", /HMGET/);
  assert.match(calls[0]?.script ?? "", /HSET/);
  assert.match(calls[0]?.script ?? "", /PEXPIRE/);
});

test("fails closed on malformed Redis responses", async () => {
  const incomplete: RedisEvalClient = {
    async eval() {
      return [1];
    },
  };
  const invalid: RedisEvalClient = {
    async eval() {
      return [1, "not-a-number", 0, 1000];
    },
  };

  await assert.rejects(
    () => new RedisTokenBucketStore(incomplete).consume("tenant", policy, 0),
    /incomplete/i,
  );
  await assert.rejects(
    () => new RedisTokenBucketStore(invalid).consume("tenant", policy, 0),
    /remaining tokens/i,
  );
});
