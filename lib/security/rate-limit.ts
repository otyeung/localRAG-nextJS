type Bucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_EVICTIONS_PER_CALL = 32;
const DEFAULT_MAX_BUCKETS = 1_000;

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
  maxBuckets?: number;
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

function getEffectiveMaxBuckets(policy: RateLimitPolicy): number {
  return Math.max(1, policy.maxBuckets ?? DEFAULT_MAX_BUCKETS);
}

export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const now = Date.now();
  evictExpiredBuckets(now);

  const current = buckets.get(key);
  const maxBuckets = getEffectiveMaxBuckets(policy);

  if (current === undefined && buckets.size >= maxBuckets) {
   return {
     allowed: false,
     remaining: 0,
     resetAt: new Date(now + policy.windowMs),
   };
  }

  const bucket =
   current === undefined
     ? { count: 0, resetAt: now + policy.windowMs, lastSeenAt: now }
     : current.resetAt > now
       ? current
       : { ...current, count: 0, resetAt: now + policy.windowMs, lastSeenAt: now };

  bucket.count += 1;
  bucket.lastSeenAt = now;
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
