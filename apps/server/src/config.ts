import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // apps/server/{src,dist}
const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigin: string | boolean;
  gtfsDir: string;
  /** OpenTripPlanner base URL, e.g. http://otp:8080. Unset = built-in planner only. */
  otpUrl: string | undefined;
  /** Synthetic vehicles moving along routes (until real driver GPS is live). */
  simulateVehicles: boolean;
  /** Synthetic marshal reports at random stands (makes demos lively; off for tests/pilots). */
  simulateReports: boolean;
  /**
   * Demo/test only: route and simulate as if the local (IST) time were this "HH:MM",
   * advancing in real time from startup. Stand reports keep real timestamps.
   */
  demoTimeOfDay: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const simulate = bool(env.SIMULATE, env.NODE_ENV !== 'production');
  const demo = env.DEMO_TIME_OF_DAY?.trim();
  if (demo && !/^([01]\d|2[0-3]):[0-5]\d$/.test(demo)) {
    throw new Error(`DEMO_TIME_OF_DAY must be HH:MM, got "${demo}"`);
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN ?? true,
    gtfsDir: env.GTFS_DIR ?? resolve(here, '../../../data/gtfs/delhi-pilot'),
    otpUrl: env.OTP_URL || undefined,
    simulateVehicles: bool(env.SIMULATE_VEHICLES, simulate),
    simulateReports: bool(env.SIMULATE_REPORTS, simulate),
    demoTimeOfDay: demo || undefined,
  };
}
