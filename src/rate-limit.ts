export interface RateLimitPolicy {
  readonly capacity: number;
  readonly refillTokens: number;
  readonly refillIntervalMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterMs: number;
  readonly resetAtMs: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    policy: RateLimitPolicy,
    nowMs?: number,
  ): Promise<RateLimitDecision>;
}

interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export function validateRateLimitPolicy(policy: RateLimitPolicy): void {
  if (!Number.isInteger(policy.capacity) || policy.capacity <= 0) {
    throw new Error("Rate-limit capacity must be a positive integer.");
  }
  if (!Number.isFinite(policy.refillTokens) || policy.refillTokens <= 0) {
    throw new Error("Rate-limit refillTokens must be positive.");
  }
  if (!Number.isFinite(policy.refillIntervalMs) || policy.refillIntervalMs <= 0) {
    throw new Error("Rate-limit refillIntervalMs must be positive.");
  }
}

function validateKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error("Rate-limit key must not be empty.");
  return normalized;
}

function decisionFromTokens(
  tokensBeforeConsume: number,
  policy: RateLimitPolicy,
  nowMs: number,
): { decision: RateLimitDecision; remainingTokens: number } {
  const refillPerMs = policy.refillTokens / policy.refillIntervalMs;
  const allowed = tokensBeforeConsume >= 1;
  const remainingTokens = allowed ? tokensBeforeConsume - 1 : tokensBeforeConsume;
  const retryAfterMs = allowed
    ? 0
    : Math.max(1, Math.ceil((1 - remainingTokens) / refillPerMs));
  const resetAfterMs = Math.max(
    0,
    Math.ceil((policy.capacity - remainingTokens) / refillPerMs),
  );

  return {
    remainingTokens,
    decision: {
      allowed,
      limit: policy.capacity,
      remaining: Math.max(0, Math.floor(remainingTokens)),
      retryAfterMs,
      resetAtMs: nowMs + resetAfterMs,
    },
  };
}

/**
 * Process-local token bucket suitable for development, tests, and single-node
 * deployments. Multi-node deployments should use a shared store such as the
 * Redis adapter below.
 */
export class InMemoryTokenBucketStore implements RateLimitStore {
  readonly #buckets = new Map<string, BucketState>();

  async consume(
    key: string,
    policy: RateLimitPolicy,
    nowMs = Date.now(),
  ): Promise<RateLimitDecision> {
    const normalizedKey = validateKey(key);
    validateRateLimitPolicy(policy);
    if (!Number.isFinite(nowMs)) throw new Error("nowMs must be finite.");

    const previous = this.#buckets.get(normalizedKey) ?? {
      tokens: policy.capacity,
      updatedAtMs: nowMs,
    };
    const elapsedMs = Math.max(0, nowMs - previous.updatedAtMs);
    const refilledTokens = Math.min(
      policy.capacity,
      previous.tokens +
        elapsedMs * (policy.refillTokens / policy.refillIntervalMs),
    );
    const { decision, remainingTokens } = decisionFromTokens(
      refilledTokens,
      policy,
      nowMs,
    );

    this.#buckets.set(normalizedKey, {
      tokens: remainingTokens,
      updatedAtMs: nowMs,
    });

    return decision;
  }

  clear(): void {
    this.#buckets.clear();
  }
}

export interface RedisEvalClient {
  eval(
    script: string,
    keys: readonly string[],
    arguments_: readonly string[],
  ): Promise<readonly unknown[]>;
}

const REDIS_TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_tokens = tonumber(ARGV[2])
local refill_interval_ms = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

local state = redis.call('HMGET', key, 'tokens', 'updated_at_ms')
local tokens = tonumber(state[1])
local updated_at_ms = tonumber(state[2])

if tokens == nil then tokens = capacity end
if updated_at_ms == nil then updated_at_ms = now_ms end

local elapsed_ms = math.max(0, now_ms - updated_at_ms)
local refill_per_ms = refill_tokens / refill_interval_ms
tokens = math.min(capacity, tokens + (elapsed_ms * refill_per_ms))

local allowed = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
end

local remaining = math.max(0, math.floor(tokens))
local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = math.max(1, math.ceil((1 - tokens) / refill_per_ms))
end
local reset_at_ms = now_ms + math.max(0, math.ceil((capacity - tokens) / refill_per_ms))

redis.call('HSET', key, 'tokens', tokens, 'updated_at_ms', now_ms)
redis.call('PEXPIRE', key, ttl_ms)

return { allowed, remaining, retry_after_ms, reset_at_ms }
`;

function asFiniteNumber(value: unknown, label: string): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Redis rate-limit response contained invalid ${label}.`);
  }
  return numberValue;
}

/**
 * Atomic Redis token bucket. The adapter accepts a deliberately small client
 * interface so callers can use their existing Redis library without adding a
 * runtime dependency to this package.
 */
export class RedisTokenBucketStore implements RateLimitStore {
  readonly #client: RedisEvalClient;
  readonly #prefix: string;

  constructor(client: RedisEvalClient, prefix = "clinical-evidence:rate-limit") {
    this.#client = client;
    this.#prefix = validateKey(prefix);
  }

  async consume(
    key: string,
    policy: RateLimitPolicy,
    nowMs = Date.now(),
  ): Promise<RateLimitDecision> {
    const normalizedKey = validateKey(key);
    validateRateLimitPolicy(policy);
    if (!Number.isFinite(nowMs)) throw new Error("nowMs must be finite.");

    const refillPerMs = policy.refillTokens / policy.refillIntervalMs;
    const ttlMs = Math.max(
      policy.refillIntervalMs,
      Math.ceil((policy.capacity / refillPerMs) * 2),
    );
    const result = await this.#client.eval(
      REDIS_TOKEN_BUCKET_SCRIPT,
      [`${this.#prefix}:${normalizedKey}`],
      [
        String(policy.capacity),
        String(policy.refillTokens),
        String(policy.refillIntervalMs),
        String(nowMs),
        String(ttlMs),
      ],
    );

    if (result.length < 4) {
      throw new Error("Redis rate-limit response was incomplete.");
    }

    return {
      allowed: asFiniteNumber(result[0], "allowed flag") === 1,
      limit: policy.capacity,
      remaining: Math.max(0, Math.floor(asFiniteNumber(result[1], "remaining tokens"))),
      retryAfterMs: Math.max(0, Math.ceil(asFiniteNumber(result[2], "retry delay"))),
      resetAtMs: Math.ceil(asFiniteNumber(result[3], "reset time")),
    };
  }
}
