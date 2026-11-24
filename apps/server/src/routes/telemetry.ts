import { REPORT_KINDS, type StandReport } from '@transit/shared-types';
import type { FastifyPluginAsync } from 'fastify';

export const telemetryRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: StandReport }>(
    '/telemetry/reports',
    {
      schema: {
        tags: ['live'],
        summary: 'Driver / marshal report from a stand',
        description: 'Updates the stand state and pushes `stand.status` to live subscribers.',
        body: {
          type: 'object',
          required: ['standId', 'kind', 'reportedAt'],
          properties: {
            standId: { type: 'string', minLength: 1, maxLength: 64 },
            kind: { type: 'string', enum: [...REPORT_KINDS] },
            passengerCount: { type: 'integer', minimum: 0, maximum: 500 },
            reportedAt: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { stands } = app.transit;
      if (!stands.has(req.body.standId)) return reply.code(404).send({ error: 'stand_not_found' });
      const stand = stands.apply(req.body);
      req.log.info({ standId: stand.standId, kind: req.body.kind }, 'stand report');
      return reply.code(202).send({ accepted: true, stand });
    },
  );
};
