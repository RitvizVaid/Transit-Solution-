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
import { standRoutes } from './routes/stands.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { OtpClient } from './services/otp.js';
import { Planner } from './services/planner.js';
import { PlanService } from './services/planService.js';
import { mulberry32, randomReport, simulatedPositions } from './services/simulator.js';
import { StandStore } from './services/stands.js';
import { serviceClock } from './services/time.js';
import { LiveHub } from './websocket/hub.js';

export interface Transit {
  config: ServerConfig;
  network: TransitNetwork;
  stands: StandStore;
  planner: PlanService;
  hub: LiveHub;
  /** Clock for routing and simulation (real time, or DEMO_TIME_OF_DAY). */
  serviceNow: () => Date;
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
  const app = Fastify(opts);

  const network = TransitNetwork.load(config.gtfsDir);
  const stands = new StandStore(network, now);
  const hub = new LiveHub(() => stands.list());
  const otp = config.otpUrl ? new OtpClient(config.otpUrl, network, stands, fetchImpl) : undefined;
  const planner = new PlanService(new Planner(network, stands), otp, app.log);
  stands.on('change', (s) => hub.publishStand(s));
  const serviceNow = serviceClock(config.demoTimeOfDay);
  app.decorate('transit', { config, network, stands, planner, hub, serviceNow });
  if (config.demoTimeOfDay) {
    app.log.warn(`DEMO_TIME_OF_DAY=${config.demoTimeOfDay}: routing/simulation clock is shifted (demo/test only)`);
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
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(websocket);

  await app.register(healthRoutes);
  await app.register(planRoutes, { prefix: '/api/v1' });
  await app.register(networkRoutes, { prefix: '/api/v1' });
  await app.register(standRoutes, { prefix: '/api/v1' });
  await app.register(telemetryRoutes, { prefix: '/api/v1' });
  await app.register(liveRoutes, { prefix: '/api/v1' });

  if (config.simulateVehicles || config.simulateReports) {
    const rng = mulberry32(20261124);
    let tick = 0;
    const timer = setInterval(() => {
      if (config.simulateVehicles) hub.publishVehicles(simulatedPositions(network, serviceNow()));
      // A stand report roughly every 10 s, so cards and the map visibly change.
      if (config.simulateReports && ++tick % 5 === 0) {
        const all = network.stands();
        const stand = all[Math.floor(rng() * all.length)];
        if (stand) {
          stands.apply({
            standId: stand.id,
            kind: randomReport(rng),
            reportedAt: new Date().toISOString(),
          });
        }
      }
    }, 2000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
    app.log.info(
      { vehicles: config.simulateVehicles, reports: config.simulateReports },
      'simulation on (SIMULATE / SIMULATE_VEHICLES / SIMULATE_REPORTS)',
    );
  }

  return app;
}
