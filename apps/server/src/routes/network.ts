import type { NearbyStopsResponse, NearestLineResponse, TransitRoute } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';

interface NearbyQuery {
  lat: number;
  lng: number;
  radius: number;
}

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: TransitRoute[] }>(
    '/routes',
    { schema: { tags: ['network'], summary: 'All routes with headways and service hours' } },
    async () => app.transit.network.listRoutes(),
  );

  app.get<{ Querystring: { lat: number; lng: number } }>(
    '/routes/nearest',
    {
      schema: {
        tags: ['network'],
        summary: 'Closest route corridor to a point, with the point snapped onto it',
        querystring: {
          type: 'object',
          required: ['lat', 'lng'],
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
          },
        },
      },
    },
    async (req, reply) => {
      const nearest = app.transit.network.nearestLine(req.query);
      if (!nearest) return reply.code(404).send({ error: 'no_routes' });
      return nearest satisfies NearestLineResponse;
    },
  );

  app.get<{ Querystring: NearbyQuery; Reply: NearbyStopsResponse }>(
    '/stops/nearby',
    {
      schema: {
        tags: ['network'],
        summary: 'Stops within a radius, nearest first',
        querystring: {
          type: 'object',
          required: ['lat', 'lng'],
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            radius: { type: 'integer', minimum: 1, maximum: 2000, default: 300 },
          },
        },
      },
    },
    async (req) => {
      const { lat, lng, radius } = req.query;
      return { stops: app.transit.network.nearbyStops({ lat, lng }, radius) };
    },
  );
};
