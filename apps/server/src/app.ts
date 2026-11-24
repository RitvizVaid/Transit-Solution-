import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { loadConfig, type ServerConfig } from './config.js';
import { TransitNetwork } from './gtfs/network.js';
import { healthRoutes } from './routes/health.js';
import { liveRoutes } from './routes/live.js';
import { networkRoutes } from './routes/network.js';
import { planRoutes } from './routes/plan.js';
import { rideRoutes } from './routes/rides.js';
import { standRoutes } from './routes/stands.js';
import { suggestionRoutes } from './routes/suggestions.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { DelhiRealtime } from './services/delhiRealtime.js';
import { OtpClient } from './services/otp.js';
import { Planner } from './services/planner.js';
import { PlanService } from './services/planService.js';
import { RateLimiter } from './services/rateLimit.js';
import { ReportRepository } from './services/reportRepository.js';
import { RideTracker } from './services/rides.js';
import { mulberry32, randomReport, simulatedPositions } from './services/simulator.js';
import { StandStore } from './services/stands.js';
import { SuggestionRepository } from './services/suggestionRepository.js';
import { serviceClock } from './services/time.js';
import { LiveHub } from './websocket/hub.js';

export interface Transit {
  config: ServerConfig;
  network: TransitNetwork;
  stands: StandStore;
  planner: PlanService;
  hub: LiveHub;
  delhiRealtime?: DelhiRealtime;
  reports: ReportRepository;
  /** Commuter route suggestions awaiting review. */
  suggestions: SuggestionRepository;
  /** Vehicles whose position commuters are sharing while riding them. */
  rides: RideTracker;
  /** Clock for routing and simulation (real time, or DEMO_TIME_OF_DAY). */
  serviceNow: () => Date;
  /** Per-minute limiters; null when limiting is off. */
  limits: {
    plan: RateLimiter;
    rides: RateLimiter;
    suggestions: RateLimiter;
    session: RateLimiter;
    reportsPerStand: RateLimiter;
  } | null;
  /** Clock used for report freshness and event timestamps. */
  now: () => number;
}

declare module 'fastify' {
  interface FastifyInstance {
    transit: Transit;
  }
}

export interface BuildOptions extends FastifyServerOptions {
  config?: Partial<ServerConfig>;
  /** Injected for tests (OTP client). */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Builds the Fastify instance without listening, so tests can use `app.inject()`. */
export async function buildApp({ config: overrides, fetchImpl, now, ...opts }: BuildOptions = {}) {
  const config = { ...loadConfig(), ...overrides };
  const app = Fastify({ trustProxy: config.trustProxy, ...opts });

  const network = TransitNetwork.load(config.gtfsDir);
  const clock = now ?? Date.now;
  const reports = new ReportRepository(config.reportDbPath);
  const suggestions = new SuggestionRepository(config.reportDbPath);
  const stands = new StandStore(network, clock);
  stands.restore(reports.recentReports(clock()));
  const hub = new LiveHub(() => stands.list());
  const delhiRealtime = config.delhiOtdApiKey
    ? new DelhiRealtime(
        config.delhiOtdApiKey,
        (positions) => hub.publishDelhiVehicles(positions),
        (status) => hub.publishDelhiStatus(status),
        (message) => app.log.warn(message),
        fetchImpl,
        clock,
      )
    : undefined;
  if (delhiRealtime) {
    hub.publishDelhiStatus('starting');
    app.addHook('onReady', async () => delhiRealtime.start());
    app.addHook('onClose', async () => delhiRealtime.stop());
  }
  const rides = new RideTracker(network, clock);
  const perMinute = (n: number) => new RateLimiter(n, 60_000, clock);
  const limits = config.rateLimits
    ? {
        plan: perMinute(config.rateLimits.planPerIp),
        rides: perMinute(config.rateLimits.ridesPerIp),
        suggestions: perMinute(config.rateLimits.suggestionsPerIp),
        session: perMinute(config.rateLimits.sessionPerIp),
        reportsPerStand: perMinute(config.rateLimits.reportsPerStand),
      }
    : null;
  const otp = config.otpUrl ? new OtpClient(config.otpUrl, network, stands, fetchImpl) : undefined;
  const planner = new PlanService(new Planner(network, stands), otp, app.log);
  stands.on('change', (s) => hub.publishStand(s));
  const serviceNow = serviceClock(config.demoTimeOfDay);
  app.decorate('transit', {
    config,
    network,
    stands,
    planner,
    hub,
    delhiRealtime,
    reports,
    suggestions,
    rides,
    limits,
    serviceNow,
    now: clock,
  });
  app.addHook('onClose', async () => {
    reports.close();
    suggestions.close();
  });
  if (config.demoTimeOfDay) {
    app.log.warn(
      `DEMO_TIME_OF_DAY=${config.demoTimeOfDay}: routing/simulation clock is shifted (demo/test only)`,
    );
  }

  app.log.info(
    {
      feed: network.feedVersion,
      routes: network.routes.size,
      stops: network.stops.size,
      otp: !!otp,
    },
    'transit network loaded',
  );

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Transit API',
        version: '1.0.0',
        description:
          'Routing and live status for informal public transit (shared autos, e-rickshaws, shared taxis, minibuses). ' +
          'Payload types: packages/shared-types.',
      },
      tags: [
        { name: 'planning', description: 'Trip planning' },
        { name: 'network', description: 'Routes and stops' },
        { name: 'live', description: 'Stands and telemetry' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  // Client messages are tiny subscriptions; refuse anything large.
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  await app.register(healthRoutes);
  await app.register(planRoutes, { prefix: '/api/v1' });
  await app.register(networkRoutes, { prefix: '/api/v1' });
  await app.register(standRoutes, { prefix: '/api/v1' });
  await app.register(telemetryRoutes, { prefix: '/api/v1' });
  await app.register(rideRoutes, { prefix: '/api/v1' });
  await app.register(suggestionRoutes, { prefix: '/api/v1' });
  await app.register(liveRoutes, { prefix: '/api/v1' });

  // Every 2 s: refresh live vehicles (crowd-shared rides, plus demo traffic when enabled)
  // and, in demos, inject a synthetic stand report every ~10 s.
  const rng = mulberry32(20261124);
  let tick = 0;
  let hadVehicles = false;
  const timer = setInterval(() => {
    const crowd = rides.positions();
    // Where commuters are sharing a route, they replace its simulated vehicles.
    const realRoutes = new Set(crowd.map((v) => v.routeId));
    const simulated = config.simulateVehicles
      ? simulatedPositions(network, serviceNow()).filter((v) => !realRoutes.has(v.routeId))
      : [];
    const vehicles = [...simulated, ...crowd];
    if (vehicles.length || hadVehicles) hub.publishVehicles(vehicles);
    hadVehicles = vehicles.length > 0;
    // Reports older than the TTL revert to baseline: tell open apps instead of waiting.
    stands.announceExpired();

    if (config.simulateReports && ++tick % 5 === 0) {
      const all = network.stands();
      const stand = all[Math.floor(rng() * all.length)];
      if (stand) {
        stands.apply({
          reportId: `sim-${tick}`,
          standId: stand.id,
          kind: randomReport(rng),
          reportedAt: new Date().toISOString(),
        });
      }
    }
  }, 2000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
  if (config.simulateVehicles || config.simulateReports) {
    app.log.info(
      { vehicles: config.simulateVehicles, reports: config.simulateReports },
      'simulation on (SIMULATE / SIMULATE_VEHICLES / SIMULATE_REPORTS)',
    );
  }

  return app;
}
