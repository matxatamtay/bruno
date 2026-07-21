class McpRateLimiter {
  constructor({ limit = 120, windowMs = 60_000, now = () => Date.now() } = {}) {
    this.limit = Math.max(1, Math.min(10_000, Number(limit) || 120));
    this.windowMs = Math.max(1_000, Math.min(3_600_000, Number(windowMs) || 60_000));
    this.now = now;
    this.buckets = new Map();
  }

  consume(key = 'anonymous') {
    const now = this.now();
    const bucketKey = String(key || 'anonymous');
    let bucket = this.buckets.get(bucketKey);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    if (bucket.count <= this.limit) {
      return { remaining: Math.max(0, this.limit - bucket.count), resetAt: bucket.resetAt };
    }
    const error = new Error(`Bruno MCP rate limit exceeded; retry after ${Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))} seconds`);
    error.code = 'BRUNO_MCP_RATE_LIMITED';
    error.statusCode = 429;
    error.retryAfterMs = Math.max(0, bucket.resetAt - now);
    throw error;
  }

  clear() {
    this.buckets.clear();
  }
}

module.exports = { McpRateLimiter };
