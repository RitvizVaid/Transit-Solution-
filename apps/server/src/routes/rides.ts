import type { RideEnd, RidePosition, RidePositionResponse } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';

const rideId = {
  type: 'string',
  minLength: 16,
  maxLength: 64,
  pattern: '^[A-Za-z0-9-]+$',
} as const;

/**
 * Crowd-shared rides: a commuter on a shared auto / minibus lets their phone report
 * where the vehicle is. Anonymous by design (no account), so every fix is sanity-checked
 * and snapped to the route before anyone else sees it. See services/rides.ts.
 */
export const rideRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: RidePosition; Reply: RidePositionResponse }>(
    '/rides/positions',
    {
      schema: {
        tags: ['live'],
        summary: 'Share the position of the vehicle you are riding',
        description:
          'Accepted fixes are snapped to the route and broadcast as `vehicle.position` ' +
          '(source `crowd`). Rejected fixes return 200 with `accepted: false` and a reason, ' +
          'so the phone can tell the rider (e.g. off route) without treating it as an error.',
        body: {
          type: 'object',
          required: ['rideId', 'routeId', 'coordinates', 'recordedAt'],
          additionalProperties: false,
          properties: {
            rideId,
            routeId: { type: 'string', minLength: 1, maxLength: 64 },
            coordinates: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: [
                { type: 'number', minimum: -180, maximum: 180 },
                { type: 'number', minimum: -90, maximum: 90 },
              ],
            },
            accuracyM: { type: 'number', minimum: 0, maximum: 100_000 },
            recordedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (req) => {
      const { vehicle, ...result } = app.transit.rides.report(req.body);
      if (vehicle) app.transit.hub.publishVehicle(vehicle);
      return result;
    },
  );

  app.post<{ Body: RideEnd }>(
    '/rides/end',
    {
      schema: {
        tags: ['live'],
        summary: 'Stop sharing a ride',
        body: {
          type: 'object',
          required: ['rideId'],
          additionalProperties: false,
          properties: { rideId },
        },
      },
    },
    async (req, reply) => {
      const vehicleId = app.transit.rides.end(req.body.rideId);
      if (vehicleId) app.transit.hub.removeVehicle(vehicleId);
      return reply.code(204).send();
    },
  );
};
