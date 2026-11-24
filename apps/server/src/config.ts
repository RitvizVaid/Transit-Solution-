import { createHash } from 'node:crypto';
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
  /** SHA-256 digests of per-stand report tokens, keyed by stand id. */
  reportTokenHashes: Record<string, string>;
  /** SHA-256 of the reviewer token for GET /suggestions; null = review API disabled. */
  adminTokenHash: string | null;
  /** SQLite database for accepted stand reports. */
  reportDbPath: string;
  /** Trust X-Forwarded-For (API behind nginx / a managed proxy) for client IPs. */
  trustProxy: boolean;
  /** Per-minute request limits; `false` disables limiting (local e2e only). */
  rateLimits:
    | {
        /** GET /plan per client IP. */
        planPerIp: number;
        /** POST /rides/* per client IP (many riders can share one carrier IP). */
        ridesPerIp: number;
        /** POST /suggestions per client IP. */
        suggestionsPerIp: number;
        /** POST /telemetry/session per client IP (token guessing). */
        sessionPerIp: number;
        /** POST /telemetry/reports per stand. */
        reportsPerStand: number;
      }
    | false;
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
  const reportTokenHashes: Record<string, string> = {};
  const seenTokenHashes = new Set<string>();
  if (env.REPORT_TOKENS_JSON) {
    let tokens: unknown;
    try {
      tokens = JSON.parse(env.REPORT_TOKENS_JSON);
    } catch (err) {
      throw new Error('REPORT_TOKENS_JSON must be a JSON object of stand ids to tokens', {
        cause: err,
      });
    }
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
      throw new Error('REPORT_TOKENS_JSON must be a JSON object of stand ids to tokens');
    }
    for (const [standId, token] of Object.entries(tokens)) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(standId)) {
        throw new Error(`REPORT_TOKENS_JSON has an invalid stand id "${standId}"`);
      }
      if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32) {
        throw new Error(`REPORT_TOKENS_JSON token for "${standId}" must be at least 32 bytes`);
      }
      const hash = createHash('sha256').update(token).digest('hex');
      if (seenTokenHashes.has(hash)) {
        throw new Error(`REPORT_TOKENS_JSON tokens must be unique (duplicate for "${standId}")`);
      }
      seenTokenHashes.add(hash);
      reportTokenHashes[standId] = hash;
    }
  }
  // Real marshal reports must never be mixed with random synthetic ones. When reporting is
  // configured, simulated reports default to off; asking for both explicitly is an error.
  const reportingConfigured = Object.keys(reportTokenHashes).length > 0;
  if (
    reportingConfigured &&
    env.SIMULATE_REPORTS !== undefined &&
    bool(env.SIMULATE_REPORTS, false)
  ) {
    throw new Error(
      'SIMULATE_REPORTS=true cannot be combined with REPORT_TOKENS_JSON (real reports would be ' +
        'mixed with synthetic ones)',
    );
  }
  const simulateReports = !reportingConfigured && bool(env.SIMULATE_REPORTS, simulate);
  if (demo && !/^([01]\d|2[0-3]):[0-5]\d$/.test(demo)) {
    throw new Error(`DEMO_TIME_OF_DAY must be HH:MM, got "${demo}"`);
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN ?? true,
    gtfsDir: env.GTFS_DIR ?? resolve(here, '../../../data/gtfs/delhi-pilot'),
    otpUrl: env.OTP_URL || undefined,
    reportTokenHashes,
    adminTokenHash: env.ADMIN_TOKEN ? adminHash(env.ADMIN_TOKEN) : null,
    reportDbPath: env.REPORT_DB_PATH ?? resolve(here, '../../../.local/reports.sqlite'),
    simulateVehicles: bool(env.SIMULATE_VEHICLES, simulate),
    simulateReports,
    trustProxy: bool(env.TRUST_PROXY, true),
    rateLimits: bool(env.RATE_LIMIT, true)
      ? {
          planPerIp: 120,
          ridesPerIp: 240,
          suggestionsPerIp: 10,
          sessionPerIp: 20,
          reportsPerStand: 30,
        }
      : false,
    demoTimeOfDay: demo || undefined,
  };
}

function adminHash(token: string): string {
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error('ADMIN_TOKEN must be at least 32 bytes');
  }
  return createHash('sha256').update(token).digest('hex');
}
