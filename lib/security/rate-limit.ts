type Bucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

type NamespaceBuckets = Map<string, Bucket>;

const buckets = new Map<string, NamespaceBuckets>();
const MAX_EVICTIONS_PER_CALL = 32;
const DEFAULT_MAX_BUCKETS = 1_000;

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
  maxBuckets?: number;
  namespace?: string;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

function getEffectiveMaxBuckets(policy: RateLimitPolicy): number {
  return Math.max(1, policy.maxBuckets ?? DEFAULT_MAX_BUCKETS);
}

function getNamespace(policy: RateLimitPolicy): string {
  return policy.namespace ?? `rate-limit:${policy.limit}:${policy.windowMs}:${getEffectiveMaxBuckets(policy)}`;
}

function getNamespaceBuckets(namespace: string): NamespaceBuckets | undefined {
  return buckets.get(namespace);
}

function getOrCreateNamespaceBuckets(namespace: string): NamespaceBuckets {
  let namespaceBuckets = buckets.get(namespace);

  if (namespaceBuckets === undefined) {
    namespaceBuckets = new Map<string, Bucket>();
    buckets.set(namespace, namespaceBuckets);
  }

  return namespaceBuckets;
}

function evictExpiredBucketsForNamespace(namespaceBuckets: NamespaceBuckets, now: number): void {
  let evicted = 0;

  for (const [key, bucket] of namespaceBuckets) {
    if (bucket.resetAt > now) {
      continue;
    }

    namespaceBuckets.delete(key);
    evicted += 1;

    if (evicted >= MAX_EVICTIONS_PER_CALL) {
      break;
    }
  }
}

function evictExpiredBuckets(now: number): void {
  for (const [namespace, namespaceBuckets] of buckets) {
    evictExpiredBucketsForNamespace(namespaceBuckets, now);

    if (namespaceBuckets.size === 0) {
      buckets.delete(namespace);
    }
  }
}

export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const now = Date.now();
  evictExpiredBuckets(now);

  const namespace = getNamespace(policy);
  const namespaceBuckets = getNamespaceBuckets(namespace);
  const current = namespaceBuckets?.get(key);
  const maxBuckets = getEffectiveMaxBuckets(policy);

  if (current === undefined && (namespaceBuckets?.size ?? 0) >= maxBuckets) {
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
  getOrCreateNamespaceBuckets(namespace).set(key, bucket);

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
  evictExpiredBuckets(Date.now());

  let count = 0;

  for (const namespaceBuckets of buckets.values()) {
    count += namespaceBuckets.size;
  }

  return count;
}
