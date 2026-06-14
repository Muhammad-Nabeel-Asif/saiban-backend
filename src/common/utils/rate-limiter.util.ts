type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export class RateLimiter {
  private readonly hits = new Map<string, RateLimitEntry>();

  /** Returns true when the request is allowed, false when rate limited. */
  check(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= max) {
      return false;
    }

    entry.count += 1;
    return true;
  }
}
