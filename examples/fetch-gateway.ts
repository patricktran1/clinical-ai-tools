import {
  InMemoryTokenBucketStore,
  createTenantGateway,
} from "@patricktran1/clinical-evidence-guardrails";

const tenantDirectory = new Map([
  [
    "development-key",
    {
      id: "dermatology-demo",
      upstreamBaseUrl: "https://evidence.internal.example/v1",
      rateLimit: {
        capacity: 60,
        refillTokens: 60,
        refillIntervalMs: 60_000,
      },
    },
  ],
]);

export const gateway = createTenantGateway({
  resolveTenant: (apiKey) => tenantDirectory.get(apiKey) ?? null,
  rateLimitStore: new InMemoryTokenBucketStore(),
  timeoutMs: 10_000,
  maxBodyBytes: 256_000,
});

// Example for a framework route handler that exposes the Fetch API.
export async function POST(request: Request): Promise<Response> {
  return gateway(request);
}
