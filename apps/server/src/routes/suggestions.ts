import { createHash, timingSafeEqual } from 'node:crypto';
import { LEG_MODES, type RouteSuggestion, type RouteSuggestionInput } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';
import { limitByIp } from '../services/rateLimit.js';

const place = {
  type: 'object',
  required: ['name', 'lat', 'lng'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
  },
} as const;

/**
 * Commuters suggest routes the app does not know (from an empty search). Suggestions are
 * only stored for review: unverified routes are never used for planning.
 */
export const suggestionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: RouteSuggestionInput; Reply: Pick<RouteSuggestion, 'id' | 'status'> }>(
    '/suggestions',
    {
      onRequest: limitByIp(() => app.transit.limits?.suggestions),
      schema: {
        tags: ['network'],
        summary: 'Suggest a route the app does not know yet',
        description:
          'Stored for review (202). Coordinates are rounded to ~100 m. Not used for planning ' +
          'until someone verifies it with operators.',
        body: {
          type: 'object',
          required: ['from', 'to'],
          additionalProperties: false,
          properties: {
            from: place,
            to: place,
            mode: { type: 'string', enum: LEG_MODES.filter((m) => m !== 'WALK') },
            routeName: { type: 'string', maxLength: 80 },
            fareInr: { type: 'integer', minimum: 0, maximum: 2000 },
            note: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const s = app.transit.suggestions.add(req.body, app.transit.now());
      req.log.info({ suggestionId: s.id }, 'route suggestion');
      return reply.code(202).send({ id: s.id, status: s.status });
    },
  );

  app.get<{ Reply: RouteSuggestion[] | { error: string } }>(
    '/suggestions',
    {
      schema: {
        tags: ['network'],
        summary: 'Pending route suggestions (reviewers only)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (req, reply) => {
      const hash = app.transit.config.adminTokenHash;
      if (!hash) return reply.code(503).send({ error: 'review_not_configured' });
      const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '')?.[1];
      const ok =
        !!token &&
        timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(hash, 'hex'));
      if (!ok) return reply.code(401).send({ error: 'invalid_admin_token' });
      return app.transit.suggestions.listPending();
    },
  );
};
