import type { LatLng, PlanResponse } from '@transit/shared-types';
import type { FastifyBaseLogger } from 'fastify';
import type { OtpClient } from './otp.js';
import type { Planner, PlanOptions } from './planner.js';

export type PlanSource = 'otp' | 'builtin';

/**
 * OpenTripPlanner when configured (street-accurate walking, larger networks),
 * the built-in frequency planner otherwise, and as a fallback when OTP is down.
 */
export class PlanService {
  constructor(
    private readonly builtin: Planner,
    private readonly otp: OtpClient | undefined,
    private readonly log?: FastifyBaseLogger,
  ) {}

  async plan(
    from: LatLng,
    to: LatLng,
    opts: PlanOptions,
  ): Promise<{ plan: PlanResponse; source: PlanSource }> {
    if (this.otp) {
      try {
        const plan = await this.otp.plan(from, to, opts);
        if (plan.itineraries.length) return { plan, source: 'otp' };
      } catch (err) {
        this.log?.warn({ err }, 'OTP failed; using built-in planner');
      }
    }
    return { plan: this.builtin.plan(from, to, opts), source: 'builtin' };
  }
}
