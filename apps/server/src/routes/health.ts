import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { hide: true } }, async () => {
    const { network, config, hub, delhiRealtime } = app.transit;
    return {
      status: 'ok',
      feedVersion: network.feedVersion,
      routes: network.routes.size,
      stops: network.stops.size,
      planner: config.otpUrl ? 'otp+builtin' : 'builtin',
      reportingConfigured: Object.keys(config.reportTokenHashes).length > 0,
      simulate: { vehicles: config.simulateVehicles, reports: config.simulateReports },
      demoTimeOfDay: config.demoTimeOfDay ?? null,
      liveClients: hub.size,
      delhiRealtime: delhiRealtime
        ? { status: delhiRealtime.status, lastSuccess: delhiRealtime.lastSuccess }
        : { status: 'disabled', lastSuccess: null },
    };
  });
};
