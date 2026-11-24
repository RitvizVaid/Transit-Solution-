import type { StandStatus } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';

export const standRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: StandStatus[] }>(
    '/stands',
    { schema: { tags: ['live'], summary: 'Current status of every marshalled stand' } },
    async () => app.transit.stands.list(),
  );

  app.get<{ Params: { standId: string } }>(
    '/stands/:standId',
    { schema: { tags: ['live'], summary: 'Current status of one stand' } },
    async (req, reply) => {
      const stand = app.transit.stands.get(req.params.standId);
      if (!stand) return reply.code(404).send({ error: 'stand_not_found' });
      return stand;
    },
  );
};
