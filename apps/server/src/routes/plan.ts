import type { PlanRequest, PlanResponse } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';

const lat = { type: 'number', minimum: -90, maximum: 90 } as const;
const lng = { type: 'number', minimum: -180, maximum: 180 } as const;
const name = { type: 'string', maxLength: 120 } as const;

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: PlanRequest; Reply: PlanResponse | { error: string } }>(
    '/plan',
    {
      schema: {
        tags: ['planning'],
        summary: 'Plan a trip between two points',
        description:
          'Up to 3 itineraries combining walking with informal routes (max one transfer). ' +
          'Durations include expected waits. Response header `x-planner` is `otp` or `builtin`.',
        querystring: {
          type: 'object',
          required: ['fromLat', 'fromLng', 'toLat', 'toLng'],
          properties: {
            fromLat: lat,
            fromLng: lng,
            toLat: lat,
            toLng: lng,
            fromName: name,
            toName: name,
            mode: { type: 'string' },
            departAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const departAt = q.departAt ? new Date(q.departAt) : app.transit.serviceNow();
      if (departAt && Number.isNaN(departAt.getTime())) {
        return reply.code(400).send({ error: 'invalid_departAt' });
      }
      const { plan, source } = await app.transit.planner.plan(
        { lat: q.fromLat, lng: q.fromLng },
        { lat: q.toLat, lng: q.toLng },
        { departAt, fromName: q.fromName, toName: q.toName },
      );
      reply.header('x-planner', source);
      return plan;
    },
  );
};
