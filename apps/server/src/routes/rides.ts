import {
  OCCUPANCY_LEVELS,
  type ArrivalsResponse,
  type RideEnd,
  type RidePosition,
  type RidePositionResponse,
} from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import { limitByIp } from '../services/rateLimit.js';

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
      onRequest: limitByIp(() => app.transit.limits?.rides),
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
            occupancy: { type: 'string', enum: [...OCCUPANCY_LEVELS] },
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
      onRequest: limitByIp(() => app.transit.limits?.rides),
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

  app.get<{
    Querystring: { stopId: string; routeId?: string; towardsStopId?: string };
    Reply: ArrivalsResponse | { error: string };
  }>(
    '/arrivals',
    {
      schema: {
        tags: ['live'],
        summary: 'Vehicles riders are sharing that are heading to a stop',
        description:
          'Only crowd-shared vehicles are used (never simulated ones). Empty when nobody ' +
          'on an approaching vehicle is sharing; clients then fall back to the headway.',
        querystring: {
          type: 'object',
          required: ['stopId'],
          properties: {
            stopId: { type: 'string', minLength: 1, maxLength: 64 },
            routeId: { type: 'string', minLength: 1, maxLength: 64 },
            towardsStopId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const { stopId, routeId, towardsStopId } = req.query;
      if (!app.transit.network.stops.has(stopId)) {
        return reply.code(404).send({ error: 'stop_not_found' });
      }
      return { stopId, arrivals: app.transit.rides.arrivals(stopId, routeId, towardsStopId) };
    },
  );
};
