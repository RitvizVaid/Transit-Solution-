import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { hide: true } }, async () => {
    const { network, config, hub } = app.transit;
    return {
      status: 'ok',
      feedVersion: network.feedVersion,
      routes: network.routes.size,
      stops: network.stops.size,
      planner: config.otpUrl ? 'otp+builtin' : 'builtin',
      simulate: { vehicles: config.simulateVehicles, reports: config.simulateReports },
      demoTimeOfDay: config.demoTimeOfDay ?? null,
      liveClients: hub.size,
    };
  });
};
