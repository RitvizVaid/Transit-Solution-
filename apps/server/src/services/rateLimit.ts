import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fixed-window request counter per key (client IP, stand id, …). In memory, so limits are
 * per API instance, which matches the single-instance deployment.
 */
export class RateLimiter {
  private window = 0;
  private counts = new Map<string, number>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request; false when `key` is over its limit for the current window. */
  hit(key: string): boolean {
    const window = Math.floor(this.now() / this.windowMs);
    if (window !== this.window) {
      this.window = window;
      this.counts = new Map(); // previous window's keys are dropped wholesale
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.limit;
  }

  /** Seconds until the current window ends (for Retry-After). */
  retryAfterSec(): number {
    const ms = this.windowMs - (this.now() % this.windowMs);
    return Math.max(1, Math.ceil(ms / 1000));
  }
}

/**
 * Per-client-IP limit as a route `onRequest` hook. Limits are generous on purpose: many
 * Indian mobile users share one public IP (carrier-grade NAT), so this only stops floods.
 */
export function limitByIp(limiter: () => RateLimiter | null | undefined) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const l = limiter();
    if (!l || l.hit(req.ip)) return;
    return tooMany(reply, l);
  };
}

export function tooMany(reply: FastifyReply, limiter: RateLimiter) {
  return reply
    .code(429)
    .header('retry-after', String(limiter.retryAfterSec()))
    .send({ error: 'rate_limited' });
}
