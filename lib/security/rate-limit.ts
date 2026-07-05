type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_EVICTIONS_PER_CALL = 32;

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

function evictExpiredBuckets(now: number): void {
  let evicted = 0;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt > now) {
      continue;
    }

    buckets.delete(key);
    evicted += 1;

    if (evicted >= MAX_EVICTIONS_PER_CALL) {
      break;
    }
  }
}

export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const now = Date.now();
  evictExpiredBuckets(now);

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

export function clearRateLimitBucketsForTests(): void {
  buckets.clear();
}

export function getRateLimitBucketCountForTests(): number {
  return buckets.size;
}
