/**
 * Small in-memory fixed-window limiter for credential endpoints (single-instance app).
 * Only *failed* attempts are counted, so normal use from one household IP is never blocked.
 * Keys combine IP and username so one IP can't spray many usernames and one username can't
 * be brute-forced from many places.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const e = this.failures.get(key);
    return !!e && e.resetAt > now && e.count >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    const e = this.failures.get(key);
    if (!e || e.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
    } else {
      e.count += 1;
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private sweep(now: number) {
    if (this.failures.size < 10_000) return;
    for (const [k, v] of this.failures) if (v.resetAt <= now) this.failures.delete(k);
  }
}
