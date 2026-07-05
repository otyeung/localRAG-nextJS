type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const now = Date.now();
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + policy.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: bucket.count <= policy.limit,
    remaining: Math.max(policy.limit - bucket.count, 0),
    resetAt: new Date(bucket.resetAt),
  };
}
